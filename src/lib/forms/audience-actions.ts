"use server";

import { getAppContext } from "@/lib/pages/context";
import { rateLimit } from "@/lib/rate-limit";
import { createServerSupabase } from "@/lib/supabase/server";
import { isBlockId, isUuid } from "./contract";

/**
 * Deleting submissions on the Audience screen (M17-08): one row, or every row of one form of the
 * current site. Both act as the signed-in user, under RLS (the delete policy: rows of a site they
 * own), and filter on the current site from `getAppContext()` too, so an id from another account
 * deletes nothing. At most 60 a minute per user. The month's count is not given back (HL016 counts
 * intake, in form_submission_usage).
 */

const AUDIENCE_DELETE_LIMIT = 60;
const AUDIENCE_DELETE_WINDOW_SECONDS = 60;

export type AudienceDeleteResult =
  { ok: true; deleted: number } | { ok: false; error: "invalid" | "rate_limited" | "failed" };

async function remove(column: "id" | "block_id", value: string): Promise<AudienceDeleteResult> {
  const { user, current } = await getAppContext();
  // Owner-only (Wave F, G3): RLS already refuses a member's delete; say so before touching anything.
  if (!current.access.isOwner) return { ok: false, error: "failed" };
  const limit = await rateLimit(
    `audience-delete:${user.id}`,
    AUDIENCE_DELETE_LIMIT,
    AUDIENCE_DELETE_WINDOW_SECONDS,
  );
  if (!limit.allowed) return { ok: false, error: "rate_limited" };
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("form_submissions")
    .delete()
    .eq("site_id", current.id)
    .eq(column, value)
    .select("id");
  if (error) {
    console.error("[audience] deleting submissions failed:", error.code ?? "unknown");
    return { ok: false, error: "failed" };
  }
  return { ok: true, deleted: data?.length ?? 0 };
}

/** "Delete" on one submission. */
export async function deleteSubmission(id: unknown): Promise<AudienceDeleteResult> {
  if (!isUuid(id)) return { ok: false, error: "invalid" };
  return remove("id", id.toLowerCase());
}

/** "Delete all from this form": every submission of one form block on the current site. */
export async function deleteFormSubmissions(blockId: unknown): Promise<AudienceDeleteResult> {
  if (!isBlockId(blockId)) return { ok: false, error: "invalid" };
  return remove("block_id", blockId);
}
