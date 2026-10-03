import type { Database } from "@/lib/supabase/database.types";
import type { DomainDeps } from "./deps";
import { buildRecords } from "./records";
import type { DomainRecord, DomainView } from "./types";
import type { DomainConfig, ProjectDomain } from "./vercel-client";

export type DomainRow = Pick<
  Database["public"]["Tables"]["domains"]["Row"],
  "id" | "page_id" | "hostname" | "status" | "verified_at" | "last_checked_at" | "created_at"
>;

export const DOMAIN_ROW_COLUMNS = "id, page_id, hostname, status, verified_at, last_checked_at, created_at";

/** The view of a row with no Vercel data (a verified domain, or before the records are loaded). */
export function baseView(row: DomainRow, overrides: Partial<DomainView> = {}): DomainView {
  return {
    id: row.id,
    hostname: row.hostname,
    pageId: row.page_id,
    status: row.status === "verified" || row.status === "error" ? row.status : "pending",
    verifiedAt: row.verified_at,
    lastCheckedAt: row.last_checked_at,
    createdAt: row.created_at,
    records: [],
    misconfigured: false,
    message: null,
    recordsUnavailable: false,
    apex: null,
    ...overrides,
  };
}

export interface LoadedRecords {
  records: DomainRecord[];
  apex: { name: string; ipv4: string } | null;
  unavailable: boolean;
  misconfigured: boolean;
}

const UNAVAILABLE: LoadedRecords = { records: [], apex: null, unavailable: true, misconfigured: false };

export function recordsFrom(
  hostname: string,
  domain: Pick<ProjectDomain, "apexName" | "verification">,
  config: DomainConfig,
): LoadedRecords {
  const built = buildRecords(hostname, domain, config);
  return {
    records: built.records,
    apex: built.apex,
    unavailable: built.unavailable,
    misconfigured: config.misconfigured,
  };
}

/**
 * The DNS records of a pending domain, from Vercel's project-domain and config responses (two
 * GETs, never a verify). Any failure, including a missing token, reads as "unavailable": the card
 * says so and offers Try again; no values are invented.
 */
export async function loadRecords(deps: DomainDeps, hostname: string): Promise<LoadedRecords> {
  try {
    const [domain, config] = await Promise.all([
      deps.vercel.getProjectDomain(hostname),
      deps.vercel.getDomainConfig(hostname),
    ]);
    return recordsFrom(hostname, domain, config);
  } catch (error) {
    deps.log?.(`[domains] loading DNS records failed: ${errorLabel(error)}`);
    return UNAVAILABLE;
  }
}

/** How long the Domains screen's list may reuse a domain's DNS records. */
export const RECORDS_MEMO_MS = 10_000;
const recordsMemo = new WeakMap<object, Map<string, { at: number; loaded: LoadedRecords }>>();

/**
 * `loadRecords` with a short per-process memo, for the screen's list. It is keyed by the Vercel
 * client (one per process in production), so two environments never share an entry, and a failed
 * read (`unavailable`) is never remembered.
 */
export async function loadRecordsMemoized(deps: DomainDeps, hostname: string): Promise<LoadedRecords> {
  let byHost = recordsMemo.get(deps.vercel);
  if (!byHost) {
    byHost = new Map();
    recordsMemo.set(deps.vercel, byHost);
  }
  const now = Date.now();
  const hit = byHost.get(hostname);
  if (hit && Math.abs(now - hit.at) < RECORDS_MEMO_MS) return hit.loaded;
  const loaded = await loadRecords(deps, hostname);
  if (byHost.size > 500) byHost.clear();
  if (!loaded.unavailable) byHost.set(hostname, { at: now, loaded });
  return loaded;
}

export function pendingView(
  row: DomainRow,
  loaded: LoadedRecords,
  overrides: Partial<DomainView> = {},
): DomainView {
  return baseView(row, {
    records: loaded.records,
    apex: loaded.apex,
    recordsUnavailable: loaded.unavailable,
    misconfigured: loaded.misconfigured,
    ...overrides,
  });
}

/** A short, secret-free label for a log line. */
export function errorLabel(error: unknown): string {
  if (error instanceof Error) {
    // VercelApiError messages are built without tokens, URLs or hostnames.
    return error.name === "VercelApiError" ? error.message : error.name;
  }
  return "unknown error";
}
