import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Reads the public Supabase credentials from the environment.
 *
 * Throws a descriptive error instead of letting the Supabase SDK fail with an
 * opaque message when the variables are missing.
 */
export function getSupabaseEnv(): { url: string; key: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error(
      "Supabase is not configured. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to your .env.local file.",
    );
  }

  return { url, key };
}

let browserClient: SupabaseClient | undefined;

/**
 * Returns a singleton Supabase client for browser/client components.
 *
 * Built on `@supabase/ssr` so the session is stored in cookies, which lets
 * `middleware.ts` (and server code) read the signed-in user.
 */
export function createClient(): SupabaseClient {
  if (!browserClient) {
    const { url, key } = getSupabaseEnv();
    browserClient = createBrowserClient(url, key);
  }

  return browserClient;
}
