import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  fail,
  type ActionResult,
  type AdminAction,
  type AdminActionContext,
} from "@/lib/admin/types";
import type { Json } from "@/lib/supabase/database.types";
import {
  DOMAIN_INPUT_MAX,
  INVALID_REQUEST_MESSAGE,
  REASON_INPUT_MAX,
  alreadyBlockedMessage,
  normalizeBlockedDomain,
  normalizeReason,
  storedDomainOf,
} from "./admin-domain";
import { parseImpact, type Impact } from "./admin-impact";

/**
 * The two admin actions behind /admin/blocked-links (M7-12): block a domain and remove one.
 *
 * They are `AdminAction`s like the ones in `@/lib/admin/actions` (which lists them in `ADMIN_ACTIONS`),
 * so they reach the database only through `executeAdminAction`: a caller who is not signed in gets 401
 * and a signed-in non-admin 403 before the input is read or a database client is built. This file
 * imports nothing from the admin library but its types (the admin guard test enforces that).
 *
 * Both write with the secret key and follow the audit rule of every admin mutation: the state change
 * first, then its `admin_audit` row, and a failure to write the row fails the action (500). The retry
 * finds the change already made and writes the row that is missing, so no change is ever without its
 * record and no retry doubles one:
 *
 *   block_domain    listed, added through this screen (`added_by` is set), and no 'block_domain' row
 *                   since the entry was made  ->  the earlier call died before its audit row: write it.
 *                   A starter-list entry has no `added_by`, so it is plainly "already blocked" (409).
 *   unblock_domain  not listed, and the newest audit row for the domain is 'block_domain'  ->  the
 *                   earlier call deleted the entry and died before its audit row: write it. (An entry
 *                   that came from the starter list has no earlier row to go by; its removal is audited
 *                   in the same call, and only a crash in between would leave no trace.)
 *
 * Nothing here touches `pages`: adding a domain stops new saves and publishes that link to it, and a
 * page that is already live keeps serving. The impact (how many live pages already link to it) is read
 * after the insert, because the function reads the list, and goes into the audit row's detail, so the
 * row is written as soon as that read returns.
 */

const blockInput = z.object({
  domain: z.string().max(DOMAIN_INPUT_MAX).default(""),
  reason: z.string().max(REASON_INPUT_MAX).default(""),
});

const unblockInput = z.object({ domain: z.string().max(DOMAIN_INPUT_MAX) });

type Db = SupabaseClient;

const looseDb = (context: AdminActionContext): Db => context.deps.db as unknown as Db;

async function writeAudit(
  db: Db,
  adminId: string,
  action: "block_domain" | "unblock_domain",
  detail: Record<string, unknown>,
): Promise<void> {
  const { error } = await db.from("admin_audit").insert({
    admin_id: adminId,
    action,
    account_id: null,
    report_id: null,
    detail: detail as Json,
  });
  // A change with no record of who made it is not acceptable: the action fails and the retry writes it.
  if (error) throw new Error(`Writing the audit log failed: ${error.message}`);
}

async function readImpact(db: Db, domain: string): Promise<Impact> {
  const { data, error } = await db.rpc("admin_blocked_domain_impact", {
    p_domain: domain,
    p_limit: 100,
  });
  if (error) throw new Error(`Reading the impact failed: ${error.message}`);
  return parseImpact(data);
}

export const blockDomainAction: AdminAction = {
  name: "block_domain",
  async run(context, rawInput): Promise<ActionResult> {
    const parsed = blockInput.safeParse(rawInput);
    if (!parsed.success) return fail(400, "invalid_input", INVALID_REQUEST_MESSAGE);
    const domain = normalizeBlockedDomain(parsed.data.domain);
    if (!domain.ok) return fail(400, "invalid_input", domain.message);
    const reason = normalizeReason(parsed.data.reason);
    if (!reason.ok) return fail(400, "invalid_input", reason.message);

    const db = looseDb(context);
    const found = await db
      .from("blocked_domains")
      .select("domain, reason, created_at, added_by")
      .eq("domain", domain.value)
      .maybeSingle();
    if (found.error) throw new Error(`Reading the blocked domain failed: ${found.error.message}`);
    const existing = found.data as {
      domain: string;
      reason: string | null;
      created_at: string;
      added_by: string | null;
    } | null;

    if (existing) {
      // Listed. Whether it is a plain duplicate or an earlier add whose audit row never got written.
      let missingAudit = false;
      if (existing.added_by !== null) {
        const logged = await db
          .from("admin_audit")
          .select("id")
          .eq("action", "block_domain")
          .eq("detail->>domain", existing.domain)
          .gte("created_at", existing.created_at)
          .limit(1);
        if (logged.error) throw new Error(`Reading the audit log failed: ${logged.error.message}`);
        missingAudit = (logged.data?.length ?? 0) === 0;
      }
      if (!missingAudit) {
        return fail(409, "already_blocked", alreadyBlockedMessage(domain.value));
      }
      const impact = await readImpact(db, domain.value);
      await writeAudit(db, existing.added_by ?? context.actor.id, "block_domain", {
        domain: domain.value,
        reason: existing.reason ?? "",
        live_pages: impact.pages,
        draft_pages: impact.drafts,
        retried: true,
      });
      return {
        ok: true,
        status: 200,
        data: { changed: false, domain: domain.value, ...impact },
      };
    }

    const inserted = await db
      .from("blocked_domains")
      .insert({ domain: domain.value, reason: reason.value, added_by: context.actor.id });
    if (inserted.error) {
      // Someone else listed it between the read and the insert: the same answer as a duplicate.
      if (inserted.error.code === "23505") {
        return fail(409, "already_blocked", alreadyBlockedMessage(domain.value));
      }
      throw new Error(`Blocking the domain failed: ${inserted.error.message}`);
    }

    const impact = await readImpact(db, domain.value);
    await writeAudit(db, context.actor.id, "block_domain", {
      domain: domain.value,
      reason: reason.value,
      live_pages: impact.pages,
      draft_pages: impact.drafts,
    });
    return { ok: true, status: 200, data: { changed: true, domain: domain.value, ...impact } };
  },
};

export const unblockDomainAction: AdminAction = {
  name: "unblock_domain",
  async run(context, rawInput): Promise<ActionResult> {
    const parsed = unblockInput.safeParse(rawInput);
    if (!parsed.success) return fail(400, "invalid_input", INVALID_REQUEST_MESSAGE);
    const domain = storedDomainOf(parsed.data.domain);
    if (domain === null) return fail(400, "invalid_input", INVALID_REQUEST_MESSAGE);

    const db = looseDb(context);
    const removed = await db
      .from("blocked_domains")
      .delete()
      .eq("domain", domain)
      .select("domain, reason");
    if (removed.error)
      throw new Error(`Removing the blocked domain failed: ${removed.error.message}`);
    const gone = (removed.data as { domain: string; reason: string | null }[] | null)?.[0];
    if (gone) {
      await writeAudit(db, context.actor.id, "unblock_domain", {
        domain,
        reason: gone.reason ?? "",
      });
      return { ok: true, status: 200, data: { changed: true, domain } };
    }

    // Nothing was listed: a second click, a domain that never was, or an earlier call that deleted the
    // entry and died before its audit row. The newest row for the domain tells which.
    const latest = await db
      .from("admin_audit")
      .select("action, detail")
      .in("action", ["block_domain", "unblock_domain"])
      .eq("detail->>domain", domain)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latest.error) throw new Error(`Reading the audit log failed: ${latest.error.message}`);
    const last = latest.data as { action: string; detail: { reason?: unknown } | null } | null;
    if (last?.action === "block_domain") {
      const earlier = last.detail?.reason;
      await writeAudit(db, context.actor.id, "unblock_domain", {
        domain,
        reason: typeof earlier === "string" ? earlier : "",
        retried: true,
      });
    }
    return { ok: true, status: 200, data: { changed: false, domain } };
  },
};
