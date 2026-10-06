import type { RateLimitOptions, RateLimitResult } from "@/lib/rate-limit";
import type { VisitorHashInput } from "./hash";

/** One row of `events` as the tracking routes write it (secret key, server side only). */
export interface EventRow {
  page_id: string;
  /** '' for a view, the block (or icon, or cell) id for a click. */
  block_id: string;
  type: "view" | "click";
  referrer: string | null;
  device: string;
  country: string | null;
  visitor_hash: string;
  /** The sub-page the event happened on (M11-09). Absent = Home (stored as null). */
  sub_page_id?: string | null;
}

/** What the beacon needs to know about a page before it records a view. */
export interface BeaconPage {
  handle: string;
  /** Hostnames of the page's VERIFIED custom domains. */
  customHosts: string[];
  /** Ids of the site's LIVE sub-pages (published ones), for the beacon's page check (M11-09). */
  subPageIds?: string[];
}

/**
 * The lock on a link (M9-29), as the click redirect reads it from the published document: an age
 * check, a code with its salt and hash, or `invalid` for a stored lock whose shape is wrong, which
 * is never treated as "no lock" (the handler answers 503 for it).
 */
export type ClickLock =
  { kind: "age" } | { kind: "code"; salt: string; hash: string } | { kind: "invalid" };

/** What the click redirect needs to know about a link: where it goes and which hosts may serve it. */
export interface ClickTarget {
  /**
   * The URL in the page's published document, with the page's and the link's UTM tags added at
   * redirect time (M9-27) when they apply: exactly the published URL when none do.
   */
  url: string;
  /** The link's lock, or absent for an unlocked link (M9-29). */
  lock?: ClickLock | undefined;
  /** The sub-page whose published document holds the link; absent for Home (M11-09). */
  subPageId?: string | undefined;
  /** `pages.handle` of the page: `{handle}.{root}` serves it. */
  handle: string;
  /** Hostnames of the page's VERIFIED custom domains. */
  customHosts: string[];
}

/**
 * Everything the two handlers touch outside the request: the limiter, the clock, the database and
 * `after()`. The routes pass the real ones (`./deps`); the unit tests pass spies, which is how the
 * order of the steps (limit, then lookup, then insert) and the fail-open behaviour are proven.
 */
export interface IngestDeps {
  /** `options.failClosed` is for the link lock's code check only (M9-29); everything else fails open. */
  rateLimit: (
    key: string,
    limit: number,
    windowSeconds: number,
    options?: Pick<RateLimitOptions, "failClosed">,
  ) => Promise<RateLimitResult>;
  now: () => Date;
  visitorHash: (input: VisitorHashInput) => string;
  insertEvent: (row: EventRow) => Promise<void>;
  lookupBeaconPage: (pageId: string) => Promise<BeaconPage | null>;
  /** The link (block, icon or cell) in the page's published document with the hosts that serve it, or null. */
  resolveClickTarget: (pageId: string, id: string) => Promise<ClickTarget | null>;
  /**
   * Does `code` open this code lock (scrypt, constant-time compare)? Defaults to the real one
   * (`verifyLockCode`); the unit tests pass a spy to prove it runs only after the limiter.
   */
  verifyLock?: (code: string, lock: { salt: string; hash: string }) => Promise<boolean>;
  /** Runs `task` after the response is sent (Next's `after`). */
  schedule: (task: () => Promise<void>) => void;
  /** NEXT_PUBLIC_ROOT_DOMAIN. */
  rootDomain: string;
}
