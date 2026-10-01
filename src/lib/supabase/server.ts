import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { clientEnv } from "@/lib/env/client";
import { hostOnlyCookie } from "@/lib/routing/cookies";
import type { Database } from "./database.types";

/**
 * Supabase client for the signed-in user: publishable key, session read from the request cookies,
 * every query runs under RLS. For Server Components, Server Actions and Route Handlers.
 *
 * Async because `cookies()` is async in Next.js 16: `const supabase = await createServerSupabase()`.
 * Create one per request; never cache it at module level.
 */
export async function createServerSupabase() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    clientEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, hostOnlyCookie(options));
            }
          } catch {
            // Called from a Server Component, where cookies are read-only. The proxy refreshes
            // the session on every app-host request, so the write is not needed there.
          }
        },
      },
    },
  );
}
