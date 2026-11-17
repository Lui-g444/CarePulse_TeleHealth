import type { SupabaseClient } from "@supabase/supabase-js";

export type PatientIntake = {
  id: string;
  appointmentId: string;
  patientId: string;
  chiefComplaint: string;
  symptomDescription: string;
  onset: string;
  duration: string;
  severity: number | null;
  medications: string;
  allergies: string;
  redFlag: boolean;
  createdAt: string;
};

export type IntakeInput = {
  appointmentId: string;
  patientId: string;
  chiefComplaint: string;
  symptomDescription: string;
  onset: string;
  duration: string;
  severity: number | null;
  medications: string;
  allergies: string;
  redFlag: boolean;
};

export type PatientHistoryEntry = {
  appointmentId: string;
  date: string;
  time: string;
  doctorName: string;
  specialty: string;
  diagnosis: string;
  notes: string | null;
  prescriptions: Array<{
    medication: string;
    dosage: string;
    frequency: string;
    duration_days: number | null;
    instructions: string;
  }>;
};

type Row = Record<string, unknown>;

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

export const EMERGENCY_KEYWORDS = [
  "chest pain",
  "chest tightness",
  "shortness of breath",
  "severe shortness of breath",
  "difficulty breathing",
  "can't breathe",
  "cannot breathe",
  "stroke",
  "face drooping",
  "arm weakness",
  "slurred speech",
  "suicidal",
  "self harm",
  "seizure",
  "unconscious",
  "severe bleeding",
  "anaphylaxis",
];

export function detectRedFlag(text: string): boolean {
  const haystack = text.toLowerCase();
  return EMERGENCY_KEYWORDS.some((keyword) => haystack.includes(keyword));
}

export async function fetchIntake(
  supabase: SupabaseClient,
  appointmentId: string,
): Promise<PatientIntake | null> {
  const { data, error } = await supabase
    .from("patient_intakes")
    .select("*")
    .eq("appointment_id", appointmentId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!data || typeof data !== "object") {
    return null;
  }

  const row = data as Row;

  return {
    id: readText(row.id),
    appointmentId: readText(row.appointment_id),
    patientId: readText(row.patient_id),
    chiefComplaint: readText(row.chief_complaint),
    symptomDescription: readText(row.symptom_description),
    onset: readText(row.onset),
    duration: readText(row.duration),
    severity: toInteger(row.severity),
    medications: readText(row.medications),
    allergies: readText(row.allergies),
    redFlag: row.red_flag === true,
    createdAt: readText(row.created_at),
  };
}

export async function saveIntake(
  supabase: SupabaseClient,
  input: IntakeInput,
): Promise<void> {
  const { error } = await supabase.from("patient_intakes").upsert(
    {
      appointment_id: input.appointmentId,
      patient_id: input.patientId,
      chief_complaint: input.chiefComplaint,
      symptom_description: input.symptomDescription || null,
      onset: input.onset || null,
      duration: input.duration || null,
      severity: input.severity,
      medications: input.medications || null,
      allergies: input.allergies || null,
      red_flag: input.redFlag,
    },
    { onConflict: "appointment_id" },
  );

  if (error) {
    throw new Error(error.message);
  }
}

export async function fetchPatientHistory(
  supabase: SupabaseClient,
  patientId: string,
): Promise<PatientHistoryEntry[]> {
  const { data: consultations, error } = await supabase
    .from("consultations")
    .select(
      "appointment_id, diagnosis, notes, prescriptions, created_at, doctor_id",
    )
    .eq("patient_id", patientId)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  const appointmentIds = rowsOf(consultations)
    .map((row) => readText(row.appointment_id))
    .filter(Boolean);

  const appointmentMap: Record<string, Row> = {};

  if (appointmentIds.length > 0) {
    const { data: appointments } = await supabase
      .from("appointments")
      .select("id, appointment_date, start_time, doctor_id")
      .in("id", appointmentIds);

    for (const row of rowsOf(appointments)) {
      const id = readText(row.id);
      if (id) {
        appointmentMap[id] = row;
      }
    }
  }

  const doctorIds = [
    ...new Set(
      Object.values(appointmentMap)
        .map((row) => readText(row.doctor_id))
        .filter(Boolean),
    ),
  ];

  const doctorMap: Record<string, { fullName: string; specialty: string }> = {};

  if (doctorIds.length > 0) {
    const { data: doctors } = await supabase
      .from("doctors")
      .select("id, full_name, specialty")
      .in("id", doctorIds);

    for (const row of rowsOf(doctors)) {
      const id = readText(row.id);
      if (id) {
        doctorMap[id] = {
          fullName: readText(row.full_name) || "Doctor",
          specialty: readText(row.specialty) || "General practice",
        };
      }
    }
  }

  return rowsOf(consultations).flatMap((row) => {
    const appointmentId = readText(row.appointment_id);
    const appointment = appointmentMap[appointmentId];
    const doctorId = appointment ? readText(appointment.doctor_id) : "";
    const doctor = doctorMap[doctorId];

    const prescriptionsRaw = row.prescriptions;
    const prescriptions = Array.isArray(prescriptionsRaw)
      ? (prescriptionsRaw as PatientHistoryEntry["prescriptions"])
      : [];

    return [
      {
        appointmentId,
        date: appointment ? readText(appointment.appointment_date) : "",
        time: appointment ? readText(appointment.start_time) : "",
        doctorName: doctor?.fullName ?? "Doctor",
        specialty: doctor?.specialty ?? "General practice",
        diagnosis: readText(row.diagnosis),
        notes: typeof row.notes === "string" ? row.notes : null,
        prescriptions,
      },
    ];
  });
}