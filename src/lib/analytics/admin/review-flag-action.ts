import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { fail, type ActionResult, type AdminAction } from "@/lib/admin/types";

/**
 * "Mark reviewed" for a high-traffic flag (M5-10): `traffic_flags.reviewed_at = now()` with the
 * secret key, only while it is still null, so a double click keeps the first timestamp and answers
 * 200 with `changed: false`. The page itself is never touched: a flagged page keeps serving, and a
 * reviewed flag only silences the nightly job for 30 days (flag_high_traffic_pages).
 *
 * This is an `AdminAction` like the ones in `@/lib/admin/actions`, so it reaches the database only
 * through `executeAdminAction` (403 for a signed-in non-admin, 401 for nobody, before anything is
 * read). It imports nothing from the admin library but its types; the registry
 * (`ADMIN_ACTIONS`) and the route (`/api/admin/traffic/{id}/reviewed`) wire it in.
 */

const idInput = z.object({ id: z.guid() });

export const reviewTrafficFlagAction: AdminAction = {
  name: "review_traffic_flag",
  async run(context, rawInput): Promise<ActionResult> {
    const parsed = idInput.safeParse(rawInput);
    if (!parsed.success) return fail(400, "invalid_input", "That request isn’t valid.");
    const flagId = parsed.data.id.toLowerCase();

    // `traffic_flags` is newer than the generated types, so the client is typed loosely here.
    const flags = (context.deps.db as unknown as SupabaseClient).from("traffic_flags");

    const written = await flags
      .update({ reviewed_at: context.deps.now().toISOString() })
      .eq("id", flagId)
      .is("reviewed_at", null)
      .select("id");
    if (written.error)
      throw new Error(`Marking the flag reviewed failed: ${written.error.message}`);
    if ((written.data?.length ?? 0) > 0) {
      return { ok: true, status: 200, data: { changed: true } };
    }

    // Nothing changed: already reviewed (a double click) or no such flag.
    const found = await flags.select("id").eq("id", flagId).maybeSingle();
    if (found.error) throw new Error(`Reading the flag failed: ${found.error.message}`);
    if (!found.data) return fail(404, "not_found", "That flag doesn’t exist.");
    return { ok: true, status: 200, data: { changed: false } };
  },
};
