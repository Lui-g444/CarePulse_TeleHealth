import Link from "next/link";
import { ArrowLeft, Home, SearchX } from "lucide-react";

export default function NotFound() {
  return (
    <div className="flex min-h-full flex-1 items-center justify-center bg-primary-bg px-4 py-16 text-black">
      <div className="w-full max-w-lg rounded-3xl border border-black/10 bg-white p-8 text-center shadow-sm">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-accent/20 text-brand-hover">
          <SearchX className="h-6 w-6" aria-hidden="true" />
        </span>
        <p className="mt-5 text-[11px] font-semibold uppercase tracking-wider text-black/45">
          404
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">
          This page isn&apos;t on the schedule.
        </h1>
        <p className="mt-2 text-sm text-black/60">
          The link may be out of date, or the page may have moved. Head back to
          the start and pick up from there.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-xl bg-brand-accent px-5 py-2.5 text-sm font-semibold text-black transition-colors hover:bg-brand-hover hover:text-white"
          >
            <Home className="h-4 w-4" aria-hidden="true" />
            Go home
          </Link>
          <Link
            href="/login"
            className="inline-flex items-center gap-2 rounded-xl border border-brand-hover bg-white px-5 py-2.5 text-sm font-semibold text-black transition-colors hover:bg-brand-accent/15"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Sign in
          </Link>
        </div>
      </div>
    </div>
  );
}
