import Link from "next/link";
import {
  Activity,
  ArrowRight,
  CalendarCheck,
  CalendarPlus,
  ClipboardList,
  HeartPulse,
  ShieldCheck,
  Stethoscope,
} from "lucide-react";
import { LiveAppointmentQueue } from "@/components/LiveAppointmentQueue";

const FEATURES = [
  {
    icon: CalendarPlus,
    title: "Booking that respects the calendar",
    body: "Pick a specialty, a doctor and an open slot. Availability comes from the doctor's weekly hours minus what is already booked, so a slot that is taken is never offered twice.",
  },
  {
    icon: Activity,
    title: "A queue that updates live",
    body: "Doctors see today's patients arrive in real time. Confirm a visit, start a consultation and close it out without refreshing the page.",
  },
  {
    icon: ClipboardList,
    title: "One record per visit",
    body: "Diagnosis, notes and prescriptions are saved against the appointment, so the history is complete for the patient and the care team.",
  },
  {
    icon: ShieldCheck,
    title: "Access that follows the role",
    body: "Patients only ever see their own visits. Doctors see their own queue. Administrators keep the directory and the roles in order.",
  },
] as const;

export default function Home() {
  return (
    <div className="flex min-h-full flex-col bg-primary-bg text-black">
      <header className="border-b border-black/10">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-4 px-4 py-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-accent text-black">
              <HeartPulse className="h-5 w-5" aria-hidden="true" />
            </span>
            <span className="text-base font-semibold tracking-tight">CarePulse</span>
          </Link>

          <nav
            aria-label="Landing"
            className="ml-auto hidden items-center gap-6 text-sm font-medium text-black/60 md:flex"
          >
            <a href="#features" className="transition-colors hover:text-black">
              Features
            </a>
          </nav>

          <div className="ml-auto flex items-center gap-2 md:ml-0">
            <Link
              href="/login"
              className="rounded-lg px-3 py-2 text-sm font-medium text-black/70 transition-colors hover:bg-white hover:text-black"
            >
              Sign in
            </Link>
            <Link
              href="/signup"
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand-accent px-4 py-2 text-sm font-semibold text-black transition-colors hover:bg-brand-hover hover:text-white"
            >
              Get started
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>
        </div>
      </header>

      <main className="flex-1">
        {/* Hero */}
        <section className="mx-auto grid w-full max-w-6xl gap-10 px-4 py-14 sm:px-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:items-center lg:py-20">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full border border-brand-hover/40 bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-black/70">
              <Activity className="h-3.5 w-3.5 text-brand-hover" aria-hidden="true" />
              Telehealth, without the waiting room
            </p>
            <h1 className="mt-5 text-4xl font-semibold leading-[1.1] tracking-tight sm:text-5xl lg:text-6xl">
              Care that keeps pace with your day.
            </h1>
            <p className="mt-5 max-w-xl text-base leading-7 text-black/65 sm:text-lg">
              CarePulse connects patients and clinicians around one shared
              schedule. Book a slot, run the consultation, and keep every record
              in step — no phone tag, no double bookings.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href="/signup"
                className="inline-flex items-center gap-2 rounded-xl bg-brand-accent px-6 py-3 text-sm font-semibold text-black transition-colors hover:bg-brand-hover hover:text-white"
              >
                <CalendarPlus className="h-4 w-4" aria-hidden="true" />
                Create an account
              </Link>
              <Link
                href="/login"
                className="inline-flex items-center gap-2 rounded-xl border border-brand-hover bg-white px-6 py-3 text-sm font-semibold text-black transition-colors hover:bg-brand-accent/15"
              >
                Sign in
              </Link>
            </div>
            <p className="mt-4 text-xs text-black/50">
              Patients, doctors and administrators each get their own workspace.
            </p>
          </div>

          {/* Product preview — real, masked schedule from Supabase */}
          <LiveAppointmentQueue />
        </section>

        {/* Features */}
        <section id="features" className="border-y border-black/10 bg-white/60">
          <div className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6 lg:py-18">
            <div className="max-w-2xl">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-brand-hover">
                Built for the whole visit
              </p>
              <h2 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
                Everything the appointment needs, in one place.
              </h2>
              <p className="mt-3 text-sm text-black/60 sm:text-base">
                From the first open slot to the last prescription, CarePulse keeps
                the schedule and the record in sync.
              </p>
            </div>

            <div className="mt-10 grid gap-4 sm:grid-cols-2">
              {FEATURES.map(({ icon: Icon, title, body }) => (
                <article
                  key={title}
                  className="rounded-2xl border border-black/10 bg-white p-5 shadow-sm"
                >
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-accent/20 text-brand-hover">
                    <Icon className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <h3 className="mt-4 text-base font-semibold">{title}</h3>
                  <p className="mt-2 text-sm leading-6 text-black/60">{body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6 lg:py-20">
          <div className="flex flex-col items-start gap-6 rounded-3xl border border-brand-hover/40 bg-brand-accent/15 p-8 sm:p-10 lg:flex-row lg:items-center lg:justify-between">
            <div className="max-w-xl">
              <h2 className="flex items-center gap-2 text-2xl font-semibold tracking-tight sm:text-3xl">
                <CalendarCheck className="h-6 w-6 text-brand-hover" aria-hidden="true" />
                Ready when your next patient is.
              </h2>
              <p className="mt-2 text-sm text-black/65 sm:text-base">
                Create an account and book your first appointment in minutes.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link
                href="/signup"
                className="inline-flex items-center gap-2 rounded-xl bg-brand-dark px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-brand-hover"
              >
                Get started
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
              <Link
                href="/login"
                className="inline-flex items-center gap-2 rounded-xl border border-black/15 bg-white px-6 py-3 text-sm font-semibold text-black transition-colors hover:border-brand-hover"
              >
                Sign in
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-black/10">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-4 py-6 text-xs text-black/55 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <span className="flex items-center gap-2">
            <Stethoscope className="h-4 w-4 text-brand-hover" aria-hidden="true" />
            CarePulse Telehealth
          </span>
          <span>
            Book appointments, run consultations, keep the record straight.
          </span>
        </div>
      </footer>
    </div>
  );
}
