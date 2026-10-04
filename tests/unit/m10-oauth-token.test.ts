import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ACCESS_TOKEN_SECONDS,
  OAUTH_CODE_SECONDS,
  REFRESH_FAMILY_MAX_SECONDS,
  REFRESH_IDLE_SECONDS,
} from "@/lib/oauth/constants";
import { basicNamesClient, TOKEN_MAX_BODY_BYTES } from "@/lib/oauth/token";
import { generateToken, sha256Hex } from "@/lib/oauth/tokens";
import {
  DCR_ID,
  REDIRECT,
  RESOURCE,
  USER,
  allow,
  connect,
  harness,
  pkce,
  type Harness,
} from "./helpers/oauth-flow";
import { memoryLimiter } from "./helpers/oauth-fake-store";

/**
 * M10-15 and M10-16: the token endpoint. The authorization code grant with PKCE, resource binding,
 * 60-second single-use codes; refresh tokens with rotation, reuse detection and expiry. Pure core,
 * in-memory store, fake clock.
 */

afterEach(() => vi.restoreAllMocks());

const body = (result: { body: unknown }) => result.body as Record<string, unknown>;

async function issueCode(h: Harness, options: Parameters<typeof allow>[1] = {}) {
  const { verifier, challenge } = pkce();
  const { code } = await allow(h, { ...options, challenge });
  return { code: code!, verifier };
}

const exchange = (
  h: Harness,
  code: string,
  verifier: string,
  over: Record<string, string | undefined> = {},
) =>
  h.token({
    grant_type: "authorization_code",
    code,
    redirect_uri: REDIRECT,
    client_id: DCR_ID,
    code_verifier: verifier,
    ...over,
  });

describe("M10-15 the authorization code grant", () => {
  it("answers 200 with the tokens, expires_in, the granted scope and no-store headers", async () => {
    const h = harness();
    const { code, verifier } = await issueCode(h, { scopes: ["hydlnk.write"] });
    const result = await exchange(h, code, verifier);
    expect(result.status).toBe(200);
    expect(result.headers).toMatchObject({ "Cache-Control": "no-store", Pragma: "no-cache" });
    const out = body(result);
    expect(out).toEqual({
      access_token: expect.stringMatching(/^hl_at_[A-Za-z0-9_-]{43}$/),
      token_type: "Bearer",
      expires_in: 3600,
      refresh_token: expect.stringMatching(/^hl_rt_[A-Za-z0-9_-]{43}$/),
      scope: "hydlnk.read hydlnk.write",
    });
  });

  it("the scope always lists what was granted, even when it equals what was asked", async () => {
    const h = harness();
    const { code, verifier } = await issueCode(h, { scopes: ["hydlnk.write", "hydlnk.publish"] });
    expect(body(await exchange(h, code, verifier)).scope).toBe(
      "hydlnk.read hydlnk.write hydlnk.publish",
    );
  });

  it("stores only hashes of the whole token strings, with the user, grant, scopes and resource", async () => {
    const h = harness();
    const done = await connect(h);
    const access = h.store.tokens.find((t) => t.kind === "access")!;
    const refresh = h.store.tokens.find((t) => t.kind === "refresh")!;
    expect(access.hash).toBe(sha256Hex(done.access_token));
    expect(refresh.hash).toBe(sha256Hex(done.refresh_token));
    expect(JSON.stringify(h.store.tokens)).not.toContain(done.access_token);
    expect(JSON.stringify(h.store.tokens)).not.toContain(done.refresh_token);
    expect(access).toMatchObject({ userId: USER.id, resource: RESOURCE });
    expect(access.expiresAt - h.store.clock).toBe(ACCESS_TOKEN_SECONDS * 1000);
    expect(refresh.expiresAt - h.store.clock).toBe(REFRESH_IDLE_SECONDS * 1000);
  });

  it("the lifetimes are the pinned constants", () => {
    expect(OAUTH_CODE_SECONDS).toBe(60);
    expect(ACCESS_TOKEN_SECONDS).toBe(3600);
    expect(REFRESH_IDLE_SECONDS).toBe(60 * 86400);
    expect(REFRESH_FAMILY_MAX_SECONDS).toBe(365 * 86400);
    expect(TOKEN_MAX_BODY_BYTES).toBe(16 * 1024);
  });

  it("a 59-second-old code works and a 61-second-old one does not", async () => {
    const fresh = harness();
    const a = await issueCode(fresh);
    fresh.store.advance(59);
    expect((await exchange(fresh, a.code, a.verifier)).status).toBe(200);
    const late = harness();
    const b = await issueCode(late);
    late.store.advance(61);
    const result = await exchange(late, b.code, b.verifier);
    expect(result.status).toBe(400);
    expect(body(result).error).toBe("invalid_grant");
  });

  it("every failure of the code checks is the same invalid_grant with the same words", async () => {
    const h = harness();
    const { code, verifier } = await issueCode(h);
    const other = pkce();
    h.store.addClient(`hlc_${"c".repeat(32)}`, [REDIRECT]);
    const attempts = [
      exchange(h, code, other.verifier),
      exchange(h, code, verifier, { redirect_uri: "https://a.example/other" }),
      exchange(h, code, verifier, { redirect_uri: `${REDIRECT}/` }),
      exchange(h, code, verifier, { client_id: `hlc_${"c".repeat(32)}` }),
      exchange(h, `hl_ac_${"A".repeat(43)}`, verifier),
      exchange(h, "garbage", verifier),
      exchange(h, code, "short"),
      exchange(h, code, `${verifier}!`),
    ];
    const results = await Promise.all(attempts);
    for (const result of results) {
      expect(result.status).toBe(400);
      expect(body(result)).toEqual({
        error: "invalid_grant",
        error_description: "The code or the refresh token isn’t valid.",
      });
    }
    // None of those used the code up: the right request still works.
    expect((await exchange(h, code, verifier)).status).toBe(200);
  });

  it("the verifier is compared as the S256 of itself, in 43 to 128 characters of the allowed alphabet", async () => {
    const h = harness();
    const long = pkce("L".repeat(128));
    const { code } = await allow(h, { challenge: long.challenge });
    expect((await exchange(h, code!, long.verifier)).status).toBe(200);
    const tooLong = {
      verifier: "M".repeat(129),
      challenge: createHash("sha256").update("M".repeat(129)).digest("base64url"),
    };
    expect(tooLong.verifier.length).toBe(129);
    const h2 = harness();
    const second = await allow(h2, { challenge: tooLong.challenge });
    expect(body(await exchange(h2, second.code!, tooLong.verifier)).error).toBe("invalid_grant");
  });

  it("required parameters are named: code, redirect_uri, client_id and code_verifier", async () => {
    const h = harness();
    const { code, verifier } = await issueCode(h);
    for (const missing of ["code", "redirect_uri", "code_verifier"] as const) {
      const form: Record<string, string | undefined> = {
        code,
        redirect_uri: REDIRECT,
        code_verifier: verifier,
      };
      form[missing] = undefined;
      const result = await h.token({
        grant_type: "authorization_code",
        client_id: DCR_ID,
        ...form,
      });
      expect(result.status).toBe(400);
      expect(body(result).error).toBe("invalid_request");
    }
    const noClient = await h.token({
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT,
      code_verifier: verifier,
    });
    expect(body(noClient).error).toBe("invalid_request");
  });

  it("resource, when sent, must be the canonical URL (invalid_target); it may be omitted", async () => {
    const h = harness();
    const { code, verifier } = await issueCode(h);
    for (const resource of [
      "https://app.hydlnk.com/mcp",
      `${RESOURCE}/`,
      "HTTP://APP.LOCALHOST:3000/mcp/x",
    ]) {
      const result = await exchange(h, code, verifier, { resource });
      expect(body(result).error).toBe("invalid_target");
    }
    expect(
      (await exchange(h, code, verifier, { resource: "HTTP://APP.LOCALHOST:3000/mcp" })).status,
    ).toBe(200);
    const again = await issueCode(h);
    expect((await exchange(h, again.code, again.verifier)).status).toBe(200);
  });

  it("an unknown client is invalid_client", async () => {
    const h = harness();
    const { code, verifier } = await issueCode(h);
    const result = await exchange(h, code, verifier, { client_id: `hlc_${"d".repeat(32)}` });
    expect(result.status).toBe(400);
    expect(body(result).error).toBe("invalid_client");
  });
});

describe("M10-15 client authentication is none", () => {
  it("a client_secret in the body is invalid_client", async () => {
    const h = harness();
    const { code, verifier } = await issueCode(h);
    const result = await exchange(h, code, verifier, { client_secret: "s3cret" });
    expect(body(result).error).toBe("invalid_client");
    expect((await exchange(h, code, verifier)).status).toBe(200);
  });

  it("a Basic header is accepted only when its user name is the client_id and the password is empty", async () => {
    const basic = (text: string) => `Basic ${Buffer.from(text).toString("base64")}`;
    const h = harness();
    const a = await issueCode(h);
    expect((await exchange(h, a.code, a.verifier, {}).then(() => 0)) ?? 0).toBe(0);
    const h2 = harness();
    const b = await issueCode(h2);
    const ok = await h2.token(
      {
        grant_type: "authorization_code",
        code: b.code,
        redirect_uri: REDIRECT,
        client_id: DCR_ID,
        code_verifier: b.verifier,
      },
      { authorization: basic(`${DCR_ID}:`) },
    );
    expect(ok.status).toBe(200);

    for (const header of [
      basic(`${DCR_ID}:secret`),
      basic("hlc_other:"),
      basic(`${DCR_ID}`),
      "Basic !!!",
      "Basic",
    ]) {
      const h3 = harness();
      const c = await issueCode(h3);
      const result = await h3.token(
        {
          grant_type: "authorization_code",
          code: c.code,
          redirect_uri: REDIRECT,
          client_id: DCR_ID,
          code_verifier: c.verifier,
        },
        { authorization: header },
      );
      expect(result.status).toBe(401);
      expect(body(result).error).toBe("invalid_client");
      expect(result.headers["WWW-Authenticate"]).toBe('Basic realm="HYDLNK"');
    }
  });

  it("compares the whole decoded Basic text, so a client id with colons in it works (raw or form encoded)", () => {
    const id = "https://claude.ai/oauth/mcp-oauth-client-metadata";
    const raw = `Basic ${Buffer.from(`${id}:`).toString("base64")}`;
    const encoded = `Basic ${Buffer.from(`${encodeURIComponent(id)}:`).toString("base64")}`;
    expect(basicNamesClient(raw, id)).toBe(true);
    expect(basicNamesClient(encoded, id)).toBe(true);
    expect(basicNamesClient(`Basic ${Buffer.from(`${id}:x`).toString("base64")}`, id)).toBe(false);
    expect(basicNamesClient(`Basic ${Buffer.from(`https:`).toString("base64")}`, id)).toBe(false);
  });

  it("a Bearer header is not client authentication and is ignored; client_assertion is ignored", async () => {
    const h = harness();
    const { code, verifier } = await issueCode(h);
    const result = await h.token(
      {
        grant_type: "authorization_code",
        code,
        redirect_uri: REDIRECT,
        client_id: DCR_ID,
        code_verifier: verifier,
        client_assertion: "eyJ.fake.jwt",
        client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
      },
      { authorization: "Bearer something" },
    );
    expect(result.status).toBe(200);
  });

  it("the PKCE check is never skipped, whatever else is sent", async () => {
    const h = harness();
    const { code } = await issueCode(h);
    const result = await h.token({
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT,
      client_id: DCR_ID,
      code_verifier: "x".repeat(43),
      client_assertion: "a",
      client_assertion_type: "b",
    });
    expect(body(result).error).toBe("invalid_grant");
  });
});

describe("M10-15 single use and reuse", () => {
  it("a code works once; the second exchange is invalid_grant and ends every token issued from it", async () => {
    const h = harness();
    const { code, verifier } = await issueCode(h);
    const first = await exchange(h, code, verifier);
    expect(first.status).toBe(200);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const second = await exchange(h, code, verifier);
    expect(body(second).error).toBe("invalid_grant");
    expect(h.store.tokens.every((t) => t.revokedAt !== null)).toBe(true);
    expect(h.store.grants[0]!.revokedAt).not.toBeNull();
    // Logged as code_reuse with the client id and no secret.
    const logged = warn.mock.calls.map((call) => String(call[0])).join("\n");
    expect(logged).toContain("code_reuse");
    expect(logged).toContain(DCR_ID);
    expect(logged).not.toContain(code);
    expect(logged).not.toContain(verifier);
    expect(logged).not.toContain(String(body(first).access_token));
  });

  it("two simultaneous exchanges of one code give one 200 and one invalid_grant", async () => {
    const h = harness();
    const { code, verifier } = await issueCode(h);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const results = await Promise.all([exchange(h, code, verifier), exchange(h, code, verifier)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 400]);
    expect(
      results.find((r) => r.status === 400) && body(results.find((r) => r.status === 400)!).error,
    ).toBe("invalid_grant");
  });

  it("a user suspended between consent and exchange is invalid_grant and nothing is issued", async () => {
    const h = harness();
    const { code, verifier } = await issueCode(h);
    h.store.suspended.add(USER.id);
    const result = await exchange(h, code, verifier);
    expect(body(result).error).toBe("invalid_grant");
    expect(h.store.tokens).toHaveLength(0);
  });
});

describe("M10-15 grants", () => {
  it("a second consent for the same person and app updates the grant and ends the earlier tokens at once", async () => {
    const h = harness();
    const first = await connect(h, { scopes: ["hydlnk.write", "hydlnk.publish"] });
    expect(first.scope).toBe("hydlnk.read hydlnk.write hydlnk.publish");
    const second = await connect(h, { scopes: ["hydlnk.write"] });
    expect(second.scope).toBe("hydlnk.read hydlnk.write");
    expect(h.store.grants).toHaveLength(1);
    const old = h.store.tokens.filter((t) => t.hash === sha256Hex(first.access_token));
    expect(old[0]!.revokedAt).not.toBeNull();
    expect(await h.store.verifyAccessToken(sha256Hex(first.access_token), RESOURCE)).toBeNull();
    expect(
      await h.store.verifyAccessToken(sha256Hex(second.access_token), RESOURCE),
    ).not.toBeNull();
  });

  it("makes at most 6 database round trips and calls no external URL", async () => {
    const h = harness();
    const { code, verifier } = await issueCode(h);
    const before = h.store.totalCalls;
    const limiterBefore = h.limiter.calls.length;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      throw new Error("a token exchange called the network");
    });
    expect((await exchange(h, code, verifier)).status).toBe(200);
    const roundTrips = h.store.totalCalls - before + (h.limiter.calls.length - limiterBefore);
    expect(roundTrips).toBeLessThanOrEqual(6);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("makes 1,000 distinct tokens of 32 random bytes each", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i += 1) {
      for (const kind of ["access", "refresh", "code"] as const) {
        const token = generateToken(kind);
        const body = token.slice(token.indexOf("_", 3) + 1);
        expect(Buffer.from(body, "base64url")).toHaveLength(32);
        seen.add(token);
      }
    }
    expect(seen.size).toBe(3000);
  });
});

describe("M10-15 the request itself", () => {
  it("takes a form only: JSON is 415 invalid_request", async () => {
    const h = harness();
    const result = await h.token(
      { grant_type: "authorization_code" },
      { mediaType: "application/json" },
    );
    expect(result.status).toBe(415);
    expect(body(result).error).toBe("invalid_request");
  });

  it("a parameter given twice is invalid_request", async () => {
    const h = harness();
    const result =
      (await h.tokenDeps.store) &&
      (await handle(h, "grant_type=refresh_token&grant_type=authorization_code&client_id=x"));
    expect(result.status).toBe(400);
    expect(body(result).error).toBe("invalid_request");
  });

  it("a body over 16 KB is 413", async () => {
    const h = harness();
    const result = await (
      await import("@/lib/oauth/token")
    ).handleTokenRequest(
      {
        clientKey: "k",
        mediaType: "application/x-www-form-urlencoded",
        authorization: null,
        readBody: async () => ({ ok: false, reason: "too_large" }),
      },
      h.tokenDeps,
    );
    expect(result.status).toBe(413);
  });

  it("only the listed error codes appear, and an unknown grant_type is unsupported_grant_type", async () => {
    const h = harness();
    const allowed = new Set([
      "invalid_request",
      "invalid_client",
      "invalid_grant",
      "unsupported_grant_type",
      "invalid_scope",
      "invalid_target",
      "temporarily_unavailable",
    ]);
    const samples = [
      await h.token({ grant_type: "password", client_id: DCR_ID }),
      await h.token({ client_id: DCR_ID }),
      await h.token({ grant_type: "authorization_code", client_id: "nope" }),
      await h.token({ grant_type: "client_credentials", client_id: DCR_ID }),
    ];
    expect(body(samples[0]!).error).toBe("unsupported_grant_type");
    expect(body(samples[3]!).error).toBe("unsupported_grant_type");
    for (const sample of samples) expect(allowed.has(String(body(sample).error))).toBe(true);
    for (const sample of samples) expect(sample.headers["Cache-Control"]).toBe("no-store");
  });

  it("limits per address: 429 temporarily_unavailable with Retry-After", async () => {
    const base = harness();
    const h = harness({ limit: memoryLimiter(() => base.store.clock) });
    for (let i = 0; i < 120; i += 1)
      await h.token({ grant_type: "authorization_code", client_id: DCR_ID });
    const limited = await h.token({ grant_type: "authorization_code", client_id: DCR_ID });
    expect(limited.status).toBe(429);
    expect(body(limited).error).toBe("temporarily_unavailable");
    expect(Number(limited.headers["Retry-After"])).toBeGreaterThanOrEqual(1);
    // Another address is not affected.
    const other = await h.token(
      { grant_type: "authorization_code", client_id: DCR_ID },
      { clientKey: "192.0.2.1" },
    );
    expect(other.status).toBe(400);
  });

  // Wave L review, finding 1: Claude's client_id is ONE address shared by every person who connects
  // Claude, so a bucket keyed on the client_id alone is one budget for all of them (and a way for one
  // caller to starve the rest). The only limit before validation is the caller's address.
  it("the client_id is never a bucket: 400 bad requests for it from other addresses do not limit a valid refresh", async () => {
    const base = harness();
    const inner = memoryLimiter(() => base.store.clock);
    const keys: string[] = [];
    const h = harness({
      limit: async (key, max, window) => {
        keys.push(key);
        return inner(key, max, window);
      },
    });
    const connected = await connect(h);
    for (let i = 0; i < 400; i += 1) {
      const bad = await h.token(
        { grant_type: "refresh_token", refresh_token: `hl_rt_${"x".repeat(43)}`, client_id: DCR_ID },
        { clientKey: `bad-caller-${i}` },
      );
      expect(bad.status).toBe(400);
    }
    const refreshed = await h.token(
      { grant_type: "refresh_token", refresh_token: connected.refresh_token, client_id: DCR_ID },
      { clientKey: "192.0.2.77" },
    );
    expect(refreshed.status).toBe(200);
    expect(keys.some((key) => key.startsWith("oauth-token-client"))).toBe(false);
  });

  it("asks only for the address limit before the grant is looked at", async () => {
    const h = harness();
    await h.token({ grant_type: "authorization_code", client_id: DCR_ID });
    expect(h.limiter.calls.map((call) => call.key)).toEqual(["oauth-token:203.0.113.7"]);
  });

  it("a store failure is a 500 server_error that says nothing of it, and logs no secret", async () => {
    const h = harness();
    const { code, verifier } = await issueCode(h);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    h.store.failNext = "getRequestByCodeHash";
    const result = await exchange(h, code, verifier);
    expect(result.status).toBe(500);
    expect(JSON.stringify(result.body)).not.toContain(code);
    expect(JSON.stringify(error.mock.calls)).not.toContain(code);
    expect(JSON.stringify(error.mock.calls)).not.toContain(verifier);
  });
});

async function handle(h: Harness, text: string) {
  const { handleTokenRequest } = await import("@/lib/oauth/token");
  return handleTokenRequest(
    {
      clientKey: "k",
      mediaType: "application/x-www-form-urlencoded",
      authorization: null,
      readBody: async () => ({ ok: true as const, text }),
    },
    h.tokenDeps,
  );
}

describe("M10-16 refresh tokens", () => {
  const refresh = (h: Harness, token: string, over: Record<string, string | undefined> = {}) =>
    h.token({ grant_type: "refresh_token", refresh_token: token, client_id: DCR_ID, ...over });

  it("returns a NEW access token and a NEW refresh token and marks the old one rotated", async () => {
    const h = harness();
    const first = await connect(h);
    h.store.advance(10);
    const result = await refresh(h, first.refresh_token);
    expect(result.status).toBe(200);
    const next = body(result);
    expect(next.access_token).not.toBe(first.access_token);
    expect(next.refresh_token).not.toBe(first.refresh_token);
    expect(next.token_type).toBe("Bearer");
    expect(next.expires_in).toBe(3600);
    expect(next.scope).toBe("hydlnk.read hydlnk.write hydlnk.publish");
    const old = h.store.tokens.find((t) => t.hash === sha256Hex(first.refresh_token))!;
    expect(old.rotatedAt).not.toBeNull();
    // Access tokens already issued stay valid until their own hour is up.
    expect(await h.store.verifyAccessToken(sha256Hex(first.access_token), RESOURCE)).not.toBeNull();
  });

  it("a refresh token never works twice, and presenting it again ends the whole family", async () => {
    const h = harness();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const a = await connect(h);
    const b = body(await refresh(h, a.refresh_token));
    const reuse = await refresh(h, a.refresh_token);
    expect(reuse.status).toBe(400);
    expect(body(reuse).error).toBe("invalid_grant");
    // B's refresh token and the newest access token are both dead.
    expect(body(await refresh(h, String(b.refresh_token))).error).toBe("invalid_grant");
    expect(await h.store.verifyAccessToken(sha256Hex(String(b.access_token)), RESOURCE)).toBeNull();
    expect(h.store.grants[0]!.revokedAt).not.toBeNull();
  });

  it("another client's id with a real refresh token is invalid_grant and ends the family", async () => {
    const h = harness();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    h.store.addClient(`hlc_${"e".repeat(32)}`, [REDIRECT]);
    const a = await connect(h);
    const result = await refresh(h, a.refresh_token, { client_id: `hlc_${"e".repeat(32)}` });
    expect(body(result).error).toBe("invalid_grant");
    expect(h.store.tokens.every((t) => t.revokedAt !== null)).toBe(true);
  });

  it("two simultaneous requests with the same token give one success and one invalid_grant, and the success is ended too", async () => {
    const h = harness();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const a = await connect(h);
    const results = await Promise.all([refresh(h, a.refresh_token), refresh(h, a.refresh_token)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 400]);
    const success = results.find((r) => r.status === 200)!;
    expect(
      await h.store.verifyAccessToken(sha256Hex(String(body(success).access_token)), RESOURCE),
    ).toBeNull();
    expect(
      h.store.tokens.filter((t) => t.kind === "refresh" && !t.rotatedAt && !t.revokedAt),
    ).toHaveLength(0);
  });

  it("every dead refresh token is the same invalid_grant", async () => {
    const h = harness();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const a = await connect(h);
    const cases: Array<string> = [`hl_rt_${"A".repeat(43)}`, "garbage", a.access_token, a.code, ""];
    for (const token of cases) {
      const result = await refresh(h, token);
      expect(result.status).toBe(400);
      expect(body(result).error).toBe(token === "" ? "invalid_request" : "invalid_grant");
    }
    // Revoked, expired, ended grant.
    const second = await connect(h);
    h.store.tokens.find((t) => t.hash === sha256Hex(second.refresh_token))!.revokedAt =
      h.store.clock;
    expect(body(await refresh(h, second.refresh_token)).error).toBe("invalid_grant");
    const third = await connect(h);
    h.store.advance(REFRESH_IDLE_SECONDS + 1);
    expect(body(await refresh(h, third.refresh_token)).error).toBe("invalid_grant");
  });

  it("a refresh token that expired in its 60 days of silence is dead, and a used one keeps rolling", async () => {
    const h = harness();
    let current = await connect(h);
    for (let day = 0; day < 4; day += 1) {
      h.store.advance(59 * 86400);
      const next = await refresh(h, current.refresh_token);
      expect(next.status).toBe(200);
      current = {
        ...current,
        refresh_token: String(body(next).refresh_token),
        access_token: String(body(next).access_token),
      };
    }
  });

  it("no chain lives past 365 days: a refresh on day 364 gets a token that expires on day 365, and day 366 is invalid_grant", async () => {
    const h = harness();
    const first = await connect(h);
    let current = first.refresh_token;
    // Refresh every 59 days up to day 354, then on day 364.
    let elapsedDays = 0;
    while (elapsedDays < 354) {
      h.store.advance(59 * 86400);
      elapsedDays += 59;
      const result = await refresh(h, current);
      expect(result.status).toBe(200);
      current = String(body(result).refresh_token);
    }
    const toDay364 = 364 - elapsedDays;
    h.store.advance(toDay364 * 86400);
    const onDay364 = await refresh(h, current);
    expect(onDay364.status).toBe(200);
    const live = h.store.tokens.find((t) => t.kind === "refresh" && !t.rotatedAt && !t.revokedAt)!;
    expect(live.expiresAt - h.store.grants[0]!.authorizedAt).toBe(365 * 86400_000);
    h.store.advance(2 * 86400);
    const onDay366 = await refresh(h, String(body(onDay364).refresh_token));
    expect(body(onDay366).error).toBe("invalid_grant");
  });

  it("a scope subset narrows the new tokens only; a wider set is invalid_scope and does not use the token up", async () => {
    const h = harness();
    const a = await connect(h, { scopes: ["hydlnk.write"] });
    const wider = await refresh(h, a.refresh_token, { scope: "hydlnk.read hydlnk.publish" });
    expect(body(wider).error).toBe("invalid_scope");
    const narrowed = await refresh(h, a.refresh_token, { scope: "hydlnk.read" });
    expect(narrowed.status).toBe(200);
    expect(body(narrowed).scope).toBe("hydlnk.read");
    const back = await refresh(h, String(body(narrowed).refresh_token));
    expect(body(back).scope).toBe("hydlnk.read hydlnk.write");
    expect(h.store.grants[0]!.scopes).toEqual(["hydlnk.read", "hydlnk.write"]);
    const unknown = await refresh(h, String(body(back).refresh_token), { scope: "hydlnk.nope" });
    expect(body(unknown).error).toBe("invalid_scope");
    // offline_access is tolerated and dropped.
    expect(
      (await refresh(h, String(body(back).refresh_token), { scope: "offline_access" })).status,
    ).toBe(200);
  });

  it("the new tokens never exceed the grant's current scopes (re-read on every refresh)", async () => {
    const h = harness();
    const a = await connect(h);
    h.store.grants[0]!.scopes = ["hydlnk.read"];
    const result = await refresh(h, a.refresh_token);
    expect(body(result).scope).toBe("hydlnk.read");
    const wide = await refresh(h, String(body(result).refresh_token), { scope: "hydlnk.write" });
    expect(body(wide).error).toBe("invalid_scope");
  });

  it("a resource, when sent, must be the canonical URL", async () => {
    const h = harness();
    const a = await connect(h);
    expect(
      body(await refresh(h, a.refresh_token, { resource: "https://elsewhere.example/mcp" })).error,
    ).toBe("invalid_target");
    expect((await refresh(h, a.refresh_token, { resource: RESOURCE })).status).toBe(200);
  });

  it("a suspended account can still refresh", async () => {
    const h = harness();
    const a = await connect(h);
    h.store.suspended.add(USER.id);
    expect((await refresh(h, a.refresh_token)).status).toBe(200);
  });

  it("the refresh tokens of a deleted user, or of an ended grant, are invalid_grant", async () => {
    const h = harness();
    const a = await connect(h);
    h.store.grants[0]!.revokedAt = h.store.clock;
    expect(body(await refresh(h, a.refresh_token)).error).toBe("invalid_grant");
    const gone = harness();
    const b = await connect(gone);
    gone.store.tokens.length = 0;
    expect(body(await refresh(gone, b.refresh_token)).error).toBe("invalid_grant");
  });

  it("forcing the race: a second live refresh token cannot exist, so the exchange answers invalid_grant", async () => {
    const h = harness();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const a = await connect(h);
    // Another request rotates the token between the read and the write.
    h.store.rotateRace = () => {
      const old = h.store.tokens.find((t) => t.hash === sha256Hex(a.refresh_token))!;
      old.rotatedAt = h.store.clock;
      h.store.rotateRace = null;
    };
    const result = await refresh(h, a.refresh_token);
    expect(body(result).error).toBe("invalid_grant");
  });

  it("a refresh response needs no external call and carries no-store", async () => {
    const h = harness();
    const a = await connect(h);
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      throw new Error("network");
    });
    const result = await refresh(h, a.refresh_token);
    expect(result.status).toBe(200);
    expect(result.headers["Cache-Control"]).toBe("no-store");
    expect(spy).not.toHaveBeenCalled();
  });
});
