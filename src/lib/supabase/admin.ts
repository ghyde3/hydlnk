import "server-only";
import { createClient } from "@supabase/supabase-js";
import { serverEnv } from "@/lib/env/server";
import type { Database } from "./database.types";

/**
 * Supabase client with the secret key: bypasses RLS. Server code only (`server-only` turns an
 * import from client code into a build error). Because RLS does not protect these queries, every
 * caller checks ownership and validates input itself, and public reads select `published` only.
 */
export function createAdminSupabase() {
  return createClient<Database>(serverEnv.NEXT_PUBLIC_SUPABASE_URL, serverEnv.SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
