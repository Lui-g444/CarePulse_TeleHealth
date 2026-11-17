import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Patient dashboard data access.
 *
 * Builds on the tables documented in `lib/booking.ts`:
 *
 *   appointments (id uuid pk, patient_id uuid, doctor_id uuid,
 *                 appointment_date date, start_time time, status text,
 *                 created_at timestamptz)
 *   doctors (id uuid pk, full_name text, specialty text)
 *   profiles (id uuid pk, full_name text)
 *
 * Every query is scoped to the signed-in patient's id; row level security is
 * expected to enforce the same restriction server-side.
 */

export type PatientAppointmentStatus =
  | "pending"
  | "confirmed"
  | "completed"
  | "cancelled";

export type PatientAppointment = {
  id: string;
  doctorId: string;
  doctorName: string;
  specialty: string;
  /** Local `YYYY-MM-DD`. */
  date: string;
  /** `HH:MM`. */
  time: string;
  status: PatientAppointmentStatus;
  /** Whether the patient has requested a video consultation. */
  videoRequested: boolean;
  /** Latest note the patient sent about this consultation. */
  patientNote: string;
  /** Epoch milliseconds of the appointment start, for sorting/splitting. */
  startsAt: number;
};

type Row = Record<string, unknown>;

function rowsOf(data: unknown): Row[] {
  return Array.isArray(data) ? (data as Row[]) : [];
}

function readText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function parseTimeToMinutes(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})/.exec(value.trim());

  if (!match) {
    return null;
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);

  if (hours > 23 || minutes > 59) {
    return null;
  }

  return hours * 60 + minutes;
}

/** `9:00:00` / `09:00` -> `09:00`. */
function toTimeKey(value: string): string {
  const minutes = parseTimeToMinutes(value);

  if (minutes === null) {
    return "";
  }

  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(
    minutes % 60,
  ).padStart(2, "0")}`;
}

function toStartTimestamp(dateKey: string, timeKey: string): number | null {
  const parts = dateKey.split("-").map(Number);

  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) {
    return null;
  }

  const minutes = parseTimeToMinutes(timeKey);

  if (minutes === null) {
    return null;
  }

  const [year, month, day] = parts;

  return new Date(
    year,
    month - 1,
    day,
    Math.floor(minutes / 60),
    minutes % 60,
  ).getTime();
}

export function normalizePatientStatus(
  value: unknown,
): PatientAppointmentStatus {
  const status = readText(value).toLowerCase();

  if (
    status === "confirmed" ||
    status === "completed" ||
    status === "cancelled"
  ) {
    return status;
  }

  return "pending";
}

export function statusLabel(status: PatientAppointmentStatus): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
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

/** Doctor names are cosmetic — a failure here must not hide the appointments. */
async function fetchDoctorDirectory(
  supabase: SupabaseClient,
  doctorIds: string[],
): Promise<Record<string, { fullName: string; specialty: string }>> {
  if (doctorIds.length === 0) {
    return {};
  }

  try {
    const { data, error } = await supabase
      .from("doctors")
      .select("id, full_name, specialty")
      .in("id", doctorIds);

    if (error) {
      return {};
    }

    return Object.fromEntries(
      rowsOf(data).flatMap((row) => {
        const id = readText(row.id);

        if (!id) {
          return [];
        }

        return [
          [
            id,
            {
              fullName: readText(row.full_name) || "Doctor",
              specialty: readText(row.specialty) || "General practice",
            },
          ] as const,
        ];
      }),
    );
  } catch {
    return {};
  }
}

export async function fetchPatientProfile(
  supabase: SupabaseClient,
  patientId: string,
): Promise<{ fullName: string; phone: string; gender: string }> {
  const { data, error } = await supabase
    .from("profiles")
    .select("full_name, phone, gender")
    .eq("id", patientId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  const row = data as Row | null;

  return {
    fullName: readText(row?.full_name),
    phone: readText(row?.phone),
    gender: readText(row?.gender),
  };
}

export async function fetchPatientAppointments(
  supabase: SupabaseClient,
  patientId: string,
): Promise<PatientAppointment[]> {
  const { data, error } = await supabase
    .from("appointments")
    .select("id, doctor_id, appointment_date, start_time, status, video_requested, patient_note")
    .eq("patient_id", patientId)
    .order("appointment_date", { ascending: false })
    .order("start_time", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  const rows = rowsOf(data);
  const doctors = await fetchDoctorDirectory(supabase, [
    ...new Set(rows.map((row) => readText(row.doctor_id)).filter(Boolean)),
  ]);

  return rows.flatMap((row) => {
    const id = readText(row.id);
    const doctorId = readText(row.doctor_id);
    const date = readText(row.appointment_date);
    const time = toTimeKey(readText(row.start_time));
    const startsAt = toStartTimestamp(date, time);

    if (!id || !date || !time || startsAt === null) {
      return [];
    }

    const doctor = doctors[doctorId];

    return [
      {
        id,
        doctorId,
        doctorName: doctor?.fullName ?? "Doctor",
        specialty: doctor?.specialty ?? "General practice",
        date,
        time,
        status: normalizePatientStatus(row.status),
        videoRequested: row.video_requested === true,
        patientNote: readText(row.patient_note),
        startsAt,
      },
    ];
  });
}

export async function cancelPatientAppointment(
  supabase: SupabaseClient,
  patientId: string,
  appointmentId: string,
  reason: string,
): Promise<void> {
  const { data, error } = await supabase
    .from("appointments")
    .update({
      status: "cancelled",
      cancelled_by: patientId,
      cancellation_reason: reason.trim() || null,
      cancelled_at: new Date().toISOString(),
    })
    .eq("id", appointmentId)
    .eq("patient_id", patientId)
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

export async function sendPatientNote(
  supabase: SupabaseClient,
  patientId: string,
  appointmentId: string,
  note: string,
): Promise<void> {
  const trimmed = note.trim();

  const { data, error } = await supabase
    .from("appointments")
    .update({
      patient_note: trimmed || null,
      patient_note_at: new Date().toISOString(),
    })
    .eq("id", appointmentId)
    .eq("patient_id", patientId)
    .in("status", ["pending", "confirmed"])
    .select("id")
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!data) {
    throw new Error("This appointment can no longer receive a note.");
  }
}

export async function requestVideoCall(
  supabase: SupabaseClient,
  patientId: string,
  appointmentId: string,
): Promise<void> {
  const { data, error } = await supabase
    .from("appointments")
    .update({
      video_requested: true,
      video_requested_at: new Date().toISOString(),
    })
    .eq("id", appointmentId)
    .eq("patient_id", patientId)
    .in("status", ["pending", "confirmed"])
    .select("id")
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!data) {
    throw new Error("This appointment can no longer request a video call.");
  }
}

/**
 * Splits appointments into what is still ahead (pending/confirmed, not yet
 * started) and the visit history (anything finished, cancelled or overdue).
 */
export function splitPatientAppointments(
  appointments: PatientAppointment[],
  now: Date = new Date(),
): { upcoming: PatientAppointment[]; past: PatientAppointment[] } {
  const cutoff = now.getTime();
  const upcoming: PatientAppointment[] = [];
  const past: PatientAppointment[] = [];

  for (const appointment of appointments) {
    const isFinished =
      appointment.status === "completed" || appointment.status === "cancelled";

    if (!isFinished && appointment.startsAt > cutoff) {
      upcoming.push(appointment);
    } else {
      past.push(appointment);
    }
  }

  upcoming.sort((a, b) => a.startsAt - b.startsAt);
  past.sort((a, b) => b.startsAt - a.startsAt);

  return { upcoming, past };
}
