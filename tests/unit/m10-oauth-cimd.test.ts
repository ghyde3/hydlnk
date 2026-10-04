import { readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import sharp, { type Sharp } from "sharp";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CIMD_DEFAULT_CACHE_SECONDS,
  CIMD_MAX_CACHE_SECONDS,
  CIMD_MIN_CACHE_SECONDS,
  cacheLifetimeSeconds,
  validateClientDocument,
} from "@/lib/oauth/client-document";
import { resolveClient } from "@/lib/oauth/clients";
import {
  CIMD_ALL_PER_MINUTE,
  CIMD_PER_HOST_PER_MINUTE,
  CIMD_PER_IP_PER_MINUTE,
  loadCimdClientWith,
  type CimdDeps,
} from "@/lib/oauth/cimd";
import { KNOWN_CLIENT_IDS } from "@/lib/oauth/known-clients";
import { LOGO_HOST_ALLOWLIST, isSafeLogoHost, loadLogo, reencodeLogo } from "@/lib/oauth/logo";
import { FakeOauthStore, memoryLimiter, openLimiter } from "./helpers/oauth-fake-store";
import type { FetchTarget, SafeFetchResult } from "@/lib/oauth/safe-fetch";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: async () => ({ allowed: true, retryAfter: 0 }) }));
vi.mock("@/lib/oauth/config", () => ({ oauthConfig: () => ({ rootDomain: "hydlnk.com" }) }));
vi.mock("@/lib/oauth/store-supabase", () => ({ defaultOauthStore: () => ({}) }));

/**
 * M10-08 and M10-09: what a client-metadata document must say, how long it is trusted, the three
 * real documents, the cache and the loader, and the logo path. Nothing here touches the network.
 */

const fixture = (name: string) =>
  JSON.parse(
    readFileSync(resolvePath(process.cwd(), "tests/unit/fixtures/cimd", name), "utf8"),
  ) as Record<string, unknown>;
const CLAUDE = "https://claude.ai/oauth/mcp-oauth-client-metadata";
const CLAUDE_CODE = "https://claude.ai/oauth/claude-code-client-metadata";
const CHATGPT = "https://chatgpt.com/oauth/client.json";
const URL_ = "https://app.example.com/oauth/client.json";

const good = (over: Record<string, unknown> = {}) => ({
  client_id: URL_,
  client_name: "Example",
  redirect_uris: ["https://app.example.com/cb"],
  ...over,
});

describe("M10-08 validateClientDocument", () => {
  it("accepts a minimal document and returns only what is read", () => {
    expect(validateClientDocument(good(), URL_, "app.example.com")).toEqual({
      ok: true,
      name: "Example",
      redirectUris: ["https://app.example.com/cb"],
      logoUri: null,
    });
  });

  it.each([
    ["null", null, "not_an_object"],
    ["an array", [], "not_an_object"],
    ["a string", "text", "not_an_object"],
    ["a client_id with a trailing slash", good({ client_id: `${URL_}/` }), "client_id_mismatch"],
    ["another case", good({ client_id: URL_.toUpperCase() }), "client_id_mismatch"],
    [
      "another host",
      good({ client_id: "https://evil.example.com/oauth/client.json" }),
      "client_id_mismatch",
    ],
    [
      "a missing client_id",
      { client_name: "x", redirect_uris: ["https://a.example.com/cb"] },
      "client_id_mismatch",
    ],
    ["no name", good({ client_name: undefined }), "bad_name"],
    ["an empty name", good({ client_name: "   " }), "bad_name"],
    ["a non-text name", good({ client_name: 7 }), "bad_name"],
    ["no redirect_uris", good({ redirect_uris: undefined }), "bad_redirect_uris"],
    ["empty redirect_uris", good({ redirect_uris: [] }), "bad_redirect_uris"],
    [
      "one bad redirect",
      good({ redirect_uris: ["https://app.example.com/cb", "cursor://x"] }),
      "bad_redirect_uris",
    ],
    [
      "eleven redirects",
      good({ redirect_uris: Array.from({ length: 11 }, (_, i) => `https://app.example.com/${i}`) }),
      "bad_redirect_uris",
    ],
    [
      "client_secret_basic",
      good({ token_endpoint_auth_method: "client_secret_basic" }),
      "bad_auth_method",
    ],
    [
      "client_secret_post",
      good({ token_endpoint_auth_method: "client_secret_post" }),
      "bad_auth_method",
    ],
    [
      "client_secret_jwt",
      good({ token_endpoint_auth_method: "client_secret_jwt" }),
      "bad_auth_method",
    ],
    ["tls_client_auth", good({ token_endpoint_auth_method: "tls_client_auth" }), "bad_auth_method"],
    [
      "self_signed_tls_client_auth",
      good({ token_endpoint_auth_method: "self_signed_tls_client_auth" }),
      "bad_auth_method",
    ],
    ["an unknown method", good({ token_endpoint_auth_method: "magic" }), "bad_auth_method"],
    ["a client_secret", good({ client_secret: "s" }), "has_secret"],
    ["client_secret_expires_at", good({ client_secret_expires_at: 0 }), "has_secret"],
    [
      "grant_types without authorization_code",
      good({ grant_types: ["refresh_token"] }),
      "bad_grant_types",
    ],
    [
      "grant_types that is not a list",
      good({ grant_types: "authorization_code" }),
      "bad_grant_types",
    ],
    ["response_types without code", good({ response_types: ["token"] }), "bad_response_types"],
    [
      "a name posing as the product",
      good({ client_name: "H-Y-D-L-N-K support" }),
      "name_impersonates",
    ],
  ])("refuses %s", (_name, json, reason) => {
    expect(validateClientDocument(json, URL_, "app.example.com")).toMatchObject({
      ok: false,
      reason,
    });
  });

  it("takes none or private_key_jwt as a declaration only, and ignores unsupported grant types", () => {
    for (const method of [undefined, "none", "private_key_jwt"]) {
      expect(
        validateClientDocument(
          good({ token_endpoint_auth_method: method }),
          URL_,
          "app.example.com",
        ).ok,
      ).toBe(true);
    }
    expect(
      validateClientDocument(
        good({
          grant_types: ["urn:ietf:params:oauth:grant-type:jwt-bearer", "authorization_code"],
        }),
        URL_,
        "app.example.com",
      ).ok,
    ).toBe(true);
    expect(
      validateClientDocument(
        good({ response_types: ["code", "id_token"] }),
        URL_,
        "app.example.com",
      ).ok,
    ).toBe(true);
  });

  it("ignores unknown members and never stores or fetches jwks_uri, policy_uri or tos_uri", () => {
    const result = validateClientDocument(
      good({
        jwks_uri: "https://x.example.com/jwks",
        policy_uri: "https://x.example.com/p",
        tos_uri: "https://x.example.com/t",
        nonsense: { a: 1 },
      }),
      URL_,
      "app.example.com",
    );
    expect(result).toEqual({
      ok: true,
      name: "Example",
      redirectUris: ["https://app.example.com/cb"],
      logoUri: null,
    });
  });

  it("a __proto__ or constructor key does nothing", () => {
    const text = `{"__proto__":{"client_name":"Hijack","redirect_uris":["https://evil.example.com/cb"]},"constructor":{"prototype":{"polluted":true}},"client_id":"${URL_}","client_name":"Real","redirect_uris":["https://app.example.com/cb"]}`;
    const result = validateClientDocument(JSON.parse(text), URL_, "app.example.com");
    expect(result).toMatchObject({
      ok: true,
      name: "Real",
      redirectUris: ["https://app.example.com/cb"],
    });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    // And a document with only the inherited route to a name is refused.
    const inherited = Object.create({
      client_name: "Inherited",
      redirect_uris: ["https://a.example.com/cb"],
    }) as Record<string, unknown>;
    inherited.client_id = URL_;
    expect(validateClientDocument(inherited, URL_, "app.example.com")).toMatchObject({
      ok: false,
      reason: "bad_name",
    });
  });

  it("a name with nothing readable left falls back to the host of the address", () => {
    const zeroWidth = String.fromCodePoint(0x200b);
    expect(
      validateClientDocument(
        good({ client_name: `${zeroWidth}${zeroWidth}` }),
        URL_,
        "app.example.com",
      ),
    ).toMatchObject({ ok: true, name: "app.example.com" });
    expect(
      validateClientDocument(good({ client_name: `x${zeroWidth}` }), URL_, "app.example.com"),
    ).toMatchObject({ ok: true, name: "x" });
  });

  it("keeps a declared logo address as a string and drops anything else", () => {
    expect(
      validateClientDocument(good({ logo_uri: "https://app.example.com/logo.png" }), URL_, "h"),
    ).toMatchObject({ logoUri: "https://app.example.com/logo.png" });
    expect(validateClientDocument(good({ logo_uri: 5 }), URL_, "h")).toMatchObject({
      logoUri: null,
    });
    expect(validateClientDocument(good({ logo_uri: "" }), URL_, "h")).toMatchObject({
      logoUri: null,
    });
  });
});

describe("M10-08 the three real documents", () => {
  it("Claude (it lists the jwt-bearer grant: a validator that rejected unsupported grants would reject it)", () => {
    const doc = fixture("claude.json");
    expect(doc.grant_types).toContain("urn:ietf:params:oauth:grant-type:jwt-bearer");
    expect(validateClientDocument(doc, CLAUDE, "claude.ai")).toEqual({
      ok: true,
      name: "Claude",
      redirectUris: ["https://claude.ai/api/mcp/auth_callback"],
      logoUri: null,
    });
  });

  it("Claude Code (two loopback URIs without a port)", () => {
    expect(validateClientDocument(fixture("claude-code.json"), CLAUDE_CODE, "claude.ai")).toEqual({
      ok: true,
      name: "Claude Code",
      redirectUris: ["http://localhost/callback", "http://127.0.0.1/callback"],
      logoUri: null,
    });
  });

  it("ChatGPT (private_key_jwt, a logo on another host, extra members)", () => {
    const doc = fixture("chatgpt.json");
    expect(doc.token_endpoint_auth_method).toBe("private_key_jwt");
    expect(doc).toHaveProperty("jwks_uri");
    expect(validateClientDocument(doc, CHATGPT, "chatgpt.com")).toEqual({
      ok: true,
      name: "ChatGPT",
      redirectUris: ["https://chatgpt.com/connector_platform_oauth_redirect"],
      logoUri: "https://persistent.oaistatic.com/sonic/misc/openai-logo.png",
    });
  });

  it("each fixture names its source and the date", () => {
    for (const name of ["claude.json", "claude-code.json", "chatgpt.json"]) {
      expect(String(fixture(name)["//"])).toMatch(/fetched from https:\/\/\S+ on 2026-10-04/);
    }
  });
});

describe("M10-08 how long a document is trusted", () => {
  it.each([
    [null, CIMD_DEFAULT_CACHE_SECONDS],
    [undefined, CIMD_DEFAULT_CACHE_SECONDS],
    ["", CIMD_DEFAULT_CACHE_SECONDS],
    ["public", CIMD_DEFAULT_CACHE_SECONDS],
    ["max-age=7200", 7200],
    ["public, max-age=600", 600],
    ["MAX-AGE=900", 900],
    ["max-age=60", CIMD_MIN_CACHE_SECONDS],
    ["max-age=299", CIMD_MIN_CACHE_SECONDS],
    ["max-age=300", 300],
    ["max-age=86400", 86400],
    ["max-age=999999", CIMD_MAX_CACHE_SECONDS],
    ["max-age=0", CIMD_MIN_CACHE_SECONDS],
    ["max-age=-5", CIMD_MIN_CACHE_SECONDS],
    ["max-age=abc", CIMD_MIN_CACHE_SECONDS],
    ["no-store", CIMD_MIN_CACHE_SECONDS],
    ["no-cache", CIMD_MIN_CACHE_SECONDS],
    ["private", CIMD_MIN_CACHE_SECONDS],
    ["max-age=7200, private", CIMD_MIN_CACHE_SECONDS],
    ["no-store, max-age=86400", CIMD_MIN_CACHE_SECONDS],
  ])("Cache-Control %j gives %i seconds", (header, seconds) => {
    expect(cacheLifetimeSeconds(header)).toBe(seconds);
  });

  it("the bounds are 300 and 86,400, and 3,600 is the default", () => {
    expect([CIMD_MIN_CACHE_SECONDS, CIMD_MAX_CACHE_SECONDS, CIMD_DEFAULT_CACHE_SECONDS]).toEqual([
      300, 86400, 3600,
    ]);
  });
});

// ---------------------------------------------------------------------------------------------
// The loader
// ---------------------------------------------------------------------------------------------

function loaderSetup(over: { limit?: CimdDeps["limit"]; docs?: Array<SafeFetchResult> } = {}) {
  const store = new FakeOauthStore();
  const limiter = openLimiter();
  const queue = [...(over.docs ?? [])];
  const calls = { fetch: 0, logo: 0, upserts: 0 };
  const originalUpsert = store.upsertCimdClient.bind(store);
  store.upsertCimdClient = async (client) => {
    calls.upserts += 1;
    return originalUpsert(client);
  };
  const doc = (json: unknown, cacheControl: string | null = null): SafeFetchResult => ({
    ok: true,
    body: new TextEncoder().encode(JSON.stringify(json)),
    contentType: "application/json",
    cacheControl,
    host: "app.example.com",
  });
  const deps: CimdDeps = {
    store,
    limit: over.limit ?? limiter.limit,
    now: store.now,
    fetchDeps: { rootDomain: "hydlnk.com", allowTestStub: false },
    inflight: new Map(),
    fetchDocument: async () => {
      calls.fetch += 1;
      return queue.shift() ?? doc(good());
    },
    fetchLogo: async () => {
      calls.logo += 1;
      return null;
    },
  };
  const resolveWith = (clientId: string, clientKey = "203.0.113.7") =>
    resolveClient(clientId, {
      store,
      now: store.now,
      loadCimdClient: (id) => loadCimdClientWith(id, clientKey, deps),
    });
  return { store, limiter, deps, calls, doc, resolveWith, queue };
}

describe("M10-08 the loader and the cache", () => {
  it("fetches once, stores the row with its window, and uses it with no request inside the lifetime", async () => {
    const t = loaderSetup({ docs: [] });
    t.queue.push(t.doc(good(), "max-age=7200"));
    const first = await t.resolveWith(URL_);
    expect(first).toMatchObject({
      ok: true,
      client: { client_name: "Example", kind: "cimd", client_id: URL_ },
    });
    expect(t.calls.fetch).toBe(1);
    const row = t.store.clients.get(URL_)!;
    expect(Date.parse(row.expires_at!) - Date.parse(row.fetched_at!)).toBe(7200_000);

    const limitCalls = t.limiter.calls.length;
    t.store.advance(7000);
    const second = await t.resolveWith(URL_);
    expect(second.ok).toBe(true);
    expect(t.calls.fetch).toBe(1);
    // A cached document costs no fetch and no count.
    expect(t.limiter.calls.length).toBe(limitCalls);
  });

  it("after the lifetime the next request fetches again", async () => {
    const t = loaderSetup();
    t.queue.push(t.doc(good(), "max-age=3600"), t.doc(good({ client_name: "Renamed" })));
    expect((await t.resolveWith(URL_)).ok).toBe(true);
    t.store.advance(3601);
    expect(await t.resolveWith(URL_)).toMatchObject({ ok: true, client: { client_name: "Renamed" } });
    expect(t.calls.fetch).toBe(2);
  });

  // Wave L review, finding 2: a client that connected before must not be locked out by a host that
  // is slow, down or rate limited for a minute. The expired row is used for up to a week.
  it.each([
    ["a timeout", { ok: false, reason: "timeout", host: "app.example.com" }],
    ["a network failure", { ok: false, reason: "network", host: "app.example.com" }],
    ["a bad status", { ok: false, reason: "bad_status", host: "app.example.com" }],
  ] as const)("%s on the refetch uses the expired document, for up to seven days", async (_n, failure) => {
    const t = loaderSetup();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    t.queue.push(t.doc(good()), failure, failure);
    expect((await t.resolveWith(URL_)).ok).toBe(true);
    t.store.advance(3601);
    const stale = await t.resolveWith(URL_);
    expect(stale).toMatchObject({ ok: true, client: { client_id: URL_, client_name: "Example" } });
    expect(t.calls.fetch).toBe(2);
    // The row is kept as it was: it is not renewed by a failure.
    expect(t.store.clients.get(URL_)!.expires_at).toBe(
      new Date(Date.UTC(2026, 9, 4, 12, 0, 0) + 3600_000).toISOString(),
    );
    // A week after it was fetched it is no longer used.
    t.store.advance(7 * 86400);
    expect(await t.resolveWith(URL_)).toEqual({
      ok: false,
      reason: "cannot_verify",
      transient: true,
    });
  });

  it("a successful refetch replaces the stale row", async () => {
    const t = loaderSetup();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    t.queue.push(
      t.doc(good({ client_name: "Old" })),
      { ok: false, reason: "timeout", host: "app.example.com" },
      t.doc(good({ client_name: "New" })),
    );
    await t.resolveWith(URL_);
    t.store.advance(3601);
    expect(await t.resolveWith(URL_)).toMatchObject({ client: { client_name: "Old" } });
    expect(await t.resolveWith(URL_)).toMatchObject({ client: { client_name: "New" } });
    expect(t.store.clients.get(URL_)!.client_name).toBe("New");
  });

  it.each([
    ["a document that is no longer valid", (t: ReturnType<typeof loaderSetup>) => t.doc(good({ redirect_uris: [] }))],
    ["a name posing as the product", (t: ReturnType<typeof loaderSetup>) => t.doc(good({ client_name: "HYDLNK Support" }))],
    ["an address that now fails the policy", () => ({ ok: false, reason: "ssrf_blocked", host: "app.example.com" }) as const],
    ["a redirect", () => ({ ok: false, reason: "redirected", host: "app.example.com" }) as const],
    ["a body that is too large", () => ({ ok: false, reason: "too_large", host: "app.example.com" }) as const],
    ["the wrong content type", () => ({ ok: false, reason: "bad_type", host: "app.example.com" }) as const],
  ])("%s on the refetch is refused: the expired document is not used", async (_n, refetch) => {
    const t = loaderSetup();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    t.queue.push(t.doc(good()), refetch(t));
    expect((await t.resolveWith(URL_)).ok).toBe(true);
    t.store.advance(3601);
    expect(await t.resolveWith(URL_)).toEqual({ ok: false, reason: "cannot_verify" });
  });

  // Wave L second review, finding 5: the expired copy stands in only for a host that cannot answer
  // (timeout, network, bad status). A caller that is rate limited is told to wait, copy or not.
  it("a refetch that is rate limited is told to wait, even when an expired copy is cached", async () => {
    const t = loaderSetup();
    // Everything but the address limit is spent.
    t.deps.limit = async (key) =>
      key.startsWith("cimd-ip:") ? { allowed: true, retryAfter: 0 } : { allowed: false, retryAfter: 30 };
    t.store.addClient(URL_, ["https://app.example.com/cb"], {
      fetched_at: new Date(t.store.clock - 2 * 86400_000).toISOString(),
      expires_at: new Date(t.store.clock - 60_000).toISOString(),
    });
    expect(await t.resolveWith(URL_)).toMatchObject({ ok: false, reason: "too_many", retryAfter: 30 });
    expect(t.calls.fetch).toBe(0);
    expect(await t.resolveWith("https://other.example.com/oauth/client.json")).toMatchObject({
      ok: false,
      reason: "too_many",
    });
  });

  it("an expired row that was fetched more than a week ago is not used even when the host cannot answer", async () => {
    const t = loaderSetup();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    t.queue.push({ ok: false, reason: "timeout", host: "app.example.com" });
    t.store.addClient(URL_, ["https://app.example.com/cb"], {
      fetched_at: new Date(t.store.clock - 8 * 86400_000).toISOString(),
      expires_at: new Date(t.store.clock - 7 * 86400_000).toISOString(),
    });
    expect(await t.resolveWith(URL_)).toMatchObject({ ok: false, reason: "cannot_verify" });
  });

  it("a registered client never goes through the stale path", async () => {
    const t = loaderSetup();
    expect(await t.resolveWith(`hlc_${"c".repeat(32)}`)).toEqual({ ok: false, reason: "unknown_app" });
  });

  it("errors and invalid documents are never stored or reused: a 500 then a valid document is fetched again on the very next request", async () => {
    const t = loaderSetup();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    t.queue.push(
      { ok: false, reason: "bad_status", host: "app.example.com" },
      t.doc(good({ redirect_uris: [] })),
      t.doc(good()),
    );
    // A bad status is the host's (transient); an empty redirect list is the document's.
    expect(await t.resolveWith(URL_)).toEqual({
      ok: false,
      reason: "cannot_verify",
      transient: true,
    });
    expect(t.store.clients.has(URL_)).toBe(false);
    expect(await t.resolveWith(URL_)).toEqual({ ok: false, reason: "cannot_verify" });
    expect(t.store.clients.has(URL_)).toBe(false);
    expect((await t.resolveWith(URL_)).ok).toBe(true);
    expect(t.calls.fetch).toBe(3);
    expect(t.calls.upserts).toBe(1);
  });

  it("a document that is not JSON or not UTF-8 is refused", async () => {
    const t = loaderSetup();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    t.queue.push(
      {
        ok: true,
        body: new TextEncoder().encode("{not json"),
        contentType: "application/json",
        cacheControl: null,
        host: "h",
      },
      {
        ok: true,
        body: new Uint8Array([0xff, 0xfe, 0xfd]),
        contentType: "application/json",
        cacheControl: null,
        host: "h",
      },
    );
    expect(await t.resolveWith(URL_)).toEqual({ ok: false, reason: "cannot_verify" });
    expect(await t.resolveWith(URL_)).toEqual({ ok: false, reason: "cannot_verify" });
  });

  it("two simultaneous first requests for one address share one fetch and write one row", async () => {
    const t = loaderSetup();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const slow = t.deps.fetchDocument!;
    t.deps.fetchDocument = async (address) => {
      await gate;
      return slow(address);
    };
    const both = Promise.all([t.resolveWith(URL_), t.resolveWith(URL_)]);
    await Promise.resolve();
    release();
    const [a, b] = await both;
    expect(a.ok && b.ok).toBe(true);
    expect(t.calls.fetch).toBe(1);
    expect(t.calls.upserts).toBe(1);
    expect(t.store.clients.size).toBe(1);
  });

  it("a changed document takes effect at the next fetch: a dropped redirect stops matching and the new name shows", async () => {
    const t = loaderSetup();
    t.queue.push(
      t.doc(
        good({
          client_name: "Old",
          redirect_uris: ["https://app.example.com/a", "https://app.example.com/b"],
        }),
      ),
    );
    const first = await t.resolveWith(URL_);
    expect(first.ok && first.client.redirect_uris).toHaveLength(2);
    t.store.advance(3601);
    t.queue.push(t.doc(good({ client_name: "New", redirect_uris: ["https://app.example.com/a"] })));
    const second = await t.resolveWith(URL_);
    expect(second).toMatchObject({
      ok: true,
      client: { client_name: "New", redirect_uris: ["https://app.example.com/a"] },
    });
  });

  it("grants and tokens already issued do not depend on the document: the token path never reads it", async () => {
    const t = loaderSetup();
    t.queue.push(t.doc(good()));
    await t.resolveWith(URL_);
    t.store.advance(86400 * 3);
    // The cache has expired and the host is "down": a getClient (what a token endpoint does) still answers.
    expect(await t.store.getClient(URL_)).toMatchObject({ client_name: "Example" });
    expect(t.calls.fetch).toBe(1);
  });

  it("a name posing as HYDLNK is invalid_client for a metadata document", async () => {
    const t = loaderSetup();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    t.queue.push(t.doc(good({ client_name: "HYDLNK Support" })));
    expect(await t.resolveWith(URL_)).toEqual({ ok: false, reason: "cannot_verify" });
    expect(t.store.clients.has(URL_)).toBe(false);
  });

  it("hydlnk in a metadata client's name is allowed only when every return address is on this computer", async () => {
    const t = loaderSetup();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    t.queue.push(
      t.doc(good({ client_name: "Claude Code (hydlnk)", redirect_uris: ["http://localhost:8080/cb"] })),
    );
    expect(await t.resolveWith(URL_)).toMatchObject({ ok: true, client: { client_name: "Claude Code (hydlnk)" } });
  });

  it("an address that fails the policy makes no fetch and no count", async () => {
    const t = loaderSetup();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    for (const address of [
      "https://127.0.0.1/x",
      "https://app.hydlnk.com/x",
      "https://localhost/x",
      "https://example.com/",
    ]) {
      expect(await t.resolveWith(address)).toEqual({ ok: false, reason: "cannot_verify" });
    }
    expect(t.calls.fetch).toBe(0);
    expect(t.limiter.calls).toEqual([]);
  });

  it("the logo is fetched only for a metadata document that names one, by the server, and its failure never blocks", async () => {
    const t = loaderSetup();
    t.queue.push(t.doc(good({ logo_uri: "https://app.example.com/logo.png" })));
    const result = await t.resolveWith(URL_);
    expect(result).toMatchObject({ ok: true, client: { logo_png: null } });
    expect(t.calls.logo).toBe(1);
    const none = loaderSetup();
    none.queue.push(none.doc(good()));
    await none.resolveWith(URL_);
    expect(none.calls.logo).toBe(0);
  });

  it("the three limits run before the lookup: 30 an address, 20 a host, 300 overall", async () => {
    expect([CIMD_PER_IP_PER_MINUTE, CIMD_PER_HOST_PER_MINUTE, CIMD_ALL_PER_MINUTE]).toEqual([
      30, 20, 300,
    ]);
    const base = loaderSetup();
    const t = loaderSetup({ limit: memoryLimiter(() => base.store.clock) });
    t.deps.limit = memoryLimiter(() => t.store.clock);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    // Distinct addresses on one host: the host limit (20) trips first.
    const ok: boolean[] = [];
    for (let i = 0; i < 21; i += 1) {
      const result = await t.resolveWith(`https://app.example.com/${i}/client.json`, `10.0.0.${i}`);
      ok.push(result.ok || result.reason !== "too_many");
    }
    expect(ok.slice(0, 20).every(Boolean)).toBe(true);
    const over = await t.resolveWith("https://app.example.com/over/client.json", "10.0.1.1");
    expect(over).toMatchObject({ ok: false, reason: "too_many" });
    expect((over as { retryAfter: number }).retryAfter).toBeGreaterThanOrEqual(1);
    // One address making 31 requests for different hosts: the address limit trips.
    const u = loaderSetup();
    u.deps.limit = memoryLimiter(() => u.store.clock);
    for (let i = 0; i < CIMD_PER_IP_PER_MINUTE; i += 1) {
      await u.resolveWith(`https://h${i}.example.com/client.json`, "10.9.9.9");
    }
    expect(await u.resolveWith("https://h99.example.com/client.json", "10.9.9.9")).toMatchObject({
      ok: false,
      reason: "too_many",
    });
    expect(
      await u.resolveWith("https://h99.example.com/client.json", "10.9.9.8"),
    ).not.toMatchObject({ reason: "too_many" });
  });

  // Wave L review, finding 2: any path on a host is a cache miss, so counting every miss against the
  // host and the whole service lets one caller spend the budget of the clients that matter most.
  it("the three known clients are counted against the caller's address only, never the host or the service", async () => {
    const t = loaderSetup();
    t.queue.push(t.doc(fixture("claude.json")));
    expect((await t.resolveWith(CLAUDE)).ok).toBe(true);
    expect(t.limiter.calls.map((call) => call.key)).toEqual(["cimd-ip:203.0.113.7"]);
    const code = loaderSetup();
    code.queue.push(code.doc(fixture("claude-code.json")));
    expect((await code.resolveWith(CLAUDE_CODE)).ok).toBe(true);
    expect(code.limiter.calls.map((call) => call.key)).toEqual(["cimd-ip:203.0.113.7"]);
    const gpt = loaderSetup();
    gpt.queue.push(gpt.doc(fixture("chatgpt.json")));
    expect((await gpt.resolveWith(CHATGPT)).ok).toBe(true);
    expect(gpt.limiter.calls.map((call) => call.key)).toEqual(["cimd-ip:203.0.113.7"]);
  });

  it("a host hammered with made-up paths cannot lock a known client out, and the made-up paths stay limited", async () => {
    const t = loaderSetup();
    t.deps.limit = memoryLimiter(() => t.store.clock);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    t.deps.fetchDocument = async (address) =>
      address === CLAUDE
        ? t.doc(fixture("claude.json"))
        : { ok: false, reason: "bad_status", host: "claude.ai" };
    for (let i = 0; i < 25; i += 1) {
      await t.resolveWith(`https://claude.ai/made-up/${i}`, `10.1.1.${i}`);
    }
    expect(await t.resolveWith("https://claude.ai/made-up/99", "10.3.3.3")).toMatchObject({
      ok: false,
      reason: "too_many",
    });
    expect((await t.resolveWith(CLAUDE, "10.2.2.2")).ok).toBe(true);
  });

  it("the service-wide limit does not stop a known client either, but it still stops an unknown one", async () => {
    const t = loaderSetup();
    t.deps.limit = async (key) =>
      key === "cimd-all" ? { allowed: false, retryAfter: 40 } : { allowed: true, retryAfter: 0 };
    t.queue.push(t.doc(fixture("chatgpt.json")));
    expect((await t.resolveWith(CHATGPT)).ok).toBe(true);
    expect(await t.resolveWith(URL_)).toMatchObject({ ok: false, reason: "too_many", retryAfter: 40 });
  });

  it("the caller's own address limit still applies to a known client", async () => {
    const t = loaderSetup();
    t.deps.limit = async (key) =>
      key.startsWith("cimd-ip:") ? { allowed: false, retryAfter: 9 } : { allowed: true, retryAfter: 0 };
    expect(await t.resolveWith(CLAUDE)).toMatchObject({ ok: false, reason: "too_many", retryAfter: 9 });
    expect(t.calls.fetch).toBe(0);
  });

  it("logs the reason and the host only: never the path, the body or an address", async () => {
    const t = loaderSetup();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    t.queue.push({ ok: false, reason: "ssrf_blocked", host: "app.example.com" });
    await t.resolveWith(URL_);
    const line = warn.mock.calls.map((call) => String(call[0])).join("\n");
    expect(line).toContain("ssrf_blocked");
    expect(line).toContain("app.example.com");
    expect(line).not.toContain("/oauth/client.json");
    expect(line).not.toMatch(/\d+\.\d+\.\d+\.\d+/);
  });
});

// ---------------------------------------------------------------------------------------------
// The logo path
// ---------------------------------------------------------------------------------------------

async function png(width: number, height: number, extra: (image: Sharp) => Sharp = (i) => i) {
  const image = sharp({
    create: { width, height, channels: 3, background: { r: 184, g: 145, b: 79 } },
  });
  return new Uint8Array(await extra(image).png().toBuffer());
}

describe("M10-38 unused metadata clients are capped", () => {
  it("trims the unused client rows to 5,000 (never the known clients) before storing a new one", async () => {
    const t = loaderSetup();
    expect((await t.resolveWith(URL_)).ok).toBe(true);
    expect(t.store.trimmedCimd).toEqual([{ cap: 5000, keep: KNOWN_CLIENT_IDS }]);
    expect(t.calls.upserts).toBe(1);
  });

  it("a known client is stored without a trim: it can never be one of the rows that goes", async () => {
    const t = loaderSetup();
    t.queue.push(
      t.doc(good({ client_id: CLAUDE, client_name: "Claude", redirect_uris: ["https://claude.ai/api/mcp/auth_callback"] })),
    );
    expect((await t.resolveWith(CLAUDE)).ok).toBe(true);
    expect(t.store.trimmedCimd).toEqual([]);
  });

  it("a trim that fails stores nothing and is a transient refusal", async () => {
    const t = loaderSetup();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    t.store.failNext = "trimUnusedCimd";
    expect(await t.resolveWith(URL_)).toEqual({ ok: false, reason: "cannot_verify", transient: true });
    expect(t.calls.upserts).toBe(0);
  });
});

describe("M10-09 logo hosts", () => {
  it.each([
    ["claude.ai", "claude.ai", true],
    ["cdn.claude.ai", "claude.ai", true],
    ["a.b.claude.ai", "claude.ai", true],
    ["evilclaude.ai", "claude.ai", false],
    ["claude.ai.evil.com", "claude.ai", false],
    ["claude.com", "claude.ai", false],
    ["persistent.oaistatic.com", "chatgpt.com", true],
    ["oaistatic.com", "chatgpt.com", false],
    ["persistent.oaistatic.com", "claude.ai", false],
    ["PERSISTENT.OAISTATIC.COM", "chatgpt.com", true],
  ])("a logo on %s for a client at %s is %s", (logo, client, safe) => {
    expect(isSafeLogoHost(logo, client)).toBe(safe);
  });

  it("the allow list holds exactly one entry, chatgpt.com to persistent.oaistatic.com", () => {
    expect(LOGO_HOST_ALLOWLIST).toEqual({ "chatgpt.com": ["persistent.oaistatic.com"] });
  });
});

describe("M10-09 re-encoding", () => {
  it("makes a 96x96 PNG of at most 20,480 bytes with no metadata, and different bytes from the source", async () => {
    const source = await png(300, 200, (image) =>
      image.withMetadata({ exif: { IFD0: { Copyright: "secret" } } }),
    );
    const out = await reencodeLogo(source);
    expect(out).not.toBeNull();
    const meta = await sharp(Buffer.from(out!)).metadata();
    expect(meta).toMatchObject({ format: "png", width: 96, height: 96 });
    expect(meta.exif).toBeUndefined();
    expect(out!.byteLength).toBeLessThanOrEqual(20_480);
    expect(Buffer.from(out!).equals(Buffer.from(source))).toBe(false);
    expect(Buffer.from(out!).includes(Buffer.from("tEXt"))).toBe(false);
    expect(Buffer.from(out!).includes(Buffer.from("secret"))).toBe(false);
  });

  it("takes JPEG and WebP, applying the orientation and dropping EXIF", async () => {
    const jpeg = new Uint8Array(
      await sharp({ create: { width: 128, height: 64, channels: 3, background: "#336699" } })
        .withMetadata({ orientation: 6 })
        .jpeg()
        .toBuffer(),
    );
    const webp = new Uint8Array(
      await sharp({ create: { width: 64, height: 64, channels: 4, background: "#336699" } })
        .webp()
        .toBuffer(),
    );
    for (const source of [jpeg, webp]) {
      const out = await reencodeLogo(source);
      expect(out).not.toBeNull();
      expect(await sharp(Buffer.from(out!)).metadata()).toMatchObject({
        format: "png",
        width: 96,
        height: 96,
      });
    }
  });

  it("refuses a picture under 32x32 or over 2,000x2,000, and anything that is not an image", async () => {
    expect(await reencodeLogo(await png(31, 64))).toBeNull();
    expect(await reencodeLogo(await png(64, 31))).toBeNull();
    expect(await reencodeLogo(await png(32, 32))).not.toBeNull();
    expect(await reencodeLogo(await png(2001, 40))).toBeNull();
    expect(
      await reencodeLogo(
        new TextEncoder().encode(
          '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"/>',
        ),
      ),
    ).toBeNull();
    expect(await reencodeLogo(new TextEncoder().encode("GIF89a"))).toBeNull();
    expect(await reencodeLogo(new Uint8Array(0))).toBeNull();
    expect(await reencodeLogo(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
  });

  it("a PNG header claiming 30,000x30,000 is refused without decoding", async () => {
    const real = await png(64, 64);
    const lying = Buffer.from(real);
    lying.writeUInt32BE(30_000, 16);
    lying.writeUInt32BE(30_000, 20);
    const decode = vi.spyOn(sharp.prototype, "toBuffer");
    expect(await reencodeLogo(new Uint8Array(lying))).toBeNull();
    expect(decode).not.toHaveBeenCalled();
    decode.mockRestore();
  });

  it("a corrupt image that passes the header check ends as null, not an error", async () => {
    const real = Buffer.from(await png(64, 64));
    real.fill(0, 60, 120);
    expect(await reencodeLogo(new Uint8Array(real))).toBeNull();
  });
});

describe("M10-09 loadLogo", () => {
  const fetchDeps = { rootDomain: "hydlnk.com", allowTestStub: false };

  it("never requests a logo on an unsafe host", async () => {
    const transport = vi.fn();
    const result = await loadLogo("https://evil.example.org/logo.png", "claude.ai", {
      ...fetchDeps,
      resolve: async () => ["93.184.216.34"],
      transport,
    });
    expect(result).toBeNull();
    expect(transport).not.toHaveBeenCalled();
  });

  it("fetches a safe logo through the same fetch function and returns the re-encoded PNG", async () => {
    const source = await png(200, 200);
    const asked: string[] = [];
    const transport = vi.fn(async (target: FetchTarget) => {
      asked.push(target.hostname);
      return {
        status: 200,
        headers: { "content-type": "image/png" },
        chunks: (async function* () {
          yield source;
        })(),
        destroy: () => undefined,
      };
    });
    const result = await loadLogo("https://cdn.example.org/logo.png", "example.org", {
      ...fetchDeps,
      resolve: async () => ["93.184.216.34"],
      transport,
    });
    expect(result).not.toBeNull();
    expect(await sharp(Buffer.from(result!)).metadata()).toMatchObject({ width: 96, height: 96 });
    expect(asked).toEqual(["cdn.example.org"]);
    expect(transport.mock.calls[0]![0].headers.Accept).toBe("image/png, image/jpeg, image/webp");
  });

  it("refuses an SVG and a response that is not an image type, whatever its bytes", async () => {
    for (const type of ["image/svg+xml", "text/html", "application/octet-stream", "image/gif"]) {
      const transport = async () => ({
        status: 200,
        headers: { "content-type": type },
        chunks: (async function* () {
          yield await png(64, 64);
        })(),
        destroy: () => undefined,
      });
      expect(
        await loadLogo("https://cdn.example.org/logo", "example.org", {
          ...fetchDeps,
          resolve: async () => ["93.184.216.34"],
          transport,
        }),
      ).toBeNull();
    }
  });

  it("takes the real type from the bytes, not the header: an SVG sent as image/png is refused", async () => {
    const transport = async () => ({
      status: 200,
      headers: { "content-type": "image/png" },
      chunks: (async function* () {
        yield new TextEncoder().encode(
          '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"></svg>',
        );
      })(),
      destroy: () => undefined,
    });
    expect(
      await loadLogo("https://cdn.example.org/logo.png", "example.org", {
        ...fetchDeps,
        resolve: async () => ["93.184.216.34"],
        transport,
      }),
    ).toBeNull();
  });

  it("a logo over 100 KB is refused", async () => {
    const big = new Uint8Array(100 * 1024 + 1);
    big.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const transport = async () => ({
      status: 200,
      headers: { "content-type": "image/png" },
      chunks: (async function* () {
        yield big;
      })(),
      destroy: () => undefined,
    });
    expect(
      await loadLogo("https://cdn.example.org/logo.png", "example.org", {
        ...fetchDeps,
        resolve: async () => ["93.184.216.34"],
        transport,
      }),
    ).toBeNull();
  });
});

beforeEach(() => vi.restoreAllMocks());
