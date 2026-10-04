import { expect, test } from "@playwright/test";
import { desktopOnly } from "../fixtures/data";
import { appRaw } from "../fixtures/http";
import {
  CLIENT_REDIRECT,
  KNOWN_CLIENT_ID,
  KNOWN_CLIENT_REDIRECT,
  RESOURCE,
  authorizeRaw,
  codesCount,
  knownClient,
  ownIp,
  pkcePair,
  registerClient,
  removeClients,
  rows,
  tokenRequest,
} from "../fixtures/oauth";

/**
 * M10-10, M10-11, M10-15 and M10-17 over raw HTTP against the dev server: dynamic client
 * registration, the order of the authorize checks, and the token and revocation endpoints' request
 * rules. Every test uses a client address of its own, because the limits count per address.
 */

const created: string[] = [];
test.afterAll(async () => {
  await removeClients(created);
  await removeClients([KNOWN_CLIENT_ID]);
});

async function register(body: unknown, headers: Record<string, string> = {}, raw?: string) {
  const res = await appRaw("/oauth/register", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ownIp(), ...headers },
    body: raw ?? JSON.stringify(body),
  });
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(res.body) as Record<string, unknown>;
  } catch {
    // not JSON
  }
  if (typeof json.client_id === "string") created.push(json.client_id);
  return { res, json };
}

test.describe("M10-10 registration over HTTP", () => {
  test("registers a public client: 201, the fields of the spec, no secret, no management address", async ({}, info) => {
    test.skip(!desktopOnly(info), "raw HTTP, no UI");
    const { res, json } = await register({
      redirect_uris: ["https://a.example/cb"],
      client_name: "Zq DCR",
      grant_types: ["authorization_code", "refresh_token"],
    });
    expect(res.status).toBe(201);
    expect(res.headers["content-type"]).toMatch(/^application\/json/);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(json).toMatchObject({
      redirect_uris: ["https://a.example/cb"],
      client_name: "Zq DCR",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: "hydlnk.read hydlnk.write hydlnk.publish",
    });
    expect(json.client_id).toMatch(/^hlc_[0-9a-f]{32}$/);
    expect(typeof json.client_id_issued_at).toBe("number");
    for (const name of ["client_secret", "registration_access_token", "registration_client_uri"]) {
      expect(json).not.toHaveProperty(name);
    }
    const stored = await rows<{ kind: string; client_name: string }>("oauth_clients", {
      client_id: String(json.client_id),
    });
    expect(stored[0]).toMatchObject({ kind: "dcr", client_name: "Zq DCR" });
    // No management endpoint exists.
    expect((await appRaw(`/oauth/register/${json.client_id}`, { method: "DELETE" })).status).toBe(
      404,
    );
    expect((await appRaw(`/oauth/register/${json.client_id}`, { method: "PUT" })).status).toBe(404);
  });

  test("validation: each refusal is a 400 JSON error with the right code", async ({}, info) => {
    test.skip(!desktopOnly(info), "raw HTTP, no UI");
    const cases: Array<[string, unknown, string]> = [
      ["no redirect_uris", {}, "invalid_redirect_uri"],
      ["a custom scheme", { redirect_uris: ["cursor://x"] }, "invalid_redirect_uri"],
      [
        "http that is not loopback",
        { redirect_uris: ["http://example.com/cb"] },
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
        "no authorization_code grant",
        { redirect_uris: ["https://a.example/cb"], grant_types: ["implicit"] },
        "invalid_client_metadata",
      ],
      [
        "a name posing as the product",
        { redirect_uris: ["https://a.example/cb"], client_name: "HYDLNK Support" },
        "invalid_client_metadata",
      ],
      [
        "a vendor's name on a return address that is not the vendor's",
        { redirect_uris: ["https://claude-ai.example/cb"], client_name: "Claude" },
        "invalid_client_metadata",
      ],
      [
        "a return address on this product's own hosts",
        { redirect_uris: ["https://mara.localhost/cb"], client_name: "Pelican Notes" },
        "invalid_redirect_uri",
      ],
    ];
    for (const [name, body, error] of cases) {
      const { res, json } = await register(body);
      expect(res.status, name).toBe(400);
      expect(json.error, name).toBe(error);
      expect(typeof json.error_description, name).toBe("string");
    }
    expect((await register(null, {}, "{not json")).json.error).toBe("invalid_client_metadata");
    const loopback = await register({
      redirect_uris: ["http://localhost/callback", "http://127.0.0.1/callback"],
      client_name: "Local",
    });
    expect(loopback.res.status).toBe(201);
    // A vendor's name is fine for a client that returns to that vendor or to this computer.
    const home = await register({
      redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
      client_name: "Claude",
    });
    expect(home.res.status).toBe(201);
    const code = await register({
      redirect_uris: ["http://localhost:51234/callback"],
      client_name: "Claude Code (my server)",
    });
    expect(code.res.status).toBe(201);
  });

  test("takes application/json only (415) and at most 8 KB (413); other methods are 405 with Allow", async ({}, info) => {
    test.skip(!desktopOnly(info), "raw HTTP, no UI");
    const form = await register(
      null,
      { "content-type": "application/x-www-form-urlencoded" },
      "redirect_uris=x",
    );
    expect(form.res.status).toBe(415);
    expect(form.json.error).toBe("invalid_request");
    const big = await register({ redirect_uris: ["https://a.example/cb"], pad: "x".repeat(9000) });
    expect(big.res.status).toBe(413);
    const get = await appRaw("/oauth/register");
    expect(get.status).toBe(405);
    expect(get.headers.allow).toBe("POST, OPTIONS");
  });

  test("the 21st registration from one address inside an hour is a 429 with Retry-After; another address is unaffected", async ({}, info) => {
    test.skip(!desktopOnly(info), "raw HTTP, no UI");
    const ip = ownIp();
    for (let i = 0; i < 20; i += 1) {
      const { res } = await register(
        { redirect_uris: ["https://a.example/cb"] },
        { "x-forwarded-for": ip },
      );
      expect(res.status).toBe(201);
    }
    const { res, json } = await register(
      { redirect_uris: ["https://a.example/cb"] },
      { "x-forwarded-for": ip },
    );
    expect(res.status).toBe(429);
    expect(json.error).toBe("temporarily_unavailable");
    expect(Number(res.headers["retry-after"])).toBeGreaterThanOrEqual(1);
    expect((await register({ redirect_uris: ["https://a.example/cb"] })).res.status).toBe(201);
  });

  test("CORS: a preflight is answered without a body, and no response allows credentials", async ({}, info) => {
    test.skip(!desktopOnly(info), "raw HTTP, no UI");
    for (const path of ["/oauth/register", "/oauth/token", "/oauth/revoke"]) {
      const res = await appRaw(path, {
        method: "OPTIONS",
        headers: { origin: "https://claude.ai", "access-control-request-method": "POST" },
      });
      expect([200, 204], path).toContain(res.status);
      expect(res.body).toBe("");
      expect(res.headers["access-control-allow-origin"]).toBe("*");
      expect(res.headers["access-control-allow-methods"]).toBe("POST, OPTIONS");
      expect(res.headers["access-control-allow-headers"]).toBe("Content-Type, Authorization");
      expect(res.headers["access-control-max-age"]).toBe("86400");
      expect(res.headers["access-control-allow-credentials"]).toBeUndefined();
      const post = await appRaw(path, {
        method: "POST",
        headers: { origin: "https://claude.ai", "x-forwarded-for": ownIp() },
        body: "",
      });
      expect(post.headers["access-control-allow-origin"], path).toBe("*");
      expect(post.headers["access-control-allow-credentials"], path).toBeUndefined();
    }
  });
});

test.describe("M10-11 authorize over HTTP", () => {
  test("a valid request signed out is a 303 to /login with no query and one cookie; a refusal creates no row", async ({}, info) => {
    test.skip(!desktopOnly(info), "raw HTTP, no UI");
    const client = await registerClient();
    created.push(client.client_id);
    const pair = pkcePair();
    const before = await codesCount(client.client_id);
    const ok = await authorizeRaw(client.client_id, pair.challenge);
    expect(ok.status).toBe(303);
    expect(ok.location).toBe("http://app.localhost:3000/login");
    expect(ok.setCookies).toHaveLength(1);
    expect(ok.setCookies[0]).toMatch(
      /^hl_oauth_resume=[0-9a-f-]{36}; Path=\/; Max-Age=600; HttpOnly; SameSite=Lax$/,
    );
    expect(ok.headers["cache-control"]).toBe("no-store");
    expect(await codesCount(client.client_id)).toBe(before + 1);

    const afterOk = await codesCount(client.client_id);
    for (const options of [
      { redirectUri: "https://evil.example/cb" },
      { scope: "hydlnk.admin" },
      { resource: "https://other.example/mcp" },
      { extra: { prompt: "none" } },
    ]) {
      const res = await authorizeRaw(client.client_id, pair.challenge, options);
      expect([303, 400]).toContain(res.status);
      expect(res.setCookies).toEqual([]);
    }
    expect(await codesCount(client.client_id)).toBe(afterOk);
  });

  test("the order: a bad client or redirect is the 400 page; for a known client everything else goes back to the app with iss, for any other client it is the 400 page too", async ({}, info) => {
    test.skip(!desktopOnly(info), "raw HTTP, no UI");
    const client = await registerClient();
    created.push(client.client_id);
    const pair = pkcePair();
    const page400 = await authorizeRaw(client.client_id, pair.challenge, {
      redirectUri: "https://evil.example/cb",
    });
    expect(page400.status).toBe(400);
    expect(page400.location).toBeNull();
    expect(page400.body).toContain("This app’s return address isn’t allowed.");
    const unknown = await authorizeRaw(`hlc_${"b".repeat(32)}`, pair.challenge);
    expect(unknown.status).toBe(400);
    expect(unknown.body).toContain("We don’t recognize this app.");
    const unverified = await authorizeRaw(
      "https://nobody.example.org/oauth/client.json",
      pair.challenge,
    );
    expect(unverified.status).toBe(400);
    expect(unverified.body).toContain("We couldn’t verify this app.");

    const cases: Array<[string, Parameters<typeof authorizeRaw>[2], string]> = [
      ["no PKCE method", { extra: { code_challenge_method: "plain" } }, "invalid_request"],
      ["a bad scope", { scope: "nope" }, "invalid_scope"],
      ["another resource", { resource: "https://app.hydlnk.com/mcp" }, "invalid_target"],
      ["prompt=none", { extra: { prompt: "none" } }, "consent_required"],
      ["a request object", { extra: { request: "abc" } }, "request_not_supported"],
    ];
    const known = await knownClient();
    for (const [name, options, error] of cases) {
      const res = await authorizeRaw(known.client_id, pair.challenge, {
        state: "keep",
        redirectUri: known.redirect_uri,
        ...options,
      });
      expect(res.status, name).toBe(303);
      const back = new URL(res.location!);
      expect(`${back.origin}${back.pathname}`, name).toBe(KNOWN_CLIENT_REDIRECT);
      expect(back.searchParams.get("error"), name).toBe(error);
      expect(back.searchParams.get("state"), name).toBe("keep");
      expect(back.searchParams.get("iss"), name).toBe("http://app.localhost:3000");
      expect(res.headers["cache-control"], name).toBe("no-store");
      expect(res.headers["referrer-policy"], name).toBe("no-referrer");
    }
  });

  // Wave L review, finding 3: anyone can register a client, so the authorize endpoint must not send
  // an error to the address that client chose. Nobody has signed in or clicked anything here.
  test("a registered client's problems are the 400 page, never a redirect to its address", async ({}, info) => {
    test.skip(!desktopOnly(info), "raw HTTP, no UI");
    const client = await registerClient();
    created.push(client.client_id);
    const pair = pkcePair();
    const before = await codesCount(client.client_id);
    for (const [name, options] of [
      ["no PKCE method", { extra: { code_challenge_method: "plain" } }],
      ["a bad scope", { scope: "nope" }],
      ["another resource", { resource: "https://app.hydlnk.com/mcp" }],
      ["prompt=none", { extra: { prompt: "none" } }],
      ["a request object", { extra: { request: "abc" } }],
    ] as const) {
      const res = await authorizeRaw(client.client_id, pair.challenge, { state: "keep", ...options });
      expect(res.status, name).toBe(400);
      expect(res.location, name).toBeNull();
      expect(res.setCookies, name).toEqual([]);
      expect(res.body, name).toContain("This sign-in request isn’t valid.");
      expect(res.body, name).toContain("The request has something we can’t read.");
      expect(res.body, name).not.toContain(CLIENT_REDIRECT);
    }
    expect(await codesCount(client.client_id)).toBe(before);
  });

  test("a request that is stored with nobody signed in is limited to 20 a minute per address, then a 429 page", async ({}, info) => {
    test.skip(!desktopOnly(info), "raw HTTP, no UI");
    const client = await registerClient();
    created.push(client.client_id);
    const ip = ownIp();
    const pair = pkcePair();
    for (let i = 0; i < 20; i += 1) {
      const ok = await authorizeRaw(client.client_id, pair.challenge, {}, { ip });
      expect(ok.status, `request ${i + 1}`).toBe(303);
    }
    const over = await authorizeRaw(client.client_id, pair.challenge, {}, { ip });
    expect(over.status).toBe(429);
    expect(over.body).toContain("Too many requests. Try again in a minute.");
    expect(Number(over.headers["retry-after"])).toBeGreaterThanOrEqual(1);
    expect(over.setCookies).toEqual([]);
    expect(await codesCount(client.client_id)).toBe(20);
    // Another address is unaffected.
    expect((await authorizeRaw(client.client_id, pair.challenge)).status).toBe(303);
  });

  test("a state with line breaks, ampersands and non-ASCII text round-trips encoded once and adds nothing", async ({}, info) => {
    test.skip(!desktopOnly(info), "raw HTTP, no UI");
    const client = await knownClient();
    const state = "a b&c=d#e %0d%0a\r\nSet-Cookie: x=1 café";
    const res = await authorizeRaw(client.client_id, pkcePair().challenge, {
      state,
      scope: "bogus",
      redirectUri: client.redirect_uri,
    });
    expect(res.status).toBe(303);
    const back = new URL(res.location!);
    expect(back.searchParams.get("state")).toBe(state);
    expect([...back.searchParams.keys()]).toEqual(["error", "error_description", "state", "iss"]);
    expect(back.hash).toBe("");
    expect(res.location).not.toMatch(/[\r\n]/);
    expect(res.headers["set-cookie"]).toBeUndefined();
  });

  test("60 requests a minute per address, then a 429 page with Retry-After; another address is unaffected", async ({}, info) => {
    test.skip(!desktopOnly(info), "raw HTTP, no UI");
    const ip = ownIp();
    for (let i = 0; i < 60; i += 1) {
      const res = await appRaw("/oauth/authorize", { headers: { "x-forwarded-for": ip } });
      expect(res.status).toBe(400);
    }
    const limited = await appRaw("/oauth/authorize", { headers: { "x-forwarded-for": ip } });
    expect(limited.status).toBe(429);
    expect(limited.body).toContain("Too many requests. Try again in a minute.");
    expect(Number(limited.headers["retry-after"])).toBeGreaterThanOrEqual(1);
    expect(
      (await appRaw("/oauth/authorize", { headers: { "x-forwarded-for": ownIp() } })).status,
    ).toBe(400);
  });

  test("only GET: the other methods are 405 with Allow: GET", async ({}, info) => {
    test.skip(!desktopOnly(info), "raw HTTP, no UI");
    for (const method of ["POST", "PUT", "PATCH", "DELETE", "HEAD"]) {
      const res = await appRaw("/oauth/authorize", {
        method,
        headers: { "x-forwarded-for": ownIp() },
      });
      expect(res.status, method).toBe(405);
      expect(res.headers.allow, method).toBe("GET");
    }
  });
});

test.describe("M10-15 the token endpoint's request rules", () => {
  test("JSON is 415, a body over 16 KB is 413, a parameter given twice and a client_secret are refused", async ({}, info) => {
    test.skip(!desktopOnly(info), "raw HTTP, no UI");
    const json = await appRaw("/oauth/token", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ownIp() },
      body: "{}",
    });
    expect(json.status).toBe(415);
    expect(JSON.parse(json.body).error).toBe("invalid_request");
    const big = await appRaw("/oauth/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "x-forwarded-for": ownIp() },
      body: `grant_type=refresh_token&pad=${"x".repeat(17_000)}`,
    });
    expect(big.status).toBe(413);
    const twice = await tokenRequest({ grant_type: "refresh_token", client_id: "x" }, {});
    expect(twice.status).toBe(400);
    const dup = await appRaw("/oauth/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "x-forwarded-for": ownIp() },
      body: "grant_type=refresh_token&grant_type=refresh_token&client_id=x",
    });
    expect(dup.status).toBe(400);
    expect(JSON.parse(dup.body).error).toBe("invalid_request");
    const client = await registerClient();
    created.push(client.client_id);
    const secret = await tokenRequest({
      grant_type: "authorization_code",
      client_id: client.client_id,
      client_secret: "s",
      code: "x",
      redirect_uri: CLIENT_REDIRECT,
      code_verifier: "x".repeat(43),
    });
    expect(secret.body.error).toBe("invalid_client");
    const unknown = await tokenRequest({
      grant_type: "authorization_code",
      client_id: `hlc_${"c".repeat(32)}`,
      code: "x",
    });
    expect(unknown.body.error).toBe("invalid_client");
    const grant = await tokenRequest({ grant_type: "password", client_id: client.client_id });
    expect(grant.body.error).toBe("unsupported_grant_type");
    for (const response of [json, big, dup])
      expect(response.headers["cache-control"]).toBe("no-store");
  });

  test("a Basic header that does not name the client is a 401 invalid_client with a challenge", async ({}, info) => {
    test.skip(!desktopOnly(info), "raw HTTP, no UI");
    const client = await registerClient();
    created.push(client.client_id);
    const bad = await tokenRequest(
      {
        grant_type: "authorization_code",
        client_id: client.client_id,
        code: "x",
        redirect_uri: CLIENT_REDIRECT,
        code_verifier: "x".repeat(43),
      },
      { authorization: `Basic ${Buffer.from(`${client.client_id}:secret`).toString("base64")}` },
    );
    expect(bad.status).toBe(401);
    expect(bad.body.error).toBe("invalid_client");
    expect(bad.headers["www-authenticate"]).toBe('Basic realm="HYDLNK"');
    const named = await tokenRequest(
      {
        grant_type: "authorization_code",
        client_id: client.client_id,
        code: "x",
        redirect_uri: CLIENT_REDIRECT,
        code_verifier: "x".repeat(43),
      },
      { authorization: `Basic ${Buffer.from(`${client.client_id}:`).toString("base64")}` },
    );
    expect(named.status).toBe(400);
    expect(named.body.error).toBe("invalid_grant");
  });

  test("120 requests a minute per address, then a 429 temporarily_unavailable with Retry-After", async ({}, info) => {
    test.skip(!desktopOnly(info), "raw HTTP, no UI");
    const ip = ownIp();
    const send = () => tokenRequest({ grant_type: "password" }, { "x-forwarded-for": ip });
    for (let i = 0; i < 120; i += 1) expect((await send()).status).toBe(400);
    const limited = await send();
    expect(limited.status).toBe(429);
    expect(limited.body.error).toBe("temporarily_unavailable");
    expect(Number(limited.headers["retry-after"])).toBeGreaterThanOrEqual(1);
  });

  test("the metadata's resource is the one tokens are minted for", async ({}, info) => {
    test.skip(!desktopOnly(info), "raw HTTP, no UI");
    const doc = JSON.parse((await appRaw("/.well-known/oauth-protected-resource/mcp")).body) as {
      resource: string;
    };
    expect(doc.resource).toBe(RESOURCE);
  });
});

test.describe("M10-17 the revocation endpoint's request rules", () => {
  test("a missing token is 400 invalid_request, JSON is 415, and a well-formed request is always 200", async ({}, info) => {
    test.skip(!desktopOnly(info), "raw HTTP, no UI");
    const form = (body: string) =>
      appRaw("/oauth/revoke", {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "x-forwarded-for": ownIp(),
        },
        body,
      });
    const missing = await form("client_id=x");
    expect(missing.status).toBe(400);
    expect(JSON.parse(missing.body).error).toBe("invalid_request");
    const json = await appRaw("/oauth/revoke", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ownIp() },
      body: "{}",
    });
    expect(json.status).toBe(415);
    const ok = await form("token=hl_at_unknown&client_id=hlc_whatever");
    expect(ok.status).toBe(200);
    expect(ok.body).toBe("");
    expect(ok.headers["cache-control"]).toBe("no-store");
    const big = await form(`token=${"x".repeat(17_000)}&client_id=x`);
    expect(big.status).toBe(413);
  });

  test("60 revocations a minute per address, then a 429", async ({}, info) => {
    test.skip(!desktopOnly(info), "raw HTTP, no UI");
    const ip = ownIp();
    const send = () =>
      appRaw("/oauth/revoke", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", "x-forwarded-for": ip },
        body: "token=a&client_id=b",
      });
    for (let i = 0; i < 60; i += 1) expect((await send()).status).toBe(200);
    expect((await send()).status).toBe(429);
  });
});
