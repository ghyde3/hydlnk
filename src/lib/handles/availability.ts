import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/database.types";
import { normalizeHandle, validateHandle } from "./rules";
import type { HandleStatus } from "./status";

export interface HandleCheck {
  /** The normalized handle (so "ADMIN" comes back as "admin"). */
  handle: string;
  status: HandleStatus;
}

/**
 * Availability of one handle (M1-02). Precedence: short, too_long, invalid, reserved, taken.
 * Reserved and taken are read with the secret key: `reserved_handles` has no client access at all
 * and `pages` has no public select, so this function (behind the endpoint) is the only route to
 * either fact. Throws on a database error; the caller turns that into a 500.
 */
export async function checkHandle(
  raw: string,
  admin: SupabaseClient<Database> = createAdminSupabase(),
): Promise<HandleCheck> {
  const handle = normalizeHandle(raw);
  const rule = validateHandle(handle);
  if (rule !== "ok") return { handle, status: rule };

  const [reserved, taken] = await Promise.all([
    admin.from("reserved_handles").select("handle").eq("handle", handle).maybeSingle(),
    admin.from("pages").select("id").eq("handle", handle).maybeSingle(),
  ]);
  if (reserved.error) throw new Error(`Reserved-handle lookup failed: ${reserved.error.message}`);
  if (taken.error) throw new Error(`Handle lookup failed: ${taken.error.message}`);

  if (reserved.data) return { handle, status: "reserved" };
  if (taken.data) return { handle, status: "taken" };
  return { handle, status: "available" };
}
