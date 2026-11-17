"use client";

import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AlertCircle, Loader2, X } from "lucide-react";
import {
  fetchIntake,
  fetchPatientHistory,
  type PatientIntake,
  type PatientHistoryEntry,
} from "@/lib/intake";
import { formatAppointmentDate } from "@/lib/doctor";
import { fetchPatientProfile } from "@/lib/patient";

export function IntakeReviewModal({
  client,
  appointmentId,
  patientId,
  patientName,
  onClose,
}: {
  client: SupabaseClient;
  appointmentId: string;
  patientId: string;
  patientName: string;
  onClose: () => void;
}) {
  const [intake, setIntake] = useState<PatientIntake | null>(null);
  const [history, setHistory] = useState<PatientHistoryEntry[] | null>(null);
  const [profile, setProfile] = useState<{
    fullName: string;
    phone: string;
    gender: string;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    (async () => {
      try {
        const [intakeData, historyData, profileData] = await Promise.all([
          fetchIntake(client, appointmentId),
          fetchPatientHistory(client, patientId),
          fetchPatientProfile(client, patientId),
        ]);

        if (!active) {
          return;
        }

        setIntake(intakeData);
        setHistory(historyData);
        setProfile(profileData);
      } catch (err) {
        if (active) {
          setError(
            err instanceof Error && err.message
              ? err.message
              : "Could not load patient records.",
          );
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [client, appointmentId, patientId]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/45 sm:items-center sm:p-4"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-t-2xl bg-primary-bg shadow-2xl sm:rounded-2xl">
        <header className="flex items-start justify-between gap-3 border-b border-black/10 bg-white px-5 py-4">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-black/45">
              Patient record
            </p>
            <h2 className="text-lg font-semibold text-black">{patientName}</h2>
            {profile ? (
              <p className="mt-1 text-xs text-black/55">
                {[profile.phone, profile.gender].filter(Boolean).join(" · ") ||
                  "No contact details on file"}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close patient record"
            className="rounded-lg border border-black/10 p-2 text-black/60 transition-colors hover:border-brand-hover hover:bg-brand-accent/10 hover:text-black"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5">
          {loading ? (
            <div className="flex items-center gap-3 text-sm text-black/60">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Loading patient records…
            </div>
          ) : error ? (
            <p
              role="alert"
              className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              {error}
            </p>
          ) : (
            <>
              <section className="rounded-xl border border-black/10 bg-white p-4">
                <h3 className="text-sm font-semibold text-black">
                  Current intake
                </h3>
                {intake ? (
                  <dl className="mt-3 space-y-2 text-sm">
                    <Row label="Chief complaint" value={intake.chiefComplaint} />
                    {intake.symptomDescription ? (
                      <Row
                        label="Symptom description"
                        value={intake.symptomDescription}
                      />
                    ) : null}
                    {intake.onset ? <Row label="Onset" value={intake.onset} /> : null}
                    {intake.duration ? (
                      <Row label="Duration" value={intake.duration} />
                    ) : null}
                    {intake.severity !== null ? (
                      <Row label="Severity" value={`${intake.severity}/10`} />
                    ) : null}
                    {intake.medications ? (
                      <Row label="Medications" value={intake.medications} />
                    ) : null}
                    {intake.allergies ? (
                      <Row label="Allergies" value={intake.allergies} />
                    ) : null}
                    {intake.redFlag ? (
                      <p className="rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-700">
                        Flagged as possible emergency symptoms at booking.
                      </p>
                    ) : null}
                  </dl>
                ) : (
                  <p className="mt-2 text-sm text-black/55">
                    No intake form was submitted for this appointment.
                  </p>
                )}
              </section>

              <section className="rounded-xl border border-black/10 bg-white p-4">
                <h3 className="text-sm font-semibold text-black">
                  Past medical history
                </h3>
                {history && history.length > 0 ? (
                  <ul className="mt-3 space-y-3">
                    {history.map((entry) => (
                      <li
                        key={entry.appointmentId}
                        className="rounded-lg border border-black/10 bg-primary-bg/40 p-3"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-sm font-medium text-black">
                            {entry.diagnosis || "Consultation"}
                          </p>
                          <p className="text-xs text-black/50">
                            {entry.date
                              ? formatAppointmentDate(entry.date)
                              : "Unknown date"}
                            {entry.doctorName ? ` · ${entry.doctorName}` : ""}
                          </p>
                        </div>
                        {entry.notes ? (
                          <p className="mt-2 text-xs text-black/60">
                            {entry.notes}
                          </p>
                        ) : null}
                        {entry.prescriptions.length > 0 ? (
                          <ul className="mt-2 space-y-1">
                            {entry.prescriptions.map((rx, index) => (
                              <li
                                key={`${rx.medication}-${index}`}
                                className="text-xs text-black/60"
                              >
                                {rx.medication} — {rx.dosage}, {rx.frequency}
                                {rx.duration_days
                                  ? ` for ${rx.duration_days} days`
                                  : ""}
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-sm text-black/55">
                    No prior consultations on record.
                  </p>
                )}
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-xs font-medium uppercase tracking-wide text-black/45">
        {label}
      </dt>
      <dd className="max-w-[70%] text-right text-sm text-black">{value}</dd>
    </div>
  );
}