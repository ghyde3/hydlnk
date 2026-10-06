import { z } from "zod";
import { verifyDomain } from "@/lib/domains/verify";
import type { Json } from "@/lib/supabase/database.types";
import { fail, type ActionResult, type AdminAction } from "./types";

/**
 * Re-check now on /admin/domains (M13-04): runs `verifyDomain`, the one routine the five-minute cron
 * (`sweepPendingDomains`), "Check DNS now" and the polling endpoint all run, for one domain, with the
 * same cooldown, the same flip to verified, the same live email and the same seven-day release of a
 * domain that stayed pending. The only difference is that an admin chooses the domain.
 *
 * Reached only through `executeAdminAction` (listed in `ADMIN_ACTIONS`), so a caller who is not an
 * admin never gets here. The domain is read from the path (`{id}`), never trusted from the body.
 * Every re-check writes one `recheck_domain` row to `admin_audit`, after the check, and a failure to
 * write it fails the action (500). A domain in the 'error' state is put back to pending first, because
 * only a pending domain can be claimed for a check. A repeated click is another check of the same domain, which the
 * cooldown keeps to one Vercel request every few seconds.
 */

const input = z.object({ id: z.guid() });

export const recheckDomainAction: AdminAction = {
  name: "recheck_domain",
  async run(context, rawInput): Promise<ActionResult> {
    const parsed = input.safeParse(rawInput);
    if (!parsed.success) return fail(400, "invalid_input", "That request isn’t valid.");
    const id = parsed.data.id.toLowerCase();
    const { db, domainDeps } = context.deps;

    // The row, with the owner for the audit row. The database is read before anything else is built.
    const found = await db
      .from("domains")
      .select("id, hostname, status, pages!inner(owner_id)")
      .eq("id", id)
      .maybeSingle();
    if (found.error) throw new Error(`Reading the domain failed: ${found.error.message}`);
    if (!found.data) return fail(404, "not_found", "That domain doesn’t exist any more.");
    const owner = (found.data.pages as unknown as { owner_id: string } | null)?.owner_id ?? null;

    if (!domainDeps) throw new Error("The domain dependencies are not wired");
    // `claim_domain_check` claims only a pending domain, so a domain in the 'error' state would never be
    // asked about again. Putting it back to pending first (service role, only from 'error') is what
    // "Re-check now" means for it; the verification then decides its state like any other check.
    if (found.data.status === "error") {
      const reset = await db
        .from("domains")
        .update({ status: "pending" })
        .eq("id", id)
        .eq("status", "error");
      if (reset.error) throw new Error(`Resetting the domain failed: ${reset.error.message}`);
    }
    const outcome = await verifyDomain(domainDeps(), id, { withRecords: false });
    if (!outcome) return fail(404, "not_found", "That domain doesn’t exist any more.");

    const { view } = outcome;
    const audited = await db.from("admin_audit").insert({
      admin_id: context.actor.id,
      action: "recheck_domain",
      account_id: owner,
      report_id: null,
      detail: {
        domain_id: id,
        hostname: found.data.hostname,
        checked: outcome.checked,
        verified: view.status === "verified",
        released: outcome.released === true,
      } as Json,
    });
    if (audited.error) throw new Error(`Writing the audit log failed: ${audited.error.message}`);

    return {
      ok: true,
      status: 200,
      data: {
        domainId: id,
        hostname: found.data.hostname,
        checked: outcome.checked,
        verified: view.status === "verified",
        released: outcome.released === true,
        state: view.status,
        lastCheckedAt: view.lastCheckedAt,
        message: view.message,
      },
    };
  },
};
