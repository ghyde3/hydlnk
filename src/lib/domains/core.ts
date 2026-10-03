import { PLAN_LIMITS } from "@/lib/limits";
import { toPlan } from "@/lib/pages/plans";
import type { DomainDeps } from "./deps";
import { normalizeHostname } from "./hostname";
import { DOMAIN_MESSAGES, DOMAIN_STATUS, domainLimitMessage } from "./messages";
import type { DomainActionResult, DomainErrorCode, DomainView } from "./types";
import { CHECK_COOLDOWN_SECONDS, readDomainRow, verifyDomain } from "./verify";
import { VercelApiError } from "./vercel-client";
import {
  DOMAIN_ROW_COLUMNS,
  baseView,
  errorLabel,
  loadRecords,
  loadRecordsMemoized,
  pendingView,
  recordsFrom,
  type DomainRow,
} from "./view";

/**
 * The domain actions without any framework in the way (M4-11, M4-12, M4-15, M4-17): the server
 * actions in actions.ts check the session and hand the verified user id to these. Every function
 * takes the caller's id and checks ownership itself, because `deps.admin` is the secret-key client
 * and RLS does not apply. Another account's domain or page is a plain refusal and never reaches
 * Vercel. Nothing here throws for an expected refusal: it returns `{ ok: false, error, message,
 * status }`.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function refuse(
  error: DomainErrorCode,
  message: string,
  status: number = DOMAIN_STATUS[error],
): DomainActionResult {
  return { ok: false, error, message, status };
}

const isUuid = (value: unknown): value is string => typeof value === "string" && UUID.test(value);

/** Maps a failed Vercel call to the refusal the owner sees. */
export function vercelRefusal(
  error: unknown,
  copy: { unreachable: string },
): { code: DomainErrorCode; message: string } {
  if (error instanceof Error && error.name === "VercelNotConfiguredError") {
    return { code: "not_configured", message: DOMAIN_MESSAGES.notConfigured };
  }
  if (error instanceof VercelApiError) {
    switch (error.kind) {
      case "conflict":
        return { code: "vercel_conflict", message: DOMAIN_MESSAGES.conflictElsewhere };
      case "capacity":
        return { code: "vercel_capacity", message: DOMAIN_MESSAGES.capacity };
      default:
        return { code: "vercel_unavailable", message: copy.unreachable };
    }
  }
  return { code: "vercel_unavailable", message: copy.unreachable };
}

interface Account {
  plan: ReturnType<typeof toPlan>;
  suspended: boolean;
}

async function readAccount(deps: DomainDeps, userId: string): Promise<Account | null> {
  const { data, error } = await deps.admin
    .from("accounts")
    .select("plan, suspended_at")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw new Error(`Reading the account failed: ${error.message}`);
  if (!data) return null;
  return { plan: toPlan(data.plan), suspended: data.suspended_at !== null };
}

async function countDomains(deps: DomainDeps, userId: string): Promise<number> {
  const { count, error } = await deps.admin
    .from("domains")
    .select("id, pages!inner(owner_id)", { count: "exact", head: true })
    .eq("pages.owner_id", userId);
  if (error) throw new Error(`Counting domains failed: ${error.message}`);
  return count ?? 0;
}

async function ownsPage(deps: DomainDeps, userId: string, pageId: string): Promise<boolean> {
  const { data, error } = await deps.admin
    .from("pages")
    .select("id, owner_id")
    .eq("id", pageId)
    .maybeSingle();
  if (error) throw new Error(`Reading the page failed: ${error.message}`);
  return !!data && data.owner_id === userId;
}

/** The domain, if the caller owns it (through its page). Another account's id reads as missing. */
async function readOwnedDomain(deps: DomainDeps, userId: string, id: unknown) {
  if (!isUuid(id)) return null;
  const row = await readDomainRow(deps, id);
  if (!row || row.pages?.owner_id !== userId) return null;
  return row;
}

/** Domain actions that call Vercel: 10 per minute per account. Fail open (the limiter itself does). */
export const DOMAIN_ACTION_LIMIT = 10;
export const DOMAIN_ACTION_WINDOW_SECONDS = 60;

async function throttled(deps: DomainDeps, action: "add" | "remove", userId: string): Promise<boolean> {
  if (!deps.rateLimit) return false;
  const result = await deps.rateLimit(
    `domains:${action}:${userId}`,
    DOMAIN_ACTION_LIMIT,
    DOMAIN_ACTION_WINDOW_SECONDS,
  );
  return !result.allowed;
}

function expire(deps: DomainDeps, ...pageIds: string[]): void {
  for (const pageId of new Set(pageIds)) {
    try {
      deps.expirePage(pageId);
    } catch (error) {
      deps.log?.(`[domains] expiring the page cache failed: ${errorLabel(error)}`);
    }
  }
}

function unexpected(deps: DomainDeps, what: string, error: unknown): DomainActionResult {
  deps.log?.(`[domains] ${what} failed: ${error instanceof Error ? error.message : "unknown error"}`);
  return refuse("server_error", DOMAIN_MESSAGES.generic);
}

// -------------------------------------------------------------------------------------------
// Add (M4-11, M4-12)
// -------------------------------------------------------------------------------------------

/**
 * Add a custom domain. Order, each step before any side effect after it:
 *   1. validate the hostname and the page id (400)      2. account: suspended (403)
 *   3. the page is the caller's (403)                   4. plan and limit (403 plan_required / domain_limit)
 *   5. the hostname is free (409 hostname_taken)        6. ONE add request to Vercel (nothing stored yet)
 *   7. insert the row (the database enforces the limit and the unique hostname again).
 * A Vercel failure leaves no row. A failed insert after a successful Vercel add removes the name
 * again, except when the hostname is taken by a concurrent add: that name belongs to the winner and
 * is never touched.
 */
export async function addDomain(
  deps: DomainDeps,
  userId: string,
  input: { hostname: unknown; pageId: unknown },
): Promise<DomainActionResult> {
  if (!isUuid(userId)) return refuse("unauthenticated", DOMAIN_MESSAGES.signedOut);

  const parsed = normalizeHostname(input.hostname, { rootDomain: deps.rootDomain });
  if (!parsed.ok) return refuse("invalid_hostname", parsed.message);
  const hostname = parsed.hostname;
  if (!isUuid(input.pageId)) return refuse("invalid_request", DOMAIN_MESSAGES.choosePage);
  const pageId = input.pageId;

  try {
    if (await throttled(deps, "add", userId)) return refuse("rate_limited", DOMAIN_MESSAGES.rateLimited);
    const account = await readAccount(deps, userId);
    if (!account) return refuse("forbidden", DOMAIN_MESSAGES.notYourPage);
    if (account.suspended) return refuse("account_suspended", DOMAIN_MESSAGES.suspended);

    if (!(await ownsPage(deps, userId, pageId))) {
      return refuse("forbidden", DOMAIN_MESSAGES.notYourPage);
    }

    const limit = PLAN_LIMITS[account.plan].customDomains;
    if (limit === 0) return refuse("plan_required", domainLimitMessage(account.plan));
    const used = await countDomains(deps, userId);
    if (used >= limit) return refuse("domain_limit", domainLimitMessage(account.plan, used));

    const existing = await deps.admin
      .from("domains")
      .select("id")
      .eq("hostname", hostname)
      .maybeSingle();
    if (existing.error) throw new Error(existing.error.message);
    if (existing.data) return refuse("hostname_taken", DOMAIN_MESSAGES.hostnameTaken);

    let projectDomain;
    try {
      projectDomain = await deps.vercel.addProjectDomain(hostname);
    } catch (error) {
      if (error instanceof VercelApiError && error.kind === "invalid") {
        return refuse("invalid_hostname", "That doesn’t look like a domain name. Check it and try again.");
      }
      const refusal = vercelRefusal(error, { unreachable: DOMAIN_MESSAGES.unreachableAdd });
      if (refusal.code === "vercel_conflict") {
        // A concurrent add of the same name wins at Vercel (it answers 400 to the second): if our
        // database holds the name by now, that is the honest answer. The winner inserts right after
        // its own add returns, so look once more after a short wait before blaming Vercel.
        for (const waitMs of [0, 250]) {
          if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
          const raced = await deps.admin.from("domains").select("id").eq("hostname", hostname).maybeSingle();
          if (raced.data) return refuse("hostname_taken", DOMAIN_MESSAGES.hostnameTaken);
        }
      }
      deps.log?.(`[domains] adding a domain at Vercel failed: ${errorLabel(error)}`);
      return refuse(refusal.code, refusal.message);
    }

    const inserted = await deps.admin
      .from("domains")
      .insert({ page_id: pageId, hostname })
      .select(DOMAIN_ROW_COLUMNS)
      .single();

    if (inserted.error || !inserted.data) {
      const code = inserted.error?.code;
      if (code === "23505") return refuse("hostname_taken", DOMAIN_MESSAGES.hostnameTaken);
      // Our add succeeded but there is no row: take the name off the project again, so Vercel is
      // never left holding a domain nobody can see or remove.
      try {
        await deps.vercel.removeProjectDomain(hostname);
      } catch (error) {
        deps.log?.(`[domains] the compensating remove failed: ${errorLabel(error)}`);
      }
      if (code === "HL003") {
        const now = await countDomains(deps, userId).catch(() => limit);
        return refuse("domain_limit", domainLimitMessage(account.plan, now));
      }
      return unexpected(deps, "inserting the domain", inserted.error ?? new Error("no row"));
    }

    expire(deps, pageId);
    const row: DomainRow = inserted.data;
    let loaded;
    try {
      loaded = recordsFrom(hostname, projectDomain, await deps.vercel.getDomainConfig(hostname));
    } catch (error) {
      deps.log?.(`[domains] loading DNS records failed: ${errorLabel(error)}`);
      loaded = { records: [], apex: null, unavailable: true, misconfigured: false };
    }
    return { ok: true, domain: pendingView(row, loaded) };
  } catch (error) {
    return unexpected(deps, "adding a domain", error);
  }
}

// -------------------------------------------------------------------------------------------
// Check (M4-15)
// -------------------------------------------------------------------------------------------

/** "Check DNS now": ownership first (another account's id is a 404 and no Vercel call), then the shared routine. */
export async function checkDomain(
  deps: DomainDeps,
  userId: string,
  id: unknown,
  options: { cooldownSeconds?: number } = {},
): Promise<DomainActionResult> {
  if (!isUuid(userId)) return refuse("unauthenticated", DOMAIN_MESSAGES.signedOut);
  try {
    const owned = await readOwnedDomain(deps, userId, id);
    if (!owned) return refuse("not_found", DOMAIN_MESSAGES.noSuchDomain);
    const outcome = await verifyDomain(deps, owned.id, {
      cooldownSeconds: options.cooldownSeconds ?? CHECK_COOLDOWN_SECONDS,
    });
    if (!outcome) return refuse("not_found", DOMAIN_MESSAGES.noSuchDomain);
    if (outcome.released) return refuse("domain_expired", DOMAIN_MESSAGES.expiredReleased);
    if (outcome.releaseFailed) {
      return refuse("vercel_unavailable", DOMAIN_MESSAGES.unreachableCheck);
    }
    return { ok: true, domain: outcome.view };
  } catch (error) {
    return unexpected(deps, "checking a domain", error);
  }
}

// -------------------------------------------------------------------------------------------
// Serves (which page a domain shows)
// -------------------------------------------------------------------------------------------

export async function setDomainPage(
  deps: DomainDeps,
  userId: string,
  id: unknown,
  pageId: unknown,
): Promise<DomainActionResult> {
  if (!isUuid(userId)) return refuse("unauthenticated", DOMAIN_MESSAGES.signedOut);
  if (!isUuid(pageId)) return refuse("invalid_request", DOMAIN_MESSAGES.choosePage);
  try {
    const owned = await readOwnedDomain(deps, userId, id);
    if (!owned) return refuse("not_found", DOMAIN_MESSAGES.noSuchDomain);
    const account = await readAccount(deps, userId);
    if (!account) return refuse("forbidden", DOMAIN_MESSAGES.notYourPage);
    if (account.suspended) return refuse("account_suspended", DOMAIN_MESSAGES.suspended);
    if (!(await ownsPage(deps, userId, pageId))) {
      return refuse("forbidden", DOMAIN_MESSAGES.notYourPage);
    }
    const updated = await deps.admin
      .from("domains")
      .update({ page_id: pageId })
      .eq("id", owned.id)
      .select(DOMAIN_ROW_COLUMNS)
      .single();
    if (updated.error || !updated.data) {
      return unexpected(deps, "pointing a domain at a page", updated.error ?? new Error("no row"));
    }
    expire(deps, owned.page_id, pageId);
    return { ok: true, domain: baseView(updated.data) };
  } catch (error) {
    return unexpected(deps, "pointing a domain at a page", error);
  }
}

// -------------------------------------------------------------------------------------------
// Remove (M4-17)
// -------------------------------------------------------------------------------------------

/**
 * Remove a domain: off the Vercel project first (a 404 there, already gone, counts as removed;
 * anything else keeps the row and says so), then the row. The next request to the hostname finds no
 * row and answers 404: the proxy reads the table on every request, nothing is cached in between.
 */
export async function removeDomain(
  deps: DomainDeps,
  userId: string,
  id: unknown,
): Promise<DomainActionResult> {
  if (!isUuid(userId)) return refuse("unauthenticated", DOMAIN_MESSAGES.signedOut);
  try {
    const owned = await readOwnedDomain(deps, userId, id);
    if (!owned) return refuse("not_found", DOMAIN_MESSAGES.noSuchDomain);
    if (await throttled(deps, "remove", userId)) return refuse("rate_limited", DOMAIN_MESSAGES.rateLimited);
    const account = await readAccount(deps, userId);
    if (!account) return refuse("forbidden", DOMAIN_MESSAGES.notYourPage);
    if (account.suspended) return refuse("account_suspended", DOMAIN_MESSAGES.suspended);

    try {
      await deps.vercel.removeProjectDomain(owned.hostname);
    } catch (error) {
      deps.log?.(`[domains] removing a domain at Vercel failed: ${errorLabel(error)}`);
      const refusal = vercelRefusal(error, { unreachable: DOMAIN_MESSAGES.unreachableRemove });
      return refuse(refusal.code, DOMAIN_MESSAGES.unreachableRemove);
    }

    const deleted = await deps.admin.from("domains").delete().eq("id", owned.id);
    if (deleted.error) return unexpected(deps, "deleting the domain row", deleted.error);
    expire(deps, owned.page_id);
    return { ok: true };
  } catch (error) {
    return unexpected(deps, "removing a domain", error);
  }
}

// -------------------------------------------------------------------------------------------
// Reads for the screen and the polling route
// -------------------------------------------------------------------------------------------

/**
 * The account's domains, newest last; a pending domain carries its DNS records from Vercel, read
 * at most once per 10 seconds per domain (reloading the screen must not fire two Vercel GETs per
 * pending domain every time). The polling route and "Try again" read fresh.
 */
export async function listDomainViews(deps: DomainDeps, accountId: string): Promise<DomainView[]> {
  if (!isUuid(accountId)) return [];
  const { data, error } = await deps.admin
    .from("domains")
    .select(`${DOMAIN_ROW_COLUMNS}, pages!inner(owner_id)`)
    .eq("pages.owner_id", accountId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`Listing domains failed: ${error.message}`);
  return Promise.all(
    (data ?? []).map(async (row) => {
      if (row.status === "verified") return baseView(row);
      return pendingView(row, await loadRecordsMemoized(deps, row.hostname));
    }),
  );
}

/** One of the account's domains read fresh (records for a pending one), or null. No verify request. */
export async function getDomainView(
  deps: DomainDeps,
  accountId: string,
  id: unknown,
): Promise<DomainView | null> {
  const owned = await readOwnedDomain(deps, accountId, id);
  if (!owned) return null;
  if (owned.status === "verified") return baseView(owned);
  return pendingView(owned, await loadRecords(deps, owned.hostname));
}

/**
 * What GET /api/domains/[id] returns: the owner's domain after the shared verification routine
 * (so polling is also what notices a flip), or null for a domain that is not theirs.
 */
export async function pollDomainView(
  deps: DomainDeps,
  accountId: string,
  id: unknown,
  cooldownSeconds: number,
): Promise<DomainView | null> {
  const owned = await readOwnedDomain(deps, accountId, id);
  if (!owned) return null;
  const outcome = await verifyDomain(deps, owned.id, { cooldownSeconds });
  // A domain released as expired is gone: the poll says "no such domain" (404), like any removed one.
  if (outcome?.released) return null;
  return outcome?.view ?? null;
}
