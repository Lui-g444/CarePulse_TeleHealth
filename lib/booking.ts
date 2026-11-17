import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Data access + slot maths for patient booking.
 *
 * Expected Supabase schema (public):
 *
 *   doctors (id uuid pk, full_name text, specialty text)
 *   doctor_schedules (id uuid pk, doctor_id uuid, day_of_week int (0=Sun … 6=Sat),
 *                     start_time time, end_time time, slot_duration_minutes int)
 *   appointments (id uuid pk, patient_id uuid, doctor_id uuid,
 *                 appointment_date date, start_time time, end_time time,
 *                 status text, created_at timestamptz)
 *
 * Duplicate protection is enforced by a partial unique index — the insert in
 * `bookAppointment` treats a 23505 violation as "slot already taken":
 *
 *   create unique index if not exists appointments_unique_slot
 *     on public.appointments (doctor_id, appointment_date, start_time)
 *     where status <> 'cancelled';
 */

export const DEFAULT_SLOT_MINUTES = 30;

export type Doctor = {
  id: string;
  fullName: string;
  specialty: string;
};

export type DoctorSchedule = {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  slotMinutes: number;
};

export type SlotStatus = "available" | "booked" | "past";

export type Slot = {
  /** 24h `HH:MM`, used as the slot's identity. */
  time: string;
  status: SlotStatus;
};

export type DateOption = {
  /** Local `YYYY-MM-DD`, used as the slot's date. */
  key: string;
  weekday: string;
  day: string;
  month: string;
  label: string;
};

export type BookingResult =
  | { ok: true; id: string }
  | { ok: false; duplicate: boolean; message: string };

type Row = Record<string, unknown>;

function rowsOf(data: unknown): Row[] {
  return Array.isArray(data) ? (data as Row[]) : [];
}

function toInteger(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
}

function readText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Parses `HH:MM` / `HH:MM:SS` into minutes past midnight. */
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

function minutesToTime(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

/** Normalises a stored time (`9:00`, `09:00:00`) to `HH:MM`. */
function normalizeTime(value: string): string | null {
  const minutes = parseTimeToMinutes(value);
  return minutes === null ? null : minutesToTime(minutes);
}

/** Local weekday (0 = Sunday) of a `YYYY-MM-DD` key, or null if malformed. */
function weekdayOf(date: string): number | null {
  const parts = date.split("-").map(Number);

  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) {
    return null;
  }

  const [year, month, day] = parts;
  return new Date(year, month - 1, day).getDay();
}

/**
 * End of a booked slot: the doctor's slot duration for that weekday, or the
 * default when the doctor has no schedule for it. Rows in `appointments`
 * carry `end_time`, so it must always be filled in.
 */
function endTimeFor({
  startTime,
  date,
  schedules,
}: {
  startTime: string;
  date: string;
  schedules: DoctorSchedule[];
}): string {
  const start = parseTimeToMinutes(startTime);

  if (start === null) {
    return startTime;
  }

  const weekday = weekdayOf(date);
  const schedule = schedules.find((entry) => entry.dayOfWeek === weekday);
  const step =
    schedule && schedule.slotMinutes > 0
      ? schedule.slotMinutes
      : DEFAULT_SLOT_MINUTES;

  return minutesToTime(Math.min(start + step, 23 * 60 + 59));
}

/** `14:30` -> `2:30 PM`, independent of locale/timezone. */
export function formatTimeLabel(time: string): string {
  const minutes = parseTimeToMinutes(time);

  if (minutes === null) {
    return time;
  }

  const hours24 = Math.floor(minutes / 60);
  const suffix = hours24 >= 12 ? "PM" : "AM";
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;

  return `${hours12}:${String(minutes % 60).padStart(2, "0")} ${suffix}`;
}

export function toDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;
}

/** The next `count` days, starting today, in local time. */
export function buildDateOptions(count = 14, now = new Date()): DateOption[] {
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + index);

    return {
      key: toDateKey(date),
      weekday: date.toLocaleDateString(undefined, { weekday: "short" }),
      day: String(date.getDate()),
      month: date.toLocaleDateString(undefined, { month: "short" }),
      label: date.toLocaleDateString(undefined, {
        weekday: "long",
        month: "long",
        day: "numeric",
      }),
    };
  });
}

/**
 * Expands a doctor's weekly schedules into concrete slots for one date and
 * marks the ones that cannot be booked.
 */
export function buildSlots({
  date,
  schedules,
  bookedTimes,
  now = new Date(),
}: {
  date: string;
  schedules: DoctorSchedule[];
  bookedTimes: string[];
  now?: Date;
}): Slot[] {
  const parts = date.split("-").map(Number);

  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) {
    return [];
  }

  const [year, month, day] = parts;
  const weekday = new Date(year, month - 1, day).getDay();
  const booked = new Set(
    bookedTimes.map(normalizeTime).filter((time): time is string => time !== null),
  );
  const slots = new Map<string, Slot>();

  for (const schedule of schedules) {
    if (schedule.dayOfWeek !== weekday) {
      continue;
    }

    const start = parseTimeToMinutes(schedule.startTime);
    const end = parseTimeToMinutes(schedule.endTime);

    if (start === null || end === null || end <= start) {
      continue;
    }

    const step =
      schedule.slotMinutes > 0 ? schedule.slotMinutes : DEFAULT_SLOT_MINUTES;

    for (let minutes = start; minutes + step <= end; minutes += step) {
      const time = minutesToTime(minutes);

      if (slots.has(time)) {
        continue;
      }

      const startsAt = new Date(
        year,
        month - 1,
        day,
        Math.floor(minutes / 60),
        minutes % 60,
      ).getTime();

      const status: SlotStatus = booked.has(time)
        ? "booked"
        : startsAt <= now.getTime()
          ? "past"
          : "available";

      slots.set(time, { time, status });
    }
  }

  return [...slots.values()].sort((a, b) => a.time.localeCompare(b.time));
}

export async function fetchDoctors(
  supabase: SupabaseClient,
): Promise<Doctor[]> {
  const { data, error } = await supabase
    .from("doctors")
    .select("id, full_name, specialty")
    .order("full_name", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return rowsOf(data).flatMap((row) => {
    const id = readText(row.id);

    if (!id) {
      return [];
    }

    return [
      {
        id,
        fullName: readText(row.full_name) || "Unnamed doctor",
        specialty: readText(row.specialty) || "General practice",
      },
    ];
  });
}

export async function fetchDoctorSchedules(
  supabase: SupabaseClient,
  doctorId: string,
): Promise<DoctorSchedule[]> {
  const { data, error } = await supabase
    .from("doctor_schedules")
    .select("day_of_week, start_time, end_time, slot_duration_minutes")
    .eq("doctor_id", doctorId);

  if (error) {
    throw new Error(error.message);
  }

  return rowsOf(data).flatMap((row) => {
    const dayOfWeek = toInteger(row.day_of_week);
    const startTime = readText(row.start_time);
    const endTime = readText(row.end_time);

    if (dayOfWeek === null || dayOfWeek < 0 || dayOfWeek > 6) {
      return [];
    }

    if (parseTimeToMinutes(startTime) === null || parseTimeToMinutes(endTime) === null) {
      return [];
    }

    const slotMinutes = toInteger(row.slot_duration_minutes);

    return [
      {
        dayOfWeek,
        startTime,
        endTime,
        slotMinutes:
          slotMinutes !== null && slotMinutes > 0
            ? slotMinutes
            : DEFAULT_SLOT_MINUTES,
      },
    ];
  });
}

export async function fetchBookedSlotTimes(
  supabase: SupabaseClient,
  doctorId: string,
  date: string,
): Promise<string[]> {
  // Null statuses are legacy rows; only cancelled appointments free a slot.
  const { data, error } = await supabase
    .from("appointments")
    .select("start_time")
    .eq("doctor_id", doctorId)
    .eq("appointment_date", date)
    .or("status.is.null,status.neq.cancelled");

  if (error) {
    throw new Error(error.message);
  }

  return rowsOf(data).flatMap((row) => {
    const time = normalizeTime(readText(row.start_time));
    return time === null ? [] : [time];
  });
}

/**
 * Inserts the booking. The unique index on
 * `(doctor_id, appointment_date, start_time)` is what actually prevents two
 * patients from taking the same slot; a 23505 error means the caller lost the
 * race and must refresh availability.
 */
export async function bookAppointment(
  supabase: SupabaseClient,
  {
    patientId,
    doctorId,
    date,
    time,
  }: { patientId: string; doctorId: string; date: string; time: string },
): Promise<BookingResult> {
  // `appointments.end_time` is part of the schema, so the slot's end is stored
  // with the booking rather than left for the reader to guess.
  const schedules = await fetchDoctorSchedules(supabase, doctorId).catch(
    () => [] as DoctorSchedule[],
  );

  const booking = {
    patient_id: patientId,
    doctor_id: doctorId,
    appointment_date: date,
    start_time: time,
    status: "pending",
  };

  let data: unknown = null;
  let error: { code?: string; message: string } | null = null;

  const withEndTime = await supabase
    .from("appointments")
    .insert({ ...booking, end_time: endTimeFor({ startTime: time, date, schedules }) })
    .select("id")
    .single();

  data = withEndTime.data;
  error = withEndTime.error;

  // Projects created before `end_time` was added reject the extra column;
  // retry without it instead of failing an otherwise valid booking.
  if (error && (error.code === "PGRST204" || error.code === "42703")) {
    const withoutEndTime = await supabase
      .from("appointments")
      .insert(booking)
      .select("id")
      .single();

    data = withoutEndTime.data;
    error = withoutEndTime.error;
  }

  if (error) {
    return {
      ok: false,
      duplicate: error.code === "23505",
      message: error.message,
    };
  }

  const id = data && typeof data === "object" ? readText((data as Row).id) : "";

  return { ok: true, id };
}
