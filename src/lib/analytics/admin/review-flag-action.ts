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
 * read) and writes an `admin_audit` row ('review_traffic_flag') for the change, exactly like suspend
 * and dismiss. It imports nothing from the admin library but its types; the registry
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
    const db = context.deps.db as unknown as SupabaseClient;
    const flags = db.from("traffic_flags");

    const found = await flags.select("id, page_id, reviewed_at").eq("id", flagId).maybeSingle();
    if (found.error) throw new Error(`Reading the flag failed: ${found.error.message}`);
    const flag = found.data as { id: string; page_id: string; reviewed_at: string | null } | null;
    if (!flag) return fail(404, "not_found", "That flag doesn’t exist.");

    // Like every admin mutation: the state change first, then its audit row. A failed audit write
    // fails the action (500); the retry sees the flag already reviewed and writes the missing row.
    const audit = async (detail: Record<string, unknown>) => {
      const owner = await db.from("pages").select("owner_id").eq("id", flag.page_id).maybeSingle();
      if (owner.error) throw new Error(`Reading the page failed: ${owner.error.message}`);
      const { error } = await db.from("admin_audit").insert({
        admin_id: context.actor.id,
        action: "review_traffic_flag",
        account_id: (owner.data as { owner_id: string } | null)?.owner_id ?? null,
        report_id: null,
        detail: { flag_id: flag.id, page_id: flag.page_id, ...detail },
      });
      if (error) throw new Error(`Writing the audit log failed: ${error.message}`);
    };

    const written = await flags
      .update({ reviewed_at: context.deps.now().toISOString() })
      .eq("id", flagId)
      .is("reviewed_at", null)
      .select("id");
    if (written.error)
      throw new Error(`Marking the flag reviewed failed: ${written.error.message}`);
    if ((written.data?.length ?? 0) > 0) {
      await audit({});
      return { ok: true, status: 200, data: { changed: true } };
    }

    // Nothing changed: already reviewed (a double click, or an earlier call whose audit row failed).
    const logged = await db
      .from("admin_audit")
      .select("id")
      .eq("action", "review_traffic_flag")
      .eq("detail->>flag_id", flag.id)
      .limit(1);
    if (logged.error) throw new Error(`Reading the audit log failed: ${logged.error.message}`);
    if ((logged.data?.length ?? 0) === 0) await audit({ retried: true });
    return { ok: true, status: 200, data: { changed: false } };
  },
};
