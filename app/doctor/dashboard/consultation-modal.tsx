"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import clsx from "clsx";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AlertCircle, Loader2, Plus, Trash2, X } from "lucide-react";
import { formatTimeLabel } from "@/lib/booking";
import {
  completeConsultation,
  formatAppointmentDate,
  validatePrescriptionDrafts,
  type PrescriptionDraft,
  type QueueAppointment,
} from "@/lib/doctor";

const MAX_PRESCRIPTIONS = 10;

const inputClass =
  "mt-1 w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal text-black placeholder:text-black/35 focus:border-brand-hover focus:outline-none focus:ring-2 focus:ring-brand-hover/30";

const labelClass =
  "block text-[10px] font-semibold uppercase tracking-wide text-black/50";

function newPrescriptionDraft(): PrescriptionDraft {
  return {
    id: crypto.randomUUID(),
    medication: "",
    dosage: "",
    frequency: "",
    durationDays: "",
    instructions: "",
  };
}

export function ConsultationModal({
  appointment,
  doctorId,
  client,
  onClose,
  onCompleted,
}: {
  appointment: QueueAppointment;
  doctorId: string;
  client: SupabaseClient;
  onClose: () => void;
  onCompleted: (appointmentId: string) => void;
}) {
  const [diagnosis, setDiagnosis] = useState("");
  const [notes, setNotes] = useState("");
  const [drafts, setDrafts] = useState<PrescriptionDraft[]>(() => [
    newPrescriptionDraft(),
  ]);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const diagnosisRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    diagnosisRef.current?.focus();
  }, []);

  // Lock background scrolling and close on Escape while the dialog is open.
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !submitting) {
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose, submitting]);

  function updateDraft(id: string, patch: Partial<PrescriptionDraft>) {
    setDrafts((current) =>
      current.map((draft) => (draft.id === id ? { ...draft, ...patch } : draft)),
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (submitting) {
      return;
    }

    const trimmedDiagnosis = diagnosis.trim();

    if (!trimmedDiagnosis) {
      setFormError("Diagnosis is required.");
      return;
    }

    const validation = validatePrescriptionDrafts(drafts);

    if (!validation.ok) {
      setFormError(validation.error);
      return;
    }

    setSubmitting(true);
    setFormError(null);

    try {
      await completeConsultation(client, {
        appointmentId: appointment.id,
        doctorId,
        patientId: appointment.patientId,
        diagnosis: trimmedDiagnosis,
        notes,
        prescriptions: validation.prescriptions,
      });

      onCompleted(appointment.id);
    } catch (error) {
      setFormError(
        error instanceof Error && error.message
          ? error.message
          : "Could not save the consultation. Please try again.",
      );
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/45 sm:items-center sm:p-4"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !submitting) {
          onClose();
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="consultation-title"
        className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl bg-primary-bg shadow-2xl sm:rounded-2xl"
      >
        <header className="flex items-start justify-between gap-3 border-b border-black/10 bg-white px-5 py-4">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-black/45">
              Post-consultation
            </p>
            <h2
              id="consultation-title"
              className="text-lg font-semibold text-black"
            >
              {appointment.patientName || "Patient"}
            </h2>
            <p className="mt-1 text-xs text-black/55">
              {formatAppointmentDate(appointment.date)} ·{" "}
              {formatTimeLabel(appointment.time)}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            aria-label="Close consultation dialog"
            className="rounded-lg border border-black/10 p-2 text-black/60 transition-colors hover:border-brand-hover hover:bg-brand-accent/10 hover:text-black disabled:cursor-not-allowed disabled:opacity-40"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </header>

        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5">
            {appointment.patientNote ? (
              <div className="rounded-xl border border-black/10 bg-primary-bg/40 p-3 text-sm text-black/75">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-black/45">
                  Patient note
                </p>
                <p className="mt-1 whitespace-pre-wrap">
                  {appointment.patientNote}
                </p>
              </div>
            ) : null}
            {formError ? (
              <p
                role="alert"
                className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800"
              >
                <AlertCircle
                  className="mt-0.5 h-4 w-4 shrink-0"
                  aria-hidden="true"
                />
                {formError}
              </p>
            ) : null}

            <label className={labelClass}>
              Diagnosis
              <textarea
                ref={diagnosisRef}
                value={diagnosis}
                onChange={(event) => setDiagnosis(event.target.value)}
                rows={3}
                required
                placeholder="e.g. Acute pharyngitis"
                className={clsx(inputClass, "resize-y")}
              />
            </label>

            <label className={labelClass}>
              Clinical notes (optional)
              <textarea
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                rows={2}
                placeholder="Allergies, follow-up advice, observations…"
                className={clsx(inputClass, "resize-y")}
              />
            </label>

            <div className="rounded-xl border border-black/10 bg-white p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold text-black">
                    Prescriptions
                  </h3>
                  <p className="text-xs text-black/50">
                    Structured medication list for this visit.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setDrafts((current) => [...current, newPrescriptionDraft()])
                  }
                  disabled={drafts.length >= MAX_PRESCRIPTIONS}
                  className="inline-flex items-center gap-1 rounded-lg border border-brand-hover px-2.5 py-1.5 text-xs font-semibold text-black transition-colors hover:bg-brand-accent/15 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                  Add medication
                </button>
              </div>

              {drafts.length === 0 ? (
                <p className="mt-3 rounded-lg border border-dashed border-black/15 p-4 text-center text-xs text-black/50">
                  No prescriptions added for this consultation.
                </p>
              ) : (
                <div className="mt-3 space-y-3">
                  {drafts.map((draft, index) => (
                    <div
                      key={draft.id}
                      role="group"
                      aria-label={`Medication ${index + 1}`}
                      className="rounded-lg border border-black/10 bg-primary-bg/50 p-3"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-semibold text-black/60">
                          Medication {index + 1}
                        </p>
                        <button
                          type="button"
                          onClick={() =>
                            setDrafts((current) =>
                              current.filter((item) => item.id !== draft.id),
                            )
                          }
                          aria-label={`Remove medication ${index + 1}`}
                          className="rounded-md p-1 text-black/40 transition-colors hover:bg-red-50 hover:text-red-700"
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                      </div>

                      <div className="mt-2 grid gap-2 sm:grid-cols-2">
                        <label className={labelClass}>
                          Medication
                          <input
                            value={draft.medication}
                            onChange={(event) =>
                              updateDraft(draft.id, {
                                medication: event.target.value,
                              })
                            }
                            placeholder="e.g. Amoxicillin"
                            className={inputClass}
                          />
                        </label>
                        <label className={labelClass}>
                          Dosage
                          <input
                            value={draft.dosage}
                            onChange={(event) =>
                              updateDraft(draft.id, {
                                dosage: event.target.value,
                              })
                            }
                            placeholder="e.g. 500 mg"
                            className={inputClass}
                          />
                        </label>
                        <label className={labelClass}>
                          Frequency
                          <input
                            value={draft.frequency}
                            onChange={(event) =>
                              updateDraft(draft.id, {
                                frequency: event.target.value,
                              })
                            }
                            placeholder="e.g. twice daily"
                            className={inputClass}
                          />
                        </label>
                        <label className={labelClass}>
                          Duration (days)
                          <input
                            type="number"
                            min={1}
                            max={365}
                            value={draft.durationDays}
                            onChange={(event) =>
                              updateDraft(draft.id, {
                                durationDays: event.target.value,
                              })
                            }
                            placeholder="e.g. 7"
                            className={inputClass}
                          />
                        </label>
                        <label className={clsx(labelClass, "sm:col-span-2")}>
                          Instructions (optional)
                          <input
                            value={draft.instructions}
                            onChange={(event) =>
                              updateDraft(draft.id, {
                                instructions: event.target.value,
                              })
                            }
                            placeholder="e.g. take with food"
                            className={inputClass}
                          />
                        </label>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <footer className="flex flex-col-reverse gap-2 border-t border-black/10 bg-white px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-[11px] text-black/45">
              Saving marks this appointment as completed.
            </p>
            <div className="flex gap-2 sm:justify-end">
              <button
                type="button"
                onClick={onClose}
                disabled={submitting}
                className="rounded-lg border border-black/15 px-4 py-2.5 text-sm font-semibold text-black/70 transition-colors hover:border-brand-hover hover:text-black disabled:cursor-not-allowed disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand-accent px-4 py-2.5 text-sm font-semibold text-black transition-colors hover:bg-brand-hover hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitting ? (
                  <>
                    <Loader2
                      className="h-4 w-4 animate-spin"
                      aria-hidden="true"
                    />
                    Saving…
                  </>
                ) : (
                  "Save consultation"
                )}
              </button>
            </div>
          </footer>
        </form>
      </div>
    </div>
  );
}
