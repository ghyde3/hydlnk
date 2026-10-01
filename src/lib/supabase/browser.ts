import { createBrowserClient } from "@supabase/ssr";
import { clientEnv } from "@/lib/env/client";
import { protocolFor } from "@/lib/routing/urls";
import type { Database } from "./database.types";

/**
 * Supabase client for Client Components: publishable key only, session in cookies. Cookies are
 * written without a `domain`, so they stay host-only (the browser client is only used on the app
 * host), and `Secure` on https (the PKCE verifier cookie of the Google flow is written here).
 * @supabase/ssr returns the same instance on every call in the browser.
 */
export function createBrowserSupabase() {
  return createBrowserClient<Database>(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    clientEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    { cookieOptions: { secure: protocolFor(clientEnv.NEXT_PUBLIC_ROOT_DOMAIN) === "https" } },
  );
}
