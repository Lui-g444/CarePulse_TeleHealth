import type { SupabaseClient } from "@supabase/supabase-js";

export type CancellationLogEntry = {
  id: string;
  date: string;
  time: string;
  patientName: string;
  doctorName: string;
  cancelledBy: string;
  reason: string | null;
};

export type AppointmentStats = {
  total: number;
  today: number;
  thisWeek: number;
};

export type CancellationRate = {
  date: string;
  total: number;
  cancelled: number;
  rate: number;
};

export type PeakHour = {
  hour: number;
  count: number;
  label: string;
};

export type UserWithRole = {
  id: string;
  fullName: string;
  role: string;
  email?: string;
  phone?: string;
  gender?: string;
};

export type DoctorRecord = {
  id: string;
  fullName: string;
  specialty: string;
};

type Row = Record<string, unknown>;

function rowsOf(data: unknown): Row[] {
  return Array.isArray(data) ? (data as Row[]) : [];
}

function readText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function toDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;
}

export async function fetchAppointmentStats(
  supabase: SupabaseClient,
): Promise<AppointmentStats> {
  const today = toDateKey(new Date());
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);
  const weekAgoKey = toDateKey(weekAgo);

  const [totalRes, todayRes, weekRes] = await Promise.all([
    supabase.from("appointments").select("id", { count: "exact", head: true }),
    supabase
      .from("appointments")
      .select("id", { count: "exact", head: true })
      .eq("appointment_date", today),
    supabase
      .from("appointments")
      .select("id", { count: "exact", head: true })
      .gte("appointment_date", weekAgoKey),
  ]);

  return {
    total: totalRes.count || 0,
    today: todayRes.count || 0,
    thisWeek: weekRes.count || 0,
  };
}

export async function fetchCancellationRates(
  supabase: SupabaseClient,
  days = 7,
): Promise<CancellationRate[]> {
  const results: CancellationRate[] = [];
  const now = new Date();

  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    const dateKey = toDateKey(date);

    const [totalRes, cancelledRes] = await Promise.all([
      supabase
        .from("appointments")
        .select("id", { count: "exact", head: true })
        .eq("appointment_date", dateKey),
      supabase
        .from("appointments")
        .select("id", { count: "exact", head: true })
        .eq("appointment_date", dateKey)
        .eq("status", "cancelled"),
    ]);

    const total = totalRes.count || 0;
    const cancelled = cancelledRes.count || 0;
    const rate = total > 0 ? Math.round((cancelled / total) * 100) : 0;

    results.push({
      date: date.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
      total,
      cancelled,
      rate,
    });
  }

  return results;
}

export async function fetchCancellationLog(
  supabase: SupabaseClient,
  limit = 10,
): Promise<CancellationLogEntry[]> {
  const { data, error } = await supabase
    .from("appointments")
    .select(
      "id, appointment_date, start_time, patient_id, doctor_id, cancelled_by, cancellation_reason",
    )
    .eq("status", "cancelled")
    .order("cancelled_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(error.message);
  }

  const rows = rowsOf(data);
  const patientIds = [...new Set(rows.map((row) => readText(row.patient_id)))];
  const doctorIds = [...new Set(rows.map((row) => readText(row.doctor_id)))];

  const patientNames: Record<string, string> = {};
  const doctorNames: Record<string, string> = {};

  if (patientIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", patientIds);

    for (const row of rowsOf(profiles)) {
      const id = readText(row.id);
      if (id) {
        patientNames[id] = readText(row.full_name) || "Patient";
      }
    }
  }

  if (doctorIds.length > 0) {
    const { data: doctors } = await supabase
      .from("doctors")
      .select("id, full_name")
      .in("id", doctorIds);

    for (const row of rowsOf(doctors)) {
      const id = readText(row.id);
      if (id) {
        doctorNames[id] = readText(row.full_name) || "Doctor";
      }
    }
  }

  return rows.flatMap((row) => {
    const id = readText(row.id);
    const date = readText(row.appointment_date);
    const time = readText(row.start_time).slice(0, 5);
    const patientId = readText(row.patient_id);
    const doctorId = readText(row.doctor_id);
    const cancelledBy = readText(row.cancelled_by);

    if (!id) {
      return [];
    }

    return [
      {
        id,
        date,
        time,
        patientName: patientNames[patientId] || "Patient",
        doctorName: doctorNames[doctorId] || "Doctor",
        cancelledBy:
          cancelledBy === patientId
            ? "Patient"
            : cancelledBy === doctorId
              ? "Doctor"
              : "Admin",
        reason:
          typeof row.cancellation_reason === "string"
            ? row.cancellation_reason
            : null,
      },
    ];
  });
}

export type AppointmentRecord = {
  id: string;
  date: string;
  time: string;
  patientName: string;
  doctorName: string;
  status: string;
};

export async function fetchRecentAppointments(
  supabase: SupabaseClient,
  limit = 12,
): Promise<AppointmentRecord[]> {
  const { data, error } = await supabase
    .from("appointments")
    .select("id, appointment_date, start_time, patient_id, doctor_id, status")
    .order("appointment_date", { ascending: false })
    .order("start_time", { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(error.message);
  }

  const rows = rowsOf(data);
  const patientIds = [...new Set(rows.map((row) => readText(row.patient_id)))];
  const doctorIds = [...new Set(rows.map((row) => readText(row.doctor_id)))];

  const patientNames: Record<string, string> = {};
  const doctorNames: Record<string, string> = {};

  if (patientIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", patientIds);
    for (const row of rowsOf(profiles)) {
      const id = readText(row.id);
      if (id) {
        patientNames[id] = readText(row.full_name) || "Patient";
      }
    }
  }

  if (doctorIds.length > 0) {
    const { data: doctors } = await supabase
      .from("doctors")
      .select("id, full_name")
      .in("id", doctorIds);
    for (const row of rowsOf(doctors)) {
      const id = readText(row.id);
      if (id) {
        doctorNames[id] = readText(row.full_name) || "Doctor";
      }
    }
  }

  return rows.flatMap((row) => {
    const id = readText(row.id);
    if (!id) {
      return [];
    }

    return [
      {
        id,
        date: readText(row.appointment_date),
        time: readText(row.start_time).slice(0, 5),
        patientName:
          patientNames[readText(row.patient_id)] || "Patient",
        doctorName: doctorNames[readText(row.doctor_id)] || "Doctor",
        status: readText(row.status) || "pending",
      },
    ];
  });
}

export async function deleteAppointment(
  supabase: SupabaseClient,
  appointmentId: string,
): Promise<void> {
  const { error } = await supabase
    .from("appointments")
    .delete()
    .eq("id", appointmentId);

  if (error) {
    throw new Error(error.message);
  }
}

export async function restoreAppointment(
  supabase: SupabaseClient,
  appointmentId: string,
): Promise<void> {
  const { error } = await supabase
    .from("appointments")
    .update({ status: "pending", cancelled_by: null, cancellation_reason: null, cancelled_at: null })
    .eq("id", appointmentId)
    .eq("status", "cancelled");

  if (error) {
    throw new Error(error.message);
  }
}

export async function fetchPeakBookingHours(
  supabase: SupabaseClient,
  days = 30,
): Promise<PeakHour[]> {
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - days);
  const weekAgoKey = toDateKey(weekAgo);

  const { data, error } = await supabase
    .from("appointments")
    .select("start_time")
    .gte("appointment_date", weekAgoKey);

  if (error) {
    throw new Error(error.message);
  }

  const hourCounts = new Map<number, number>();

  for (const row of rowsOf(data)) {
    const time = readText(row.start_time);
    const match = /^(\d{1,2}):/.exec(time);
    if (match) {
      const hour = parseInt(match[1], 10);
      hourCounts.set(hour, (hourCounts.get(hour) || 0) + 1);
    }
  }

  const hours = Array.from({ length: 24 }, (_, hour) => {
    const count = hourCounts.get(hour) || 0;
    const label =
      hour === 0
        ? "12 AM"
        : hour < 12
          ? `${hour} AM`
          : hour === 12
            ? "12 PM"
            : `${hour - 12} PM`;
    return { hour, count, label };
  });

  // Return only hours with activity or business hours range
  return hours.filter((h) => h.count > 0 || (h.hour >= 8 && h.hour <= 18));
}

export async function fetchUsersWithRoles(
  supabase: SupabaseClient,
): Promise<UserWithRole[]> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, role, phone, gender, email");

  if (error) {
    throw new Error(error.message);
  }

  return rowsOf(data)
    .map((row) => ({
      id: readText(row.id),
      fullName: readText(row.full_name) || "Unnamed User",
      role: readText(row.role) || "patient",
      email: readText(row.email) || undefined,
      phone: readText(row.phone) || undefined,
      gender: readText(row.gender) || undefined,
    }))
    .filter((user) => user.id);
}

export async function updateUserRole(
  supabase: SupabaseClient,
  userId: string,
  role: string,
): Promise<void> {
  const { error } = await supabase
    .from("profiles")
    .update({ role })
    .eq("id", userId);

  if (error) {
    throw new Error(error.message);
  }
}

/**
 * The bookable doctor directory. A row may only be created for an account that
 * already exists, because `doctors.id` references `auth.users`.
 */
export async function fetchDoctorDirectory(
  supabase: SupabaseClient,
): Promise<DoctorRecord[]> {
  const { data, error } = await supabase
    .from("doctors")
    .select("id, full_name, specialty")
    .order("full_name", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return rowsOf(data)
    .map((row) => ({
      id: readText(row.id),
      fullName: readText(row.full_name) || "Unnamed doctor",
      specialty: readText(row.specialty) || "General practice",
    }))
    .filter((doctor) => doctor.id);
}

export async function createDoctor(
  supabase: SupabaseClient,
  input: { userId: string; fullName: string; specialty: string },
): Promise<void> {
  const fullName = input.fullName.trim();
  const specialty = input.specialty.trim();

  if (!input.userId) {
    throw new Error("Choose the account that should become a doctor.");
  }

  if (!fullName) {
    throw new Error("Enter the doctor's full name.");
  }

  const { error } = await supabase.from("doctors").insert({
    id: input.userId,
    full_name: fullName,
    specialty: specialty || "General practice",
  });

  if (error) {
    throw new Error(
      error.code === "23505"
        ? "That account is already in the doctor directory."
        : error.message,
    );
  }
}

export async function deleteDoctor(
  supabase: SupabaseClient,
  doctorId: string,
): Promise<void> {
  // Appointments cascade from doctors, so refuse rather than wipe clinical
  // history that already points at this doctor.
  const { count, error: countError } = await supabase
    .from("appointments")
    .select("id", { count: "exact", head: true })
    .eq("doctor_id", doctorId);

  if (countError) {
    throw new Error(countError.message);
  }

  if ((count ?? 0) > 0) {
    throw new Error(
      "This doctor already has appointments on record, so they can't be removed from the directory.",
    );
  }

  const { error } = await supabase.from("doctors").delete().eq("id", doctorId);

  if (error) {
    throw new Error(error.message);
  }
}
