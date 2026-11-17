"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import clsx from "clsx";
import {
  CalendarPlus,
  LayoutDashboard,
  Loader2,
  LogOut,
  Stethoscope,
} from "lucide-react";
import { createClient } from "@/lib/supabase";

export type AppRole = "patient" | "doctor" | "admin";

type NavLink = { href: string; label: string };

const NAV_LINKS: Record<AppRole, NavLink[]> = {
  patient: [
    { href: "/patient/dashboard", label: "Dashboard" },
    { href: "/patient/book", label: "Book appointment" },
  ],
  doctor: [{ href: "/doctor/dashboard", label: "Dashboard" }],
  admin: [{ href: "/admin/dashboard", label: "Dashboard" }],
};

const ROLE_LABELS: Record<AppRole, string> = {
  patient: "Patient",
  doctor: "Doctor",
  admin: "Admin",
};

/**
 * Top navigation for every signed-in page.
 *
 * Renders the CarePulse home link (the middleware sends signed-in users on to
 * their dashboard), the role's own links, and the sign-out button — signing out
 * clears the Supabase session and lands on the login screen.
 */
export type SidebarSection = { id: string; label: string; href?: string };

export function AppHeader({
  role,
  sections,
}: {
  role: AppRole;
  sections?: SidebarSection[];
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [name, setName] = useState("");
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const [showSignOutDialog, setShowSignOutDialog] = useState(false);
  const [signOutPassword, setSignOutPassword] = useState("");
  const [signOutEmail, setSignOutEmail] = useState("");
  const [verifyingPassword, setVerifyingPassword] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  // The name is cosmetic; a failure just leaves the role label showing.
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
          .select("full_name")
          .eq("id", userId)
          .maybeSingle();

        if (active) {
          const fullName = profile?.full_name;
          setName(typeof fullName === "string" ? fullName.trim() : "");
        }
      } catch {
        // Supabase not configured — the page body already explains that.
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  async function openSignOutDialog() {
    try {
      const supabase = createClient();
      const { data } = await supabase.auth.getUser();
      setSignOutEmail(data.user?.email ?? "");
    } catch {
      setSignOutEmail("");
    }

    setSignOutPassword("");
    setShowSignOutDialog(true);
  }

  async function handleSignOut() {
    if (signingOut) {
      return;
    }

    await openSignOutDialog();
    return;
  }


  async function confirmSignOut() {
    if (signingOut || verifyingPassword) {
      return;
    }

    if (role !== "admin" && signOutEmail) {
      setVerifyingPassword(true);
      setSignOutError(null);

      try {
        const supabase = createClient();
        const { error } = await supabase.auth.signInWithPassword({
          email: signOutEmail,
          password: signOutPassword,
        });

        if (error) {
          throw new Error("Incorrect password.");
        }
      } catch (error) {
        setSignOutError(
          error instanceof Error && error.message
            ? error.message
            : "Could not verify your password.",
        );
        setVerifyingPassword(false);
        return;
      } finally {
        setVerifyingPassword(false);
      }
    }

    setSigningOut(true);
    setShowSignOutDialog(false);

    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signOut();

      if (error) {
        throw new Error(error.message);
      }

      router.replace("/login");
      router.refresh();
    } catch (error) {
      setSignOutError(
        error instanceof Error && error.message
          ? error.message
          : "Could not sign out. Please try again.",
      );
      setSigningOut(false);
    }
  }

  const links = NAV_LINKS[role];

  // Close the mobile drawer whenever the route changes.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMobileOpen(false);
  }, [pathname]);
  const identity = name || ROLE_LABELS[role];

  return (
    <>
    {/* Mobile hamburger */}
    <button
      type="button"
      onClick={() => setMobileOpen(true)}
      aria-label="Open navigation"
      className="fixed left-3 top-3 z-40 inline-flex items-center justify-center rounded-lg border border-black/10 bg-white p-2 text-black shadow-sm md:hidden"
    >
      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
      </svg>
    </button>

    {mobileOpen ? (
      <button
        type="button"
        aria-label="Close navigation"
        onClick={() => setMobileOpen(false)}
        className="fixed inset-0 z-40 bg-black/40 md:hidden"
      />
    ) : null}

    <aside
      className={clsx(
        "fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-black/10 bg-primary-bg/95 backdrop-blur transition-transform duration-200 md:z-40 md:translate-x-0",
        mobileOpen ? "translate-x-0" : "-translate-x-full",
      )}
    >
      {/* Close button (mobile) */}
      <button
        type="button"
        onClick={() => setMobileOpen(false)}
        aria-label="Close navigation"
        className="absolute right-2 top-2 rounded-lg p-1.5 text-black/60 hover:bg-white/70 hover:text-black md:hidden"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
      <div className="flex items-center gap-2 px-4 py-4">
        <Link
          href="/"
          className="flex items-center gap-2 rounded-lg text-black focus:outline-none focus:ring-2 focus:ring-brand-hover/40"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-accent text-black">
            <Stethoscope className="h-4 w-4" aria-hidden="true" />
          </span>
          <span className="text-sm font-semibold tracking-tight">CarePulse</span>
        </Link>
      </div>

      <nav aria-label="Main" className="flex flex-1 flex-col gap-1 px-3 py-2">
        {links.map((link) => {
          const active =
            pathname === link.href ||
            (link.href !== "/patient/dashboard" &&
              pathname.startsWith(`${link.href}/`));

          return (
            <Link
              key={link.href}
              href={link.href}
              aria-current={active ? "page" : undefined}
              className={clsx(
                "inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "bg-white text-black shadow-sm"
                  : "text-black/60 hover:bg-white/70 hover:text-black",
              )}
            >
              {link.href === "/patient/book" ? (
                <CalendarPlus className="h-4 w-4" aria-hidden="true" />
              ) : (
                <LayoutDashboard className="h-4 w-4" aria-hidden="true" />
              )}
              {link.label}
            </Link>
          );
        })}

        {sections && sections.length > 0 ? (
          <>
            <div className="my-2 border-t border-black/10" />
            <p className="px-3 text-[10px] font-semibold uppercase tracking-wider text-black/40">
              On this page
            </p>
            {sections.map((section) => {
              const className =
                "inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-black/60 transition-colors hover:bg-white/70 hover:text-black";
              if (section.href) {
                return (
                  <Link
                    key={section.id}
                    href={section.href}
                    className={className}
                  >
                    {section.label}
                  </Link>
                );
              }
              return (
                <a
                  key={section.id}
                  href={`#${section.id}`}
                  className={className}
                >
                  {section.label}
                </a>
              );
            })}
          </>
        ) : null}
      </nav>

      <div className="border-t border-black/10 px-3 py-3">
        <span className="block truncate px-3 text-xs font-medium text-black/55">
          {identity}
        </span>
        <button
          type="button"
          onClick={handleSignOut}
          disabled={signingOut}
          className="mt-2 inline-flex w-full items-center gap-2 rounded-lg border border-brand-hover px-3 py-2 text-sm font-semibold text-black transition-colors hover:bg-brand-accent/15 focus:outline-none focus:ring-2 focus:ring-brand-hover/40 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {signingOut ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <LogOut className="h-4 w-4" aria-hidden="true" />
          )}
          {signingOut ? "Signing out…" : "Sign out"}
        </button>
        {signOutError ? (
          <p role="alert" className="mt-2 text-xs text-red-700">{signOutError}</p>
        ) : null}
      </div>
    </aside>

    {showSignOutDialog ? (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
        <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl">
          <h2 className="text-lg font-semibold text-black">Sign out?</h2>
          <p className="mt-2 text-sm text-black/65">
            {role !== "admin"
              ? "Enter your password to confirm sign out."
              : "Are you sure you want to sign out?"}
          </p>
          {role !== "admin" ? (
            <>
              <input
                type="password"
                value={signOutPassword}
                onChange={(e) => setSignOutPassword(e.target.value)}
                placeholder="Password"
                className="mt-4 block w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm outline-none transition-colors focus:border-brand-hover focus:ring-1 focus:ring-brand-hover"
              />
              <Link
                href="/forgot-password"
                className="mt-2 inline-block text-xs font-medium text-brand-hover hover:underline"
              >
                Forgot your password?
              </Link>
            </>
          ) : null}
          {signOutError ? (
            <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
              {signOutError}
            </p>
          ) : null}
          <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={() => {
                setShowSignOutDialog(false);
                setSignOutPassword("");
              }}
              disabled={signingOut || verifyingPassword}
              className="rounded-lg border border-black/15 px-4 py-2.5 text-sm font-semibold text-black/70 transition-colors hover:border-brand-hover hover:text-black"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void confirmSignOut()}
              disabled={signingOut || verifyingPassword}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand-accent px-4 py-2.5 text-sm font-semibold text-black transition-colors hover:bg-brand-hover hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              {signingOut || verifyingPassword ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : null}
              Sign out
            </button>
          </div>
        </div>
      </div>
    ) : null}
    </>
  );
}
