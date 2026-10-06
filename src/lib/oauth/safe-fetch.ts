import "server-only";
import * as dns from "node:dns";
import type { LookupAddress } from "node:dns";
import * as http from "node:http";
import * as https from "node:https";
import type { LookupFunction } from "node:net";
import { testHooksEnabled } from "@/lib/env/test-hooks";
import {
  TEST_STUB_ORIGIN,
  checkClientAddress,
  judgeResolution,
  type AddressCheck,
  type AddressRefusal,
} from "./ssrf";

/**
 * The only code in the wave that requests a URL a client chose (M10-07): the client-metadata
 * document and its logo. A static scan of src/lib/oauth and src/lib/mcp finds no other `fetch(`,
 * `https.request`, `http.request` or `dns.` use (tests/unit/m10-oauth-static.test.ts).
 *
 * What it does, and what it refuses:
 *
 *   - the address is judged as text first (`checkClientAddress`), before any lookup;
 *   - both A and AAAA records are resolved, and ANY address that is not public unicast refuses the
 *     fetch (a name with one public and one private address is refused);
 *   - the socket connects to the address that was validated, not to a second lookup of the name (DNS
 *     rebinding): the connection's `lookup` returns the validated address, while the server name, the
 *     Host header and the certificate check keep the original name. Certificate checking is never
 *     turned off (a scan forbids switching it off);
 *   - redirects are never followed: every 3xx answer is refused, whatever its `Location` (stricter than
 *     the draft on purpose);
 *   - GET only, `Accept` set by the caller, `Accept-Encoding: identity`, `User-Agent: HYDLNK-OAuth/1`,
 *     no cookie, no Authorization, no header the client chose;
 *   - one deadline of 3 seconds for DNS, connect, TLS and the body together, and a body cap that cuts
 *     the stream the moment it is passed (never buffered whole);
 *   - the status must be 200, the content type must be one the caller accepts, and a content encoding
 *     other than identity is refused.
 *
 * Failures are never explained: a result carries a short reason code for the log line (with the host
 * only, never the path, the body or the resolved address) and the page says "We couldn’t verify this app."
 */

export const CIMD_TIMEOUT_MS = 3000;
export const CIMD_MAX_BYTES = 5120;
export const LOGO_MAX_BYTES = 100 * 1024;
export const FETCH_USER_AGENT = "HYDLNK-OAuth/1";

export type FetchRefusal =
  | "ssrf_blocked"
  | "bad_scheme"
  | "too_large"
  | "bad_type"
  | "timeout"
  | "redirected"
  | "bad_status"
  | "network";

export interface FetchTarget {
  /** The name the request is for: the server name, the Host header and the certificate check. */
  hostname: string;
  /** The validated address the socket connects to. */
  ip: string;
  family: 4 | 6;
  port: number;
  /** Path and query. */
  path: string;
  secure: boolean;
  headers: Record<string, string>;
  signal: AbortSignal;
}

export interface TransportResponse {
  status: number;
  /** Header names are lower case. */
  headers: Record<string, string | undefined>;
  chunks: AsyncIterable<Uint8Array>;
  destroy: () => void;
}

export type Transport = (target: FetchTarget) => Promise<TransportResponse>;

export interface SafeFetchDeps {
  /** NEXT_PUBLIC_ROOT_DOMAIN: this product's own hosts are never fetched. */
  rootDomain: string;
  resolve?: (hostname: string) => Promise<string[]>;
  transport?: Transport;
  timeoutMs?: number;
  /** Defaults to `testHooksEnabled()`: the end-to-end stub address is valid only while it is true. */
  allowTestStub?: boolean;
}

export interface SafeFetchOptions {
  maxBytes: number;
  accept: string;
  /** Is this `Content-Type` (lower case, parameters removed) one the caller takes? */
  acceptsType: (contentType: string) => boolean;
}

export type SafeFetchResult =
  | {
      ok: true;
      body: Uint8Array;
      contentType: string;
      cacheControl: string | null;
      host: string;
    }
  | { ok: false; reason: FetchRefusal; host: string | null };

function refusalFor(reason: AddressRefusal): FetchRefusal {
  switch (reason) {
    case "ip_literal":
    case "single_label":
    case "reserved_name":
    case "own_host":
    case "bad_host":
      return "ssrf_blocked";
    default:
      return "bad_scheme";
  }
}

/**
 * The resolver's own limits: one try and 1.5 seconds per query, inside the 3 second deadline of the
 * whole fetch. A c-ares Resolver answers on its own sockets; `dns.lookup` runs `getaddrinfo` in libuv's
 * four-thread pool, where a few slow names would stall every file and crypto call of the instance
 * (Wave L second review).
 */
export const DNS_RESOLVER_OPTIONS = { timeout: 1500, tries: 1 } as const;

/** The two queries `resolveBothFamilies` needs (a `dns.promises.Resolver` has both). */
export interface FamilyResolver {
  resolve4(hostname: string): Promise<string[]>;
  resolve6(hostname: string): Promise<string[]>;
}

/** The answers that mean "this name has no records of this family", which is normal for most names. */
const NO_RECORDS = new Set(["ENODATA", "ENOTFOUND"]);

/**
 * Both families, asked at once. A family with no records is empty; any other failure of either
 * family is an error (a half answer could hide an address that was never judged), and so is a name
 * with no records at all.
 */
export async function resolveBothFamilies(
  resolver: FamilyResolver,
  hostname: string,
): Promise<string[]> {
  const ask = async (query: Promise<string[]>): Promise<string[]> => {
    try {
      return await query;
    } catch (error) {
      if (NO_RECORDS.has((error as { code?: string } | null)?.code ?? "")) return [];
      throw error;
    }
  };
  const [v4, v6] = await Promise.all([
    ask(resolver.resolve4(hostname)),
    ask(resolver.resolve6(hostname)),
  ]);
  const all = [...v4, ...v6];
  if (all.length === 0) throw Object.assign(new Error("no records"), { code: "ENOTFOUND" });
  return all;
}

/** Both families, from the system's name servers (c-ares), never from the libuv pool. */
async function defaultResolve(hostname: string): Promise<string[]> {
  return resolveBothFamilies(new dns.promises.Resolver(DNS_RESOLVER_OPTIONS), hostname);
}

/** A DNS lookup that answers with the one address that was validated, whatever name it is asked for. */
export function pinnedLookup(target: Pick<FetchTarget, "ip" | "family">): LookupFunction {
  return (_hostname, lookupOptions, callback) => {
    if (lookupOptions.all) {
      (callback as (error: Error | null, addresses: LookupAddress[]) => void)(null, [
        { address: target.ip, family: target.family },
      ]);
    } else {
      callback(null, target.ip, target.family);
    }
  };
}

/** The real transport: node's http(s) client with the connection pinned to the validated address. */
const nodeTransport: Transport = (target) =>
  new Promise((resolve, reject) => {
    const options = {
      host: target.hostname,
      port: target.port,
      path: target.path,
      method: "GET",
      // The Host header comes from `host` and `port` above: the original name, never the address.
      headers: target.headers,
      // The socket goes to the address that was validated: no second lookup of the name.
      lookup: pinnedLookup(target),
      servername: target.secure ? target.hostname : undefined,
      agent: false as const,
      signal: target.signal,
    };
    const request = target.secure
      ? https.request(options, onResponse)
      : // The end-to-end stub only, and only behind testHooksEnabled() (checked by the caller).
        http.request(options, onResponse);
    function onResponse(response: http.IncomingMessage) {
      const headers: Record<string, string | undefined> = {};
      for (const [name, value] of Object.entries(response.headers)) {
        headers[name] = Array.isArray(value) ? value.join(", ") : value;
      }
      resolve({
        status: response.statusCode ?? 0,
        headers,
        chunks: response,
        destroy: () => response.destroy(),
      });
    }
    request.on("error", reject);
    request.end();
  });

export async function fetchClientDocument(
  address: string,
  deps: SafeFetchDeps,
  options: SafeFetchOptions,
): Promise<SafeFetchResult> {
  const checked: AddressCheck = checkClientAddress(address, {
    rootDomain: deps.rootDomain,
    allowTestStub: deps.allowTestStub ?? testHooksEnabled(),
  });
  if (!checked.ok) return { ok: false, reason: refusalFor(checked.reason), host: null };
  const host = checked.host;

  const controller = new AbortController();
  const deadline = new Promise<"timeout">((resolve) => {
    controller.signal.addEventListener("abort", () => resolve("timeout"), { once: true });
  });
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? CIMD_TIMEOUT_MS);
  let response: TransportResponse | null = null;

  try {
    // Resolution: both families, every address public, or no fetch.
    let addresses: string[];
    if (checked.testStub) {
      addresses = ["127.0.0.1"];
    } else {
      const found = await Promise.race([(deps.resolve ?? defaultResolve)(host), deadline]);
      if (found === "timeout") return { ok: false, reason: "timeout", host };
      addresses = found;
    }
    let ip: string;
    let family: 4 | 6;
    if (checked.testStub) {
      ip = "127.0.0.1";
      family = 4;
    } else {
      const verdict = judgeResolution(addresses);
      if (!verdict.ok) return { ok: false, reason: "ssrf_blocked", host };
      ip = verdict.address;
      family = verdict.family;
    }

    const url = new URL(checked.url);
    const target: FetchTarget = {
      hostname: host,
      ip,
      family,
      port: checked.testStub ? Number(new URL(TEST_STUB_ORIGIN).port) : 443,
      path: `${url.pathname}${url.search}`,
      secure: !checked.testStub,
      headers: {
        Accept: options.accept,
        "Accept-Encoding": "identity",
        "User-Agent": FETCH_USER_AGENT,
      },
      signal: controller.signal,
    };

    const connected = await Promise.race([(deps.transport ?? nodeTransport)(target), deadline]);
    if (connected === "timeout") return { ok: false, reason: "timeout", host };
    response = connected;

    if (response.status >= 300 && response.status < 400)
      return { ok: false, reason: "redirected", host };
    if (response.status !== 200) return { ok: false, reason: "bad_status", host };

    const contentType = (response.headers["content-type"] ?? "")
      .split(";", 1)[0]!
      .trim()
      .toLowerCase();
    const encoding = (response.headers["content-encoding"] ?? "identity").trim().toLowerCase();
    if (!options.acceptsType(contentType) || (encoding !== "identity" && encoding !== "")) {
      return { ok: false, reason: "bad_type", host };
    }
    const declared = response.headers["content-length"];
    if (declared !== undefined && Number(declared) > options.maxBytes) {
      return { ok: false, reason: "too_large", host };
    }

    // The body, cut the moment the count passes the cap, within the same deadline.
    const chunks: Uint8Array[] = [];
    let total = 0;
    const iterator = response.chunks[Symbol.asyncIterator]();
    for (;;) {
      const next = await Promise.race([iterator.next(), deadline]);
      if (next === "timeout") return { ok: false, reason: "timeout", host };
      if (next.done) break;
      total += next.value.byteLength;
      if (total > options.maxBytes) return { ok: false, reason: "too_large", host };
      chunks.push(next.value);
    }
    const body = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return {
      ok: true,
      body,
      contentType,
      cacheControl: response.headers["cache-control"] ?? null,
      host,
    };
  } catch (error) {
    if (controller.signal.aborted) return { ok: false, reason: "timeout", host };
    void error;
    return { ok: false, reason: "network", host };
  } finally {
    clearTimeout(timer);
    // Whatever happened, the socket does not outlive the call.
    response?.destroy();
    controller.abort();
  }
}

/** Does `Content-Type` name JSON: `application/json` or `...+json`? */
export function isJsonType(contentType: string): boolean {
  return contentType === "application/json" || contentType.endsWith("+json");
}
