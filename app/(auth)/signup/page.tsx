"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Eye, EyeOff, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase";

const ROLES = ["patient", "doctor"] as const;
type Role = (typeof ROLES)[number];

export default function SignupPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [gender, setGender] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [role, setRole] = useState<Role>("patient");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsConfirmation, setNeedsConfirmation] = useState(false);

  async function handleSignUp(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!email || !password) {
      setError("Please enter your email and password.");
      return;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }

    setIsLoading(true);

    try {
      const supabase = createClient();

      // Admins are provisioned directly in Supabase; the public signup form
      // never creates an admin account, even if the role field is tampered with.
      const safeRole: "patient" | "doctor" =
        role === "doctor" ? "doctor" : "patient";

      const { data: authData, error: authError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: name || undefined,
            phone: phone || undefined,
            gender: gender || undefined,
            role: safeRole,
          },
        },
      });

      if (authError) {
        throw new Error(authError.message);
      }

      const user = authData.user;

      if (!user) {
        throw new Error("Signup did not return a user.");
      }

      // With email confirmation enabled Supabase returns no session, so the
      // profile insert (RLS: own row, authenticated) would fail. Ask the user
      // to confirm first; the row is created on the next sign-in attempt.
      if (!authData.session) {
        setNeedsConfirmation(true);
        return;
      }

      const { error: profileError } = await supabase.from("profiles").insert({
        id: user.id,
        email: user.email ?? email,
        full_name: name || null,
        phone: phone || null,
        gender: gender || null,
        role: safeRole,
      });

      if (profileError) {
        throw new Error(
          profileError.code === "23505"
            ? "A profile with this email already exists."
            : profileError.message,
        );
      }

      router.replace(`/${safeRole}/dashboard`);
      router.refresh();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Could not create your account. Please try again.",
      );
      setIsLoading(false);
    }
  }

  if (needsConfirmation) {
    return (
      <div className="relative min-h-screen bg-primary-bg px-4 py-12 text-brand-dark">
        <div className="mx-auto max-w-md">
          <div className="rounded-xl border border-black/10 bg-white p-6 shadow-sm">
            <h1 className="text-xl font-semibold text-black">Confirm your email</h1>
            <p className="mt-2 text-sm text-black/60">
              We sent a confirmation link to <strong>{email}</strong>. Open it,
              then sign in to finish setting up your account.
            </p>
            <Link
              href="/login"
              className="mt-5 inline-flex w-full items-center justify-center rounded-lg bg-brand-accent px-5 py-2.5 text-sm font-semibold text-black transition-colors hover:bg-brand-hover hover:text-white"
            >
              Go to sign in
            </Link>
          </div>
        </div>
      </div>
    );
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
          <h1 className="text-2xl font-semibold tracking-tight">Create your account</h1>
          <p className="mt-1 text-sm text-brand-dark/60">
            Pick your role, then enter your email and password.
          </p>
        </header>

        <form onSubmit={handleSignUp} className="rounded-xl border border-black/10 bg-white p-6 shadow-sm">
          <div className="space-y-4">
            <div>
              <label htmlFor="name" className="sr-only">
                Full name (optional)
              </label>
              <input
                id="name"
                type="text"
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Full name (optional)"
                className="block w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm outline-none transition-colors placeholder:text-black/30 focus:border-brand-hover focus:ring-1 focus:ring-brand-hover"
              />
            </div>
            <div>
              <input
                id="phone"
                type="tel"
                autoComplete="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="Contact number (optional)"
                className="block w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm outline-none transition-colors placeholder:text-black/30 focus:border-brand-hover focus:ring-1 focus:ring-brand-hover"
              />
            </div>
            <div>
              <select
                id="gender"
                value={gender}
                onChange={(e) => setGender(e.target.value)}
                className="block w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm outline-none transition-colors focus:border-brand-hover focus:ring-1 focus:ring-brand-hover"
              >
                <option value="">Gender / preferred gender (optional)</option>
                <option value="female">Female</option>
                <option value="male">Male</option>
                <option value="non-binary">Non-binary</option>
                <option value="prefer-not-to-say">Prefer not to say</option>
              </select>
            </div>
            <div>
              <label htmlFor="email" className="sr-only">
                Email address
              </label>
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
            </div>
            <div>
              <label htmlFor="password" className="sr-only">
                Password
              </label>
              <div className="relative">
                <input
                id="password"
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password (at least 6 characters)"
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
            <div>
              <label className="block text-sm font-medium text-black/70">Role</label>
              <fieldset className="mt-2 space-y-1">
                <div className="flex flex-wrap gap-2">
                  {ROLES.map((option: Role) => (
                    <label
                      key={option}
                      className="flex cursor-pointer items-center gap-2 rounded-lg border border-black/10 bg-white px-3 py-2 text-sm capitalize text-black/70 transition-colors hover:border-brand-hover data-[selected=true]:border-brand-hover data-[selected=true]:bg-brand-accent/5 data-[selected=true]:text-brand-dark"
                      data-selected={role === option}
                    >
                      <input
                        type="radio"
                        name="role"
                        value={option}
                        checked={role === option}
                        onChange={() => setRole(option)}
                        className="h-4 w-4 accent-brand-hover"
                      />
                      {option}
                    </label>
                  ))}
                </div>
                <p className="text-xs text-black/50">
                  Choose carefully — this determines which dashboard you&apos;ll use.
                </p>
              </fieldset>
            </div>
            {error && (
              <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
                {error}
              </p>
            )}
            <button
              type="submit"
              disabled={isLoading}
              className="flex w-full items-center justify-center rounded-lg bg-brand-accent px-5 py-2.5 text-sm font-semibold text-brand-dark transition-colors hover:bg-[#82cc3f] focus:outline-none focus:ring-2 focus:ring-brand-hover disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isLoading ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  Signing up…
                </span>
              ) : (
                "Create account"
              )}
            </button>
          </div>
        </form>
        <p className="mt-6 text-center text-sm text-black/60">
          Already have an account?{" "}
          <Link href="/login" className="font-medium text-brand-hover hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
