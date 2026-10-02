import type { SupabaseClient } from "@supabase/supabase-js";
import { emptyDraft } from "@/lib/document";
import type { Database, Json } from "@/lib/supabase/database.types";
import { normalizeHandle, validateHandle } from "./rules";

/**
 * The claim logic (M1-09), written against an injected secret-key client so tests can drive it
 * without Next.js. Production code never imports this file directly: it calls claimHandle from
 * "./claim", which supplies the server-only admin client. Do not call it with a publishable-key
 * client (RLS refuses the insert, which is the point).
 */

export type ClaimError =
  | "short"
  | "too_long"
  | "invalid"
  | "reserved"
  | "taken"
  | "page_limit"
  | "no_account"
  | "suspended";

export type ClaimResult =
  { ok: true; handle: string; pageId: string } | { ok: false; error: ClaimError };

/**
 * Inserts the account's first page. `userId` MUST come from a verified session (getClaims), never
 * from request input. Reserved handles, uniqueness and the plan's page limit are enforced by the
 * database (BEFORE INSERT triggers and the unique index, which also serialise concurrent claims),
 * so this function only maps the resulting error codes:
 *   HL004 -> reserved, 23505 -> taken, HL001 -> page_limit, 23503 -> no_account.
 */
export async function claimHandleWithClient(
  admin: SupabaseClient<Database>,
  userId: string,
  rawHandle: string,
): Promise<ClaimResult> {
  const handle = normalizeHandle(rawHandle);
  const rule = validateHandle(handle);
  if (rule !== "ok") return { ok: false, error: rule };

  const account = await admin
    .from("accounts")
    .select("id, suspended_at")
    .eq("id", userId)
    .maybeSingle();
  if (account.error) throw new Error(`Account lookup failed: ${account.error.message}`);
  if (!account.data) return { ok: false, error: "no_account" };
  if (account.data.suspended_at) return { ok: false, error: "suspended" };

  const { data, error } = await admin
    .from("pages")
    .insert({ owner_id: userId, handle, draft: emptyDraft(handle) as unknown as Json })
    .select("id, handle")
    .single();

  if (error) {
    switch (error.code) {
      case "HL004":
        return { ok: false, error: "reserved" };
      case "23505":
        return { ok: false, error: "taken" };
      case "HL001":
        return { ok: false, error: "page_limit" };
      case "23503":
        return { ok: false, error: "no_account" };
      case "23514":
        // pages_handle_format: the rules above should have caught it; never a 500 for bad input.
        return { ok: false, error: "invalid" };
      default:
        throw new Error(`Claiming handle failed: ${error.code} ${error.message}`);
    }
  }
  return { ok: true, handle: data.handle, pageId: data.id };
}
