import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { reviewTrafficFlagAction } from "@/lib/analytics/admin/review-flag-action";
import { blockDomainAction, unblockDomainAction } from "@/lib/blocklist/admin-actions";
import type { Json } from "@/lib/supabase/database.types";
import { clearAnnouncementAction, setAnnouncementAction } from "./announcement-actions";
import { addReservedHandleAction, removeReservedHandleAction } from "./reserved-actions";
import { recheckDomainAction } from "./recheck-domain-action";
import { fail, type ActionResult, type AdminAction, type AdminActionContext } from "./types";

/**
 * The admin mutations (M5-06, M5-07). Each is an `AdminAction`, listed in `ADMIN_ACTIONS`, and
 * reached only through `executeAdminAction` (which refuses anyone who is not an admin before any
 * of this runs). tests/unit/admin-actions-guard.test.ts walks this registry with a non-admin and
 * an anonymous caller and expects 403 and 401 with no database call, and fails when an exported
 * action is missing from the registry or a route does not go through `adminRoute`.
 *
 * Every action is idempotent: a double click answers 200 with `changed: false`, never an error.
 */

const idInput = z.object({ id: z.guid() });

function defineAction(
  name: string,
  handler: (context: AdminActionContext, id: string) => Promise<ActionResult>,
): AdminAction {
  return {
    name,
    async run(context, rawInput) {
      const parsed = idInput.safeParse(rawInput);
      if (!parsed.success) return fail(400, "invalid_input", "That request isn’t valid.");
      return handler(context, parsed.data.id.toLowerCase());
    },
  };
}

/** The `reports` table is the reports agent's (docs in src/lib/reports/README.md): typed loosely here. */
const reportsOf = (db: AdminActionContext["deps"]["db"]) =>
  (db as unknown as SupabaseClient).from("reports");

/** A table that does not exist yet (the reports migration not applied) must not break a suspension. */
const MISSING_TABLE = new Set(["42P01", "PGRST205"]);

async function audit(
  context: AdminActionContext,
  action: "suspend" | "unsuspend" | "dismiss_report",
  fields: { accountId?: string; reportId?: string; detail?: Record<string, unknown> },
): Promise<void> {
  const { error } = await context.deps.db.from("admin_audit").insert({
    admin_id: context.actor.id,
    action,
    account_id: fields.accountId ?? null,
    report_id: fields.reportId ?? null,
    detail: (fields.detail ?? {}) as Json,
  });
  // A state change with no record of who made it is not acceptable: the action fails (500) and the
  // retry, which sees the change already made, writes the row (see `auditIfMissing`).
  if (error) throw new Error(`Writing the audit log failed: ${error.message}`);
}

/**
 * The retry half of the audit rule: the state was changed by an earlier call whose audit row (or a
 * later step) failed, so this call changed nothing. When the newest suspend-or-unsuspend row of the
 * account is not the action that produced the state it is in now, the earlier call died before
 * writing it, and this one writes it. A double click, which finds the row there, writes nothing.
 */
async function auditIfMissing(
  context: AdminActionContext,
  action: "suspend" | "unsuspend",
  accountId: string,
  detail: Record<string, unknown>,
): Promise<void> {
  const latest = await context.deps.db
    .from("admin_audit")
    .select("action")
    .eq("account_id", accountId)
    .in("action", ["suspend", "unsuspend"])
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latest.error) throw new Error(`Reading the audit log failed: ${latest.error.message}`);
  const last = latest.data?.action ?? null;
  // An unsuspend with no suspend on record means the account was never suspended: nothing to log.
  if (action === "unsuspend" ? last === "suspend" : last !== "suspend") {
    await audit(context, action, { accountId, detail: { ...detail, retried: true } });
  }
}

/** The account's pages (id and handle), for the cache calls and the confirm copy. */
async function pagesOf(context: AdminActionContext, accountId: string) {
  const { data, error } = await context.deps.db
    .from("pages")
    .select("id, handle")
    .eq("owner_id", accountId);
  if (error) throw new Error(`Listing pages failed: ${error.message}`);
  return data;
}

async function expireCaches(
  context: AdminActionContext,
  accountId: string,
  handles: readonly string[],
): Promise<void> {
  // Both calls are attempted: a failing page tag must not leave a handle's 404 cached, and vice
  // versa. The first failure is raised afterwards so the action answers 500 and can be repeated.
  let failure: unknown = null;
  try {
    await context.deps.invalidateAccount(accountId);
  } catch (error) {
    failure = error;
  }
  try {
    context.deps.invalidateHandles(handles);
  } catch (error) {
    failure ??= error;
  }
  if (failure) throw failure;
}

/**
 * Suspend an account (M5-07): `suspended_at = now()` with the secret key (only when it is not
 * already set, so a double click keeps the first timestamp), every cached page of the account
 * expired at once, the account's open reports marked actioned. Admins cannot be suspended. The audit
 * row is written right after the state change, before the caches and the reports, and a failure to
 * write it fails the action (a retry writes it: `auditIfMissing`).
 */
export const suspendAccountAction = defineAction("suspend_account", async (context, accountId) => {
  const { db, now } = context.deps;
  if (await context.deps.isProtectedAccount(accountId)) {
    return fail(409, "admin_protected", "Admins can’t be suspended.");
  }
  const account = await db
    .from("accounts")
    .select("id, suspended_at")
    .eq("id", accountId)
    .maybeSingle();
  if (account.error) throw new Error(`Reading the account failed: ${account.error.message}`);
  if (!account.data) return fail(404, "not_found", "That account doesn’t exist.");

  const pages = await pagesOf(context, accountId);
  const detail = { handles: pages.map((page) => page.handle) };
  let changed = false;
  if (account.data.suspended_at === null) {
    const written = await db
      .from("accounts")
      .update({ suspended_at: now().toISOString() })
      .eq("id", accountId)
      .is("suspended_at", null)
      .select("id");
    if (written.error) throw new Error(`Suspending failed: ${written.error.message}`);
    changed = (written.data?.length ?? 0) > 0;
  }
  // The record comes right after the state change and before anything that can fail after it (the
  // caches, the reports): a suspension is never in force without a row saying who did it. A retry
  // that finds the account already suspended writes the row if the earlier call never did.
  if (changed) await audit(context, "suspend", { accountId, detail });
  else if (account.data.suspended_at !== null)
    await auditIfMissing(context, "suspend", accountId, detail);

  // Every call, changed or not: a retry after a failed cache call must still expire the caches.
  await expireCaches(
    context,
    accountId,
    pages.map((page) => page.handle),
  );

  let reportsActioned = 0;
  if (pages.length > 0) {
    const marked = await reportsOf(db)
      .update({
        status: "actioned",
        reviewed_at: now().toISOString(),
        reviewed_by: context.actor.id,
      })
      .in(
        "page_id",
        pages.map((page) => page.id),
      )
      .eq("status", "open")
      .select("id");
    if (marked.error && !MISSING_TABLE.has(marked.error.code)) {
      throw new Error(`Marking reports actioned failed: ${marked.error.message}`);
    }
    reportsActioned = marked.data?.length ?? 0;
  }

  return { ok: true, status: 200, data: { changed, pages: pages.length, reportsActioned } };
});

/** Unsuspend an account (M5-07): clears `suspended_at` and expires the same caches. */
export const unsuspendAccountAction = defineAction(
  "unsuspend_account",
  async (context, accountId) => {
    const { db } = context.deps;
    const account = await db
      .from("accounts")
      .select("id, suspended_at")
      .eq("id", accountId)
      .maybeSingle();
    if (account.error) throw new Error(`Reading the account failed: ${account.error.message}`);
    if (!account.data) return fail(404, "not_found", "That account doesn’t exist.");

    const pages = await pagesOf(context, accountId);
    const detail = { handles: pages.map((page) => page.handle) };
    let changed = false;
    if (account.data.suspended_at !== null) {
      const written = await db
        .from("accounts")
        .update({ suspended_at: null })
        .eq("id", accountId)
        .not("suspended_at", "is", null)
        .select("id");
      if (written.error) throw new Error(`Unsuspending failed: ${written.error.message}`);
      changed = (written.data?.length ?? 0) > 0;
    }
    // Same rule as suspend: the record right after the change, before the caches.
    if (changed) await audit(context, "unsuspend", { accountId, detail });
    else if (account.data.suspended_at === null) {
      await auditIfMissing(context, "unsuspend", accountId, detail);
    }

    await expireCaches(
      context,
      accountId,
      pages.map((page) => page.handle),
    );
    return { ok: true, status: 200, data: { changed, pages: pages.length } };
  },
);

/** Dismiss a report (M5-06): status `dismissed`, who and when. Dismissing twice is a no-op. */
export const dismissReportAction = defineAction("dismiss_report", async (context, reportId) => {
  const { db, now } = context.deps;
  const found = await reportsOf(db).select("id, status").eq("id", reportId).maybeSingle();
  if (found.error) throw new Error(`Reading the report failed: ${found.error.message}`);
  const report = found.data as { id: string; status: string } | null;
  if (!report) return fail(404, "not_found", "That report doesn’t exist.");
  if (report.status === "dismissed") {
    // Dismissed by an earlier call whose audit row failed: this retry writes it.
    const logged = await db
      .from("admin_audit")
      .select("id")
      .eq("report_id", reportId)
      .eq("action", "dismiss_report")
      .limit(1);
    if (logged.error) throw new Error(`Reading the audit log failed: ${logged.error.message}`);
    if ((logged.data?.length ?? 0) === 0) {
      await audit(context, "dismiss_report", { reportId, detail: { retried: true } });
    }
    return { ok: true, status: 200, data: { changed: false } };
  }
  if (report.status !== "open") {
    return fail(409, "already_resolved", "That report was already resolved.");
  }

  const written = await reportsOf(db)
    .update({
      status: "dismissed",
      reviewed_at: now().toISOString(),
      reviewed_by: context.actor.id,
    })
    .eq("id", reportId)
    .eq("status", "open")
    .select("id");
  if (written.error) throw new Error(`Dismissing failed: ${written.error.message}`);
  const changed = (written.data?.length ?? 0) > 0;
  if (changed) await audit(context, "dismiss_report", { reportId });
  return { ok: true, status: 200, data: { changed } };
});

export { reviewTrafficFlagAction };
/** Re-check now on /admin/domains (M13-04): defined beside the admin library, listed here. */
export { recheckDomainAction };
/** Block and remove a domain at /admin/blocked-links (M7-12): defined beside the blocklist, listed here. */
export { blockDomainAction, unblockDomainAction };

/** Reserved handles, the announcement and the connected apps watch (M13-08 to M13-10): defined beside this file, listed here. */
export { addReservedHandleAction, removeReservedHandleAction };
export { clearAnnouncementAction, setAnnouncementAction };

/** Every admin mutation. Adding an action here is what makes the guard test cover it. */
export const ADMIN_ACTIONS: readonly AdminAction[] = [
  suspendAccountAction,
  unsuspendAccountAction,
  dismissReportAction,
  reviewTrafficFlagAction,
  blockDomainAction,
  unblockDomainAction,
  recheckDomainAction,
  addReservedHandleAction,
  removeReservedHandleAction,
  setAnnouncementAction,
  clearAnnouncementAction,
];
