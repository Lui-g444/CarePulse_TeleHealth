import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Doctor dashboard data access + form validation.
 *
 * Builds on the tables documented in `lib/booking.ts` and additionally expects:
 *
 *   profiles (id uuid pk, full_name text)
 *   consultations (
 *     id uuid pk default gen_random_uuid(),
 *     appointment_id uuid not null unique references appointments(id),
 *     doctor_id uuid not null,
 *     patient_id uuid not null,
 *     diagnosis text not null,
 *     notes text,
 *     prescriptions jsonb not null default '[]'::jsonb,
 *     created_at timestamptz not null default now()
 *   )
 *
 * The unique constraint on `consultations.appointment_id` makes saving a
 * consultation idempotent (upsert), so a failed status update can be retried.
 * Realtime requires `public.appointments` to be part of the realtime
 * publication, and the doctor's auth user id is assumed to be `doctors.id`.
 */

export const DAY_LABELS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

/** Monday-first display order for the schedule editor. */
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;

export type QueueStatus = "pending" | "confirmed" | "completed" | "cancelled";

export type QueueAppointment = {
  id: string;
  patientId: string;
  patientName: string;
  /** Local `YYYY-MM-DD`. */
  date: string;
  /** `HH:MM`. */
  time: string;
  status: QueueStatus;
  /** Whether the patient has requested a video consultation. */
  videoRequested: boolean;
  /** Latest note the patient sent about this consultation. */
  patientNote: string;
};

export type DayHours = {
  dayOfWeek: number;
  enabled: boolean;
  startTime: string;
  endTime: string;
  slotMinutes: number;
};

export type PrescriptionInput = {
  medication: string;
  dosage: string;
  frequency: string;
  duration_days: number | null;
  instructions: string;
};

export type PrescriptionDraft = {
  id: string;
  medication: string;
  dosage: string;
  frequency: string;
  durationDays: string;
  instructions: string;
};

export type PrescriptionValidation =
  | { ok: true; prescriptions: PrescriptionInput[] }
  | { ok: false; error: string };

export type ConsultationInput = {
  appointmentId: string;
  doctorId: string;
  patientId: string;
  diagnosis: string;
  notes: string;
  prescriptions: PrescriptionInput[];
};

type Row = Record<string, unknown>;

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

function rowsOf(data: unknown): Row[] {
  return Array.isArray(data) ? (data as Row[]) : [];
}

function readText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function toInteger(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
}

/** `9:00:00` / `09:00` -> `09:00`, for `<input type="time">`. */
export function toTimeInput(value: unknown): string {
  const match = /^(\d{1,2}):(\d{2})/.exec(readText(value));

  if (!match) {
    return "";
  }

  return `${match[1].padStart(2, "0")}:${match[2]}`;
}

export function normalizeQueueStatus(value: unknown): QueueStatus {
  const status = readText(value).toLowerCase();

  if (status === "confirmed" || status === "completed" || status === "cancelled") {
    return status;
  }

  return "pending";
}

export function statusLabel(status: QueueStatus): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

/** 7 days, Monday first, all disabled — the editor starts from DB values. */
export function emptyWeeklyHours(): DayHours[] {
  return DAY_ORDER.map((dayOfWeek) => ({
    dayOfWeek,
    enabled: false,
    startTime: "09:00",
    endTime: "17:00",
    slotMinutes: 30,
  }));
}

export function formatAppointmentDate(dateKey: string): string {
  const parts = dateKey.split("-").map(Number);

  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) {
    return dateKey;
  }

  const [year, month, day] = parts;

  return new Date(year, month - 1, day).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export async function fetchDoctorProfile(
  supabase: SupabaseClient,
  doctorId: string,
): Promise<{ fullName: string; specialty: string } | null> {
  const { data, error } = await supabase
    .from("doctors")
    .select("full_name, specialty")
    .eq("id", doctorId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!data || typeof data !== "object") {
    return null;
  }

  const row = data as Row;

  return {
    fullName: readText(row.full_name) || "Doctor",
    specialty: readText(row.specialty) || "General practice",
  };
}

export async function fetchDoctorWeeklyHours(
  supabase: SupabaseClient,
  doctorId: string,
): Promise<DayHours[]> {
  const { data, error } = await supabase
    .from("doctor_schedules")
    .select("day_of_week, start_time, end_time, slot_duration_minutes")
    .eq("doctor_id", doctorId);

  if (error) {
    throw new Error(error.message);
  }

  // The editor maintains one block per weekday; if the doctor has several
  // overlapping blocks saved, the first one is shown and saving replaces them.
  const byDay = new Map<number, Row>();

  for (const row of rowsOf(data)) {
    const dayOfWeek = toInteger(row.day_of_week);

    if (dayOfWeek === null || dayOfWeek < 0 || dayOfWeek > 6) {
      continue;
    }

    if (!byDay.has(dayOfWeek)) {
      byDay.set(dayOfWeek, row);
    }
  }

  return emptyWeeklyHours().map((day) => {
    const row = byDay.get(day.dayOfWeek);

    if (!row) {
      return day;
    }

    const slotMinutes = toInteger(row.slot_duration_minutes);

    return {
      ...day,
      enabled: true,
      startTime: toTimeInput(row.start_time) || day.startTime,
      endTime: toTimeInput(row.end_time) || day.endTime,
      slotMinutes:
        slotMinutes !== null && slotMinutes > 0 ? slotMinutes : day.slotMinutes,
    };
  });
}

export function validateWeeklyHours(days: DayHours[]): string | null {
  for (const day of days) {
    if (!day.enabled) {
      continue;
    }

    const label = DAY_LABELS[day.dayOfWeek];

    if (!TIME_PATTERN.test(day.startTime) || !TIME_PATTERN.test(day.endTime)) {
      return `${label}: enter a valid start and end time.`;
    }

    if (day.endTime <= day.startTime) {
      return `${label}: end time must be after the start time.`;
    }

    if (
      !Number.isInteger(day.slotMinutes) ||
      day.slotMinutes < 10 ||
      day.slotMinutes > 180
    ) {
      return `${label}: slot length must be between 10 and 180 minutes.`;
    }

    const windowMinutes =
      Number(day.endTime.slice(0, 2)) * 60 +
      Number(day.endTime.slice(3)) -
      (Number(day.startTime.slice(0, 2)) * 60 + Number(day.startTime.slice(3)));

    if (windowMinutes < day.slotMinutes) {
      return `${label}: working hours are shorter than one slot.`;
    }
  }

  return null;
}

/**
 * Replaces each weekday's block one day at a time, so a failure late in the
 * save cannot wipe the whole week.
 */
export async function saveWeeklyHours(
  supabase: SupabaseClient,
  doctorId: string,
  days: DayHours[],
): Promise<void> {
  for (const day of days) {
    const { error: deleteError } = await supabase
      .from("doctor_schedules")
      .delete()
      .eq("doctor_id", doctorId)
      .eq("day_of_week", day.dayOfWeek);

    if (deleteError) {
      throw new Error(`${DAY_LABELS[day.dayOfWeek]}: ${deleteError.message}`);
    }

    if (!day.enabled) {
      continue;
    }

    const { error: insertError } = await supabase
      .from("doctor_schedules")
      .insert({
        doctor_id: doctorId,
        day_of_week: day.dayOfWeek,
        start_time: day.startTime,
        end_time: day.endTime,
        slot_duration_minutes: day.slotMinutes,
      });

    if (insertError) {
      throw new Error(`${DAY_LABELS[day.dayOfWeek]}: ${insertError.message}`);
    }
  }
}

export async function fetchAppointmentQueue(
  supabase: SupabaseClient,
  doctorId: string,
  fromDate: string,
): Promise<QueueAppointment[]> {
  const { data, error } = await supabase
    .from("appointments")
    .select("id, patient_id, appointment_date, start_time, status, video_requested, patient_note")
    .eq("doctor_id", doctorId)
    .gte("appointment_date", fromDate)
    .order("appointment_date", { ascending: true })
    .order("start_time", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return rowsOf(data).flatMap((row) => {
    const id = readText(row.id);
    const patientId = readText(row.patient_id);
    const date = readText(row.appointment_date);
    const time = toTimeInput(row.start_time);

    if (!id || !date || !time) {
      return [];
    }

    return [
      {
        id,
        patientId,
        patientName: "",
        date,
        time,
        status: normalizeQueueStatus(row.status),
        videoRequested: row.video_requested === true,
        patientNote: readText(row.patient_note),
      },
    ];
  });
}

/** Patient names are cosmetic — a failure here must not hide the queue. */
export async function fetchPatientNames(
  supabase: SupabaseClient,
  patientIds: string[],
): Promise<Record<string, string>> {
  if (patientIds.length === 0) {
    return {};
  }

  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name")
    .in("id", patientIds);

  if (error) {
    return {};
  }

  const names: Record<string, string> = {};

  for (const row of rowsOf(data)) {
    const id = readText(row.id);
    const name = readText(row.full_name);

    if (id && name) {
      names[id] = name;
    }
  }

  return names;
}

export async function cancelDoctorAppointment(
  supabase: SupabaseClient,
  doctorId: string,
  appointmentId: string,
  reason: string,
): Promise<void> {
  const { data, error } = await supabase
    .from("appointments")
    .update({
      status: "cancelled",
      cancelled_by: doctorId,
      cancellation_reason: reason.trim() || null,
      cancelled_at: new Date().toISOString(),
    })
    .eq("id", appointmentId)
    .eq("doctor_id", doctorId)
    .in("status", ["pending", "confirmed"])
    .select("id")
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!data) {
    throw new Error("This appointment can no longer be cancelled.");
  }
}

export async function updateAppointmentStatus(
  supabase: SupabaseClient,
  doctorId: string,
  appointmentId: string,
  status: "confirmed" | "completed",
): Promise<void> {
  const { data, error } = await supabase
    .from("appointments")
    .update({ status })
    .eq("id", appointmentId)
    .eq("doctor_id", doctorId)
    .select("id")
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!data) {
    throw new Error("This appointment could not be updated.");
  }
}

export function validatePrescriptionDrafts(
  drafts: PrescriptionDraft[],
): PrescriptionValidation {
  const prescriptions: PrescriptionInput[] = [];

  for (let index = 0; index < drafts.length; index += 1) {
    const draft = drafts[index];
    const medication = draft.medication.trim();
    const dosage = draft.dosage.trim();
    const frequency = draft.frequency.trim();
    const durationRaw = draft.durationDays.trim();
    const instructions = draft.instructions.trim();
    const label = `Prescription ${index + 1}`;

    const empty =
      !medication && !dosage && !frequency && !durationRaw && !instructions;

    if (empty) {
      continue;
    }

    if (!medication) {
      return { ok: false, error: `${label}: medication is required.` };
    }

    if (!dosage) {
      return { ok: false, error: `${label}: dosage is required.` };
    }

    if (!frequency) {
      return { ok: false, error: `${label}: frequency is required.` };
    }

    let durationDays: number | null = null;

    if (durationRaw) {
      const parsed = Number(durationRaw);

      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 365) {
        return {
          ok: false,
          error: `${label}: duration must be a whole number of days between 1 and 365.`,
        };
      }

      durationDays = parsed;
    }

    prescriptions.push({
      medication,
      dosage,
      frequency,
      duration_days: durationDays,
      instructions,
    });
  }

  return { ok: true, prescriptions };
}

/**
 * Saves the consultation first (idempotent on `appointment_id`) and only then
 * completes the appointment, so a retry after a failed update cannot duplicate
 * the diagnosis.
 */
export async function completeConsultation(
  supabase: SupabaseClient,
  input: ConsultationInput,
): Promise<void> {
  const { error } = await supabase.from("consultations").upsert(
    {
      appointment_id: input.appointmentId,
      doctor_id: input.doctorId,
      patient_id: input.patientId,
      diagnosis: input.diagnosis,
      notes: input.notes.trim() || null,
      prescriptions: input.prescriptions,
    },
    { onConflict: "appointment_id" },
  );

  if (error) {
    throw new Error(error.message);
  }

  await updateAppointmentStatus(
    supabase,
    input.doctorId,
    input.appointmentId,
    "completed",
  );
}
