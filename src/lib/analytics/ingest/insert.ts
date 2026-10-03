import "server-only";
import { createAdminSupabase } from "@/lib/supabase/admin";
import type { EventRow } from "./types";

/**
 * Appends one row to `events` with the secret key. The table has no client access at all (no
 * policy, no grant), so this is the only way a row gets in. `ts` is the database's `now()`.
 * Throws on a database error; the callers log it (the message only) and carry on.
 */
export async function insertEvent(row: EventRow): Promise<void> {
  const { error } = await createAdminSupabase().from("events").insert(row);
  if (error) throw new Error(`Inserting an event failed: ${error.message}`);
}
