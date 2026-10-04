import { describe, expect, it, vi } from "vitest";
import {
  REGISTER_MAX_BODY_BYTES,
  REGISTER_PER_IP_PER_HOUR,
  newDcrClientId,
  registerClient,
  type RegisterDeps,
} from "@/lib/oauth/register";
import { UNUSED_DCR_CAP } from "@/lib/oauth/constants";
import { sha256Hex } from "@/lib/oauth/tokens";
import { verifyAccessToken } from "@/lib/oauth/verify";
import { DCR_ID, RESOURCE, USER, connect, harness } from "./helpers/oauth-flow";
import { FakeOauthStore, memoryLimiter, openLimiter } from "./helpers/oauth-fake-store";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/oauth/config", () => ({
  oauthConfig: () => ({ resource: "http://app.localhost:3000/mcp" }),
}));
vi.mock("@/lib/oauth/store-supabase", () => ({ defaultOauthStore: () => ({}) }));
vi.mock("next/server", () => ({
  after: () => {
    throw new Error("outside a request");
  },
}));

/**
 * M10-10 (registration), M10-17 (revocation) and M10-04's bearer lookup (`verifyAccessToken`).
 */

function register(
  json: unknown,
  over: {
    mediaType?: string;
    limit?: RegisterDeps["limit"];
    store?: FakeOauthStore;
    clientKey?: string;
    raw?: string;
    rootDomain?: string;
  } = {},
) {
  const store = over.store ?? new FakeOauthStore();
  const text = over.raw ?? JSON.stringify(json);
  return {
    store,
    result: registerClient(
      {
        clientKey: over.clientKey ?? "203.0.113.7",
        mediaType: over.mediaType ?? "application/json",
        readBody: async () =>
          new TextEncoder().encode(text).length > REGISTER_MAX_BODY_BYTES
            ? { ok: false as const, reason: "too_large" as const }
            : { ok: true as const, text },
      },
      {
        store,
        limit: over.limit ?? openLimiter().limit,
        now: () => store.clock,
        ...(over.rootDomain ? { rootDomain: over.rootDomain } : {}),
      },
    ),
  };
}

const body = (result: { body: unknown }) => result.body as Record<string, unknown>;

describe("M10-10 registration", () => {
  it("registers a public client: 201 with the fields of the spec and no secret", async () => {
    const { result, store } = register({
      redirect_uris: ["https://a.example/cb"],
      client_name: "My App",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    });
    const out = await result;
    expect(out.status).toBe(201);
    expect(out.headers["Cache-Control"]).toBe("no-store");
    const created = body(out);
    expect(created).toEqual({
      client_id: expect.stringMatching(/^hlc_[0-9a-f]{32}$/),
      client_id_issued_at: Math.floor(store.clock / 1000),
      redirect_uris: ["https://a.example/cb"],
      client_name: "My App",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: "hydlnk.read hydlnk.write hydlnk.publish",
    });
    expect(created).not.toHaveProperty("client_secret");
    expect(created).not.toHaveProperty("registration_access_token");
    expect(created).not.toHaveProperty("registration_client_uri");
    expect(store.clients.get(created.client_id as string)).toMatchObject({
      kind: "dcr",
      client_name: "My App",
      redirect_uris: ["https://a.example/cb"],
    });
  });

  it("defaults: no name is 'Unnamed app', no grant_types means both, ignored members are never stored", async () => {
    const { result, store } = register({
      redirect_uris: ["http://localhost/cb"],
      scope: "everything",
      application_type: "native",
      contacts: ["a@b.example"],
      tos_uri: "https://tos.example",
      policy_uri: "https://policy.example",
      client_uri: "https://client.example",
      logo_uri: "https://logo.example/x.png",
      jwks: { keys: [] },
      jwks_uri: "https://jwks.example",
      software_statement: "eyJ.x.y",
      __proto__: { polluted: true },
      mystery: 1,
    });
    const out = await result;
    expect(out.status).toBe(201);
    expect(body(out).client_name).toBe("Unnamed app");
    expect(body(out).grant_types).toEqual(["authorization_code", "refresh_token"]);
    const row = store.clients.get(body(out).client_id as string)!;
    expect(JSON.stringify(row)).not.toMatch(/logo\.example|jwks|tos\.example|everything|software/);
    expect(row.logo_png).toBeNull();
  });

  it("the grant_types an app asks for are narrowed to what is supported, and the response says what was kept", async () => {
    const kept = await register({
      redirect_uris: ["https://a.example/cb"],
      grant_types: ["authorization_code", "urn:ietf:params:oauth:grant-type:jwt-bearer"],
    }).result;
    expect(body(kept).grant_types).toEqual(["authorization_code"]);
    const none = await register({
      redirect_uris: ["https://a.example/cb"],
      grant_types: ["refresh_token"],
    }).result;
    expect(none.status).toBe(400);
    expect(body(none).error).toBe("invalid_client_metadata");
    const implicit = await register({
      redirect_uris: ["https://a.example/cb"],
      grant_types: ["implicit"],
    }).result;
    expect(body(implicit).error).toBe("invalid_client_metadata");
  });

  it.each([
    ["no redirect_uris", { client_name: "x" }, "invalid_redirect_uri"],
    ["empty redirect_uris", { redirect_uris: [] }, "invalid_redirect_uri"],
    ["a custom scheme", { redirect_uris: ["cursor://x"] }, "invalid_redirect_uri"],
    [
      "one bad entry",
      { redirect_uris: ["https://a.example/cb", "http://example.com/cb"] },
      "invalid_redirect_uri",
    ],
    [
      "eleven URIs",
      { redirect_uris: Array.from({ length: 11 }, (_, i) => `https://a.example/${i}`) },
      "invalid_redirect_uri",
    ],
    [
      "a client secret method",
      {
        redirect_uris: ["https://a.example/cb"],
        token_endpoint_auth_method: "client_secret_basic",
      },
      "invalid_client_metadata",
    ],
    [
      "private_key_jwt",
      { redirect_uris: ["https://a.example/cb"], token_endpoint_auth_method: "private_key_jwt" },
      "invalid_client_metadata",
    ],
    [
      "response_types without code",
      { redirect_uris: ["https://a.example/cb"], response_types: ["token"] },
      "invalid_client_metadata",
    ],
    [
      "a name posing as the product",
      { redirect_uris: ["https://a.example/cb"], client_name: "HYDLNK Support" },
      "invalid_client_metadata",
    ],
    [
      "a non-text name",
      { redirect_uris: ["https://a.example/cb"], client_name: 5 },
      "invalid_client_metadata",
    ],
    [
      "a grant_types that is not a list",
      { redirect_uris: ["https://a.example/cb"], grant_types: "authorization_code" },
      "invalid_client_metadata",
    ],
  ])("refuses %s with a 400 JSON error", async (_name, json, error) => {
    const out = await register(json).result;
    expect(out.status).toBe(400);
    expect(body(out)).toEqual({ error, error_description: expect.any(String) });
  });

  it("the HYDLNK name refusal says why", async () => {
    const out = await register({
      redirect_uris: ["https://a.example/cb"],
      client_name: "H-Y-D-L-N-K",
    }).result;
    expect(body(out).error_description).toBe("The name can’t include HYDLNK.");
  });

  it("malformed JSON, a non-object and an array are invalid_client_metadata", async () => {
    for (const raw of ["{not json", "[]", '"text"', "null", "5"]) {
      const out = await register(null, { raw }).result;
      expect(out.status).toBe(400);
      expect(body(out).error).toBe("invalid_client_metadata");
    }
  });

  it("takes application/json only (415), and a body of at most 8 KB (413)", async () => {
    const wrong = await register(
      { redirect_uris: ["https://a.example/cb"] },
      { mediaType: "application/x-www-form-urlencoded" },
    ).result;
    expect(wrong.status).toBe(415);
    expect(body(wrong)).toMatchObject({ error: "invalid_request" });
    const big = await register(null, {
      raw: JSON.stringify({
        redirect_uris: ["https://a.example/cb"],
        pad: "x".repeat(REGISTER_MAX_BODY_BYTES),
      }),
    }).result;
    expect(big.status).toBe(413);
  });

  it("is limited to 20 an hour per address and 300 an hour overall: 429 temporarily_unavailable with Retry-After", async () => {
    const store = new FakeOauthStore();
    const limit = memoryLimiter(store.now);
    for (let i = 0; i < REGISTER_PER_IP_PER_HOUR; i += 1) {
      expect(
        (await register({ redirect_uris: ["https://a.example/cb"] }, { store, limit }).result)
          .status,
      ).toBe(201);
    }
    const over = await register({ redirect_uris: ["https://a.example/cb"] }, { store, limit })
      .result;
    expect(over.status).toBe(429);
    expect(body(over).error).toBe("temporarily_unavailable");
    expect(Number(over.headers["Retry-After"])).toBeGreaterThanOrEqual(1);
    // Another address is unaffected.
    expect(
      (
        await register(
          { redirect_uris: ["https://a.example/cb"] },
          { store, limit, clientKey: "198.51.100.1" },
        ).result
      ).status,
    ).toBe(201);

    // There is no overall bucket (Wave L review): it was one budget for every caller, so about fifteen
    // addresses could spend it and keep every real client's fallback registration at a 429 for the hour.
    // Storage is bounded by the 20,000-row trim and the nightly purge instead.
    const wide = new FakeOauthStore();
    const keys: string[] = [];
    const inner = memoryLimiter(wide.now);
    const wideLimit: RegisterDeps["limit"] = async (key, max, window) => {
      keys.push(key);
      return inner(key, max, window);
    };
    for (let i = 0; i < 400; i += 1) {
      const result = await register(
        { redirect_uris: ["https://a.example/cb"] },
        { store: wide, limit: wideLimit, clientKey: `192.0.2.${Math.floor(i / 15)}.${i % 15}` },
      ).result;
      expect(result.status).toBe(201);
    }
    expect(keys.every((key) => key.startsWith("oauth-register:"))).toBe(true);
    expect(keys).not.toContain("oauth-register-all");
  });

  it("makes room first: it trims unused registrations at the cap, and a limiter failure fails open", async () => {
    const store = new FakeOauthStore();
    await register({ redirect_uris: ["https://a.example/cb"] }, { store }).result;
    expect(store.trimmed).toEqual([UNUSED_DCR_CAP]);
    expect(UNUSED_DCR_CAP).toBe(20000);
  });

  // Wave L review, finding 4: a registered app cannot call itself Claude on a consent screen.
  it.each([
    ["Claude", "https://evil.example/cb"],
    ["Claude Code (my server)", "https://claude-ai.app/cb"],
    ["C-l-a-u-d-e", "https://a.example/cb"],
    ["ChatGPT", "https://claude.ai/api/mcp/auth_callback"],
    ["OpenAI Connector", "https://a.example/cb"],
    ["Anthropic Support", "https://a.example/cb"],
    ["ＣＬＡＵＤＥ", "https://a.example/cb"],
  ])("refuses the name %j with the return address %s", async (name, redirect) => {
    const { result, store } = register({ redirect_uris: [redirect], client_name: name });
    const out = await result;
    expect(out.status).toBe(400);
    expect(body(out).error).toBe("invalid_client_metadata");
    expect(String(body(out).error_description)).toMatch(/Claude, Anthropic, ChatGPT or OpenAI/);
    expect(store.clients.size).toBe(0);
  });

  it.each([
    ["Claude", ["https://claude.ai/api/mcp/auth_callback"]],
    ["Claude Code (my server)", ["http://localhost:51234/callback"]],
    ["Claude Code", ["http://localhost/callback", "http://127.0.0.1/callback"]],
    ["ChatGPT", ["https://chatgpt.com/connector_platform_oauth_redirect"]],
    ["Notes for people who like pelicans", ["https://a.example/cb"]],
  ])("accepts the name %j when it returns where that name lives", async (name, redirects) => {
    const { result } = register({ redirect_uris: redirects, client_name: name });
    expect((await result).status).toBe(201);
  });

  it("refuses a return address on this product's own hosts, and accepts a look-alike", async () => {
    for (const bad of [
      "https://hydlnk.com/cb",
      "https://mara.hydlnk.com/cb",
      "https://app.hydlnk.com/oauth/consent",
      "https://HYDLNK.COM/cb",
    ]) {
      const out = await register({ redirect_uris: [bad] }, { rootDomain: "hydlnk.com" }).result;
      expect(out.status, bad).toBe(400);
      expect(body(out).error, bad).toBe("invalid_redirect_uri");
    }
    for (const good of [
      "https://nothydlnk.com/cb",
      "https://hydlnk.com.evil.example/cb",
      "http://localhost:3000/cb",
    ]) {
      const out = await register({ redirect_uris: [good] }, { rootDomain: "hydlnk.com" }).result;
      expect(out.status, good).toBe(201);
    }
    // A list is refused as a whole.
    const mixed = await register(
      { redirect_uris: ["https://a.example/cb", "https://x.hydlnk.com/cb"] },
      { rootDomain: "hydlnk.com" },
    ).result;
    expect(mixed.status).toBe(400);
  });

  it("a store failure is a 500 that names nothing", async () => {
    const store = new FakeOauthStore();
    store.failNext = "insertDcrClient";
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const out = await register({ redirect_uris: ["https://a.example/cb"] }, { store }).result;
    expect(out.status).toBe(500);
    expect(JSON.stringify(out.body)).not.toMatch(/XX000|insertDcrClient/);
  });

  it("makes a client id of hlc_ and 32 lowercase hex characters from the CSPRNG", () => {
    const ids = new Set(Array.from({ length: 500 }, () => newDcrClientId()));
    expect(ids.size).toBe(500);
    for (const id of ids) expect(id).toMatch(/^hlc_[0-9a-f]{32}$/);
  });
});

describe("M10-17 revocation", () => {
  it("revoking a live token of that client ends the whole grant, whichever token was sent", async () => {
    for (const which of ["access_token", "refresh_token"] as const) {
      const h = harness();
      const t = await connect(h);
      const out = await h.revoke({ token: t[which], client_id: DCR_ID, token_type_hint: which });
      expect(out.status).toBe(200);
      expect(out.body).toBeUndefined();
      expect(out.headers["Cache-Control"]).toBe("no-store");
      expect(await h.store.verifyAccessToken(sha256Hex(t.access_token), RESOURCE)).toBeNull();
      const refreshed = await h.token({
        grant_type: "refresh_token",
        refresh_token: t.refresh_token,
        client_id: DCR_ID,
      });
      expect(body(refreshed).error).toBe("invalid_grant");
      expect(h.store.grants[0]!.revokedAt).not.toBeNull();
    }
  });

  it("answers 200 and changes nothing for an unknown token, another client's id, a wrong hint and a junk value", async () => {
    const h = harness();
    h.store.addClient(`hlc_${"f".repeat(32)}`, ["https://a.example/cb"]);
    const t = await connect(h);
    for (const form of [
      { token: `hl_at_${"A".repeat(43)}`, client_id: DCR_ID },
      { token: t.access_token, client_id: `hlc_${"f".repeat(32)}` },
      { token: t.access_token, client_id: DCR_ID, token_type_hint: "bogus" },
      { token: "x".repeat(300), client_id: DCR_ID },
      { token: "has space inside", client_id: DCR_ID },
    ]) {
      const res = await h.revoke(form);
      expect(res.status).toBe(200);
    }
    // The wrong-hint one DID end it (the hint is advisory): rebuild to check the others alone.
    const h2 = harness();
    h2.store.addClient(`hlc_${"f".repeat(32)}`, ["https://a.example/cb"]);
    const u = await connect(h2);
    for (const form of [
      { token: `hl_at_${"A".repeat(43)}`, client_id: DCR_ID },
      { token: u.access_token, client_id: `hlc_${"f".repeat(32)}` },
      { token: "x".repeat(300), client_id: DCR_ID },
    ]) {
      expect((await h2.revoke(form)).status).toBe(200);
    }
    expect(h2.store.grants[0]!.revokedAt).toBeNull();
    expect(await h2.store.verifyAccessToken(sha256Hex(u.access_token), RESOURCE)).not.toBeNull();
  });

  it("a missing token is 400 invalid_request; a repeated one too; JSON is 415", async () => {
    const h = harness();
    expect(body(await h.revoke({ client_id: DCR_ID })).error).toBe("invalid_request");
    const { handleRevokeRequest } = await import("@/lib/oauth/revoke");
    const repeated = await handleRevokeRequest(
      {
        clientKey: "k",
        mediaType: "application/x-www-form-urlencoded",
        authorization: null,
        readBody: async () => ({ ok: true as const, text: "token=a&token=b&client_id=x" }),
      },
      h.revokeDeps,
    );
    expect(repeated.status).toBe(400);
    const json = await handleRevokeRequest(
      {
        clientKey: "k",
        mediaType: "application/json",
        authorization: null,
        readBody: async () => ({ ok: true as const, text: "{}" }),
      },
      h.revokeDeps,
    );
    expect(json.status).toBe(415);
    const large = await handleRevokeRequest(
      {
        clientKey: "k",
        mediaType: "application/x-www-form-urlencoded",
        authorization: null,
        readBody: async () => ({ ok: false as const, reason: "too_large" as const }),
      },
      h.revokeDeps,
    );
    expect(large.status).toBe(413);
  });

  it("is limited to 60 a minute per address", async () => {
    const base = harness();
    const h = harness({ limit: memoryLimiter(() => base.store.clock) });
    for (let i = 0; i < 60; i += 1)
      expect((await h.revoke({ token: "a", client_id: DCR_ID })).status).toBe(200);
    const limited = await h.revoke({ token: "a", client_id: DCR_ID });
    expect(limited.status).toBe(429);
    expect(limited.headers["Retry-After"]).toBeDefined();
  });
});

describe("M10-04 verifyAccessToken", () => {
  const verify = (
    h: ReturnType<typeof harness>,
    token: string,
    over: { defer?: (work: () => Promise<unknown>) => void } = {},
  ) =>
    verifyAccessToken(token, {
      store: h.store,
      resource: RESOURCE,
      now: h.store.now,
      defer: over.defer ?? ((work) => void work()),
    });

  it("returns the user, client, grant, scopes and token id of a live access token, and nothing secret", async () => {
    const h = harness();
    const t = await connect(h, { scopes: ["hydlnk.write"] });
    const auth = await verify(h, t.access_token);
    expect(auth).toEqual({
      userId: USER.id,
      clientId: DCR_ID,
      grantId: h.store.grants[0]!.id,
      scopes: ["hydlnk.read", "hydlnk.write"],
      tokenId: h.store.tokens.find((x) => x.kind === "access")!.id,
      expiresAt: Math.floor((h.store.clock + 3600_000) / 1000),
    });
    expect(JSON.stringify(auth)).not.toContain(t.access_token);
  });

  it("returns null for every credential that never works", async () => {
    const h = harness();
    const t = await connect(h);
    const flip = t.access_token.slice(0, -1) + (t.access_token.endsWith("A") ? "B" : "A");
    const bad = [
      "",
      `hl_at_${"A".repeat(43)}`,
      "x".repeat(43),
      flip,
      t.refresh_token,
      t.code,
      "x".repeat(257),
      `${t.access_token}é`,
      `${t.access_token} extra`,
      "has space",
    ];
    for (const token of bad) expect(await verify(h, token)).toBeNull();
    expect(await verify(h, t.access_token)).not.toBeNull();

    h.store.advance(3601);
    expect(await verify(h, t.access_token)).toBeNull();
  });

  it("rejects a revoked token, a revoked grant and a token for another resource", async () => {
    const h = harness();
    const t = await connect(h);
    const row = h.store.tokens.find((x) => x.kind === "access")!;
    row.resource = "http://app.localhost:3000/other";
    expect(await verify(h, t.access_token)).toBeNull();
    row.resource = RESOURCE;
    row.revokedAt = h.store.clock;
    expect(await verify(h, t.access_token)).toBeNull();
    row.revokedAt = null;
    h.store.grants[0]!.revokedAt = h.store.clock;
    expect(await verify(h, t.access_token)).toBeNull();
  });

  it("never throws for a bad token and hashes before it asks: the plaintext is never queried", async () => {
    const h = harness();
    const t = await connect(h);
    const spy = vi.spyOn(h.store, "verifyAccessToken");
    await verify(h, t.access_token);
    expect(spy).toHaveBeenCalledWith(sha256Hex(t.access_token), RESOURCE);
    expect(JSON.stringify(spy.mock.calls)).not.toContain(t.access_token);
    // Oversized and non-ASCII values are refused before hashing.
    spy.mockClear();
    await verify(h, "x".repeat(257));
    await verify(h, "ééé");
    expect(spy).not.toHaveBeenCalled();
  });

  it("records use cheaply: ten calls inside a minute write once, and a later minute writes again", async () => {
    const h = harness();
    const t = await connect(h);
    for (let i = 0; i < 10; i += 1) {
      await verify(h, t.access_token);
      h.store.advance(5);
    }
    expect(h.store.touches).toHaveLength(1);
    h.store.advance(120);
    await verify(h, t.access_token);
    expect(h.store.touches).toHaveLength(2);
    expect(h.store.grants[0]!.lastUsedAt).not.toBeNull();
  });

  it("the write never fails the request: a failing touch is swallowed", async () => {
    const h = harness();
    const t = await connect(h);
    h.store.touchToken = async () => {
      throw new Error("touch failed");
    };
    const auth = await verifyAccessToken(t.access_token, {
      store: h.store,
      resource: RESOURCE,
      now: h.store.now,
      defer: (work) => void work().catch(() => undefined),
    });
    expect(auth).not.toBeNull();
  });
});
