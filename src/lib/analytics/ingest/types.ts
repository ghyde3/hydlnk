import type { RateLimitResult } from "@/lib/rate-limit";
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
}

/** What the beacon needs to know about a page before it records a view. */
export interface BeaconPage {
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
  rateLimit: (key: string, limit: number, windowSeconds: number) => Promise<RateLimitResult>;
  now: () => Date;
  visitorHash: (input: VisitorHashInput) => string;
  insertEvent: (row: EventRow) => Promise<void>;
  lookupBeaconPage: (pageId: string) => Promise<BeaconPage | null>;
  /** The URL of a block, icon or cell in the page's published document, or null. */
  resolveClickTarget: (pageId: string, id: string) => Promise<string | null>;
  /** Runs `task` after the response is sent (Next's `after`). */
  schedule: (task: () => Promise<void>) => void;
  /** NEXT_PUBLIC_ROOT_DOMAIN. */
  rootDomain: string;
}
