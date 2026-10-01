import { createBrowserClient } from "@supabase/ssr";
import { clientEnv } from "@/lib/env/client";
import type { Database } from "./database.types";

/**
 * Supabase client for Client Components: publishable key only, session in cookies. Cookies are
 * written without a `domain`, so they stay host-only (the browser client is only used on the app
 * host). @supabase/ssr returns the same instance on every call in the browser.
 */
export function createBrowserSupabase() {
  return createBrowserClient<Database>(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    clientEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
}
