"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Eye, EyeOff, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (
        event === "PASSWORD_RECOVERY" ||
        event === "SIGNED_IN" ||
        !!session
      ) {
        setReady(true);
      }
    });
    // The recovery token arrives in the URL hash; give the client a moment to
    // parse it, then check for a session.
    const check = () => {
      void supabase.auth.getSession().then(({ data: sessionData }) => {
        if (sessionData.session) setReady(true);
      });
    };
    check();
    const t = window.setTimeout(check, 500);
    return () => {
      data.subscription.unsubscribe();
      window.clearTimeout(t);
    };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const supabase = createClient();
      const { error: updateError } = await supabase.auth.updateUser({
        password,
      });
      if (updateError) throw new Error(updateError.message);
      router.replace("/login");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update password.");
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
            Set a new password
          </h1>
          <p className="mt-1 text-sm text-brand-dark/60">
            Choose a password with at least 6 characters.
          </p>
        </header>

        {!ready ? (
          <div className="rounded-xl border border-black/10 bg-white p-6 shadow-sm">
            <p className="text-sm text-black/60">
              Open this page by clicking the reset link in your email. If you
              already clicked it and still see this, make sure your Supabase
              project has this page URL in Auth → URL Configuration → Redirect
              URLs (e.g. http://localhost:3000/reset-password and your
              production URL).
            </p>
            <Link
              href="/forgot-password"
              className="mt-4 inline-flex w-full items-center justify-center rounded-lg border border-black/15 px-5 py-2.5 text-sm font-semibold text-black transition-colors hover:bg-black/5"
            >
              Request a new reset link
            </Link>
          </div>
        ) : (
          <form
            onSubmit={handleSubmit}
            className="rounded-xl border border-black/10 bg-white p-6 shadow-sm"
          >
            <div className="space-y-4">
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="New password"
                  className="block w-full rounded-lg border border-black/10 bg-white px-3 py-2 pr-10 text-sm outline-none transition-colors placeholder:text-black/30 focus:border-brand-hover focus:ring-1 focus:ring-brand-hover"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-black/45 hover:text-black"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" aria-hidden="true" />
                  ) : (
                    <Eye className="h-4 w-4" aria-hidden="true" />
                  )}
                </button>
              </div>
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
                    Updating…
                  </>
                ) : (
                  "Update password"
                )}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
