"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  AlertCircle,
  CalendarDays,
  Check,
  CheckCircle2,
  Clock,
  Loader2,
  MessageSquare,
  RefreshCw,
  Stethoscope,
  Users,
  X,
} from "lucide-react";
import { AppHeader } from "@/components/AppHeader";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { formatTimeLabel, toDateKey } from "@/lib/booking";
import {
  cancelDoctorAppointment,
  DAY_LABELS,
  fetchAppointmentQueue,
  fetchDoctorProfile,
  fetchDoctorWeeklyHours,
  fetchPatientNames,
  formatAppointmentDate,
  saveWeeklyHours,
  statusLabel,
  updateAppointmentStatus,
  validateWeeklyHours,
  type DayHours,
  type QueueAppointment,
  type QueueStatus,
} from "@/lib/doctor";
import { createClient } from "@/lib/supabase";
import { ChatModal } from "@/components/ChatModal";
import { CallModal } from "@/components/CallModal";
import {
  CALL_INVITE_BODY,
  fetchAnnouncements,
  fetchUnreadCountsByAppointment,
  sendMessage,
  type Announcement,
} from "@/lib/chat";
import { ConsultationModal } from "./consultation-modal";
import { IntakeReviewModal } from "./intake-review-modal";

type LiveStatus = "connecting" | "live" | "offline";

type FilterValue = "all" | Exclude<QueueStatus, "cancelled">;

const FILTERS: Array<{ value: FilterValue; label: string }> = [
  { value: "all", label: "All" },
  { value: "pending", label: "Pending" },
  { value: "confirmed", label: "Confirmed" },
  { value: "completed", label: "Completed" },
];

const STATUS_STYLES: Record<QueueStatus, string> = {
  pending: "border-black/15 bg-white text-black/65",
  confirmed: "border-brand-hover/40 bg-brand-accent/25 text-black",
  completed: "border-brand-hover bg-brand-hover text-white",
  cancelled: "border-red-200 bg-red-50 text-red-700",
};

function describeError(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function patientInitial(name: string): string {
  return (name.trim()[0] ?? "P").toUpperCase();
}

export default function DoctorDashboardPage() {
  const [client, setClient] = useState<SupabaseClient | null>(null);
  const [initError, setInitError] = useState<string | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [doctorId, setDoctorId] = useState<string | null>(null);
  const [doctor, setDoctor] = useState<{
    fullName: string;
    specialty: string;
  } | null>(null);
  // "missing" means the account has the doctor role but no directory row yet —
  // schedules and bookings cannot work until an admin adds it.
  const [profileState, setProfileState] = useState<
    "loading" | "ready" | "missing"
  >("loading");

  const [queue, setQueue] = useState<QueueAppointment[] | null>(null);
  const [queueError, setQueueError] = useState<string | null>(null);
  const [liveStatus, setLiveStatus] = useState<LiveStatus>("connecting");
  const [filter, setFilter] = useState<FilterValue>("all");
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [weekly, setWeekly] = useState<DayHours[] | null>(null);
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [scheduleValidation, setScheduleValidation] = useState<string | null>(
    null,
  );
  const [scheduleNotice, setScheduleNotice] = useState<string | null>(null);
  const [scheduleSaving, setScheduleSaving] = useState(false);
  const [scheduleReloadKey, setScheduleReloadKey] = useState(0);

  const [consultationTarget, setConsultationTarget] =
    useState<QueueAppointment | null>(null);
  const [chatTarget, setChatTarget] = useState<QueueAppointment | null>(null);
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [intakeTarget, setIntakeTarget] = useState<QueueAppointment | null>(null);
  const [callTarget, setCallTarget] = useState<{
    appointment: QueueAppointment;
    audioOnly: boolean;
  } | null>(null);
  const [callRoomUrl, setCallRoomUrl] = useState<string | null>(null);
  const [callRoomLoading, setCallRoomLoading] = useState(false);
  const [callRoomError, setCallRoomError] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<QueueAppointment | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const [pendingStatusChange, setPendingStatusChange] = useState<{
    appointment: QueueAppointment;
    status: "confirmed" | "completed";
  } | null>(null);
  const [statusChanging, setStatusChanging] = useState(false);

  const startCall = useCallback(
    async (appointment: QueueAppointment, audioOnly: boolean) => {
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
        if (client && doctorId) {
          void sendMessage(
            client,
            appointment.id,
            doctorId,
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
    [client, doctorId],
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

        if (active) {
          setClient(supabase);
          setDoctorId(data.user?.id ?? null);
        }
      } catch {
        if (active) {
          setClient(supabase);
          setDoctorId(null);
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

  // Profile is only used for the page header; failures fall back to "Doctor".
  useEffect(() => {
    if (!client || !doctorId) {
      return;
    }

    let active = true;

    (async () => {
      try {
        const profile = await fetchDoctorProfile(client, doctorId);
        if (active) {
          setDoctor(profile);
          setProfileState(profile ? "ready" : "missing");
        }
      } catch {
        if (active) {
          setDoctor(null);
          setProfileState("missing");
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [client, doctorId]);

  const fetchQueueData = useCallback(async () => {
    if (!client || !doctorId) {
      return null;
    }

    const rows = await fetchAppointmentQueue(
      client,
      doctorId,
      toDateKey(new Date()),
    );
    const names = await fetchPatientNames(client, [
      ...new Set(rows.map((row) => row.patientId)),
    ]);

    return rows.map((row) => ({
      ...row,
      patientName: names[row.patientId] || "Patient",
    }));
  }, [client, doctorId]);

  const refreshQueue = useCallback(async () => {
    try {
      const rows = await fetchQueueData();

      if (!rows) {
        return;
      }

      setQueue(rows);
      setQueueError(null);
      if (client && doctorId) {
        void fetchUnreadCountsByAppointment(
          client,
          doctorId,
          rows.map((row) => row.id),
        ).then(setUnreadCounts);
      }
    } catch (error) {
      setQueueError(
        describeError(error, "Could not load the appointment queue."),
      );
      setQueue((current) => current ?? []);
    }
  }, [fetchQueueData, client, doctorId]);

  useEffect(() => {
    let active = true;

    (async () => {
      try {
        const rows = await fetchQueueData();

        if (!active || !rows) {
          return;
        }

        setQueue(rows);
        setQueueError(null);
        if (client && doctorId) {
          void fetchUnreadCountsByAppointment(
            client,
            doctorId,
            rows.map((row) => row.id),
          ).then((counts) => {
            if (active) {
              setUnreadCounts(counts);
            }
          });
        }
      } catch (error) {
        if (active) {
          setQueueError(
            describeError(error, "Could not load the appointment queue."),
          );
          setQueue((current) => current ?? []);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [fetchQueueData, client, doctorId]);

  useEffect(() => {
    if (!client) return;
    let active = true;
    void fetchAnnouncements(client).then((list) => {
      if (active) setAnnouncements(list);
    });
    return () => {
      active = false;
    };
  }, [client]);

  // Appointment changes arrive over Supabase realtime; any change refetches the
  // queue so status edits from any client (including this one) stay in sync.
  useEffect(() => {
    if (!client || !doctorId) {
      return;
    }

    let active = true;

    const channel = client
      .channel(`doctor-appointments-${doctorId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "appointments",
          filter: `doctor_id=eq.${doctorId}`,
        },
        () => {
          void refreshQueue();
        },
      )
      .subscribe((status) => {
        if (!active) {
          return;
        }

        if (status === "SUBSCRIBED") {
          setLiveStatus("live");
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          setLiveStatus("offline");
        }
      });

    return () => {
      active = false;
      void client.removeChannel(channel);
    };
  }, [client, doctorId, refreshQueue]);

  useEffect(() => {
    if (!client || !doctorId) {
      return;
    }

    let active = true;

    (async () => {
      try {
        const hours = await fetchDoctorWeeklyHours(client, doctorId);
        if (active) {
          setWeekly(hours);
          setScheduleError(null);
        }
      } catch (error) {
        if (active) {
          setWeekly(null);
          setScheduleError(
            describeError(error, "Could not load your weekly hours."),
          );
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [client, doctorId, scheduleReloadKey]);

  const counts = useMemo(() => {
    const base = queue ?? [];

    return {
      all: base.length,
      pending: base.filter((appointment) => appointment.status === "pending")
        .length,
      confirmed: base.filter(
        (appointment) => appointment.status === "confirmed",
      ).length,
      completed: base.filter(
        (appointment) => appointment.status === "completed",
      ).length,
    };
  }, [queue]);

  const visibleAppointments = useMemo(() => {
    if (!queue) {
      return null;
    }

    return filter === "all"
      ? queue
      : queue.filter((appointment) => appointment.status === filter);
  }, [queue, filter]);

  function handleDayChange(dayOfWeek: number, patch: Partial<DayHours>) {
    setWeekly((current) =>
      current?.map((day) =>
        day.dayOfWeek === dayOfWeek ? { ...day, ...patch } : day,
      ) ?? current,
    );
    setScheduleValidation(null);
    setScheduleNotice(null);
    setScheduleError(null);
  }

  async function handleSaveSchedule() {
    if (!client || !doctorId || !weekly || scheduleSaving) {
      return;
    }

    const validation = validateWeeklyHours(weekly);

    if (validation) {
      setScheduleValidation(validation);
      setScheduleNotice(null);
      return;
    }

    setScheduleSaving(true);
    setScheduleValidation(null);
    setScheduleNotice(null);

    try {
      await saveWeeklyHours(client, doctorId, weekly);
      setScheduleNotice("Schedule saved. New bookings use these hours.");
    } catch (error) {
      setScheduleError(
        describeError(error, "Could not save your weekly hours."),
      );
    } finally {
      setScheduleSaving(false);
    }
  }

  async function performStatusChange(
    appointment: QueueAppointment,
    status: "confirmed" | "completed",
  ) {
    if (!client || !doctorId || updatingId) {
      return;
    }

    const previousStatus = appointment.status;

    setUpdatingId(appointment.id);
    setActionError(null);
    setNotice(null);
    setQueue(
      (current) =>
        current?.map((item) =>
          item.id === appointment.id ? { ...item, status } : item,
        ) ?? current,
    );

    try {
      await updateAppointmentStatus(
        client,
        doctorId,
        appointment.id,
        status,
      );
      setNotice(
        status === "confirmed"
          ? `${appointment.patientName}'s appointment is confirmed.`
          : `${appointment.patientName}'s visit is marked completed.`,
      );
    } catch (error) {
      setQueue(
        (current) =>
          current?.map((item) =>
            item.id === appointment.id
              ? { ...item, status: previousStatus }
              : item,
          ) ?? current,
      );
      setActionError(
        describeError(error, "Could not update the appointment."),
      );
    } finally {
      setUpdatingId(null);
    }
  }

  async function confirmStatusChange() {
    if (!pendingStatusChange || statusChanging) {
      return;
    }

    setStatusChanging(true);
    try {
      await performStatusChange(
        pendingStatusChange.appointment,
        pendingStatusChange.status,
      );
      setPendingStatusChange(null);
    } finally {
      setStatusChanging(false);
    }
  }

  async function handleCancelAppointment() {
    if (!client || !doctorId || !cancelTarget || cancelling) {
      return;
    }

    setCancelling(true);

    try {
      await cancelDoctorAppointment(
        client,
        doctorId,
        cancelTarget.id,
        cancelReason,
      );
      setNotice(`${cancelTarget.patientName}'s appointment has been cancelled.`);
      setCancelTarget(null);
      setCancelReason("");
      void refreshQueue();
    } catch (error) {
      setActionError(
        describeError(error, "Could not cancel the appointment."),
      );
    } finally {
      setCancelling(false);
    }
  }

  function handleConsultationCompleted(appointmentId: string) {
    setConsultationTarget(null);
    setQueue(
      (current) =>
        current?.map((item) =>
          item.id === appointmentId ? { ...item, status: "completed" } : item,
        ) ?? current,
    );
    setNotice("Consultation saved and appointment marked completed.");
    void refreshQueue();
  }

  // Poll unread chat counts so doctors are notified of new patient messages.
  useEffect(() => {
    if (!client || !doctorId || !queue || queue.length === 0) {
      return;
    }
    const appointmentIds = queue.map((row) => row.id);
    const timer = window.setInterval(() => {
      void fetchUnreadCountsByAppointment(client, doctorId, appointmentIds).then(
        (counts) => setUnreadCounts(counts),
      );
    }, 15000);
    return () => window.clearInterval(timer);
  }, [client, doctorId, queue]);

  return (
    <div className="min-h-full bg-primary-bg md:pl-64">
      <AppHeader
        role="doctor"
        sections={[
          { id: "announcements", label: "Announcements" },
          { id: "queue", label: "Appointment queue" },
          { id: "availability", label: "Availability" },
        ]}
      />
      <main className="mx-auto w-full max-w-6xl px-4 pt-16 pb-10 sm:px-6 md:pt-10 lg:py-14">
        <header className="mb-8">
          <p className="mb-3 inline-flex items-center gap-2 rounded-full border border-brand-hover/40 bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-black/70">
            <Stethoscope className="h-3.5 w-3.5" aria-hidden="true" />
            CarePulse
          </p>
          <h1 className="text-3xl font-semibold tracking-tight text-black sm:text-4xl">
            Doctor dashboard
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-black/60 sm:text-base">
            {doctor
              ? `${doctor.fullName} · ${doctor.specialty}`
              : doctorId
                ? "Loading your profile…"
                : "Manage your weekly hours and patient queue."}
          </p>
        </header>

        {announcements.length > 0 ? (
          <section id="announcements" className="mb-6 rounded-2xl border border-black/10 bg-white p-5 shadow-sm">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-black/45">
              Announcements
            </p>
            <ul className="space-y-2">
              {announcements.map((a) => (
                <li key={a.id} className="rounded-xl border border-black/10 p-3">
                  {a.title ? (
                    <p className="text-sm font-semibold text-black">{a.title}</p>
                  ) : null}
                  <p className="text-sm text-black/70 whitespace-pre-wrap">{a.body}</p>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {initError ? (
          <NoticeCard title="Dashboard unavailable" message={initError} />
        ) : !authChecked ? (
          <div className="flex items-center gap-3 rounded-2xl border border-black/10 bg-white p-6 text-sm text-black/60">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Checking your session…
          </div>
        ) : !doctorId || !client ? (
          <div className="rounded-2xl border border-black/10 bg-white p-6 sm:p-8">
            <h2 className="text-lg font-semibold text-black">
              Sign in with a doctor account
            </h2>
            <p className="mt-2 max-w-xl text-sm text-black/60">
              This workspace shows your schedule and patient queue, so it needs
              your doctor session.
            </p>
            <Link
              href="/login"
              className="mt-5 inline-flex items-center justify-center rounded-xl bg-brand-accent px-5 py-3 text-sm font-semibold text-black transition-colors hover:bg-brand-hover hover:text-white"
            >
              Go to sign in
            </Link>
          </div>
        ) : profileState === "missing" ? (
          <div className="rounded-2xl border border-black/10 bg-white p-6 sm:p-8">
            <h2 className="text-lg font-semibold text-black">
              You&apos;re not in the doctor directory yet
            </h2>
            <p className="mt-2 max-w-xl text-sm text-black/60">
              Your account has the doctor role, but no directory entry has been
              created for it, so patients can&apos;t book you and hours can&apos;t
              be saved. Ask an administrator to add you from the Doctor
              Directory on their dashboard.
            </p>
          </div>
        ) : profileState === "loading" ? (
          <div className="flex items-center gap-3 rounded-2xl border border-black/10 bg-white p-6 text-sm text-black/60">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Loading your profile…
          </div>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
            <section id="queue" className="rounded-2xl border border-black/10 bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-bg text-brand-hover">
                    <Users className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-black/45">
                      Today &amp; upcoming
                    </p>
                    <h2 className="text-base font-semibold text-black">
                      Appointment queue
                    </h2>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <span
                    className="inline-flex items-center gap-1.5 rounded-full border border-black/10 bg-white px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-black/55"
                    title={
                      liveStatus === "live"
                        ? "Realtime updates connected"
                        : liveStatus === "offline"
                          ? "Realtime updates unavailable — refresh manually"
                          : "Connecting to realtime updates"
                    }
                  >
                    <span
                      className={clsx(
                        "h-1.5 w-1.5 rounded-full",
                        liveStatus === "live"
                          ? "animate-pulse bg-brand-hover"
                          : liveStatus === "offline"
                            ? "bg-red-500"
                            : "bg-amber-500",
                      )}
                    />
                    {liveStatus === "live"
                      ? "Live"
                      : liveStatus === "offline"
                        ? "Offline"
                        : "Connecting"}
                  </span>
                  <button
                    type="button"
                    onClick={() => void refreshQueue()}
                    aria-label="Refresh appointment queue"
                    className="rounded-lg border border-black/10 p-2 text-black/60 transition-colors hover:border-brand-hover hover:bg-brand-accent/10 hover:text-black"
                  >
                    <RefreshCw
                      className={clsx(
                        "h-4 w-4",
                        queue === null && "animate-spin",
                      )}
                      aria-hidden="true"
                    />
                  </button>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2" aria-label="Filter appointments by status">
                {FILTERS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={filter === option.value}
                    onClick={() => setFilter(option.value)}
                    className={clsx(
                      "rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors",
                      filter === option.value
                        ? "border-brand-hover bg-brand-accent text-black"
                        : "border-black/10 bg-white text-black/60 hover:border-brand-hover hover:text-black",
                    )}
                  >
                    {option.label}
                    <span className="ml-1.5 text-[10px] font-medium opacity-60">
                      {counts[option.value]}
                    </span>
                  </button>
                ))}
              </div>

              {notice ? (
                <p className="mt-4 flex items-start gap-2 rounded-xl border border-brand-hover/40 bg-brand-accent/15 p-3 text-sm text-black">
                  <CheckCircle2
                    className="mt-0.5 h-4 w-4 shrink-0 text-brand-hover"
                    aria-hidden="true"
                  />
                  {notice}
                </p>
              ) : null}

              {actionError ? (
                <p
                  role="alert"
                  className="mt-4 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800"
                >
                  <AlertCircle
                    className="mt-0.5 h-4 w-4 shrink-0"
                    aria-hidden="true"
                  />
                  {actionError}
                </p>
              ) : null}

              {queueError ? (
                <div className="mt-4">
                  <p
                    role="alert"
                    className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800"
                  >
                    <AlertCircle
                      className="mt-0.5 h-4 w-4 shrink-0"
                      aria-hidden="true"
                    />
                    {queueError}
                  </p>
                  <button
                    type="button"
                    onClick={() => void refreshQueue()}
                    className="mt-3 rounded-lg border border-brand-hover px-3 py-2 text-xs font-semibold text-black transition-colors hover:bg-brand-accent/15"
                  >
                    Try again
                  </button>
                </div>
              ) : null}

              <div className="mt-4">
                {visibleAppointments === null ? (
                  <div className="space-y-3">
                    {[0, 1, 2].map((key) => (
                      <div
                        key={key}
                        className="h-[92px] animate-pulse rounded-xl border border-black/10 bg-black/5"
                      />
                    ))}
                  </div>
                ) : visibleAppointments.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-black/15 p-6 text-center text-sm text-black/60">
                    {filter === "all"
                      ? "No appointments on the books yet."
                      : `No ${filter} appointments right now.`}
                  </p>
                ) : (
                  <ul className="space-y-3">
                    {visibleAppointments.map((appointment) => (
                      <li
                        key={appointment.id}
                        className="flex flex-col gap-3 rounded-xl border border-black/10 p-4 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div className="flex min-w-0 items-center gap-3">
                          <span className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-bg text-sm font-semibold text-black sm:flex">
                            {patientInitial(appointment.patientName)}
                          </span>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-black">
                              {appointment.patientName || "Patient"}
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
                            {appointment.patientNote ? (
                              <p className="mt-1 truncate text-xs italic text-black/60">
                                “{appointment.patientNote}”
                              </p>
                            ) : null}
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center justify-between gap-2 sm:justify-end">
                          <button
                            type="button"
                            onClick={() => setIntakeTarget(appointment)}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-black/15 px-3 py-2 text-xs font-semibold text-black/70 transition-colors hover:border-brand-hover hover:text-black"
                          >
                            View intake
                          </button>
                          <StatusPill status={appointment.status} />

                          {(appointment.status === "pending" ||
                            appointment.status === "confirmed") && (
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
                                className="relative inline-flex items-center gap-1.5 rounded-lg border border-brand-hover px-3 py-2 text-xs font-semibold text-black transition-colors hover:bg-brand-accent/15"
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
                                disabled={cancelling}
                                onClick={() => setCancelTarget(appointment)}
                                className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-2 text-xs font-semibold text-red-700 transition-colors hover:bg-red-50 disabled:opacity-50"
                              >
                                <X className="h-3.5 w-3.5" aria-hidden="true" />
                                Cancel
                              </button>
                            </>
                          )}

                          {appointment.status === "pending" ? (
                            <button
                              type="button"
                              disabled={updatingId !== null}
                              onClick={() =>
                                setPendingStatusChange({
                                  appointment,
                                  status: "confirmed",
                                })
                              }
                              className="inline-flex items-center gap-1.5 rounded-lg bg-brand-accent px-3 py-2 text-xs font-semibold text-black transition-colors hover:bg-brand-hover hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {updatingId === appointment.id ? (
                                <Loader2
                                  className="h-3.5 w-3.5 animate-spin"
                                  aria-hidden="true"
                                />
                              ) : (
                                <Check
                                  className="h-3.5 w-3.5"
                                  aria-hidden="true"
                                />
                              )}
                              Confirm
                            </button>
                          ) : appointment.status === "confirmed" ? (
                            <button
                              type="button"
                              onClick={() =>
                                setConsultationTarget(appointment)
                              }
                              className="inline-flex items-center gap-1.5 rounded-lg border border-brand-hover px-3 py-2 text-xs font-semibold text-black transition-colors hover:bg-brand-accent/15"
                            >
                              Complete consultation
                            </button>
                          ) : null}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>

            <aside id="availability" className="rounded-2xl border border-black/10 bg-white p-5 shadow-sm lg:sticky lg:top-6">
              <div className="flex items-start gap-3">
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-bg text-brand-hover">
                  <CalendarDays className="h-4 w-4" aria-hidden="true" />
                </span>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-black/45">
                    Availability
                  </p>
                  <h2 className="text-base font-semibold text-black">
                    Weekly hours
                  </h2>
                </div>
              </div>
              <p className="mt-2 text-xs text-black/55">
                Patients can only book inside these blocks. Toggle a day off to
                remove it from booking.
              </p>

              {scheduleError ? (
                <div className="mt-4">
                  <p
                    role="alert"
                    className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-800"
                  >
                    <AlertCircle
                      className="mt-0.5 h-4 w-4 shrink-0"
                      aria-hidden="true"
                    />
                    {scheduleError}
                  </p>
                  <button
                    type="button"
                    onClick={() => setScheduleReloadKey((key) => key + 1)}
                    className="mt-3 rounded-lg border border-brand-hover px-3 py-2 text-xs font-semibold text-black transition-colors hover:bg-brand-accent/15"
                  >
                    Reload hours
                  </button>
                </div>
              ) : weekly === null ? (
                <div className="mt-4 space-y-2">
                  {[0, 1, 2, 3, 4, 5, 6].map((key) => (
                    <div
                      key={key}
                      className="h-9 animate-pulse rounded-lg bg-black/5"
                    />
                  ))}
                </div>
              ) : (
                <>
                  <div className="mt-4 divide-y divide-black/10">
                    {weekly.map((day) => (
                      <DayRow
                        key={day.dayOfWeek}
                        day={day}
                        onChange={(patch) =>
                          handleDayChange(day.dayOfWeek, patch)
                        }
                      />
                    ))}
                  </div>

                  {scheduleValidation ? (
                    <p
                      role="alert"
                      className="mt-4 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-800"
                    >
                      <AlertCircle
                        className="mt-0.5 h-4 w-4 shrink-0"
                        aria-hidden="true"
                      />
                      {scheduleValidation}
                    </p>
                  ) : null}

                  {scheduleNotice ? (
                    <p className="mt-4 flex items-start gap-2 rounded-xl border border-brand-hover/40 bg-brand-accent/15 p-3 text-xs text-black">
                      <CheckCircle2
                        className="mt-0.5 h-4 w-4 shrink-0 text-brand-hover"
                        aria-hidden="true"
                      />
                      {scheduleNotice}
                    </p>
                  ) : null}

                  <button
                    type="button"
                    onClick={() => void handleSaveSchedule()}
                    disabled={scheduleSaving}
                    className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-brand-accent px-4 py-3 text-sm font-semibold text-black transition-colors hover:bg-brand-hover hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {scheduleSaving ? (
                      <>
                        <Loader2
                          className="h-4 w-4 animate-spin"
                          aria-hidden="true"
                        />
                        Saving…
                      </>
                    ) : (
                      "Save schedule"
                    )}
                  </button>
                  <p className="mt-2 text-center text-[11px] text-black/45">
                    Slots are generated from the start time in the selected
                    increment.
                  </p>
                </>
              )}
            </aside>
          </div>
        )}
      </main>

      {chatTarget ? (
        <ChatModal
          appointmentId={chatTarget.id}
          otherPartyName={chatTarget.patientName || "Patient"}
          currentUserId={doctorId ?? ""}
          client={client!}
          onClose={() => setChatTarget(null)}
          onStartVideoCall={() => void startCall(chatTarget, false)}
          onStartAudioCall={() => void startCall(chatTarget, true)}
        />
      ) : null}

      {callTarget ? (
        <CallModal
          title={callTarget.appointment.patientName || "Patient"}
          subtitle="Telehealth consultation"
          audioOnly={callTarget.audioOnly}
          roomUrl={callRoomUrl}
          loading={callRoomLoading}
          error={callRoomError}
          onClose={closeCall}
        />
      ) : null}

      {consultationTarget && client && doctorId ? (
        <ConsultationModal
          key={consultationTarget.id}
          appointment={consultationTarget}
          doctorId={doctorId}
          client={client}
          onClose={() => setConsultationTarget(null)}
          onCompleted={handleConsultationCompleted}
        />
      ) : null}

      {intakeTarget && client ? (
        <IntakeReviewModal
          key={`intake-${intakeTarget.id}`}
          client={client}
          appointmentId={intakeTarget.id}
          patientId={intakeTarget.patientId}
          patientName={intakeTarget.patientName || "Patient"}
          onClose={() => setIntakeTarget(null)}
        />
      ) : null}

      <ConfirmDialog
        open={cancelTarget !== null}
        title="Cancel this appointment?"
        description={
          cancelTarget
            ? `You are about to cancel ${cancelTarget.patientName}'s appointment.`
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
          Reason for cancellation
          <textarea
            value={cancelReason}
            onChange={(e) => setCancelReason(e.target.value)}
            rows={3}
            placeholder="Explain why this appointment is being cancelled"
            className="mt-1 w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm text-black focus:border-brand-hover focus:outline-none focus:ring-1 focus:ring-brand-hover"
          />
        </label>
      </ConfirmDialog>

      <ConfirmDialog
        open={pendingStatusChange !== null}
        title="Confirm appointment?"
        description={
          pendingStatusChange
            ? `Mark ${pendingStatusChange.appointment.patientName}'s appointment as ${pendingStatusChange.status}.`
            : undefined
        }
        confirmLabel="Confirm"
        loading={statusChanging}
        onConfirm={confirmStatusChange}
        onCancel={() => setPendingStatusChange(null)}
      />
    </div>
  );
}

function DayRow({
  day,
  onChange,
}: {
  day: DayHours;
  onChange: (patch: Partial<DayHours>) => void;
}) {
  const label = DAY_LABELS[day.dayOfWeek];
  const timeInputClass =
    "mt-1 w-full rounded-lg border border-black/15 bg-white px-2 py-1.5 text-sm font-normal text-black focus:border-brand-hover focus:outline-none focus:ring-2 focus:ring-brand-hover/30";

  return (
    <div className="py-3 first:pt-0 last:pb-0">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            role="switch"
            aria-checked={day.enabled}
            aria-label={`${label} working hours`}
            onClick={() => onChange({ enabled: !day.enabled })}
            className={clsx(
              "relative h-5 w-9 shrink-0 rounded-full transition-colors",
              day.enabled ? "bg-brand-accent" : "bg-black/15",
            )}
          >
            <span
              className={clsx(
                "absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform",
                day.enabled ? "translate-x-[1.1rem]" : "translate-x-0.5",
              )}
            />
          </button>
          <span
            className={clsx(
              "text-sm",
              day.enabled ? "font-medium text-black" : "text-black/40",
            )}
          >
            {label}
          </span>
        </div>
        {!day.enabled ? (
          <span className="text-[10px] font-semibold uppercase tracking-wide text-black/35">
            Closed
          </span>
        ) : null}
      </div>

      {day.enabled ? (
        <div className="mt-2 grid grid-cols-2 gap-2">
          <label className="text-[10px] font-semibold uppercase tracking-wide text-black/50">
            From
            <input
              type="time"
              value={day.startTime}
              onChange={(event) => onChange({ startTime: event.target.value })}
              className={timeInputClass}
            />
          </label>
          <label className="text-[10px] font-semibold uppercase tracking-wide text-black/50">
            To
            <input
              type="time"
              value={day.endTime}
              onChange={(event) => onChange({ endTime: event.target.value })}
              className={timeInputClass}
            />
          </label>
          <label className="col-span-2 text-[10px] font-semibold uppercase tracking-wide text-black/50">
            Slot length (minutes)
            <input
              type="number"
              min={10}
              max={180}
              step={5}
              value={day.slotMinutes}
              onChange={(event) =>
                onChange({ slotMinutes: Number(event.target.value) })
              }
              className={timeInputClass}
            />
          </label>
        </div>
      ) : null}
    </div>
  );
}

function StatusPill({ status }: { status: QueueStatus }) {
  return (
    <span
      className={clsx(
        "inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide",
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
