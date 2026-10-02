import { parseReportAddress, type ReportAddress } from "./address";
import { ipBucketOf } from "./client-ip";
import {
  HONEYPOT_FIELD,
  REPORT_GLOBAL_KEY,
  REPORT_GLOBAL_RATE,
  REPORT_MESSAGES,
  REPORT_PAGE_CAP,
  REPORT_RATE,
  type ReportField,
} from "./constants";
import { reporterHashes } from "./hash";
import { parseReportInput, type ReportErrors } from "./schema";

/**
 * The report form's submission (M5-05), as a function of plain data so it is tested without Next.js
 * or a database. The route handler (handler.ts) feeds it the body and the client IP; server.ts wires
 * the real lookups and the two SQL functions.
 *
 * Order matters:
 *   1. a filled honeypot answers success and does nothing (it is not counted, so a bot learns nothing);
 *   2. Zod validation, field by field (400);
 *   3. the per-reporter limit, keyed on the IPv4 address or the IPv6 /64 prefix: every valid
 *      submission counts, duplicates and unknown pages included, so the sixth one in an hour is the
 *      one refused (429); then the hourly limit on the whole form (also 429);
 *   4. the page lookup (404 with the address error);
 *   5. one transaction that refuses a repeat inside 24 hours and a flood against one page, and
 *      otherwise files the report. Duplicates and caps answer exactly like a filed report.
 */

export interface ReportPage {
  id: string;
  /** Always the current handle: the form shows `{handle}.hydlnk.com` and no page content. */
  handle: string;
}

export interface ReportRecord {
  pageId: string;
  pageHandle: string;
  reason: string;
  details: string | null;
  email: string | null;
  /** Today's hash first, then yesterday's. */
  hashes: string[];
  pageCap: number;
}

export interface ReportDeps {
  /** Key material for the daily salt. */
  secret: string;
  /** NEXT_PUBLIC_ROOT_DOMAIN. */
  rootDomain: string;
  now: () => Date;
  /** A published page by id; null for a missing, unpublished or deleted one. */
  findPageById: (id: string) => Promise<ReportPage | null>;
  /** A published page by handle or verified custom domain. */
  findPageByAddress: (address: ReportAddress) => Promise<ReportPage | null>;
  /**
   * Counts one submission against `limit` per `windowSeconds` for the reporter (hashes: today's
   * first). Wave D's shared `rateLimit()` can be wrapped in this seam.
   */
  limiter: (
    hashes: string[],
    limit: number,
    windowSeconds: number,
  ) => Promise<{ allowed: boolean; retryAfter: number }>;
  /** Files the report unless it is a repeat or the page is flooded. */
  store: (record: ReportRecord) => Promise<"created" | "duplicate" | "page_capped">;
}

export type ReportBody =
  { ok: true; message: string } | { ok: false; message?: string; errors?: ReportErrors };

export interface ReportOutcome {
  status: 200 | 400 | 404 | 429 | 500;
  body: ReportBody;
  headers?: Record<string, string>;
}

const success = (): ReportOutcome => ({
  status: 200,
  body: { ok: true, message: REPORT_MESSAGES.sent },
});

const tooMany = (retryAfter: number): ReportOutcome => ({
  status: 429,
  body: { ok: false, message: REPORT_MESSAGES.tooMany },
  headers: { "Retry-After": String(Math.max(1, Math.ceil(retryAfter))) },
});

/** The error shown for a page that cannot be found, on the field the visitor used. */
const notFound = (field: ReportField): ReportOutcome => ({
  status: 404,
  body: { ok: false, errors: { [field]: REPORT_MESSAGES.notFound } },
});

export async function submitReport(
  raw: Record<string, unknown>,
  ip: string,
  deps: ReportDeps,
): Promise<ReportOutcome> {
  const trap = raw[HONEYPOT_FIELD];
  if (typeof trap === "string" ? trap.trim() !== "" : trap !== undefined && trap !== null) {
    return success();
  }

  const parsed = parseReportInput(raw);
  if (!parsed.ok) return { status: 400, body: { ok: false, errors: parsed.errors } };
  const input = parsed.data;

  // An address that cannot name a page is a field error, not a not-found, and costs no lookup.
  const address = input.page ? null : parseReportAddress(input.address ?? "", deps.rootDomain);
  if (!input.page && !address) return notFound("address");

  const now = deps.now();
  const hashes = reporterHashes(ipBucketOf(ip), deps.secret, now);
  const limit = await deps.limiter(hashes, REPORT_RATE.limit, REPORT_RATE.windowSeconds);
  if (!limit.allowed) return tooMany(limit.retryAfter);
  // The whole form's hourly cap, after the per-reporter one so a flooder is refused before it can
  // touch the shared counter.
  const overall = await deps.limiter(
    [REPORT_GLOBAL_KEY],
    REPORT_GLOBAL_RATE.limit,
    REPORT_GLOBAL_RATE.windowSeconds,
  );
  if (!overall.allowed) return tooMany(overall.retryAfter);

  const page = input.page
    ? await deps.findPageById(input.page)
    : await deps.findPageByAddress(address as ReportAddress);
  if (!page) return notFound(input.page ? "page" : "address");

  await deps.store({
    pageId: page.id,
    pageHandle: page.handle,
    reason: input.reason,
    details: input.details ?? null,
    email: input.email ?? null,
    hashes,
    pageCap: REPORT_PAGE_CAP,
  });
  // "created", "duplicate" and "page_capped" all read the same to the visitor.
  return success();
}
