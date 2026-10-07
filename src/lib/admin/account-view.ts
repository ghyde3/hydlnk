/**
 * The pure half of the account details and audit log screens (M13-02, M13-05): types, the filter
 * parsing and a few formatters. No `server-only` and no database, so components and unit tests import
 * it freely; `account-queries.ts` has the reads.
 */

/** Every action `admin_audit` accepts: the same list as the CHECK constraint of migration 20261013000001. */
export const AUDIT_ACTIONS = [
  "suspend",
  "unsuspend",
  "dismiss_report",
  "review_traffic_flag",
  "block_domain",
  "unblock_domain",
  "gift_plan",
  "end_gift",
  "reserve_handle",
  "unreserve_handle",
  "recheck_domain",
  "view_draft",
  "set_announcement",
  "clear_announcement",
  "block_app",
  "unblock_app",
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const AUDIT_ACTION_LABELS: Record<AuditAction, string> = {
  suspend: "Suspended an account",
  unsuspend: "Unsuspended an account",
  dismiss_report: "Dismissed a report",
  review_traffic_flag: "Reviewed a traffic flag",
  block_domain: "Blocked a domain",
  unblock_domain: "Unblocked a domain",
  gift_plan: "Gifted a plan",
  end_gift: "Ended a gift",
  reserve_handle: "Reserved a handle",
  unreserve_handle: "Released a handle",
  recheck_domain: "Re-checked a domain",
  view_draft: "Viewed a draft",
  set_announcement: "Set the announcement",
  clear_announcement: "Cleared the announcement",
  block_app: "Blocked an app",
  unblock_app: "Unblocked an app",
};

export const auditLabel = (action: string): string =>
  (AUDIT_ACTION_LABELS as Record<string, string>)[action] ?? action;

export const AUDIT_PAGE_SIZE = 50;
/** Audit rows shown on an account's own page. */
export const ACCOUNT_AUDIT_LIMIT = 25;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: unknown): value is string =>
  typeof value === "string" && UUID.test(value);

const first = (raw: string | string[] | undefined): string =>
  (Array.isArray(raw) ? raw[0] : raw) ?? "";

export interface AuditFilter {
  /** Lowercased account id, or null for every account. */
  account: string | null;
  action: AuditAction | null;
  page: number;
  /** The account text as typed when it is not an id, so the form can show it next to the message. */
  badAccount: string | null;
}

/** The audit screen's query string, never trusted: an unknown action or a malformed id is "no filter" plus a hint. */
export function parseAuditFilter(params: {
  account?: string | string[];
  action?: string | string[];
  page?: string | string[];
}): AuditFilter {
  const accountRaw = first(params.account).trim().slice(0, 100);
  const action = AUDIT_ACTIONS.find((candidate) => candidate === first(params.action)) ?? null;
  const rawPage = Number(first(params.page));
  const page = Number.isInteger(rawPage) && rawPage >= 1 && rawPage <= 10_000 ? rawPage : 1;
  const valid = isUuid(accountRaw);
  return {
    account: valid ? accountRaw.toLowerCase() : null,
    action,
    page,
    badAccount: accountRaw !== "" && !valid ? accountRaw : null,
  };
}

export interface AuditRow {
  id: number;
  createdAt: string;
  adminId: string;
  adminEmail: string | null;
  action: string;
  accountId: string | null;
  reportId: string | null;
  detail: Record<string, unknown>;
}

/** The actor of an audit row nobody acted on (the gift expiry sweep): the nil uuid. */
export const SYSTEM_ACTOR_ID = "00000000-0000-0000-0000-000000000000";

/** The sub-page total cap of an account (HL009, migration 20261011000001): 64 MiB. */
export const SITE_BYTES_CAP = 67_108_864;

/**
 * The customer's page in Stripe's dashboard. Built from the stored id alone (no Stripe call). The
 * dashboard of the mode the configured key belongs to: a test key (`sk_test_`, `rk_test_`) opens the
 * test dashboard, anything else (production runs live) the live one. Null for an id that is not a
 * Stripe customer id. The key is only looked at for its prefix and never returned.
 */
export function stripeCustomerUrl(
  customerId: string | null,
  secretKey?: string | null,
): string | null {
  if (!customerId || !/^cus_[A-Za-z0-9]+$/.test(customerId)) return null;
  const test = /^[rs]k_test_/.test(secretKey ?? "");
  return `https://dashboard.stripe.com/${test ? "test/" : ""}customers/${customerId}`;
}

/** "Oct 3, 2026": the date part of an ISO time, locale-free, UTC. */
export function formatDate(iso: string | null): string {
  if (!iso) return "";
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return "";
  const date = new Date(time);
  const month = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ][date.getUTCMonth()];
  return `${month} ${date.getUTCDate()}, ${date.getUTCFullYear()}`;
}

export interface AccountSubPage {
  id: string;
  title: string;
  path: string;
  live: boolean;
}

export interface AccountDomain {
  id: string;
  hostname: string;
  status: string;
}

export interface AccountSite {
  pageId: string;
  handle: string;
  /** Published and its owner not suspended. */
  live: boolean;
  published: boolean;
  subPages: AccountSubPage[];
  domains: AccountDomain[];
}

export interface AccountApp {
  grantId: string;
  clientName: string;
  scopes: string[];
  lastUsedAt: string | null;
  authorizedAt: string;
}

export interface AccountReport {
  id: string;
  reason: string;
  status: string;
  createdAt: string;
  handle: string | null;
}

export interface AccountDetail {
  id: string;
  email: string;
  signedUpAt: string | null;
  lastSignInAt: string | null;
  plan: string;
  paidPlan: string;
  giftPlan: string | null;
  giftUntil: string | null;
  giftReason: string | null;
  /** A gift is on and has not ended (no end date, or an end in the future). */
  giftActive: boolean;
  suspendedAt: string | null;
  stripeCustomerId: string | null;
  uploadBytes: number;
  siteBytes: number;
  reportsTotal: number;
  reportsOpen: number;
  sites: AccountSite[];
  apps: AccountApp[];
  reports: AccountReport[];
  audit: AuditRow[];
}
