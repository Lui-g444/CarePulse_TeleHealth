"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  AlertCircle,
  CalendarDays,
  Check,
  CheckCircle2,
  Clock,
  Loader2,
  Stethoscope,
} from "lucide-react";
import { AppHeader } from "@/components/AppHeader";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import {
  bookAppointment,
  buildDateOptions,
  buildSlots,
  fetchBookedSlotTimes,
  fetchDoctorSchedules,
  fetchDoctors,
  formatTimeLabel,
  type DateOption,
  type Doctor,
  type Slot,
} from "@/lib/booking";
import { createClient } from "@/lib/supabase";
import {
  detectRedFlag,
  saveIntake,
  type IntakeInput,
} from "@/lib/intake";

type Confirmation = {
  id: string;
  doctor: Doctor;
  dateLabel: string;
  time: string;
};

function describeError(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export default function PatientBookingPage() {
  const router = useRouter();
  const [client, setClient] = useState<SupabaseClient | null>(null);
  const [initError, setInitError] = useState<string | null>(null);

  const [patientId, setPatientId] = useState<string | null>(null);
  const [authChecked, setAuthChecked] = useState(false);

  const [doctors, setDoctors] = useState<Doctor[] | null>(null);
  const [doctorsError, setDoctorsError] = useState<string | null>(null);

  const [specialty, setSpecialty] = useState("all");
  const [selectedDoctor, setSelectedDoctor] = useState<Doctor | null>(null);

  const [dates, setDates] = useState<DateOption[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const [slots, setSlots] = useState<Slot[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotsError, setSlotsError] = useState<string | null>(null);
  const [slotsReloadKey, setSlotsReloadKey] = useState(0);

  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [pendingSlot, setPendingSlot] = useState<string | null>(null);
  const [bookingError, setBookingError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);

  // Clinical intake captured during the booking flow.
  const [chiefComplaint, setChiefComplaint] = useState("");
  const [symptomDescription, setSymptomDescription] = useState("");
  const [onset, setOnset] = useState("");
  const [duration, setDuration] = useState("");
  const [severity, setSeverity] = useState("");
  const [medications, setMedications] = useState("");
  const [allergies, setAllergies] = useState("");
  const [redFlagAcknowledged, setRedFlagAcknowledged] = useState(false);
  const [showRedFlagModal, setShowRedFlagModal] = useState(false);
  const [showCancelBookingDialog, setShowCancelBookingDialog] = useState(false);

  // Built after mount so the current date is never frozen into the prerender.
  useEffect(() => {
    let active = true;

    (async () => {
      const options = buildDateOptions(14);

      if (!active) {
        return;
      }

      setDates(options);
      setSelectedDate((current) => current ?? options[0]?.key ?? null);
    })();

    return () => {
      active = false;
    };
  }, []);

  // Session + doctor list bootstrap. Middleware already guards this route, but
  // the booking needs the patient id and a friendly message when the session is
  // gone.
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

      const [doctorsResult, authResult] = await Promise.allSettled([
        fetchDoctors(supabase),
        supabase.auth.getUser(),
      ]);

      if (!active) {
        return;
      }

      setClient(supabase);

      if (doctorsResult.status === "fulfilled") {
        setDoctors(doctorsResult.value);
      } else {
        setDoctors([]);
        setDoctorsError(
          describeError(doctorsResult.reason, "Could not load doctors."),
        );
      }

      setPatientId(
        authResult.status === "fulfilled"
          ? (authResult.value.data.user?.id ?? null)
          : null,
      );
      setAuthChecked(true);
    })();

    return () => {
      active = false;
    };
  }, []);

  // Availability is derived from the doctor's weekly schedules minus the
  // appointments already held for the selected date.
  useEffect(() => {
    if (!client || !selectedDoctor || !selectedDate) {
      return;
    }

    let active = true;

    (async () => {
      setSlotsLoading(true);
      setSlotsError(null);
      setSelectedSlot(null);

      try {
        const [schedules, bookedTimes] = await Promise.all([
          fetchDoctorSchedules(client, selectedDoctor.id),
          fetchBookedSlotTimes(client, selectedDoctor.id, selectedDate),
        ]);

        if (!active) {
          return;
        }

        setSlots(buildSlots({ date: selectedDate, schedules, bookedTimes }));
      } catch (error) {
        if (active) {
          setSlots([]);
          setSlotsError(describeError(error, "Could not load availability."));
        }
      } finally {
        if (active) {
          setSlotsLoading(false);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [client, selectedDoctor, selectedDate, slotsReloadKey]);

  const specialties = useMemo(() => {
    const unique = new Set((doctors ?? []).map((doctor) => doctor.specialty));
    return [...unique].sort((a, b) => a.localeCompare(b));
  }, [doctors]);

  const filteredDoctors = useMemo(() => {
    if (!doctors) {
      return [];
    }

    return specialty === "all"
      ? doctors
      : doctors.filter((doctor) => doctor.specialty === specialty);
  }, [doctors, specialty]);

  const selectedDateOption = dates.find((date) => date.key === selectedDate);

  function handleSelectDoctor(doctor: Doctor) {
    if (pendingSlot || selectedDoctor?.id === doctor.id) {
      return;
    }

    setSelectedDoctor(doctor);
    setSelectedSlot(null);
    setSlots([]);
    setSlotsLoading(true);
    setSlotsError(null);
    setBookingError(null);
    setConfirmation(null);
  }

  function handleSelectDate(dateKey: string) {
    if (pendingSlot || selectedDate === dateKey) {
      return;
    }

    setSelectedDate(dateKey);
    setSelectedSlot(null);
    setSlots([]);
    setSlotsLoading(true);
    setSlotsError(null);
    setBookingError(null);
  }

  function handleSelectSlot(slot: Slot) {
    if (slot.status !== "available" || pendingSlot) {
      return;
    }

    setSelectedSlot(slot.time);
    setBookingError(null);
  }

  async function handleConfirmBooking() {
    if (
      !client ||
      !patientId ||
      !selectedDoctor ||
      !selectedDate ||
      !selectedSlot ||
      pendingSlot
    ) {
      return;
    }

    const doctor = selectedDoctor;
    const time = selectedSlot;
    const date = selectedDate;
    const dateLabel = selectedDateOption?.label ?? date;

    const redFlag = detectRedFlag(`${chiefComplaint} ${symptomDescription}`);

    if (redFlag && !redFlagAcknowledged) {
      setShowRedFlagModal(true);
      return;
    }

    setPendingSlot(time);
    setBookingError(null);
    // Optimistic update: hold the slot immediately so the UI cannot offer it
    // twice while the insert is in flight.
    setSlots((current) =>
      current.map((slot) =>
        slot.time === time ? { ...slot, status: "booked" } : slot,
      ),
    );
    setSelectedSlot(null);

    let result;

    try {
      result = await bookAppointment(client, {
        patientId,
        doctorId: doctor.id,
        date,
        time,
      });
    } catch (error) {
      result = {
        ok: false as const,
        duplicate: false,
        message: describeError(error, "Could not reach the booking service."),
      };
    }

    setPendingSlot(null);

    if (result.ok) {
      if (chiefComplaint.trim()) {
        const intake: IntakeInput = {
          appointmentId: result.id,
          patientId,
          chiefComplaint: chiefComplaint.trim(),
          symptomDescription: symptomDescription.trim(),
          onset: onset.trim(),
          duration: duration.trim(),
          severity: severity ? Number(severity) : null,
          medications: medications.trim(),
          allergies: allergies.trim(),
          redFlag,
        };

        try {
          await saveIntake(client, intake);
        } catch {
          // Booking succeeded; intake failure must not hide the confirmation.
        }
      }

      setConfirmation({ id: result.id, doctor, dateLabel, time });
      return;
    }

    if (result.duplicate) {
      // Another patient won the race: keep the slot marked booked and pull the
      // server's current availability.
      setBookingError(
        "That slot was just taken by another patient. Please pick a different time.",
      );
      setSlotsReloadKey((key) => key + 1);
      return;
    }

    // Any other failure releases the optimistic hold.
    setSlots((current) =>
      current.map((slot) =>
        slot.time === time ? { ...slot, status: "available" } : slot,
      ),
    );
    setSelectedSlot(time);
    setBookingError(result.message || "Could not book this slot. Please try again.");
  }

  function handleBookAnother() {
    setConfirmation(null);
    setSelectedSlot(null);
    setSlotsReloadKey((key) => key + 1);
  }

  return (
    <div className="min-h-full bg-primary-bg md:pl-64">
      <AppHeader role="patient" />
      <main className="mx-auto w-full max-w-6xl px-4 pt-16 pb-10 sm:px-6 md:pt-10 lg:py-14">
        <header className="mb-8">
          <p className="mb-3 inline-flex items-center gap-2 rounded-full border border-brand-hover/40 bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-black/70">
            <Stethoscope className="h-3.5 w-3.5" aria-hidden="true" />
            CarePulse
          </p>
          <h1 className="text-3xl font-semibold tracking-tight text-black sm:text-4xl">
            Book an appointment
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-black/60 sm:text-base">
            Filter by specialty, choose a doctor and reserve an open slot.
            Availability is checked against the clinic&apos;s live schedule.
          </p>
        </header>

        {initError ? (
          <NoticeCard
            title="Booking is unavailable"
            message={initError}
          />
        ) : !authChecked ? (
          <div className="flex items-center gap-3 rounded-2xl border border-black/10 bg-white p-6 text-sm text-black/60">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Checking your session…
          </div>
        ) : !patientId ? (
          <div className="rounded-2xl border border-black/10 bg-white p-6 sm:p-8">
            <h2 className="text-lg font-semibold text-black">
              Sign in to book an appointment
            </h2>
            <p className="mt-2 max-w-xl text-sm text-black/60">
              We need your patient account to attach the appointment to you.
            </p>
            <Link
              href="/login"
              className="mt-5 inline-flex items-center justify-center rounded-xl bg-brand-accent px-5 py-3 text-sm font-semibold text-black transition-colors hover:bg-brand-hover hover:text-white"
            >
              Go to sign in
            </Link>
          </div>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
            <div className="space-y-6">
              <section className="rounded-2xl border border-black/10 bg-white p-5 shadow-sm">
                <StepHeading
                  step="Step 1"
                  title="Find your doctor"
                  icon={<Stethoscope className="h-4 w-4" aria-hidden="true" />}
                  hint={
                    doctors === null
                      ? undefined
                      : `${filteredDoctors.length} doctor${
                          filteredDoctors.length === 1 ? "" : "s"
                        }`
                  }
                />

                <div
                  className="mt-4 flex flex-wrap gap-2"
                  role="group"
                  aria-label="Filter doctors by specialty"
                >
                  <FilterChip
                    label="All specialties"
                    active={specialty === "all"}
                    onClick={() => setSpecialty("all")}
                  />
                  {specialties.map((option) => (
                    <FilterChip
                      key={option}
                      label={option}
                      active={specialty === option}
                      onClick={() => setSpecialty(option)}
                    />
                  ))}
                </div>

                <div className="mt-4">
                  {doctorsError ? (
                    <p
                      role="alert"
                      className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800"
                    >
                      <AlertCircle
                        className="mt-0.5 h-4 w-4 shrink-0"
                        aria-hidden="true"
                      />
                      {doctorsError}
                    </p>
                  ) : doctors === null ? (
                    <div className="grid gap-3 sm:grid-cols-2">
                      {[0, 1, 2, 3].map((key) => (
                        <div
                          key={key}
                          className="h-[68px] animate-pulse rounded-xl border border-black/10 bg-black/5"
                        />
                      ))}
                    </div>
                  ) : filteredDoctors.length === 0 ? (
                    <p className="rounded-xl border border-dashed border-black/15 p-6 text-center text-sm text-black/60">
                      No doctors available for this specialty yet. Try another
                      filter.
                    </p>
                  ) : (
                    <div className="grid gap-3 sm:grid-cols-2">
                      {filteredDoctors.map((doctor) => {
                        const isSelected = selectedDoctor?.id === doctor.id;

                        return (
                          <button
                            key={doctor.id}
                            type="button"
                            onClick={() => handleSelectDoctor(doctor)}
                            aria-pressed={isSelected}
                            className={clsx(
                              "flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-colors",
                              isSelected
                                ? "border-brand-hover bg-brand-accent/20 ring-2 ring-brand-hover/50"
                                : "border-black/10 bg-white hover:border-brand-hover hover:bg-brand-accent/10",
                            )}
                          >
                            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-bg text-sm font-semibold text-black">
                              {initialsOf(doctor.fullName)}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-semibold text-black">
                                {doctor.fullName}
                              </span>
                              <span className="block truncate text-xs text-black/60">
                                {doctor.specialty}
                              </span>
                            </span>
                            {isSelected ? (
                              <Check
                                className="h-4 w-4 shrink-0 text-brand-hover"
                                aria-hidden="true"
                              />
                            ) : null}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </section>

              <section className="rounded-2xl border border-black/10 bg-white p-5 shadow-sm">
                <StepHeading
                  step="Step 2"
                  title="Pick a date"
                  icon={<CalendarDays className="h-4 w-4" aria-hidden="true" />}
                />

                {!selectedDoctor ? (
                  <Placeholder text="Select a doctor to see the next two weeks of availability." />
                ) : (
                  <div className="mt-4 flex gap-2 overflow-x-auto pb-2">
                    {dates.length === 0
                      ? Array.from({ length: 7 }, (_, key) => (
                          <div
                            key={key}
                            className="h-[72px] w-[4.5rem] shrink-0 animate-pulse rounded-xl border border-black/10 bg-black/5"
                          />
                        ))
                      : null}
                    {dates.map((date) => {
                      const isSelected = selectedDate === date.key;

                      return (
                        <button
                          key={date.key}
                          type="button"
                          aria-pressed={isSelected}
                          onClick={() => handleSelectDate(date.key)}
                          disabled={pendingSlot !== null}
                          className={clsx(
                            "flex min-w-[4.5rem] flex-col items-center rounded-xl border px-3 py-2 transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                            isSelected
                              ? "border-brand-hover bg-brand-accent text-black"
                              : "border-black/10 bg-white text-black/70 hover:border-brand-hover hover:bg-brand-accent/10",
                          )}
                        >
                          <span className="text-[11px] font-medium uppercase tracking-wide">
                            {date.weekday}
                          </span>
                          <span className="text-lg font-semibold leading-tight">
                            {date.day}
                          </span>
                          <span className="text-[11px]">{date.month}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </section>

              <section className="rounded-2xl border border-black/10 bg-white p-5 shadow-sm">
                <StepHeading
                  step="Step 3"
                  title="Choose a time"
                  icon={<Clock className="h-4 w-4" aria-hidden="true" />}
                  hint={
                    !slotsLoading && slots.length > 0
                      ? `${slots.filter((slot) => slot.status === "available").length} open`
                      : undefined
                  }
                />

                {!selectedDoctor || !selectedDate ? (
                  <Placeholder text="Select a doctor and date to see open times." />
                ) : slotsLoading ? (
                  <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
                    {Array.from({ length: 8 }, (_, key) => (
                      <div
                        key={key}
                        className="h-10 animate-pulse rounded-lg border border-black/10 bg-black/5"
                      />
                    ))}
                  </div>
                ) : slotsError ? (
                  <div className="mt-4">
                    <p
                      role="alert"
                      className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800"
                    >
                      <AlertCircle
                        className="mt-0.5 h-4 w-4 shrink-0"
                        aria-hidden="true"
                      />
                      {slotsError}
                    </p>
                    <button
                      type="button"
                      onClick={() => setSlotsReloadKey((key) => key + 1)}
                      className="mt-3 rounded-lg border border-brand-hover px-3 py-2 text-xs font-semibold text-black transition-colors hover:bg-brand-accent/15"
                    >
                      Try again
                    </button>
                  </div>
                ) : slots.length === 0 ? (
                  <p className="mt-4 rounded-xl border border-dashed border-black/15 p-6 text-center text-sm text-black/60">
                    This doctor has no scheduled hours on{" "}
                    {selectedDateOption?.label ?? "that day"}. Pick another date.
                  </p>
                ) : (
                  <>
                    <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
                      {slots.map((slot) => {
                        const isSelected = selectedSlot === slot.time;
                        const isPending = pendingSlot === slot.time;
                        const unavailable = slot.status !== "available";

                        return (
                          <button
                            key={slot.time}
                            type="button"
                            aria-pressed={isSelected}
                            aria-label={`${formatTimeLabel(slot.time)}${
                              slot.status === "booked"
                                ? ", already booked"
                                : slot.status === "past"
                                  ? ", no longer available"
                                  : ""
                            }`}
                            disabled={unavailable || pendingSlot !== null}
                            onClick={() => handleSelectSlot(slot)}
                            className={clsx(
                              "flex items-center justify-center gap-1 rounded-lg border px-2 py-2 text-sm font-medium transition-colors",
                              isSelected
                                ? "border-brand-hover bg-brand-accent text-black"
                                : slot.status === "booked"
                                  ? "cursor-not-allowed border-black/10 bg-black/5 text-black/35 line-through"
                                  : slot.status === "past"
                                    ? "cursor-not-allowed border-black/10 bg-black/5 text-black/30"
                                    : "border-brand-hover/30 bg-white text-black hover:border-brand-hover hover:bg-brand-accent/15",
                              isPending && "opacity-60",
                            )}
                          >
                            {isPending ? (
                              <Loader2
                                className="h-3.5 w-3.5 animate-spin"
                                aria-hidden="true"
                              />
                            ) : null}
                            {formatTimeLabel(slot.time)}
                          </button>
                        );
                      })}
                    </div>
                    <div className="mt-4 flex flex-wrap items-center gap-4 text-[11px] text-black/50">
                      <Legend className="bg-white" label="Available" />
                      <Legend className="bg-black/10" label="Booked" />
                      <Legend className="bg-black/5" label="Past" />
                    </div>
                  </>
                )}
              </section>
            </div>

            <aside className="rounded-2xl border border-black/10 bg-white p-5 shadow-sm lg:sticky lg:top-6">
              {confirmation ? (
                <div>
                  <span className="flex h-11 w-11 items-center justify-center rounded-full bg-brand-accent">
                    <CheckCircle2
                      className="h-6 w-6 text-black"
                      aria-hidden="true"
                    />
                  </span>
                  <h2 className="mt-4 text-lg font-semibold text-black">
                    Appointment reserved
                  </h2>
                  <p className="mt-1 text-sm text-black/60">
                    The clinic will confirm your booking shortly.
                  </p>
                  <dl className="mt-4 space-y-3 border-t border-black/10 pt-4">
                    <SummaryRow label="Doctor" value={confirmation.doctor.fullName} />
                    <SummaryRow label="Specialty" value={confirmation.doctor.specialty} />
                    <SummaryRow label="Date" value={confirmation.dateLabel} />
                    <SummaryRow label="Time" value={formatTimeLabel(confirmation.time)} />
                    <SummaryRow label="Reference" value={confirmation.id.slice(0, 8)} />
                  </dl>
                  <button
                    type="button"
                    onClick={handleBookAnother}
                    className="mt-5 w-full rounded-xl border border-brand-hover px-4 py-3 text-sm font-semibold text-black transition-colors hover:bg-brand-accent/15"
                  >
                    Book another appointment
                  </button>
                </div>
              ) : (
                <>
                  <h2 className="text-base font-semibold text-black">
                    Your appointment
                  </h2>
                  <dl className="mt-4 space-y-3">
                    <SummaryRow
                      label="Doctor"
                      value={selectedDoctor?.fullName ?? "Not selected"}
                    />
                    <SummaryRow
                      label="Specialty"
                      value={selectedDoctor?.specialty ?? "—"}
                    />
                    <SummaryRow
                      label="Date"
                      value={selectedDateOption?.label ?? "Not selected"}
                    />
                    <SummaryRow
                      label="Time"
                      value={
                        selectedSlot ? formatTimeLabel(selectedSlot) : "Not selected"
                      }
                    />
                  </dl>

                  <div className="mt-4 space-y-3 rounded-xl border border-black/10 bg-primary-bg/40 p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-black/45">
                      Clinical intake (recommended)
                    </p>
                    <label className="block text-xs font-medium text-black/70">
                      Chief complaint
                      <input
                        value={chiefComplaint}
                        onChange={(e) => setChiefComplaint(e.target.value)}
                        placeholder="e.g. Sore throat for 3 days"
                        className="mt-1 w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm text-black focus:border-brand-hover focus:outline-none focus:ring-1 focus:ring-brand-hover"
                      />
                    </label>
                    <label className="block text-xs font-medium text-black/70">
                      Symptom description
                      <textarea
                        value={symptomDescription}
                        onChange={(e) => setSymptomDescription(e.target.value)}
                        rows={2}
                        placeholder="Describe what you're feeling"
                        className="mt-1 w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm text-black focus:border-brand-hover focus:outline-none focus:ring-1 focus:ring-brand-hover"
                      />
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      <label className="block text-xs font-medium text-black/70">
                        Onset
                        <input
                          value={onset}
                          onChange={(e) => setOnset(e.target.value)}
                          placeholder="e.g. 2 days ago"
                          className="mt-1 w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm text-black focus:border-brand-hover focus:outline-none focus:ring-1 focus:ring-brand-hover"
                        />
                      </label>
                      <label className="block text-xs font-medium text-black/70">
                        Duration
                        <input
                          value={duration}
                          onChange={(e) => setDuration(e.target.value)}
                          placeholder="e.g. 3 days"
                          className="mt-1 w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm text-black focus:border-brand-hover focus:outline-none focus:ring-1 focus:ring-brand-hover"
                        />
                      </label>
                    </div>
                    <label className="block text-xs font-medium text-black/70">
                      Severity (1–10)
                      <input
                        type="number"
                        min={1}
                        max={10}
                        value={severity}
                        onChange={(e) => setSeverity(e.target.value)}
                        className="mt-1 w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm text-black focus:border-brand-hover focus:outline-none focus:ring-1 focus:ring-brand-hover"
                      />
                    </label>
                    <label className="block text-xs font-medium text-black/70">
                      Current medications
                      <input
                        value={medications}
                        onChange={(e) => setMedications(e.target.value)}
                        placeholder="e.g. Ibuprofen"
                        className="mt-1 w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm text-black focus:border-brand-hover focus:outline-none focus:ring-1 focus:ring-brand-hover"
                      />
                    </label>
                    <label className="block text-xs font-medium text-black/70">
                      Known allergies
                      <input
                        value={allergies}
                        onChange={(e) => setAllergies(e.target.value)}
                        placeholder="e.g. Penicillin"
                        className="mt-1 w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm text-black focus:border-brand-hover focus:outline-none focus:ring-1 focus:ring-brand-hover"
                      />
                    </label>
                    {detectRedFlag(`${chiefComplaint} ${symptomDescription}`) ? (
                      <p className="rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-700">
                        Possible emergency symptoms detected. Please review the
                        warning before booking.
                      </p>
                    ) : null}
                  </div>

                  {bookingError ? (
                    <p
                      role="alert"
                      className="mt-4 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-800"
                    >
                      <AlertCircle
                        className="mt-0.5 h-4 w-4 shrink-0"
                        aria-hidden="true"
                      />
                      {bookingError}
                    </p>
                  ) : null}

                  <button
                    type="button"
                    onClick={() => setShowCancelBookingDialog(true)}
                    className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-black/15 px-4 py-3 text-sm font-semibold text-black/70 transition-colors hover:border-brand-hover hover:text-black"
                  >
                    Cancel booking
                  </button>
                  <button
                    type="button"
                    onClick={handleConfirmBooking}
                    disabled={!selectedSlot || pendingSlot !== null}
                    className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-brand-accent px-4 py-3 text-sm font-semibold text-black transition-colors hover:bg-brand-hover hover:text-white disabled:cursor-not-allowed disabled:bg-black/10 disabled:text-black/40"
                  >
                    {pendingSlot !== null ? (
                      <>
                        <Loader2
                          className="h-4 w-4 animate-spin"
                          aria-hidden="true"
                        />
                        Booking…
                      </>
                    ) : (
                      "Confirm appointment"
                    )}
                  </button>
                  <p className="mt-2 text-center text-[11px] text-black/50">
                    {selectedSlot
                      ? "This slot is held for you once you confirm."
                      : "Pick a time slot to continue."}
                  </p>
                </>
              )}
            </aside>
          </div>
        )}
      </main>

      <ConfirmDialog
        open={showCancelBookingDialog}
        title="Cancel booking?"
        description="You will lose the slot and intake details you have entered."
        confirmLabel="Leave booking"
        tone="danger"
        onConfirm={() => {
          setShowCancelBookingDialog(false);
          router.push("/patient/dashboard");
        }}
        onCancel={() => setShowCancelBookingDialog(false)}
      />

      {showRedFlagModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <h2 className="text-lg font-semibold text-red-700">
              Possible emergency symptoms
            </h2>
            <p className="mt-2 text-sm text-black/70">
              Your description includes symptoms that may require urgent care
              (for example chest pain or severe shortness of breath). If you are
              experiencing a medical emergency, call your local emergency
              services immediately instead of booking an appointment.
            </p>
            <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
              <a
                href="tel:911"
                className="inline-flex items-center justify-center rounded-lg bg-red-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-700"
              >
                Call emergency services
              </a>
              <button
                type="button"
                onClick={() => {
                  setRedFlagAcknowledged(true);
                  setShowRedFlagModal(false);
                }}
                className="rounded-lg border border-black/15 px-4 py-2.5 text-sm font-semibold text-black/70 hover:border-brand-hover hover:text-black"
              >
                I understand, continue booking
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function StepHeading({
  step,
  title,
  icon,
  hint,
}: {
  step: string;
  title: string;
  icon: ReactNode;
  hint?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-bg text-brand-hover">
          {icon}
        </span>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-black/45">
            {step}
          </p>
          <h2 className="text-base font-semibold text-black">{title}</h2>
        </div>
      </div>
      {hint ? (
        <span className="pt-3 text-xs text-black/50">{hint}</span>
      ) : null}
    </div>
  );
}

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={clsx(
        "rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors",
        active
          ? "border-brand-hover bg-brand-accent text-black"
          : "border-black/10 bg-white text-black/60 hover:border-brand-hover hover:text-black",
      )}
    >
      {label}
    </button>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-[11px] font-medium uppercase tracking-wide text-black/45">
        {label}
      </dt>
      <dd className="max-w-[65%] truncate text-right text-sm font-medium text-black">
        {value}
      </dd>
    </div>
  );
}

function Legend({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className={clsx(
          "h-2.5 w-2.5 rounded-sm border border-black/10",
          className,
        )}
      />
      {label}
    </span>
  );
}

function Placeholder({ text }: { text: string }) {
  return (
    <p className="mt-4 rounded-xl border border-dashed border-black/15 bg-primary-bg/40 p-6 text-center text-sm text-black/60">
      {text}
    </p>
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
