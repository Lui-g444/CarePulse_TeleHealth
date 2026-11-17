"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Eye, EyeOff, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase";

const ROLE_DASHBOARDS = {
  patient: "/patient/dashboard",
  doctor: "/doctor/dashboard",
  admin: "/admin/dashboard",
} as const;

type Role = keyof typeof ROLE_DASHBOARDS;

function isRole(value: unknown): value is Role {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(ROLE_DASHBOARDS, value)
  );
}

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Set when a session already exists, so the page offers a way forward. */
  const [activeRole, setActiveRole] = useState<Role | null>(null);

  useEffect(() => {
    let active = true;

    (async () => {
      try {
        const supabase = createClient();
        const { data } = await supabase.auth.getUser();
        const userId = data.user?.id;

        if (!userId) {
          return;
        }

        const { data: profile } = await supabase
          .from("profiles")
          .select("role")
          .eq("id", userId)
          .maybeSingle();

        if (active && isRole(profile?.role)) {
          setActiveRole(profile.role);
        }
      } catch {
        // No Supabase config: the sign-in attempt reports it.
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!email || !password) {
      setError("Please enter your email and password.");
      return;
    }
    setError(null);
    setIsLoading(true);
    try {
      const supabase = createClient();
      const { data: authData, error: authError } =
        await supabase.auth.signInWithPassword({ email, password });
      if (authError) throw new Error(authError.message);

      // Middleware routes by role, but navigating here means the user lands on
      // the right dashboard without waiting for a full reload.
      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", authData.user.id)
        .maybeSingle();

      let resolvedRole: Role | null = isRole(profile?.role)
        ? profile.role
        : null;

      // With email confirmation enabled the signup form runs before a session
      // exists, so the profile row is created here on the first sign-in.
      if (!resolvedRole) {
        const metadata = authData.user.user_metadata ?? {};
        // Admin accounts are provisioned directly in Supabase, never via the
        // public signup flow, so never trust an "admin" role coming from
        // signup metadata.
        const rawMetadataRole = isRole(metadata.role) ? metadata.role : "patient";
        const metadataRole = rawMetadataRole === "admin" ? "patient" : rawMetadataRole;
        const metadataName =
          typeof metadata.full_name === "string" ? metadata.full_name : null;
        const metadataPhone =
          typeof metadata.phone === "string" ? metadata.phone : null;
        const metadataGender =
          typeof metadata.gender === "string" ? metadata.gender : null;

        const { error: profileError } = await supabase.from("profiles").insert({
          id: authData.user.id,
          email: authData.user.email,
          full_name: metadataName,
          phone: metadataPhone,
          gender: metadataGender,
          role: metadataRole,
        });

        if (!profileError) {
          resolvedRole = metadataRole;
        }
      }

      if (!resolvedRole) {
        setError(
          "Signed in, but your profile has no role yet. Ask an administrator to assign one.",
        );
        setIsLoading(false);
        return;
      }

      router.replace(ROLE_DASHBOARDS[resolvedRole]);
      router.refresh();
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Could not sign in. Please try again.",
      );
      setIsLoading(false);
    }
  }

  return (
    <div className="relative min-h-screen bg-primary-bg px-4 py-12 text-brand-dark">
      <Link
        href="/"
        className="absolute left-4 top-4 inline-flex items-center gap-1.5 text-sm font-medium text-black/60 transition-colors hover:text-black"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Back to home
      </Link>

      <div className="mx-auto max-w-md pt-8">

        <header className="mb-8 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">Sign in to CarePulse</h1>
          <p className="mt-1 text-sm text-brand-dark/60">
            Use the email and password for your account.
          </p>
        </header>

        {activeRole ? (
          <div className="mb-5 rounded-xl border border-brand-hover/40 bg-brand-accent/15 px-4 py-3 text-sm text-black">
            <p>You&apos;re already signed in.</p>
            <Link
              href={ROLE_DASHBOARDS[activeRole]}
              className="mt-1 inline-flex items-center gap-1 font-semibold underline underline-offset-2"
            >
              Go to your dashboard
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
            <p className="mt-2 text-xs text-black/55">
              Or sign in below with another account to switch.
            </p>
          </div>
        ) : null}

        <form onSubmit={handleLogin} className="rounded-xl border border-black/10 bg-white p-6 shadow-sm">
          <div className="space-y-4">
            <div>
              <label htmlFor="email" className="sr-only">
                Email address
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="block w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm outline-none transition-colors placeholder:text-black/30 focus:border-brand-hover focus:ring-1 focus:ring-brand-hover"
              />
            </div>
            <div>
              <label htmlFor="password" className="sr-only">
                Password
              </label>
              <div className="relative">
                <input
                id="password"
                name="password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
                className="block w-full rounded-lg border border-black/10 bg-white px-3 py-2 pr-10 text-sm outline-none transition-colors placeholder:text-black/30 focus:border-brand-hover focus:ring-1 focus:ring-brand-hover"
              />
                <button
                  type="button"
                  onClick={() => setShowPassword((value) => !value)}
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
            </div>
            {error && (
              <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
                {error}
              </p>
            )}
            <button
              type="submit"
              disabled={isLoading}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand-accent px-5 py-2.5 text-sm font-semibold text-brand-dark transition-colors hover:bg-[#82cc3f] focus:outline-none focus:ring-2 focus:ring-brand-hover disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  Signing in…
                </>
              ) : (
                "Sign in"
              )}
            </button>
          </div>
        </form>
        <p className="mt-2 text-center text-sm">
          <Link
            href="/forgot-password"
            className="font-medium text-brand-hover hover:underline"
          >
            Forgot your password?
          </Link>
        </p>
        <p className="mt-6 text-center text-sm text-black/60">
          Don&apos;t have an account?{" "}
          <Link href="/signup" className="font-medium text-brand-hover hover:underline">
            Sign up
          </Link>
        </p>
      </div>
    </div>
  );
}
