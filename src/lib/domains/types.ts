/**
 * Shared types of the custom-domains feature (M4-11 .. M4-17, M5-23). Safe in server and client
 * code: no imports, no runtime code. The server actions (actions.ts), the polling route
 * (GET /api/domains/[id]) and the server-only reads (queries.ts) all speak these shapes, and the
 * Domains screen renders them.
 */

export type DomainStatus = "pending" | "verified" | "error";

/** One DNS record to add at the owner's DNS provider, exactly as Vercel returned it (never typed here). */
export interface DomainRecord {
  /** "CNAME", "A" or "TXT". */
  type: string;
  /**
   * The host relative to Vercel's apex name: "links" for links.example.test, "a.b" for
   * a.b.example.test, "@" when the hostname is the apex itself; "_vercel" for the TXT challenge.
   */
  name: string;
  /** The value to copy. A CNAME target has its trailing dot dropped. */
  value: string;
}

export interface DomainView {
  id: string;
  /** Lower case, punycode for an internationalised name. */
  hostname: string;
  pageId: string;
  status: DomainStatus;
  /** ISO timestamp, null until the domain is verified. */
  verifiedAt: string | null;
  /** ISO timestamp of the last check against Vercel (server-only column), null before the first. */
  lastCheckedAt: string | null;
  /** ISO timestamp the domain was added: the Domains screen's 48-hour rule (M5-18) reads it. */
  createdAt: string;
  /**
   * Step 2 of the pending card: the records to add, exactly as Vercel returned them (CNAME or A
   * first, then the TXT ownership challenge when Vercel asks for one). Empty for a verified
   * domain and while `recordsUnavailable` is true. Never hard-coded.
   */
  records: DomainRecord[];
  /** Vercel's own verdict on the DNS (config.misconfigured). false for a verified domain. */
  misconfigured: boolean;
  /**
   * The line under the buttons after a check: "Checked just now. DNS isn’t pointing here yet.
   * Records can take a while to spread." or "Checked a few seconds ago." Null when nothing was
   * just checked (a plain read).
   */
  message: string | null;

  // Additive fields (they extend the contract, nothing above changed):

  /**
   * True when Vercel's config request failed: `records` is empty and the card shows "We couldn’t
   * load your DNS records." with a "Try again" button (re-fetch GET /api/domains/[id]). No fallback
   * values, ever.
   */
  recordsUnavailable: boolean;
  /**
   * For the note under a subdomain's table ("Using a root domain like example.test instead? Add an
   * A record for @ pointing to 203.0.113.10."): Vercel's apex name and its first IPv4 (lowest rank).
   * Null when the hostname is the apex itself, when Vercel returned no IPv4, or while
   * `recordsUnavailable`.
   */
  apex: { name: string; ipv4: string } | null;
}

/** Codes of a refused action (`error`), with the HTTP-style `status` that goes with each. */
export type DomainErrorCode =
  | "unauthenticated" // 401
  | "invalid_request" // 400: a missing or malformed id / page id
  | "invalid_hostname" // 400
  | "rate_limited" // 429: too many adds or removes from this account in a minute
  | "plan_required" // 403: Free
  | "domain_limit" // 403: Pro or Studio at its limit
  | "account_suspended" // 403
  | "forbidden" // 403: the page is not the caller's
  | "not_found" // 404: no such domain for this account
  | "domain_expired" // 410: a pending domain older than 7 days, released by this check
  | "hostname_taken" // 409
  | "vercel_conflict" // 409: Vercel says the name is connected elsewhere
  | "vercel_capacity" // 503: Vercel's per-project domain cap
  | "vercel_unavailable" // 502: Vercel unreachable, timed out or answered 5xx
  | "not_configured" // 503: VERCEL_API_TOKEN or the project id is not set
  | "server_error"; // 500

export type DomainActionResult =
  | { ok: true; domain?: DomainView }
  | {
      ok: false;
      /** One of DomainErrorCode. */
      error: string;
      /** Sentence-case copy for the UI, says what to do. */
      message: string;
      /** HTTP-style status of the refusal, for tests and logs. */
      status: number;
    };
