import "server-only";
import { testHooksEnabled } from "@/lib/env/test-hooks";
import { rateLimit } from "@/lib/rate-limit";
import { cacheLifetimeSeconds, validateClientDocument } from "./client-document";
import type { ClientResolution } from "./clients";
import { oauthConfig } from "./config";
import { loadLogo } from "./logo";
import { logOauthEvent, logOauthFailure } from "./log";
import type { LimitFn } from "./register";
import {
  CIMD_MAX_BYTES,
  fetchClientDocument,
  isJsonType,
  type FetchRefusal,
  type SafeFetchDeps,
  type SafeFetchResult,
} from "./safe-fetch";
import { checkClientAddress } from "./ssrf";
import type { ClientRow, OauthStore } from "./store";
import { defaultOauthStore } from "./store-supabase";

/**
 * Client ID Metadata Documents (M10-07, M10-08, M10-09): turns an https `client_id` into a client row.
 *
 * It is called only when the cache holds no fresh row for the address, and it is the only place that
 * asks for a document. In this order:
 *
 *   1. the address is judged as text (https, public name, a path, port 443, never this product's own
 *      hosts), before any lookup;
 *   2. a request for the same address already in flight is joined, not repeated;
 *   3. limits, before the lookup: 30 a minute per client address, 20 per document host, 300 overall
 *      (a limiter failure fails open and is logged without the address);
 *   4. the fetch (safe-fetch.ts: public addresses only, no redirects, 5 KB, 3 seconds), the document
 *      validated (client-document.ts), the name cleaned, a safe logo fetched and re-encoded or skipped;
 *   5. one upsert on `client_id`: the fetch time and the lifetime from the response's Cache-Control.
 *
 * A failure is never stored, never cached and never explained to the browser: the result says only
 * "cannot verify" (or "too many"), and the log line carries a reason code and the host.
 */

export const CIMD_PER_IP_PER_MINUTE = 30;
export const CIMD_PER_HOST_PER_MINUTE = 20;
export const CIMD_ALL_PER_MINUTE = 300;

export interface CimdDeps {
  store: Pick<OauthStore, "upsertCimdClient">;
  limit: LimitFn;
  now: () => number;
  fetchDeps: SafeFetchDeps;
  /** Requests for the same address in flight at the moment (shared by concurrent first requests). */
  inflight?: Map<string, Promise<ClientResolution>>;
  /** Test seam: replaces the document fetch. */
  fetchDocument?: (address: string) => Promise<SafeFetchResult>;
  /** Test seam: replaces the logo path. */
  fetchLogo?: (logoUri: string, clientHost: string) => Promise<Uint8Array | null>;
}

const sharedInflight = new Map<string, Promise<ClientResolution>>();

const cannotVerify = (reason: FetchRefusal | string, host: string | null): ClientResolution => {
  logOauthEvent("client_document_refused", { reason, ...(host ? { host } : {}) });
  return { ok: false, reason: "cannot_verify" };
};

export async function loadCimdClientWith(
  clientId: string,
  clientKey: string,
  deps: CimdDeps,
): Promise<ClientResolution> {
  const address = checkClientAddress(clientId, {
    rootDomain: deps.fetchDeps.rootDomain,
    allowTestStub: deps.fetchDeps.allowTestStub ?? testHooksEnabled(),
  });
  if (!address.ok) {
    return cannotVerify(
      address.reason === "ip_literal" ||
        address.reason === "own_host" ||
        address.reason === "reserved_name" ||
        address.reason === "single_label" ||
        address.reason === "bad_host"
        ? "ssrf_blocked"
        : "bad_scheme",
      null,
    );
  }

  const inflight = deps.inflight ?? sharedInflight;
  const running = inflight.get(clientId);
  if (running) return running;

  const work = (async (): Promise<ClientResolution> => {
    // Limits first: each distinct client address can cost an outbound request.
    const perAddress = await deps.limit(`cimd-ip:${clientKey}`, CIMD_PER_IP_PER_MINUTE, 60);
    const perHost = perAddress.allowed
      ? await deps.limit(`cimd-host:${address.host}`, CIMD_PER_HOST_PER_MINUTE, 60)
      : perAddress;
    const overall = perHost.allowed
      ? await deps.limit("cimd-all", CIMD_ALL_PER_MINUTE, 60)
      : perHost;
    if (!perAddress.allowed || !perHost.allowed || !overall.allowed) {
      const blocked = !perAddress.allowed ? perAddress : !perHost.allowed ? perHost : overall;
      logOauthEvent("client_document_refused", { reason: "rate_limited", host: address.host });
      return { ok: false, reason: "too_many", retryAfter: Math.max(1, blocked.retryAfter) };
    }

    const fetched = deps.fetchDocument
      ? await deps.fetchDocument(clientId)
      : await fetchClientDocument(clientId, deps.fetchDeps, {
          maxBytes: CIMD_MAX_BYTES,
          accept: "application/json",
          acceptsType: isJsonType,
        });
    if (!fetched.ok) return cannotVerify(fetched.reason, fetched.host ?? address.host);

    let json: unknown;
    try {
      json = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(fetched.body));
    } catch {
      return cannotVerify("bad_type", address.host);
    }
    const document = validateClientDocument(json, clientId, address.host);
    if (!document.ok) return cannotVerify(`invalid_${document.reason}`, address.host);

    // A logo is shown only for a client whose document we fetched ourselves, and only a safe one.
    let logo: Uint8Array | null = null;
    if (document.logoUri) {
      logo = deps.fetchLogo
        ? await deps.fetchLogo(document.logoUri, address.host)
        : await loadLogo(document.logoUri, address.host, deps.fetchDeps);
    }

    const fetchedAt = deps.now();
    const expiresAt = fetchedAt + cacheLifetimeSeconds(fetched.cacheControl) * 1000;
    const row: ClientRow = {
      client_id: clientId,
      kind: "cimd",
      client_name: document.name,
      redirect_uris: document.redirectUris,
      logo_png: logo,
      fetched_at: new Date(fetchedAt).toISOString(),
      expires_at: new Date(expiresAt).toISOString(),
      created_at: new Date(fetchedAt).toISOString(),
      last_seen_at: new Date(fetchedAt).toISOString(),
    };
    try {
      await deps.store.upsertCimdClient({
        client_id: clientId,
        kind: "cimd",
        client_name: row.client_name,
        redirect_uris: row.redirect_uris,
        logo_png: logo,
        fetched_at: row.fetched_at,
        expires_at: row.expires_at,
      });
    } catch (error) {
      logOauthFailure("clientDocument", error);
      return { ok: false, reason: "cannot_verify" };
    }
    return { ok: true, client: row };
  })();

  inflight.set(clientId, work);
  try {
    return await work;
  } finally {
    inflight.delete(clientId);
  }
}

/** The loader the authorize route uses: the real store, limiter, clock and fetch. */
export function loadCimdClient(clientId: string, clientKey: string): Promise<ClientResolution> {
  const config = oauthConfig();
  return loadCimdClientWith(clientId, clientKey, {
    store: defaultOauthStore(),
    limit: (key, limit, window) => rateLimit(key, limit, window),
    now: Date.now,
    fetchDeps: { rootDomain: config.rootDomain },
  });
}
