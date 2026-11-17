"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email) {
      setError("Please enter your email.");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const supabase = createClient();
      const redirectTo =
        typeof window !== "undefined"
          ? `${window.location.origin}/reset-password`
          : undefined;
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(
        email,
        { redirectTo },
      );
      if (resetError) throw new Error(resetError.message);
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send reset email.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative min-h-screen bg-primary-bg px-4 py-12 text-brand-dark">
      <Link
        href="/login"
        className="absolute left-4 top-4 inline-flex items-center gap-1.5 text-sm font-medium text-black/60 transition-colors hover:text-black"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Back to sign in
      </Link>

      <div className="mx-auto max-w-md pt-8">
        <header className="mb-8 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">
            Reset your password
          </h1>
          <p className="mt-1 text-sm text-brand-dark/60">
            Enter your email and we&apos;ll send a reset link.
          </p>
        </header>

        {sent ? (
          <div className="rounded-xl border border-black/10 bg-white p-6 shadow-sm">
            <p className="text-sm text-black/70">
              Check your inbox for a password reset link. It may take a minute to
              arrive.
            </p>
            <Link
              href="/login"
              className="mt-5 inline-flex w-full items-center justify-center rounded-lg bg-brand-accent px-5 py-2.5 text-sm font-semibold text-black transition-colors hover:bg-brand-hover hover:text-white"
            >
              Back to sign in
            </Link>
          </div>
        ) : (
          <form
            onSubmit={handleSubmit}
            className="rounded-xl border border-black/10 bg-white p-6 shadow-sm"
          >
            <div className="space-y-4">
              <input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="block w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm outline-none transition-colors placeholder:text-black/30 focus:border-brand-hover focus:ring-1 focus:ring-brand-hover"
              />
              {error ? (
                <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
                  {error}
                </p>
              ) : null}
              <button
                type="submit"
                disabled={loading}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand-accent px-5 py-2.5 text-sm font-semibold text-brand-dark transition-colors hover:bg-[#82cc3f] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    Sending…
                  </>
                ) : (
                  "Send reset link"
                )}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
