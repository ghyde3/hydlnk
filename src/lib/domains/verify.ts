import type { DomainDeps } from "./deps";
import { DOMAIN_MESSAGES } from "./messages";
import type { DomainView } from "./types";
import {
  DOMAIN_ROW_COLUMNS,
  baseView,
  errorLabel,
  loadRecords,
  pendingView,
  recordsFrom,
  type DomainRow,
  type LoadedRecords,
} from "./view";

/**
 * The one verification routine (M4-15, M5-23): Check DNS now, the polling endpoint and the
 * five-minute sweep all run `verifyDomain`, so they share one cooldown, one flip and one email.
 *
 *   1. read the row; a verified domain returns as is (no Vercel call at all);
 *   2. CLAIM the check with one conditional UPDATE (`claim_domain_check`: pending and last checked
 *      at least `cooldownSeconds` ago, stamping last_checked_at with the database clock). No claim
 *      means a check ran moments ago: return the stored result, make no verify request. This is
 *      what keeps 20 rapid clicks, or a click racing the sweep, to one Vercel verify request;
 *   3. ask Vercel to verify and read the domain's DNS config. Verified AND not misconfigured flips
 *      the row (`mark_domain_verified`, true only for the caller that made the change); anything
 *      else leaves it pending;
 *   4. the caller that flipped it expires the page's cache and claims the one email
 *      (`claim_domain_live_email`) BEFORE sending it. A send failure is logged (without the
 *      address) and never undoes or blocks the verification.
 *
 * The server only ever talks to the Vercel API (deps.vercel): the customer's hostname is a path
 * segment of those requests and nothing else, never something this code fetches (SSRF).
 */

/** Seconds between two checks of one domain (M4-15). The polling endpoint uses a hair less. */
export const CHECK_COOLDOWN_SECONDS = 10;
export const POLL_COOLDOWN_SECONDS = 9;

/**
 * A domain that is still pending this many days after it was added is released: taken off the
 * Vercel project and deleted. Without it a pending row would hold a hostname (and the project's
 * domain slot) forever, which lets anyone squat a name they never control. The sweep and "Check DNS
 * now" both do it; a verified domain is never expired.
 */
export const PENDING_EXPIRY_DAYS = 7;
/** @deprecated the sweep verifies pending domains younger than this and releases the older ones. */
export const SWEEP_MAX_AGE_DAYS = PENDING_EXPIRY_DAYS;
export const SWEEP_BATCH = 50;

export interface VerifyOptions {
  cooldownSeconds?: number;
  /**
   * Also read the project domain (ownership challenges) so the view carries the DNS records.
   * The sweep skips it: it only needs the verdict.
   */
  withRecords?: boolean;
  /** The clock for the expiry rule. Default: `deps.now`, then the real one. */
  now?: () => Date;
}

export interface VerifyOutcome {
  view: DomainView;
  /** A verify request went to Vercel (or was attempted) in this call. */
  checked: boolean;
  /** This call flipped the domain from pending to verified. */
  becameVerified: boolean;
  /** This call released (removed at Vercel and deleted) an expired pending domain. */
  released?: boolean;
  /** An expired pending domain that could not be released now (Vercel failed): the row is kept. */
  releaseFailed?: boolean;
}

type OwnedRow = DomainRow & { pages: { owner_id: string } | null };

/** Last records read for a domain, so a check inside the cooldown can show them without asking Vercel again. */
const recentRecords = new Map<string, { at: number; loaded: LoadedRecords }>();
const RECENT_RECORDS_MS = 60_000;

function remember(id: string, loaded: LoadedRecords): void {
  if (recentRecords.size > 500) recentRecords.clear();
  if (!loaded.unavailable) recentRecords.set(id, { at: Date.now(), loaded });
}

export async function readDomainRow(deps: DomainDeps, id: string): Promise<OwnedRow | null> {
  const { data, error } = await deps.admin
    .from("domains")
    .select(`${DOMAIN_ROW_COLUMNS}, pages!inner(owner_id)`)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`Reading domain ${id} failed: ${error.message}`);
  return (data as OwnedRow | null) ?? null;
}

/** Re-reads one row's checked/verified columns after a claim failed or a flip happened elsewhere. */
async function freshRow(deps: DomainDeps, row: OwnedRow): Promise<DomainRow> {
  const { data } = await deps.admin
    .from("domains")
    .select(DOMAIN_ROW_COLUMNS)
    .eq("id", row.id)
    .maybeSingle();
  return data ?? row;
}

const clockOf = (deps: DomainDeps, now?: () => Date): Date => (now ?? deps.now ?? (() => new Date()))();

/** True for a pending row added more than `PENDING_EXPIRY_DAYS` ago. Verified and errored rows never expire. */
export function isExpiredPending(row: Pick<DomainRow, "status" | "created_at">, now: Date): boolean {
  if (row.status !== "pending") return false;
  const created = Date.parse(row.created_at);
  return Number.isFinite(created) && created < now.getTime() - PENDING_EXPIRY_DAYS * 86_400_000;
}

/**
 * Releases an expired pending domain: off the Vercel project first (a 404, already gone, counts as
 * removed), then the row, only while it is still pending (a verification that landed in between
 * keeps its row). A Vercel failure keeps the row so the next sweep or check retries; it is logged
 * and answered as "failed", never thrown.
 */
async function releaseExpired(deps: DomainDeps, row: DomainRow): Promise<"released" | "failed"> {
  try {
    await deps.vercel.removeProjectDomain(row.hostname);
  } catch (error) {
    deps.log?.(`[domains] releasing expired domain ${row.id} failed: ${errorLabel(error)}`);
    return "failed";
  }
  const deleted = await deps.admin.from("domains").delete().eq("id", row.id).eq("status", "pending");
  if (deleted.error) {
    deps.log?.(`[domains] deleting expired domain ${row.id} failed: ${deleted.error.message}`);
    return "failed";
  }
  try {
    deps.expirePage(row.page_id);
  } catch (error) {
    deps.log?.(`[domains] expiring the page cache failed: ${errorLabel(error)}`);
  }
  return "released";
}

export async function verifyDomain(
  deps: DomainDeps,
  id: string,
  options: VerifyOptions = {},
): Promise<VerifyOutcome | null> {
  const cooldown = options.cooldownSeconds ?? CHECK_COOLDOWN_SECONDS;
  const withRecords = options.withRecords ?? true;

  const row = await readDomainRow(deps, id);
  if (!row) return null;
  if (row.status === "verified") {
    return { view: baseView(row), checked: false, becameVerified: false };
  }

  // Pending for more than 7 days: release it instead of asking Vercel anything.
  if (isExpiredPending(row, clockOf(deps, options.now))) {
    if ((await releaseExpired(deps, row)) === "released") {
      return {
        view: baseView(row, { message: DOMAIN_MESSAGES.expiredReleased }),
        checked: false,
        becameVerified: false,
        released: true,
      };
    }
    return {
      view: pendingView(
        row,
        { records: [], apex: null, unavailable: true, misconfigured: false },
        { message: DOMAIN_MESSAGES.unreachableCheck },
      ),
      checked: false,
      becameVerified: false,
      releaseFailed: true,
    };
  }

  const claim = await deps.admin.rpc("claim_domain_check", {
    p_id: id,
    p_cooldown_seconds: cooldown,
  });
  if (claim.error) throw new Error(`Claiming a check of domain ${id} failed: ${claim.error.message}`);

  if (claim.data !== true) {
    // Checked moments ago (or flipped in the meantime): the stored result, no verify request.
    const stored = await freshRow(deps, row);
    if (stored.status === "verified") {
      return { view: baseView(stored), checked: false, becameVerified: false };
    }
    const memo = recentRecords.get(id);
    const loaded =
      memo && Date.now() - memo.at < RECENT_RECORDS_MS
        ? memo.loaded
        : withRecords
          ? await loadRecords(deps, row.hostname)
          : { records: [], apex: null, unavailable: false, misconfigured: false };
    remember(id, loaded);
    return {
      view: pendingView(stored, loaded, { message: DOMAIN_MESSAGES.checkedFewSecondsAgo }),
      checked: false,
      becameVerified: false,
    };
  }

  // This call owns the check.
  const checkedRow = await freshRow(deps, row);
  let verified = false;
  let loaded: LoadedRecords;
  try {
    const verify = await deps.vercel.verifyProjectDomain(row.hostname);
    const [domain, config] = await Promise.all([
      withRecords ? deps.vercel.getProjectDomain(row.hostname) : Promise.resolve(null),
      deps.vercel.getDomainConfig(row.hostname),
    ]);
    verified = verify.verified && !config.misconfigured;
    loaded = domain
      ? recordsFrom(row.hostname, domain, config)
      : { records: [], apex: null, unavailable: false, misconfigured: config.misconfigured };
  } catch (error) {
    deps.log?.(`[domains] checking domain ${row.id} failed: ${errorLabel(error)}`);
    return {
      view: pendingView(
        checkedRow,
        { records: [], apex: null, unavailable: true, misconfigured: false },
        { message: DOMAIN_MESSAGES.unreachableCheck },
      ),
      checked: true,
      becameVerified: false,
    };
  }

  if (!verified) {
    remember(id, loaded);
    return {
      view: pendingView(checkedRow, loaded, { message: DOMAIN_MESSAGES.checkedJustNow }),
      checked: true,
      becameVerified: false,
    };
  }

  const flip = await deps.admin.rpc("mark_domain_verified", { p_id: id });
  if (flip.error) throw new Error(`Verifying domain ${id} failed: ${flip.error.message}`);
  const flipped = flip.data === true;
  const after = await freshRow(deps, row);

  if (flipped) {
    try {
      deps.expirePage(row.page_id);
    } catch (error) {
      deps.log?.(`[domains] expiring the page cache failed: ${errorLabel(error)}`);
    }
    await announceLive(deps, row);
  }
  recentRecords.delete(id);
  return { view: baseView(after), checked: true, becameVerified: flipped };
}

/**
 * M5-23: one email when a domain goes live. The claim is one atomic UPDATE made before sending,
 * so concurrent callers (two tabs, the sweep and a manual check) send one message, and a domain
 * that is pending, removed or already announced sends nothing. The address comes from the page
 * owner's auth user, never from a request. Everything here is best effort: it never throws.
 */
export async function announceLive(deps: DomainDeps, row: OwnedRow): Promise<void> {
  try {
    const claim = await deps.admin.rpc("claim_domain_live_email", { p_id: row.id });
    if (claim.error || claim.data !== true) {
      if (claim.error) deps.log?.(`[domains] claiming the live email failed: ${claim.error.message}`);
      return;
    }
    const ownerId = row.pages?.owner_id;
    if (!ownerId) return;

    // A suspended account's page is not served, so announcing it live would mislead.
    const account = await deps.admin
      .from("accounts")
      .select("suspended_at")
      .eq("id", ownerId)
      .maybeSingle();
    if (account.error || !account.data || account.data.suspended_at !== null) return;

    const owner = await deps.admin.auth.admin.getUserById(ownerId);
    const to = owner.data.user?.email;
    if (owner.error || !to) {
      deps.log?.(`[domains] no email address for the owner of domain ${row.id}; no email sent`);
      return;
    }
    await deps.sendLiveEmail({ to, hostname: row.hostname });
  } catch (error) {
    // The address is never in this line.
    deps.log?.(`[domains] the live email for domain ${row.id} failed: ${errorLabel(error)}`);
  }
}

export interface SweepResult {
  /** Domains a verify request was sent for (cooled-down ones are not counted). */
  checked: number;
  /** Domains this sweep flipped to verified. */
  verified: number;
  /** Expired pending domains this sweep released. */
  released: number;
}

/**
 * The five-minute sweep: up to `batch` pending domains created in the last `maxAgeDays` days,
 * least recently checked first (never-checked first), each through `verifyDomain` with the same
 * cooldown, a few at a time; then up to `batch` pending domains older than that, which are released
 * (removed at Vercel, row deleted). One failing domain never stops the rest.
 */
export async function sweepPendingDomains(
  deps: DomainDeps,
  options: { batch?: number; maxAgeDays?: number; concurrency?: number; now?: () => Date } = {},
): Promise<SweepResult> {
  const batch = options.batch ?? SWEEP_BATCH;
  const maxAgeDays = options.maxAgeDays ?? SWEEP_MAX_AGE_DAYS;
  const concurrency = options.concurrency ?? 5;
  const now = options.now ?? (() => clockOf(deps));
  const since = new Date(now().getTime() - maxAgeDays * 86_400_000);

  const { data, error } = await deps.admin
    .from("domains")
    .select("id")
    .eq("status", "pending")
    .gte("created_at", since.toISOString())
    .order("last_checked_at", { ascending: true, nullsFirst: true })
    .limit(batch);
  if (error) throw new Error(`Listing pending domains failed: ${error.message}`);

  const expired = await deps.admin
    .from("domains")
    .select("id")
    .eq("status", "pending")
    .lt("created_at", since.toISOString())
    .order("created_at", { ascending: true })
    .limit(batch);
  if (expired.error) throw new Error(`Listing expired pending domains failed: ${expired.error.message}`);

  const ids = [...(data ?? []), ...(expired.data ?? [])].map((row) => row.id);
  let checked = 0;
  let verified = 0;
  let released = 0;
  for (let i = 0; i < ids.length; i += concurrency) {
    const outcomes = await Promise.all(
      ids.slice(i, i + concurrency).map(async (id) => {
        try {
          return await verifyDomain(deps, id, { withRecords: false, now });
        } catch (failure) {
          deps.log?.(`[domains] sweep: domain ${id} failed: ${errorLabel(failure)}`);
          return null;
        }
      }),
    );
    for (const outcome of outcomes) {
      if (outcome?.checked) checked += 1;
      if (outcome?.becameVerified) verified += 1;
      if (outcome?.released) released += 1;
    }
  }
  return { checked, verified, released };
}
