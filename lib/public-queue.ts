import type { SupabaseClient } from "@supabase/supabase-js";
import {
  formatAppointmentDate,
  normalizeQueueStatus,
  toTimeInput,
  type QueueStatus,
} from "@/lib/doctor";

/**
 * Read access for the landing page's live appointment queue.
 *
 * The browser reads `public.appointment_feed` — a trigger-maintained mirror of
 * `appointments` that only carries the initials of the patient, never a name.
 * `appointments` itself stays closed to anonymous visitors, so the marketing
 * page can show a genuine live schedule without leaking patient identities.
 * The table, trigger, policies and realtime publication live in
 * `supabase/schema.sql`.
 */

export type PublicQueueEntry = {
  id: string;
  doctorId: string;
  /** Two letters derived from the patient's name, e.g. `AY`. */
  initials: string;
  /** Local `YYYY-MM-DD`. */
  date: string;
  /** `HH:MM`. */
  time: string;
  status: QueueStatus;
};

export type PublicQueueDoctor = {
  fullName: string;
  specialty: string;
};

export type PublicQueue = {
  entries: PublicQueueEntry[];
  doctors: Record<string, PublicQueueDoctor>;
};

type Row = Record<string, unknown>;

const QUEUE_LIMIT = 4;

function rowsOf(data: unknown): Row[] {
  return Array.isArray(data) ? (data as Row[]) : [];
}

function readText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Only pending and confirmed visits are still ahead of the doctor. */
export async function fetchPublicQueue(
  supabase: SupabaseClient,
  todayKey: string,
  limit = QUEUE_LIMIT,
): Promise<PublicQueueEntry[]> {
  const { data, error } = await supabase
    .from("appointment_feed")
    .select(
      "appointment_id, doctor_id, appointment_date, start_time, status, patient_initials",
    )
    .gte("appointment_date", todayKey)
    .in("status", ["pending", "confirmed"])
    .order("appointment_date", { ascending: true })
    .order("start_time", { ascending: true })
    .limit(limit);

  if (error) {
    throw new Error(error.message);
  }

  return rowsOf(data).flatMap((row) => {
    const id = readText(row.appointment_id);
    const date = readText(row.appointment_date);
    const time = toTimeInput(row.start_time);

    if (!id || !date || !time) {
      return [];
    }

    return [
      {
        id,
        doctorId: readText(row.doctor_id),
        initials: readText(row.patient_initials),
        date,
        time,
        status: normalizeQueueStatus(row.status),
      },
    ];
  });
}

/** Doctor names are cosmetic — a failure here must not hide the queue. */
export async function fetchPublicQueueDoctors(
  supabase: SupabaseClient,
): Promise<Record<string, PublicQueueDoctor>> {
  const { data, error } = await supabase
    .from("doctors")
    .select("id, full_name, specialty");

  if (error) {
    return {};
  }

  const doctors: Record<string, PublicQueueDoctor> = {};

  for (const row of rowsOf(data)) {
    const id = readText(row.id);

    if (!id) {
      continue;
    }

    doctors[id] = {
      fullName: readText(row.full_name),
      specialty: readText(row.specialty),
    };
  }

  return doctors;
}

/** `Today`, `Tomorrow`, or `Mon, Nov 10` — for the queue's date column. */
export function formatQueueDay(dateKey: string, todayKey: string): string {
  if (dateKey === todayKey) {
    return "Today";
  }

  const today = todayKey.split("-").map(Number);
  const date = dateKey.split("-").map(Number);

  if (today.length === 3 && date.length === 3) {
    const tomorrow = new Date(today[0], today[1] - 1, today[2] + 1);
    const tomorrowKey = `${tomorrow.getFullYear()}-${String(
      tomorrow.getMonth() + 1,
    ).padStart(2, "0")}-${String(tomorrow.getDate()).padStart(2, "0")}`;

    if (dateKey === tomorrowKey) {
      return "Tomorrow";
    }
  }

  return formatAppointmentDate(dateKey);
}
