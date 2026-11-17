"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  AlertCircle,
  BarChart3,
  Calendar,
  Loader2,
  MessageSquare,
  Plus,
  Shield,
  Stethoscope,
  Trash2,
  TrendingDown,
  Users,
  RefreshCw,
  X,
} from "lucide-react";
import { AppHeader } from "@/components/AppHeader";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import {
  createDoctor,
  deleteAppointment,
  deleteDoctor,
  restoreAppointment,
  fetchAppointmentStats,
  fetchCancellationLog,
  fetchCancellationRates,
  fetchRecentAppointments,
  fetchDoctorDirectory,
  fetchPeakBookingHours,
  fetchUsersWithRoles,
  updateUserRole,
  type AppointmentRecord,
  type AppointmentStats,
  type CancellationLogEntry,
  type CancellationRate,
  type DoctorRecord,
  type PeakHour,
  type UserWithRole,
} from "@/lib/admin";
import { createClient } from "@/lib/supabase";
import { ChatModal } from "@/components/ChatModal";
import {
  createAnnouncement,
  fetchUnreadDirectCountsBySender,
} from "@/lib/chat";

function describeError(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

const ROLES = ["patient", "doctor", "admin"] as const;

export default function AdminDashboardPage() {
  const [client, setClient] = useState<SupabaseClient | null>(null);
  const [initError, setInitError] = useState<string | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminId, setAdminId] = useState<string | null>(null);
  const [messagesOpen, setMessagesOpen] = useState(false);
  const [chatTarget, setChatTarget] = useState<{ id: string; name: string } | null>(
    null,
  );
  const [unreadDirectCounts, setUnreadDirectCounts] = useState<
    Record<string, number>
  >({});
  const [announceOpen, setAnnounceOpen] = useState(false);
  const [announceTitle, setAnnounceTitle] = useState("");
  const [announceBody, setAnnounceBody] = useState("");
  const [announceTarget, setAnnounceTarget] = useState<
    "all" | "patient" | "doctor"
  >("all");
  const [announceSaving, setAnnounceSaving] = useState(false);

  const [stats, setStats] = useState<AppointmentStats | null>(null);
  const [cancellations, setCancellations] = useState<CancellationRate[] | null>(
    null,
  );
  const [cancellationLog, setCancellationLog] = useState<
    CancellationLogEntry[] | null
  >(null);
  const [appointmentRecords, setAppointmentRecords] = useState<
    AppointmentRecord[] | null
  >(null);
  const [peakHours, setPeakHours] = useState<PeakHour[] | null>(null);
  const [users, setUsers] = useState<UserWithRole[] | null>(null);
  const [doctors, setDoctors] = useState<DoctorRecord[] | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatingUser, setUpdatingUser] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [pendingRoleChange, setPendingRoleChange] = useState<{
    userId: string;
    newRole: string;
  } | null>(null);
  const [pendingDoctorRemoval, setPendingDoctorRemoval] =
    useState<DoctorRecord | null>(null);
  const [pendingAppointmentDelete, setPendingAppointmentDelete] =
    useState<AppointmentRecord | null>(null);

  const [doctorUserId, setDoctorUserId] = useState("");
  const [doctorName, setDoctorName] = useState("");
  const [doctorSpecialty, setDoctorSpecialty] = useState("");
  const [savingDoctor, setSavingDoctor] = useState(false);
  const [removingDoctor, setRemovingDoctor] = useState<string | null>(null);
  const [doctorError, setDoctorError] = useState<string | null>(null);

  const loadAllData = useCallback(async (supabase: SupabaseClient) => {
    try {
      setLoading(true);
      setError(null);

      const [
        statsData,
        cancellationData,
        cancellationLogData,
        appointmentRecordsData,
        peakData,
        usersData,
        doctorsData,
      ] = await Promise.all([
        fetchAppointmentStats(supabase),
        fetchCancellationRates(supabase, 7),
        fetchCancellationLog(supabase, 10),
        fetchRecentAppointments(supabase, 12),
        fetchPeakBookingHours(supabase, 30),
        fetchUsersWithRoles(supabase),
        fetchDoctorDirectory(supabase),
      ]);

      setStats(statsData);
      setCancellations(cancellationData);
      setCancellationLog(cancellationLogData);
      setAppointmentRecords(appointmentRecordsData);
      setPeakHours(peakData);
      setUsers(usersData);
      setDoctors(doctorsData);
    } catch (err) {
      setError(describeError(err, "Failed to load dashboard data"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;

    (async () => {
      let supabase: SupabaseClient;

      try {
        supabase = createClient();
      } catch (err) {
        if (active) {
          setInitError(describeError(err, "Supabase is not configured."));
          setAuthChecked(true);
          setLoading(false);
        }
        return;
      }

      try {
        const { data } = await supabase.auth.getUser();
        if (!active) return;

        setClient(supabase);
        setAdminId(data.user?.id ?? null);

        if (!data.user) {
          setAuthChecked(true);
          setLoading(false);
          return;
        }

        // Check if user is admin
        const { data: profile } = await supabase
          .from("profiles")
          .select("role")
          .eq("id", data.user.id)
          .maybeSingle();

        if (!active) return;

        setAuthChecked(true);
        setIsAdmin(profile?.role === "admin");

        if (profile?.role === "admin") {
          await loadAllData(supabase);
        } else {
          setLoading(false);
        }
      } catch (err) {
        if (active) {
          setError(describeError(err, "Failed to load dashboard"));
          setAuthChecked(true);
          setLoading(false);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [loadAllData]);

  const performRoleChange = async (userId: string, newRole: string) => {
    if (!client || updatingUser) return;

    setUpdatingUser(userId);
    setNotice(null);
    setError(null);

    try {
      await updateUserRole(client, userId, newRole);
      setUsers((current) =>
        current?.map((user) =>
          user.id === userId ? { ...user, role: newRole } : user,
        ) ?? current,
      );
      setNotice("Role updated successfully");
    } catch (err) {
      setError(describeError(err, "Failed to update role"));
    } finally {
      setUpdatingUser(null);
    }
  };

  const handleDeleteAppointment = async (appointment: AppointmentRecord) => {
    if (!client) {
      return;
    }

    try {
      await deleteAppointment(client, appointment.id);
      setAppointmentRecords((current) =>
        current?.filter((item) => item.id !== appointment.id) ?? current,
      );
      setNotice("Appointment deleted.");
    } catch (err) {
      setError(describeError(err, "Failed to delete appointment."));
    }
  };

  const handleRestoreAppointment = async (appointment: AppointmentRecord) => {
    if (!client) {
      return;
    }

    try {
      await restoreAppointment(client, appointment.id);
      setAppointmentRecords((current) =>
        current?.map((item) =>
          item.id === appointment.id ? { ...item, status: "pending" } : item,
        ) ?? current,
      );
      setNotice("Appointment restored to pending.");
    } catch (err) {
      setError(describeError(err, "Failed to restore appointment."));
    }
  };

  const handleAddDoctor = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!client || savingDoctor) {
      return;
    }

    setSavingDoctor(true);
    setDoctorError(null);
    setNotice(null);

    try {
      await createDoctor(client, {
        userId: doctorUserId,
        fullName: doctorName,
        specialty: doctorSpecialty,
      });

      const directory = await fetchDoctorDirectory(client);
      setDoctors(directory);
      setDoctorUserId("");
      setDoctorName("");
      setDoctorSpecialty("");
      setNotice("Doctor added to the directory.");
    } catch (err) {
      setDoctorError(describeError(err, "Failed to add the doctor"));
    } finally {
      setSavingDoctor(false);
    }
  };

  const performRemoveDoctor = async (doctor: DoctorRecord) => {
    if (!client || removingDoctor) {
      return;
    }

    setRemovingDoctor(doctor.id);
    setDoctorError(null);
    setNotice(null);

    try {
      await deleteDoctor(client, doctor.id);
      setDoctors((current) =>
        current?.filter((item) => item.id !== doctor.id) ?? current,
      );
      setNotice(`${doctor.fullName} removed from the directory.`);
    } catch (err) {
      setDoctorError(describeError(err, "Failed to remove the doctor"));
    } finally {
      setRemovingDoctor(null);
    }
  };

  async function confirmRoleChange() {
    if (!pendingRoleChange) {
      return;
    }

    await performRoleChange(pendingRoleChange.userId, pendingRoleChange.newRole);
    setPendingRoleChange(null);
  }

  async function confirmDoctorRemoval() {
    if (!pendingDoctorRemoval) {
      return;
    }

    await performRemoveDoctor(pendingDoctorRemoval);
    setPendingDoctorRemoval(null);
  }

  // Unread badges for the admin's direct-message inbox.
  useEffect(() => {
    if (!client || !adminId) return;
    let active = true;
    void fetchUnreadDirectCountsBySender(client, adminId).then((counts) => {
      if (active) setUnreadDirectCounts(counts);
    });
    return () => {
      active = false;
    };
  }, [client, adminId]);


  // Only accounts already holding the doctor role can join the directory.
  const doctorCandidates = (users ?? []).filter(
    (user) =>
      user.role === "doctor" &&
      !(doctors ?? []).some((doctor) => doctor.id === user.id),
  );

  const maxPeakCount = peakHours
    ? Math.max(...peakHours.map((h) => h.count), 1)
    : 1;

  return (
    <div className="min-h-full bg-primary-bg md:pl-64">
      <AppHeader
        role="admin"
        sections={[
          { id: "appointment-data", label: "Appointment data management" },
          { id: "peak-hours", label: "Peak booking hours" },
          { id: "doctor-directory", label: "Doctor directory" },
          { id: "user-management", label: "User management" },
        ]}
      />
      <main className="mx-auto w-full max-w-7xl px-4 pt-16 pb-10 sm:px-6 md:pt-10 lg:py-14">
        <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="mb-3 inline-flex items-center gap-2 rounded-full border border-brand-hover/40 bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-black/70">
              <Shield className="h-3.5 w-3.5" aria-hidden="true" />
              CarePulse Admin
            </p>
            <h1 className="text-3xl font-semibold tracking-tight text-black sm:text-4xl">
              Admin Dashboard
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-black/60 sm:text-base">
              Overview of appointments, analytics, and user management
            </p>
          </div>

          {client && isAdmin ? (
            <>
            <button
              type="button"
              onClick={() => setMessagesOpen(true)}
              className="relative inline-flex items-center gap-2 rounded-xl border border-brand-hover bg-white px-4 py-2.5 text-sm font-semibold text-black transition-colors hover:bg-brand-accent/15"
            >
              <MessageSquare className="h-4 w-4" aria-hidden="true" />
              Message
              {Object.values(unreadDirectCounts).reduce((s, c) => s + c, 0) >
              0 ? (
                <span className="ml-1 inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
                  {Object.values(unreadDirectCounts).reduce(
                    (sum, count) => sum + count,
                    0,
                  )}
                </span>
              ) : null}
            </button>
            <button
              type="button"
              onClick={() => setAnnounceOpen(true)}
              className="inline-flex items-center gap-2 rounded-xl border border-brand-hover bg-white px-4 py-2.5 text-sm font-semibold text-black transition-colors hover:bg-brand-accent/15"
            >
              <MessageSquare className="h-4 w-4" aria-hidden="true" />              Announce
            </button>
            </>
          ) : null}
        </header>

        {initError ? (
          <NoticeCard title="Dashboard unavailable" message={initError} />
        ) : !authChecked ? (
          <div className="flex items-center gap-3 rounded-2xl border border-black/10 bg-white p-6 text-sm text-black/60">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Checking your session...
          </div>
        ) : !client || !isAdmin ? (
          <div className="rounded-2xl border border-black/10 bg-white p-6 sm:p-8">
            <h2 className="text-lg font-semibold text-black">
              Access Denied
            </h2>
            <p className="mt-2 max-w-xl text-sm text-black/60">
              This dashboard requires administrator privileges.
            </p>
            <Link
              href="/"
              className="mt-5 inline-flex items-center justify-center rounded-xl bg-brand-accent px-5 py-3 text-sm font-semibold text-black transition-colors hover:bg-brand-hover hover:text-white"
            >
              Go Home
            </Link>
          </div>
        ) : (
          <>
            {notice && (
              <div className="mb-6 flex items-start gap-2 rounded-xl border border-brand-hover/40 bg-brand-accent/15 p-3 text-sm text-black">
                <AlertCircle
                  className="mt-0.5 h-4 w-4 shrink-0 text-brand-hover"
                  aria-hidden="true"
                />
                {notice}
              </div>
            )}

            {error && (
              <div className="mb-6 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                <AlertCircle
                  className="mt-0.5 h-4 w-4 shrink-0"
                  aria-hidden="true"
                />
                {error}
              </div>
            )}

            {/* Stats Cards */}
            <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <StatCard
                title="Total Appointments"
                value={stats?.total.toString() || "0"}
                icon={<Calendar className="h-5 w-5" />}
                loading={loading}
              />
              <StatCard
                title="Today"
                value={stats?.today.toString() || "0"}
                icon={<Calendar className="h-5 w-5" />}
                loading={loading}
              />
              <StatCard
                title="Last 7 Days"
                value={stats?.thisWeek.toString() || "0"}
                icon={<BarChart3 className="h-5 w-5" />}
                loading={loading}
              />
            </div>

            <div className="mb-6 grid gap-6 lg:grid-cols-2">
              {/* Daily Cancellation Rates */}
              <section className="rounded-2xl border-2 border-[#619930] bg-white p-5 shadow-sm">
                <div className="mb-4 flex items-center gap-2">
                  <TrendingDown className="h-5 w-5 text-brand-hover" />
                  <h2 className="text-lg font-semibold text-black">
                    Daily Cancellation Rates (Last 7 Days)
                  </h2>
                </div>
                {loading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-brand-hover" />
                  </div>
                ) : (
                  <div className="space-y-3">
                    {cancellations?.map((day) => (
                      <div key={day.date} className="flex items-center gap-3">
                        <span className="w-16 text-xs font-medium text-black/70">
                          {day.date}
                        </span>
                        <div className="flex-1">
                          <div className="mb-1 flex justify-between text-xs text-black/60">
                            <span>
                              {day.cancelled} / {day.total} cancelled
                            </span>
                            <span className="font-semibold text-red-600">
                              {day.rate}%
                            </span>
                          </div>
                          <div className="h-2 w-full overflow-hidden rounded-full bg-black/10">
                            <div
                              className="h-full bg-red-500 transition-all"
                              style={{ width: `${day.rate}%` }}
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {/* Recent Cancellations */}
              <section className="rounded-2xl border-2 border-[#619930] bg-white p-5 shadow-sm lg:col-span-2">
                <div className="mb-4 flex items-center gap-2">
                  <TrendingDown className="h-5 w-5 text-brand-hover" />
                  <h2 className="text-lg font-semibold text-black">
                    Recent Cancellations
                  </h2>
                </div>
                {loading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-brand-hover" />
                  </div>
                ) : cancellationLog && cancellationLog.length > 0 ? (
                  <ul className="space-y-3">
                    {cancellationLog.map((entry) => (
                      <li
                        key={entry.id}
                        className="rounded-xl border border-black/10 p-3"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <p className="text-sm font-semibold text-black">
                            {entry.patientName} with {entry.doctorName}
                          </p>
                          <p className="text-xs text-black/50">
                            {entry.date} {entry.time}
                          </p>
                        </div>
                        <p className="mt-1 text-xs text-black/60">
                          Cancelled by {entry.cancelledBy}
                          {entry.reason ? `: ${entry.reason}` : ""}
                        </p>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="py-6 text-center text-sm text-black/55">
                    No cancellations recorded yet.
                  </p>
                )}
              </section>

              {/* Appointment data management */}
              <section id="appointment-data" className="rounded-2xl border-2 border-[#619930] bg-white p-5 shadow-sm lg:col-span-2">
                <div className="mb-4 flex items-center gap-2">
                  <Trash2 className="h-5 w-5 text-brand-hover" />
                  <h2 className="text-lg font-semibold text-black">
                    Appointment data management
                  </h2>
                </div>
                {loading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-brand-hover" />
                  </div>
                ) : appointmentRecords && appointmentRecords.length > 0 ? (
                  <ul className="space-y-3">
                    {appointmentRecords.map((record) => (
                      <li
                        key={record.id}
                        className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-black/10 p-3"
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-black">
                            {record.patientName} with {record.doctorName}
                          </p>
                          <p className="mt-1 text-xs text-black/55">
                            {record.date} {record.time} · {record.status}
                          </p>
                        </div>
                        <div className="flex gap-2">
                          {record.status === "cancelled" ? (
                            <button
                              type="button"
                              onClick={() => void handleRestoreAppointment(record)}
                              className="rounded-lg border border-brand-hover px-3 py-2 text-xs font-semibold text-black transition-colors hover:bg-brand-accent/15"
                            >
                              Restore
                            </button>
                          ) : null}
                          <button
                            type="button"
                            onClick={() => setPendingAppointmentDelete(record)}
                            className="rounded-lg border border-red-200 px-3 py-2 text-xs font-semibold text-red-700 transition-colors hover:bg-red-50"
                          >
                            Delete
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="py-6 text-center text-sm text-black/55">
                    No appointments recorded yet.
                  </p>
                )}
              </section>

              {/* Peak Booking Hours Chart */}
              <section id="peak-hours" className="rounded-2xl border-2 border-[#619930] bg-white p-5 shadow-sm">
                <div className="mb-4 flex items-center gap-2">
                  <BarChart3 className="h-5 w-5 text-brand-hover" />
                  <h2 className="text-lg font-semibold text-black">
                    Peak Booking Hours (Last 30 Days)
                  </h2>
                </div>
                {loading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-brand-hover" />
                  </div>
                ) : (
                  <div className="space-y-2">
                    {peakHours?.map((hour) => (
                      <div key={hour.hour} className="flex items-center gap-3">
                        <span className="w-14 text-xs font-medium text-black/70">
                          {hour.label}
                        </span>
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <div className="h-6 flex-1 overflow-hidden rounded-lg bg-black/10">
                              <div
                                className="h-full bg-brand-accent transition-all"
                                style={{
                                  width: `${(hour.count / maxPeakCount) * 100}%`,
                                }}
                              />
                            </div>
                            <span className="w-8 text-right text-xs font-semibold text-black">
                              {hour.count}
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}
                    {peakHours?.length === 0 && (
                      <p className="py-4 text-center text-sm text-black/50">
                        No booking data available
                      </p>
                    )}
                  </div>
                )}
              </section>
            </div>

            {/* Doctor Directory */}
            <section id="doctor-directory" className="mb-6 rounded-2xl border-2 border-[#619930] bg-white p-5 shadow-sm">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Stethoscope className="h-5 w-5 text-brand-hover" />
                  <h2 className="text-lg font-semibold text-black">
                    Doctor Directory
                  </h2>
                </div>
                <p className="text-xs text-black/50">
                  Patients book slots from this list
                </p>
              </div>

              {doctorError && (
                <div className="mb-4 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                  <AlertCircle
                    className="mt-0.5 h-4 w-4 shrink-0"
                    aria-hidden="true"
                  />
                  {doctorError}
                </div>
              )}

              <form
                onSubmit={handleAddDoctor}
                className="grid gap-3 rounded-xl bg-primary-bg/70 p-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-end"
              >
                <div>
                  <label
                    htmlFor="doctor-account"
                    className="mb-1 block text-xs font-semibold uppercase tracking-wide text-black/50"
                  >
                    Doctor account
                  </label>
                  <select
                    id="doctor-account"
                    value={doctorUserId}
                    onChange={(event) => {
                      const id = event.target.value;
                      const candidate = doctorCandidates.find(
                        (user) => user.id === id,
                      );
                      setDoctorUserId(id);
                      setDoctorName(candidate?.fullName ?? "");
                    }}
                    disabled={loading || savingDoctor}
                    className="w-full rounded-lg border-2 border-[#619930] bg-white px-3 py-2 text-sm font-medium text-black focus:outline-none focus:ring-2 focus:ring-brand-hover/30 disabled:opacity-50"
                  >
                    <option value="">Select an account…</option>
                    {doctorCandidates.map((user) => (
                      <option key={user.id} value={user.id}>
                        {user.fullName}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="doctor-name"
                    className="mb-1 block text-xs font-semibold uppercase tracking-wide text-black/50"
                  >
                    Full name
                  </label>
                  <input
                    id="doctor-name"
                    type="text"
                    value={doctorName}
                    onChange={(event) => setDoctorName(event.target.value)}
                    placeholder="Dr. Amina Yusuf"
                    disabled={savingDoctor}
                    className="w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm text-black focus:border-brand-hover focus:outline-none focus:ring-1 focus:ring-brand-hover disabled:opacity-50"
                  />
                </div>

                <div>
                  <label
                    htmlFor="doctor-specialty"
                    className="mb-1 block text-xs font-semibold uppercase tracking-wide text-black/50"
                  >
                    Specialty
                  </label>
                  <input
                    id="doctor-specialty"
                    type="text"
                    value={doctorSpecialty}
                    onChange={(event) => setDoctorSpecialty(event.target.value)}
                    placeholder="General practice"
                    disabled={savingDoctor}
                    className="w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm text-black focus:border-brand-hover focus:outline-none focus:ring-1 focus:ring-brand-hover disabled:opacity-50"
                  />
                </div>

                <button
                  type="submit"
                  disabled={savingDoctor || !doctorUserId}
                  className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-brand-accent px-4 py-2 text-sm font-semibold text-black transition-colors hover:bg-brand-hover hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {savingDoctor ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Plus className="h-4 w-4" />
                  )}
                  Add doctor
                </button>
              </form>

              {loading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-brand-hover" />
                </div>
              ) : doctors && doctors.length > 0 ? (
                <ul className="mt-4 divide-y divide-black/5">
                  {doctors.map((doctor) => (
                    <li
                      key={doctor.id}
                      className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-4 last:pb-1"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-accent/25 text-brand-hover">
                          <Stethoscope className="h-4 w-4" aria-hidden="true" />
                        </span>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-black">
                            {doctor.fullName}
                          </p>
                          <p className="truncate text-xs text-black/55">
                            {doctor.specialty}
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setPendingDoctorRemoval(doctor)}
                        disabled={removingDoctor === doctor.id}
                        aria-label={`Remove ${doctor.fullName} from the directory`}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-700 transition-colors hover:bg-red-50 disabled:opacity-50"
                      >
                        {removingDoctor === doctor.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5" />
                        )}
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="mt-4 rounded-xl border border-dashed border-black/15 p-6 text-center">
                  <p className="text-sm text-black/60">
                    No doctors in the directory yet.
                  </p>
                  <p className="mt-1 text-xs text-black/45">
                    {doctorCandidates.length === 0
                      ? "Promote an account to the doctor role below, then add it here."
                      : "Pick a doctor account above to make it bookable."}
                  </p>
                </div>
              )}
            </section>

            {/* User Management Table */}
            <section id="user-management" className="rounded-2xl border-2 border-[#619930] bg-white p-5 shadow-sm">
              <div className="mb-4 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Users className="h-5 w-5 text-brand-hover" />
                  <h2 className="text-lg font-semibold text-black">
                    User Management
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => client && loadAllData(client)}
                  className="flex items-center gap-1 rounded-lg border border-brand-hover px-3 py-1.5 text-xs font-semibold text-black transition-colors hover:bg-brand-accent/15"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Refresh
                </button>
              </div>
              {loading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-brand-hover" />
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-black/10">
                        <th className="pb-3 text-left text-xs font-semibold uppercase tracking-wide text-black/50">
                          User
                        </th>
                        <th className="pb-3 text-left text-xs font-semibold uppercase tracking-wide text-black/50">
                          Role
                        </th>
                        <th className="pb-3 text-right text-xs font-semibold uppercase tracking-wide text-black/50">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-black/5">
                      {users?.map((user) => (
                        <tr key={user.id}>
                          <td className="py-3">
                            <div className="flex items-center gap-3">
                              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary-bg text-sm font-semibold text-black">
                                {user.fullName.charAt(0).toUpperCase()}
                              </span>
                              <div>
                                <span className="text-sm font-medium text-black">
                                  {user.fullName}
                                </span>
                                <p className="text-xs text-black/50">
                                  {[user.phone, user.gender, user.email]
                                    .filter(Boolean)
                                    .join(" · ") || "No contact details"}
                                </p>
                              </div>
                            </div>
                          </td>
                          <td className="py-3">
                            <span
                              className={clsx(
                                "inline-flex rounded-full px-2.5 py-1 text-xs font-semibold",
                                user.role === "admin"
                                  ? "bg-red-100 text-red-800"
                                  : user.role === "doctor"
                                    ? "bg-brand-accent/30 text-black"
                                    : "bg-black/5 text-black/70",
                              )}
                            >
                              {user.role}
                            </span>
                          </td>
                          <td className="py-3 text-right">
                            <select
                              value={user.role}
                              onChange={(e) => {
                                const newRole = e.target.value;
                                if (newRole !== user.role) {
                                  setPendingRoleChange({
                                    userId: user.id,
                                    newRole,
                                  });
                                }
                              }}
                              disabled={updatingUser === user.id}
                              className="rounded-lg border-2 border-[#619930] px-3 py-1.5 text-sm font-medium text-black focus:outline-none focus:ring-2 focus:ring-brand-hover/30 disabled:opacity-50"
                            >
                              {ROLES.map((role) => (
                                <option key={role} value={role}>
                                  {role.charAt(0).toUpperCase() + role.slice(1)}
                                </option>
                              ))}
                            </select>
                            {updatingUser === user.id && (
                              <Loader2 className="ml-2 inline h-4 w-4 animate-spin" />
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {users?.length === 0 && (
                    <p className="py-4 text-center text-sm text-black/50">
                      No users found
                    </p>
                  )}
                </div>
              )}
            </section>
          </>
        )}
      </main>

      {messagesOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <div className="flex max-h-[70vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
            <header className="flex items-center justify-between border-b border-black/10 px-5 py-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-black/45">
                  Inbox
                </p>
                <h2 className="text-lg font-semibold text-black">Messages</h2>
              </div>
              <button
                type="button"
                onClick={() => setMessagesOpen(false)}
                className="rounded-lg border border-black/10 p-2 text-black/60 transition-colors hover:border-brand-hover hover:text-black"
                aria-label="Close messages"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              {!users || users.filter((u) => u.id !== adminId).length === 0 ? (
                <p className="px-2 py-6 text-center text-sm text-black/55">
                  No users to message yet.
                </p>
              ) : (
                <ul className="space-y-2">
                  {users
                    .filter((u) => u.id !== adminId)
                    .map((user) => (
                      <li key={user.id}>
                        <button
                          type="button"
                          onClick={() => {
                            setChatTarget({ id: user.id, name: user.fullName });
                            setMessagesOpen(false);
                          }}
                          className="flex w-full items-center justify-between gap-3 rounded-xl border border-black/10 p-3 text-left transition-colors hover:border-brand-hover hover:bg-brand-accent/10"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-black">
                              {user.fullName}
                            </p>
                            <p className="mt-0.5 text-xs text-black/55">
                              {user.role}
                            </p>
                          </div>
                          {unreadDirectCounts[user.id] ? (
                            <span className="inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
                              {unreadDirectCounts[user.id]}
                            </span>
                          ) : null}
                        </button>
                      </li>
                    ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {chatTarget && client && adminId ? (
        <ChatModal
          recipientId={chatTarget.id}
          otherPartyName={chatTarget.name}
          currentUserId={adminId}
          client={client}
          onClose={() => setChatTarget(null)}
        />
      ) : null}

      {announceOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-2xl">
            <header className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-black">New announcement</h2>
              <button
                type="button"
                onClick={() => setAnnounceOpen(false)}
                className="rounded-lg border border-black/10 p-2 text-black/60"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </header>
            <div className="space-y-3">
              <input
                value={announceTitle}
                onChange={(e) => setAnnounceTitle(e.target.value)}
                placeholder="Title (optional)"
                className="w-full rounded-lg border border-black/15 px-3 py-2 text-sm"
              />
              <textarea
                value={announceBody}
                onChange={(e) => setAnnounceBody(e.target.value)}
                placeholder="Message to send…"
                rows={4}
                className="w-full rounded-lg border border-black/15 px-3 py-2 text-sm"
              />
              <select
                value={announceTarget}
                onChange={(e) =>
                  setAnnounceTarget(e.target.value as "all" | "patient" | "doctor")
                }
                className="w-full rounded-lg border border-black/15 px-3 py-2 text-sm"
              >
                <option value="all">Everyone</option>
                <option value="patient">Patients only</option>
                <option value="doctor">Doctors only</option>
              </select>
              <button
                type="button"
                disabled={announceSaving || !announceBody.trim()}
                onClick={async () => {
                  if (!client || !adminId) return;
                  setAnnounceSaving(true);
                  try {
                    await createAnnouncement(
                      client,
                      adminId,
                      announceBody,
                      announceTarget,
                      announceTitle,
                    );
                    setAnnounceBody("");
                    setAnnounceTitle("");
                    setAnnounceOpen(false);
                    setNotice("Announcement sent.");
                  } catch (err) {
                    setError(
                      err instanceof Error ? err.message : "Failed to send",
                    );
                  } finally {
                    setAnnounceSaving(false);
                  }
                }}
                className="w-full rounded-lg bg-brand-accent px-4 py-2 text-sm font-semibold text-black disabled:opacity-50"
              >
                {announceSaving ? "Sending…" : "Send announcement"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <ConfirmDialog
        open={pendingRoleChange !== null}
        title="Change user role?"
        description={
          pendingRoleChange
            ? `This will change the selected account's role to ${pendingRoleChange.newRole}.`
            : undefined
        }
        confirmLabel="Update role"
        onConfirm={confirmRoleChange}
        onCancel={() => setPendingRoleChange(null)}
      />

      <ConfirmDialog
        open={pendingDoctorRemoval !== null}
        title="Remove doctor from directory?"
        description={
          pendingDoctorRemoval
            ? `${pendingDoctorRemoval.fullName} will no longer be bookable. This cannot be undone.`
            : undefined
        }
        confirmLabel="Remove"
        tone="danger"
        onConfirm={confirmDoctorRemoval}
        onCancel={() => setPendingDoctorRemoval(null)}
      />

      <ConfirmDialog
        open={pendingAppointmentDelete !== null}
        title="Delete appointment?"
        description={
          pendingAppointmentDelete
            ? `Delete ${pendingAppointmentDelete.patientName}'s appointment permanently.`
            : undefined
        }
        confirmLabel="Delete"
        tone="danger"
        onConfirm={() => {
          if (pendingAppointmentDelete) {
            void handleDeleteAppointment(pendingAppointmentDelete);
          }
          setPendingAppointmentDelete(null);
        }}
        onCancel={() => setPendingAppointmentDelete(null)}
      />
    </div>
  );
}

function StatCard({
  title,
  value,
  icon,
  loading,
}: {
  title: string;
  value: string;
  icon: React.ReactNode;
  loading: boolean;
}) {
  return (
    <div className="rounded-2xl border-2 border-[#619930] bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-black/60">{title}</p>
          {loading ? (
            <div className="mt-2 h-8 w-16 animate-pulse rounded bg-black/10" />
          ) : (
            <p className="mt-2 text-3xl font-semibold text-black">{value}</p>
          )}
        </div>
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-accent/20 text-brand-hover">
          {icon}
        </div>
      </div>
    </div>
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
