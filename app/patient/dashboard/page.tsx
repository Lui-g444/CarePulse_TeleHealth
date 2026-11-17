"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  AlertCircle,
  CalendarDays,
  CalendarPlus,
  Clock,
  History,
  Loader2,
  MessageSquare,
  RefreshCw,
  Stethoscope,
  X,
} from "lucide-react";
import { AppHeader } from "@/components/AppHeader";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { formatTimeLabel } from "@/lib/booking";
import {
  cancelPatientAppointment,
  fetchPatientAppointments,
  fetchPatientProfile,
  formatAppointmentDate,
  splitPatientAppointments,
  statusLabel,
  type PatientAppointment,
  type PatientAppointmentStatus,
} from "@/lib/patient";
import { createClient } from "@/lib/supabase";
import { CallModal } from "@/components/CallModal";
import { ChatModal } from "@/components/ChatModal";
import {
  CALL_INVITE_BODY,
  fetchAnnouncements,
  fetchUnreadCountsByAppointment,
  sendMessage,
  type Announcement,
} from "@/lib/chat";

const STATUS_STYLES: Record<PatientAppointmentStatus, string> = {
  pending: "border-black/15 bg-white text-black/65",
  confirmed: "border-brand-hover/40 bg-brand-accent/25 text-black",
  completed: "border-brand-hover bg-brand-hover text-white",
  cancelled: "border-red-200 bg-red-50 text-red-700",
};

/** Visit history is capped so the page stays short for long-time patients. */
const PAST_VISIT_LIMIT = 8;

function describeError(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function initialsOf(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("") || "DR"
  );
}

export default function PatientDashboardPage() {
  const [client, setClient] = useState<SupabaseClient | null>(null);
  const [initError, setInitError] = useState<string | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [patientId, setPatientId] = useState<string | null>(null);
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [gender, setGender] = useState("");

  const [appointments, setAppointments] = useState<PatientAppointment[] | null>(
    null,
  );
  const [listError, setListError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [cancelTarget, setCancelTarget] = useState<PatientAppointment | null>(
    null,
  );
  const [cancelReason, setCancelReason] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const [chatTarget, setChatTarget] = useState<PatientAppointment | null>(null);
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [callTarget, setCallTarget] = useState<{
    appointment: PatientAppointment;
    audioOnly: boolean;
  } | null>(null);
  const [callRoomUrl, setCallRoomUrl] = useState<string | null>(null);
  const [callRoomLoading, setCallRoomLoading] = useState(false);
  const [callRoomError, setCallRoomError] = useState<string | null>(null);

  const startCall = useCallback(
    async (appointment: PatientAppointment, audioOnly: boolean) => {
      setChatTarget(null);
      setCallTarget({ appointment, audioOnly });
      setCallRoomUrl(null);
      setCallRoomError(null);
      setCallRoomLoading(true);
      try {
        const res = await fetch("/api/jitsi/room", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ appointmentId: appointment.id }),
        });
        const data = (await res.json()) as { url?: string; error?: string };
        if (!res.ok || !data.url) {
          throw new Error(data.error || "Could not start the call");
        }
        setCallRoomUrl(data.url);
        if (client && patientId) {
          void sendMessage(
            client,
            appointment.id,
            patientId,
            CALL_INVITE_BODY[audioOnly ? "audio" : "video"],
          ).catch(() => {});
        }
      } catch (err) {
        setCallRoomError(
          err instanceof Error ? err.message : "Could not start the call",
        );
      } finally {
        setCallRoomLoading(false);
      }
    },
    [client, patientId],
  );

  const closeCall = useCallback(() => {
    setCallTarget(null);
    setCallRoomUrl(null);
    setCallRoomError(null);
    setCallRoomLoading(false);
  }, []);

  useEffect(() => {
    let active = true;

    (async () => {
      let supabase: SupabaseClient;

      try {
        supabase = createClient();
      } catch (error) {
        if (active) {
          setInitError(describeError(error, "Supabase is not configured."));
          setAuthChecked(true);
        }
        return;
      }

      try {
        const { data } = await supabase.auth.getUser();
        const id = data.user?.id ?? null;

        if (!active) {
          return;
        }

        setClient(supabase);
        setPatientId(id);

        if (id) {
          // The name is only used for the greeting; failures fall back to it.
          try {
            const profile = await fetchPatientProfile(supabase, id);
            if (active) {
              setFullName(profile.fullName);
              setPhone(profile.phone);
              setGender(profile.gender);
            }
          } catch {
            if (active) {
              setFullName("");
            }
          }
        }
      } catch {
        if (active) {
          setClient(supabase);
          setPatientId(null);
        }
      } finally {
        if (active) {
          setAuthChecked(true);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!client || !patientId) {
      return;
    }

    let active = true;

    (async () => {
      try {
        const rows = await fetchPatientAppointments(client, patientId);

        if (active) {
          setAppointments(rows);
          setListError(null);
          void fetchUnreadCountsByAppointment(
            client,
            patientId,
            rows.map((row) => row.id),
          ).then((counts) => {
            if (active) {
              setUnreadCounts(counts);
            }
          });
        }
      } catch (error) {
        if (active) {
          setListError(
            describeError(error, "Could not load your appointments."),
          );
          setAppointments((current) => current ?? []);
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
  }, [client, patientId, reloadKey]);

  useEffect(() => {
    if (!client) return;
    let active = true;
    void fetchAnnouncements(client).then((list) => {
      if (active) setAnnouncements(list);
    });
    return () => {
      active = false;
    };
  }, [client, setAnnouncements]);

  const refreshAppointments = useCallback(() => {
    setLoading(true);
    setReloadKey((key) => key + 1);
  }, []);

  // Poll unread chat counts so patients are notified of new messages.
  useEffect(() => {
    if (!client || !patientId || !appointments) {
      return;
    }
    const appointmentIds = appointments.map((row) => row.id);
    const timer = window.setInterval(() => {
      void fetchUnreadCountsByAppointment(client, patientId, appointmentIds).then(
        (counts) => setUnreadCounts(counts),
      );
    }, 15000);
    return () => window.clearInterval(timer);
  }, [client, patientId, appointments]);

  const { upcoming, past } =
    appointments === null
      ? { upcoming: [], past: [] }
      : splitPatientAppointments(appointments);

  async function handleCancelAppointment() {
    if (!client || !patientId || !cancelTarget || cancelling) {
      return;
    }

    setCancelling(true);

    try {
      await cancelPatientAppointment(
        client,
        patientId,
        cancelTarget.id,
        cancelReason,
      );
      setReloadKey((key) => key + 1);
      setCancelTarget(null);
      setCancelReason("");
    } finally {
      setCancelling(false);
    }
  }

  const firstName = fullName.trim().split(/\s+/)[0] ?? "";

  return (
    <div className="min-h-full bg-primary-bg pl-64">
      <AppHeader
        role="patient"
        sections={[
          { id: "announcements", label: "Announcements" },
          { id: "upcoming", label: "Upcoming appointments" },
          { id: "history", label: "History" },
        ]}
      />
      <main className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 lg:py-14">
        <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="mb-3 inline-flex items-center gap-2 rounded-full border border-brand-hover/40 bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-black/70">
              <Stethoscope className="h-3.5 w-3.5" aria-hidden="true" />
              CarePulse
            </p>
            <h1 className="text-3xl font-semibold tracking-tight text-black sm:text-4xl">
              Patient dashboard
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-black/60 sm:text-base">
              {firstName
                ? `Welcome back, ${firstName}. Here are your visits and what's next.`
                : "Your appointments, past visits and what's next."}
            </p>
          </div>

          <Link
            href="/patient/book"
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand-accent px-5 py-3 text-sm font-semibold text-black transition-colors hover:bg-brand-hover hover:text-white"
          >
            <CalendarPlus className="h-4 w-4" aria-hidden="true" />
            Book an appointment
          </Link>
        </header>

        {initError ? (
          <NoticeCard title="Dashboard unavailable" message={initError} />
        ) : !authChecked ? (
          <div className="flex items-center gap-3 rounded-2xl border border-black/10 bg-white p-6 text-sm text-black/60">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Checking your session…
          </div>
        ) : !patientId || !client ? (
          <div className="rounded-2xl border border-black/10 bg-white p-6 sm:p-8">
            <h2 className="text-lg font-semibold text-black">
              Sign in with a patient account
            </h2>
            <p className="mt-2 max-w-xl text-sm text-black/60">
              This dashboard shows your own appointments, so it needs your
              patient session.
            </p>
            <Link
              href="/login"
              className="mt-5 inline-flex items-center justify-center rounded-xl bg-brand-accent px-5 py-3 text-sm font-semibold text-black transition-colors hover:bg-brand-hover hover:text-white"
            >
              Go to sign in
            </Link>
          </div>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
            <div className="space-y-6">
              {announcements.length > 0 ? (
                <section id="announcements" className="rounded-2xl border border-black/10 bg-white p-5 shadow-sm">
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-black/45">
                    Announcements
                  </p>
                  <ul className="space-y-2">
                    {announcements.map((a) => (
                      <li key={a.id} className="rounded-xl border border-black/10 p-3">
                        {a.title ? (
                          <p className="text-sm font-semibold text-black">{a.title}</p>
                        ) : null}
                        <p className="text-sm text-black/70 whitespace-pre-wrap">
                          {a.body}
                        </p>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              <section id="upcoming" className="rounded-2xl border border-black/10 bg-white p-5 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-bg text-brand-hover">
                      <CalendarDays className="h-4 w-4" aria-hidden="true" />
                    </span>
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-black/45">
                        Coming up
                      </p>
                      <h2 className="text-base font-semibold text-black">
                        Upcoming appointments
                      </h2>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={refreshAppointments}
                    aria-label="Refresh appointments"
                    className="rounded-lg border border-black/10 p-2 text-black/60 transition-colors hover:border-brand-hover hover:bg-brand-accent/10 hover:text-black"
                  >
                    <RefreshCw
                      className={clsx("h-4 w-4", loading && "animate-spin")}
                      aria-hidden="true"
                    />
                  </button>
                </div>

                {listError ? (
                  <div className="mt-4">
                    <p
                      role="alert"
                      className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800"
                    >
                      <AlertCircle
                        className="mt-0.5 h-4 w-4 shrink-0"
                        aria-hidden="true"
                      />
                      {listError}
                    </p>
                    <button
                      type="button"
                      onClick={refreshAppointments}
                      className="mt-3 rounded-lg border border-brand-hover px-3 py-2 text-xs font-semibold text-black transition-colors hover:bg-brand-accent/15"
                    >
                      Try again
                    </button>
                  </div>
                ) : null}

                <div className="mt-4">
                  {appointments === null ? (
                    <div className="space-y-3">
                      {[0, 1].map((key) => (
                        <div
                          key={key}
                          className="h-[84px] animate-pulse rounded-xl border border-black/10 bg-black/5"
                        />
                      ))}
                    </div>
                  ) : upcoming.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-black/15 p-6 text-center">
                      <p className="text-sm text-black/60">
                        You have no upcoming appointments.
                      </p>
                      <Link
                        href="/patient/book"
                        className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-brand-hover px-3 py-2 text-xs font-semibold text-black transition-colors hover:bg-brand-accent/15"
                      >
                        <CalendarPlus className="h-3.5 w-3.5" aria-hidden="true" />
                        Book your first visit
                      </Link>
                    </div>
                  ) : (
                    <ul className="space-y-3">
                      {upcoming.map((appointment) => (
                        <li
                          key={appointment.id}
                          className="flex flex-col gap-3 rounded-xl border border-black/10 p-4 sm:flex-row sm:items-center sm:justify-between"
                        >
                          <div className="flex min-w-0 items-center gap-3">
                            <span className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-bg text-sm font-semibold text-black sm:flex">
                              {initialsOf(appointment.doctorName)}
                            </span>
                            <div className="min-w-0">
                              <p className="truncate text-sm font-semibold text-black">
                                {appointment.doctorName}
                              </p>
                              <p className="mt-0.5 truncate text-xs text-black/50">
                                {appointment.specialty}
                              </p>
                              <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-black/55">
                                <span className="inline-flex items-center gap-1">
                                  <CalendarDays
                                    className="h-3.5 w-3.5"
                                    aria-hidden="true"
                                  />
                                  {formatAppointmentDate(appointment.date)}
                                </span>
                                <span className="inline-flex items-center gap-1">
                                  <Clock
                                    className="h-3.5 w-3.5"
                                    aria-hidden="true"
                                  />
                                  {formatTimeLabel(appointment.time)}
                                </span>
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center gap-2">
                            {appointment.status === "pending" ||
                            appointment.status === "confirmed" ? (
                              <>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setChatTarget(appointment);
                                    setUnreadCounts((current) => ({
                                      ...current,
                                      [appointment.id]: 0,
                                    }));
                                  }}
                                  className="relative inline-flex items-center gap-1.5 rounded-lg border border-brand-hover px-2.5 py-1.5 text-xs font-semibold text-black transition-colors hover:bg-brand-accent/15"
                                >
                                  <MessageSquare
                                    className="h-3.5 w-3.5"
                                    aria-hidden="true"
                                  />
                                  Message
                                  {unreadCounts[appointment.id] ? (
                                    <span className="ml-1 inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
                                      {unreadCounts[appointment.id]}
                                    </span>
                                  ) : null}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setCancelTarget(appointment)}
                                  className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-2.5 py-1.5 text-xs font-semibold text-red-700 transition-colors hover:bg-red-50"
                                >
                                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                                  Cancel
                                </button>
                              </>
                            ) : null}
                            <StatusPill status={appointment.status} />
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </section>

              <section id="history" className="rounded-2xl border border-black/10 bg-white p-5 shadow-sm">
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-bg text-brand-hover">
                    <History className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-black/45">
                      History
                    </p>
                    <h2 className="text-base font-semibold text-black">
                      Past visits
                    </h2>
                  </div>
                </div>

                <div className="mt-4">
                  {appointments === null ? (
                    <div className="space-y-2">
                      {[0, 1, 2].map((key) => (
                        <div
                          key={key}
                          className="h-10 animate-pulse rounded-lg bg-black/5"
                        />
                      ))}
                    </div>
                  ) : past.length === 0 ? (
                    <p className="rounded-xl border border-dashed border-black/15 p-6 text-center text-sm text-black/60">
                      No past visits yet.
                    </p>
                  ) : (
                    <>
                      <ul className="divide-y divide-black/10">
                        {past
                          .slice(0, PAST_VISIT_LIMIT)
                          .map((appointment) => (
                            <li
                              key={appointment.id}
                              className="flex flex-wrap items-center justify-between gap-2 py-3 first:pt-0 last:pb-0"
                            >
                              <div className="min-w-0">
                                <p className="truncate text-sm font-medium text-black">
                                  {appointment.doctorName}
                                </p>
                                <p className="mt-0.5 text-xs text-black/55">
                                  {formatAppointmentDate(appointment.date)} ·{" "}
                                  {formatTimeLabel(appointment.time)}
                                </p>
                              </div>
                              <StatusPill status={appointment.status} />
                            </li>
                          ))}
                      </ul>
                      {past.length > PAST_VISIT_LIMIT ? (
                        <p className="mt-3 text-xs text-black/45">
                          Showing the {PAST_VISIT_LIMIT} most recent visits.
                        </p>
                      ) : null}
                    </>
                  )}
                </div>
              </section>
            </div>

            <aside className="rounded-2xl border border-black/10 bg-white p-5 shadow-sm lg:sticky lg:top-6">
              <div className="rounded-xl border border-black/10 bg-primary-bg/40 p-4">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-black/45">
                  Your profile
                </p>
                <p className="mt-1 text-sm font-semibold text-black">
                  {fullName || "Patient"}
                </p>
                <dl className="mt-3 space-y-2 text-xs text-black/65">
                  <div className="flex justify-between gap-2">
                    <dt className="text-black/45">Contact</dt>
                    <dd className="text-right">{phone || "Not provided"}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-black/45">Gender</dt>
                    <dd className="text-right">{gender || "Not provided"}</dd>
                  </div>
                </dl>
              </div>

              <div className="mt-4 flex items-start gap-3">
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-bg text-brand-hover">
                  <Stethoscope className="h-4 w-4" aria-hidden="true" />
                </span>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-black/45">
                    Care
                  </p>
                  <h2 className="text-base font-semibold text-black">
                    Need to see a doctor?
                  </h2>
                </div>
              </div>
              <p className="mt-2 text-xs text-black/55">
                Pick a specialty, choose a doctor and reserve an open slot.
                Availability is checked against the clinic&apos;s live schedule.
              </p>
              <Link
                href="/patient/book"
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-brand-accent px-4 py-3 text-sm font-semibold text-black transition-colors hover:bg-brand-hover hover:text-white"
              >
                <CalendarPlus className="h-4 w-4" aria-hidden="true" />
                Book an appointment
              </Link>
            </aside>
          </div>
        )}
      </main>

      <ConfirmDialog
        open={cancelTarget !== null}
        title="Cancel this appointment?"
        description={
          cancelTarget
            ? `You are about to cancel your visit with ${cancelTarget.doctorName} on ${formatAppointmentDate(
                cancelTarget.date,
              )} at ${formatTimeLabel(cancelTarget.time)}.`
            : undefined
        }
        confirmLabel="Cancel appointment"
        tone="danger"
        loading={cancelling}
        onConfirm={handleCancelAppointment}
        onCancel={() => {
          setCancelTarget(null);
          setCancelReason("");
        }}
      >
        <label className="block text-xs font-medium text-black/70">
          Reason for cancellation (optional but recommended)
          <textarea
            value={cancelReason}
            onChange={(e) => setCancelReason(e.target.value)}
            rows={3}
            placeholder="Tell the clinic why you are cancelling"
            className="mt-1 w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm text-black focus:border-brand-hover focus:outline-none focus:ring-1 focus:ring-brand-hover"
          />
        </label>
      </ConfirmDialog>

      {chatTarget ? (
        <ChatModal
          appointmentId={chatTarget.id}
          otherPartyName={chatTarget.doctorName}
          currentUserId={patientId ?? ""}
          client={client!}
          onClose={() => setChatTarget(null)}
          onStartVideoCall={() => void startCall(chatTarget, false)}
          onStartAudioCall={() => void startCall(chatTarget, true)}
        />
      ) : null}

      {callTarget ? (
        <CallModal
          title={callTarget.appointment.doctorName || "Doctor"}
          subtitle="Telehealth consultation"
          audioOnly={callTarget.audioOnly}
          roomUrl={callRoomUrl}
          loading={callRoomLoading}
          error={callRoomError}
          onClose={closeCall}
        />
      ) : null}
    </div>
  );
}

function StatusPill({ status }: { status: PatientAppointmentStatus }) {
  return (
    <span
      className={clsx(
        "inline-flex shrink-0 items-center rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide",
        STATUS_STYLES[status],
      )}
    >
      {statusLabel(status)}
    </span>
  );
}

function NoticeCard({ title, message }: { title: string; message: string }) {
  return (
    <div className="rounded-2xl border border-black/10 bg-white p-6 sm:p-8">
      <h2 className="flex items-center gap-2 text-lg font-semibold text-black">
        <AlertCircle className="h-5 w-5 text-red-600" aria-hidden="true" />
        {title}
      </h2>
      <p className="mt-2 max-w-xl text-sm text-black/60">{message}</p>
    </div>
  );
}
