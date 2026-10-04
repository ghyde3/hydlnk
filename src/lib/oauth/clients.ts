import { logOauthEvent } from "./log";
import { TEST_STUB_ORIGIN } from "./ssrf";
import type { ClientRow, OauthStore } from "./store";

/**
 * Who is asking (M10-11 step 3): a registered client (`hlc_` plus 32 hex characters, M10-10) is read
 * from the table, a client-metadata client (an https address, M10-07 and M10-08) is read from its cache
 * or fetched, and anything else is not recognized. The result carries no page text: the caller turns a
 * refusal into one of the fixed error-page sentences.
 */

export const DCR_CLIENT_ID = /^hlc_[0-9a-f]{32}$/;

export type ClientIdKind = "dcr" | "cimd" | "unknown";

/**
 * Looks only at the shape of the id. The end-to-end stub's address is a metadata address here; the
 * fetch function refuses it unless the test hooks are on (M10-07), so letting it through is
 * harmless: the refusal is `cannot_verify`.
 */
export function classifyClientId(clientId: string): ClientIdKind {
  if (DCR_CLIENT_ID.test(clientId)) return "dcr";
  if (clientId.length <= 2048 && /^https:\/\/[^/\s]/.test(clientId)) return "cimd";
  // The end-to-end stub's address (src/lib/oauth/ssrf.ts holds the one place that names it).
  if (
    clientId.startsWith(`${TEST_STUB_ORIGIN}/`) &&
    clientId.length <= 2048 &&
    !/\s/.test(clientId)
  ) {
    return "cimd";
  }
  return "unknown";
}

export type ClientResolution =
  | { ok: true; client: ClientRow }
  | {
      ok: false;
      reason: "unknown_app" | "cannot_verify" | "too_many";
      retryAfter?: number;
      /**
       * Present (true) when the document could not be read for a reason that says nothing about the
       * document itself: the host was slow, unreachable or answered with an error, or our own store
       * failed. Only then may an expired cached copy be used instead.
       */
      transient?: true;
    };

/** An expired client-metadata row stands in for a host that cannot answer, for this long after it was fetched. */
export const CIMD_STALE_SECONDS = 7 * 24 * 60 * 60;

export interface ResolveClientDeps {
  store: Pick<OauthStore, "getClient" | "touchClient">;
  now: () => number;
  /**
   * Fetches, validates and stores a client-metadata document (M10-07, M10-08), or says why not. Called
   * only when the cache holds no fresh row for the address.
   */
  loadCimdClient: (clientId: string) => Promise<ClientResolution>;
}

export async function resolveClient(
  clientId: string,
  deps: ResolveClientDeps,
): Promise<ClientResolution> {
  const kind = classifyClientId(clientId);
  if (kind === "unknown") return { ok: false, reason: "unknown_app" };

  if (kind === "dcr") {
    const row = await deps.store.getClient(clientId);
    if (!row || row.kind !== "dcr") return { ok: false, reason: "unknown_app" };
    await deps.store.touchClient(clientId).catch(() => undefined);
    return { ok: true, client: row };
  }

  // A fresh cache row is used with no outbound request and no count against the limits.
  const cached = await deps.store.getClient(clientId);
  if (
    cached &&
    cached.kind === "cimd" &&
    cached.expires_at !== null &&
    Date.parse(cached.expires_at) > deps.now()
  ) {
    await deps.store.touchClient(clientId).catch(() => undefined);
    return { ok: true, client: cached };
  }
  const loaded = await deps.loadCimdClient(clientId);
  if (loaded.ok) return loaded;

  // A client the person has connected before is not locked out because its host is slow, down or
  // being asked for too much for a minute (Wave L review): the expired copy stands in until a refetch
  // succeeds, and for a week at most after it was fetched. A document that is now invalid is not
  // "the host is down": it is refused, whatever the copy says.
  const unavailable =
    loaded.reason === "too_many" || (loaded.reason === "cannot_verify" && loaded.transient === true);
  if (unavailable && cached && cached.kind === "cimd" && usableAsStale(cached, deps.now())) {
    logOauthEvent("client_document_stale");
    await deps.store.touchClient(clientId).catch(() => undefined);
    return { ok: true, client: cached };
  }
  return loaded;
}

function usableAsStale(row: ClientRow, nowMs: number): boolean {
  const fetched = Date.parse(row.fetched_at ?? row.expires_at ?? "");
  return Number.isFinite(fetched) && fetched + CIMD_STALE_SECONDS * 1000 > nowMs;
}
