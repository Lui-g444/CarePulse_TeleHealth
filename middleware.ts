import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const LOGIN_PATH = "/login";

/** Dashboard each profile role is sent to. */
const ROLE_DASHBOARDS = {
  patient: "/patient/dashboard",
  doctor: "/doctor/dashboard",
  admin: "/admin/dashboard",
} as const;

type UserRole = keyof typeof ROLE_DASHBOARDS;

const ROLE_AREAS = Object.keys(ROLE_DASHBOARDS) as UserRole[];

function isUserRole(value: unknown): value is UserRole {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(ROLE_DASHBOARDS, value)
  );
}

function isInArea(pathname: string, area: string): boolean {
  return pathname === `/${area}` || pathname.startsWith(`/${area}/`);
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Without credentials the app cannot authenticate anyone; let requests
  // through instead of locking every route behind an unreachable login.
  if (!supabaseUrl || !supabaseKey) {
    console.warn(
      "[middleware] NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY are not set — skipping auth redirects.",
    );
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        // Keep the request cookies in sync so downstream reads see refreshed tokens.
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value),
        );

        response = NextResponse.next({ request });

        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );

        // Cache headers that must accompany refreshed auth cookies.
        if (headers) {
          Object.entries(headers).forEach(([key, value]) =>
            response.headers.set(key, value),
          );
        }
      },
    },
  });

  /** Builds a redirect that keeps any cookies refreshed during this request. */
  const redirectTo = (target: string) => {
    const redirectResponse = NextResponse.redirect(new URL(target, request.url));

    response.cookies
      .getAll()
      .forEach((cookie) => redirectResponse.cookies.set(cookie));

    return redirectResponse;
  };

  let userId: string | null = null;

  try {
    const { data } = await supabase.auth.getUser();
    userId = data.user?.id ?? null;
  } catch (error) {
    console.error("[middleware] Could not verify Supabase session:", error);
  }

  // Signed-out visitors can browse the landing, login and signup pages, but
  // every role workspace needs a session. Unknown paths fall through so they
  // render the app's 404 instead of bouncing to the login screen.
  if (!userId) {
    const needsAuth = ROLE_AREAS.some((area) => isInArea(pathname, area));
    return needsAuth ? redirectTo(LOGIN_PATH) : response;
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle();

  if (profileError) {
    console.error(
      "[middleware] Could not load profile role:",
      profileError.message,
    );
  }

  const role: unknown = profile?.role;

  // Signed in but not assigned a role yet: let the app handle onboarding.
  if (!isUserRole(role)) {
    return response;
  }

  const dashboard = ROLE_DASHBOARDS[role];

  // Signed-in users go straight from the landing page to their dashboard. The
  // login and signup pages stay reachable so a session can always be switched
  // or ended (the header's sign-out button lands there).
  if (pathname === "/") {
    return redirectTo(dashboard);
  }

  // Keep users inside their own role's area.
  const inOtherRoleArea = ROLE_AREAS.some(
    (area) => isInArea(pathname, area) && area !== role,
  );

  if (inOtherRoleArea) {
    return redirectTo(dashboard);
  }

  return response;
}

export const config = {
  matcher: [
    // Run on app routes only — skip API routes, Next internals, PWA files and static assets.
    "/((?!api|_next/static|_next/image|favicon.ico|icons/|manifest.json|sw\\.js|workbox-|worker-|swe-worker-|fallback-|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml|woff2?)$).*)",
  ],
};
