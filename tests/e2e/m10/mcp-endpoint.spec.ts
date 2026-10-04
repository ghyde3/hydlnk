import { randomBytes } from "node:crypto";
import { expect, test } from "@playwright/test";
import { generateToken, sha256Hex } from "@/lib/oauth/tokens";
import { adminClient } from "../fixtures/auth";
import {
  cleanupUsers,
  desktopOnly,
  insertPage,
  makeUser,
  signedInUser,
  uniq,
} from "../fixtures/data";
import {
  ALL_SCOPES,
  MCP_URL,
  McpClient,
  READ_ONLY_SCOPES,
  cleanupMintedClients,
  mintToken,
} from "../fixtures/mcp-client";
import { url } from "../helpers";

/**
 * Wave L, the HTTP edge of https://app.hydlnk.com/mcp (M10-02, M10-04, M10-20): the challenge, the
 * credentials that never work, cookies that never count, the protocol in both generations, Origin and
 * CORS, the methods, the size cap and the limit on failed requests. Raw requests against the real
 * server and database; a minted token stands in for the OAuth dance (the dance is flow.spec.ts).
 * Pure HTTP, so the phone project skips it.
 */

test.afterAll(async () => {
  await cleanupUsers();
  await cleanupMintedClients();
});

const prm = () => url("app", "/.well-known/oauth-protected-resource/mcp");
const CHALLENGE = () => `Bearer resource_metadata="${prm()}"`;

async function post(body: unknown, headers: Record<string, string> = {}) {
  const response = await fetch(MCP_URL(), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  return { response, text: await response.text() };
}
const LIST = { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} };
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

test.describe("the challenge and the credentials", () => {
  test.beforeEach(({}, info) => test.skip(!desktopOnly(info), "pure HTTP: desktop only"));

  test("M10-04 no credential is a bare 401: only the metadata URL, no error code, no cookie, no-store", async () => {
    const { response, text } = await post(LIST);
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe(CHALLENGE());
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(JSON.parse(text)).toMatchObject({ error: "unauthorized" });
    for (const method of ["GET", "DELETE"]) {
      expect((await fetch(MCP_URL(), { method })).status, method).toBe(401);
    }
  });

  test("M10-02 a forged Host or Forwarded header changes nothing: the challenge names only the configured origin", async () => {
    const forged = {
      "x-forwarded-host": "evil.example",
      "x-forwarded-proto": "http",
      forwarded: "host=evil.example;proto=http",
    };
    for (const extra of [{}, bearer("x".repeat(43))]) {
      const { response, text } = await post(LIST, { ...forged, ...extra });
      expect(response.status).toBe(401);
      expect(response.headers.get("www-authenticate")).toContain(prm());
      expect(`${response.headers.get("www-authenticate")}${text}`).not.toContain("evil.example");
    }
    const metadata = await fetch(prm(), { headers: forged });
    if (metadata.status === 200) expect(await metadata.text()).not.toContain("evil.example");
  });

  test("M10-04 credentials that never work are each a 401 with error=invalid_token and one identical answer", async () => {
    const user = await makeUser("mcp-cred", { plan: "pro" });
    const good = await mintToken(user.id);
    const admin = adminClient();
    const answers = new Map<string, string>();
    const record = async (label: string, headers: Record<string, string>, path = "") => {
      const response = await fetch(`${MCP_URL()}${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          ...headers,
        },
        body: JSON.stringify(LIST),
      });
      expect(response.status, label).toBe(401);
      const challenge = response.headers.get("www-authenticate") ?? "";
      expect(challenge, label).toContain('error="invalid_token"');
      expect(challenge, label).toContain(`resource_metadata="${prm()}"`);
      answers.set(label, `${challenge}|${await response.text()}`);
    };

    // An unknown value, and a real token with one character changed.
    await record("unknown 43 characters", bearer(randomBytes(32).toString("base64url")));
    const flipped = good.token.slice(0, -1) + (good.token.endsWith("A") ? "B" : "A");
    await record("one character changed", bearer(flipped));
    // Expired, revoked, a refresh token, an authorization code, another resource.
    const expired = await mintToken(user.id, ALL_SCOPES, { expiresInSeconds: -120 });
    await record("expired", bearer(expired.token));
    const revoked = await mintToken(user.id);
    await admin
      .from("oauth_tokens")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", revoked.tokenId);
    await record("revoked", bearer(revoked.token));
    const refresh = generateToken("refresh");
    const withRefresh = await mintToken(user.id);
    const inserted = await admin.from("oauth_tokens").insert({
      grant_id: withRefresh.grantId,
      user_id: user.id,
      kind: "refresh",
      token_hash: sha256Hex(refresh),
      scopes: [...ALL_SCOPES],
      resource: MCP_URL(),
      expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    });
    expect(inserted.error).toBeNull();
    await record("a refresh token as a bearer", bearer(refresh));
    await record("an authorization code as a bearer", bearer(generateToken("code")));
    const elsewhere = await mintToken(user.id, ALL_SCOPES, {
      resource: "https://other.example/mcp",
    });
    await record("a token for another resource", bearer(elsewhere.token));
    // A grant that was revoked, and the token of a deleted user.
    const grantRevoked = await mintToken(user.id);
    await admin
      .from("oauth_grants")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", grantRevoked.grantId);
    await record("a token whose grant was revoked", bearer(grantRevoked.token));
    const doomed = await makeUser("mcp-cred-gone");
    const doomedToken = await mintToken(doomed.id);
    await admin.auth.admin.deleteUser(doomed.id);
    await record("a deleted user's token", bearer(doomedToken.token));
    // The header forms.
    await record("Bearer with nothing", { authorization: "Bearer" });
    await record("Bearer with two spaces", { authorization: "Bearer  x" });
    await record("Basic", { authorization: "Basic x" });
    await record("two tokens", { authorization: `Bearer ${good.token} y` });
    await record("longer than 256", bearer("a".repeat(257)));
    await record("non-ASCII", { authorization: `Bearer café${"a".repeat(40)}` });
    // The token anywhere but the header is no credential: a 401 with no error attribute.
    for (const [label, init] of [
      ["only in the query string", { path: `?access_token=${good.token}`, body: LIST }],
      ["only in the body", { path: "", body: { ...LIST, access_token: good.token } }],
    ] as const) {
      const response = await fetch(`${MCP_URL()}${init.path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify(init.body),
      });
      expect(response.status, label).toBe(401);
      expect(response.headers.get("www-authenticate"), label).toBe(CHALLENGE());
    }
    // The same status, header and body whatever the reason: a probe learns nothing.
    expect(new Set(answers.values()).size, [...answers.keys()].join("; ")).toBe(1);

    // A lower-case scheme is fine (RFC 7235), and the good token still works.
    const lower = await post(LIST, { authorization: `bearer ${good.token}` });
    expect(lower.response.status).toBe(200);
  });

  test("M10-04 a cookie never authorizes: a session and no bearer is a 401, and with a bearer the bearer's user acts", async ({
    context,
    request,
  }) => {
    const signedIn = await signedInUser(context, { label: "mcp-cookie", plan: "pro" });
    const cookieJar = await context.cookies(url("app", "/"));
    const cookie = cookieJar.map((item) => `${item.name}=${item.value}`).join("; ");
    expect(cookie.length).toBeGreaterThan(0);
    const bare = await post(LIST, { cookie });
    expect(bare.response.status).toBe(401);
    expect(bare.response.headers.get("set-cookie")).toBeNull();
    expect(bare.text).not.toContain(signedIn.handle);

    // A valid bearer for ANOTHER user, with the first user's session cookie: the bearer's user acts.
    const other = await makeUser("mcp-cookie-b", { plan: "pro" });
    const otherHandle = uniq("cookie-b");
    await insertPage(other.id, otherHandle);
    const token = await mintToken(other.id);
    const mcp = new McpClient(token.token);
    await mcp.initialize();
    const response = await mcp.post(
      {
        jsonrpc: "2.0",
        id: 9,
        method: "tools/call",
        params: { name: "list_pages", arguments: {} },
      },
      { cookie, "mcp-protocol-version": "2025-06-18" },
    );
    const data = response.message!.result!.structuredContent as {
      pages: Array<{ handle: string }>;
    };
    expect(data.pages.map((page) => page.handle)).toEqual([otherHandle]);
    expect(response.headers.get("set-cookie")).toBeNull();
    // The signed-in user's own session still works in the app, untouched by any of this.
    expect(
      (
        await request.get(url("app", "/analytics/stats?range=30"), { headers: { cookie } })
      ).status(),
    ).toBeLessThan(500);
  });
});

test.describe("the protocol", () => {
  test.beforeEach(({}, info) => test.skip(!desktopOnly(info), "pure HTTP: desktop only"));

  test("M10-20 the 2025 handshake works statelessly for both versions: initialize, initialized, tools/list, with no session id", async () => {
    const user = await makeUser("mcp-proto", { plan: "pro" });
    const token = await mintToken(user.id, READ_ONLY_SCOPES);
    for (const version of ["2025-06-18", "2025-11-25"]) {
      const mcp = new McpClient(token.token);
      const init = await mcp.initialize(version);
      expect(init.status).toBe(200);
      const result = init.message!.result as {
        protocolVersion: string;
        serverInfo: { name: string };
        capabilities: Record<string, unknown>;
        instructions: string;
      };
      expect(result.protocolVersion).toBe(version);
      expect(result.serverInfo.name).toBe("hydlnk");
      expect(Object.keys(result.capabilities)).toEqual(["tools"]);
      expect(result.instructions.length).toBeLessThanOrEqual(1200);
      expect(init.headers.get("mcp-session-id")).toBeNull();
      expect((await mcp.initialized()).status).toBe(202);
      expect(await mcp.listTools()).toHaveLength(12);
    }
  });

  test("M10-21 tools/list is the pinned table of twelve for any valid token, whatever its scopes", async () => {
    const user = await makeUser("mcp-list", { plan: "free" });
    const mcp = new McpClient((await mintToken(user.id, READ_ONLY_SCOPES)).token);
    await mcp.initialize();
    const tools = await mcp.listTools();
    expect(
      tools.map((tool) => [
        tool.name,
        tool.title,
        tool.annotations.readOnlyHint,
        tool.annotations.destructiveHint,
        tool.annotations.idempotentHint,
        tool.annotations.openWorldHint,
        tool._meta.securitySchemes[0].scopes[0],
      ]),
    ).toEqual([
      ["list_pages", "List your pages", true, false, true, false, "hydlnk.read"],
      ["get_page", "Get a page", true, false, true, false, "hydlnk.read"],
      ["get_analytics", "Get page analytics", true, false, true, false, "hydlnk.read"],
      ["get_domains", "List custom domains", true, false, true, false, "hydlnk.read"],
      ["update_profile", "Update the profile", false, false, true, false, "hydlnk.write"],
      ["add_block", "Add a block", false, false, false, false, "hydlnk.write"],
      ["update_block", "Update a block", false, false, true, false, "hydlnk.write"],
      ["move_block", "Move a block", false, false, true, false, "hydlnk.write"],
      ["remove_block", "Remove a block", false, true, true, false, "hydlnk.write"],
      ["set_theme", "Change the theme", false, false, true, false, "hydlnk.write"],
      ["create_preview_link", "Create a preview link", false, false, false, false, "hydlnk.write"],
      ["publish_page", "Publish a page", false, true, true, false, "hydlnk.publish"],
    ]);
    for (const tool of tools) {
      expect(tool.inputSchema.additionalProperties, tool.name).toBe(false);
      expect(tool.outputSchema, tool.name).toBeUndefined();
      expect(tool.description.length, tool.name).toBeLessThanOrEqual(800);
    }
  });

  test("M10-20 the 2026-07-28 form works too, with the same token: server/discover and tools/list with the per-request envelope", async () => {
    const user = await makeUser("mcp-2026", { plan: "pro" });
    const token = await mintToken(user.id);
    const mcp = new McpClient(token.token, { era: "2026" });
    const discover = await mcp.rpc("server/discover");
    expect(discover.status).toBe(200);
    expect(
      (discover.message!.result as { supportedVersions: string[] }).supportedVersions,
    ).toContain("2026-07-28");
    expect(await mcp.listTools()).toHaveLength(12);
    await insertPage(user.id, uniq("era"));
    const pages = await mcp.call<{ pages: unknown[] }>("list_pages");
    expect(pages.pages).toHaveLength(1);
  });

  test("M10-20 methods and errors: GET and DELETE are 405 with Allow, resources and prompts are method not found, an unknown tool is -32602, bad JSON is -32700", async () => {
    const user = await makeUser("mcp-errors", { plan: "pro" });
    const token = (await mintToken(user.id)).token;
    for (const method of ["GET", "DELETE"]) {
      const response = await fetch(MCP_URL(), {
        method,
        headers: { ...bearer(token), accept: "text/event-stream" },
      });
      expect(response.status, method).toBe(405);
      expect(response.headers.get("allow")).toBe("POST");
    }
    // M10-01: the library's in-page bridge script is never served. The query that would ask for it is
    // answered like any other GET (a 405 after the bearer check) and without a token it is the bare 401.
    const bridge = await fetch(`${MCP_URL()}?webmcp-script`, { headers: bearer(token) });
    expect(bridge.status).toBe(405);
    expect(bridge.headers.get("content-type")).not.toMatch(/javascript/);
    expect((await fetch(`${MCP_URL()}?webmcp-script`)).status).toBe(401);
    const mcp = new McpClient(token);
    await mcp.initialize();
    for (const method of ["resources/list", "prompts/list", "completion/complete"]) {
      expect((await mcp.rpc(method)).message!.error!.code, method).toBe(-32601);
    }
    expect(
      (await mcp.rpc("tools/call", { name: "no_such_tool", arguments: {} })).message!.error!.code,
    ).toBe(-32602);
    const bad = await post("{not json", bearer(token));
    expect(bad.response.status).toBe(400);
    expect(JSON.parse(bad.text).error.code).toBe(-32700);
  });

  test("M10-02 a body over 256 KB is a 413 and one just under it is read", async () => {
    const user = await makeUser("mcp-size", { plan: "pro" });
    const token = (await mintToken(user.id)).token;
    const big = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: { pad: "x".repeat(300 * 1024) },
    });
    const refused = await post(big, bearer(token));
    expect(refused.response.status).toBe(413);
    const fine = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: { pad: "x".repeat(200 * 1024) },
    });
    expect(
      (await post(fine, { ...bearer(token), "mcp-protocol-version": "2025-06-18" })).response
        .status,
    ).toBe(200);
  });
});

test.describe("Origin and CORS", () => {
  test.beforeEach(({}, info) => test.skip(!desktopOnly(info), "pure HTTP: desktop only"));

  test("M10-02 a foreign Origin is a 403 before the token is read; allowed origins are echoed; no response allows credentials", async () => {
    const user = await makeUser("mcp-origin", { plan: "pro" });
    const token = (await mintToken(user.id)).token;
    const app = url("app", "").replace(/\/$/, "");
    for (const origin of [
      "https://evil.example",
      "null",
      `${app}.evil.example`,
      "https://claude.ai.evil.example",
      "https://",
    ]) {
      const { response, text } = await post(LIST, { origin, ...bearer(token) });
      expect(response.status, origin).toBe(403);
      expect(JSON.parse(text)).toEqual({ error: "origin_not_allowed" });
      expect(response.headers.get("vary")).toContain("Origin");
      expect(response.headers.get("access-control-allow-origin")).toBeNull();
      expect(response.headers.get("access-control-allow-credentials")).toBeNull();
    }
    for (const origin of [
      app,
      "https://claude.ai",
      "https://claude.com",
      "https://chatgpt.com",
      "http://localhost:6274",
      "http://127.0.0.1:3333",
    ]) {
      const { response } = await post(LIST, {
        origin,
        ...bearer(token),
        "mcp-protocol-version": "2025-06-18",
      });
      expect(response.status, origin).toBe(200);
      expect(response.headers.get("access-control-allow-origin")).toBe(origin);
      expect(response.headers.get("vary")).toContain("Origin");
      expect(response.headers.get("access-control-expose-headers")).toBe(
        "WWW-Authenticate, Mcp-Session-Id, Retry-After",
      );
      expect(response.headers.get("access-control-allow-credentials")).toBeNull();
    }
    // A browser client reads the challenge too.
    const anonymous = await post(LIST, { origin: "https://claude.ai" });
    expect(anonymous.response.status).toBe(401);
    expect(anonymous.response.headers.get("access-control-allow-origin")).toBe("https://claude.ai");
    expect(anonymous.response.headers.get("access-control-allow-credentials")).toBeNull();
  });

  test("M10-02 a preflight is answered without a token: no body, the allowed headers, a day of caching", async () => {
    const response = await fetch(MCP_URL(), {
      method: "OPTIONS",
      headers: {
        origin: "https://chatgpt.com",
        "access-control-request-method": "POST",
        "access-control-request-headers": "authorization, content-type, mcp-protocol-version",
      },
    });
    expect([200, 204]).toContain(response.status);
    expect(await response.text()).toBe("");
    expect(response.headers.get("access-control-allow-origin")).toBe("https://chatgpt.com");
    expect(response.headers.get("access-control-max-age")).toBe("86400");
    expect(response.headers.get("access-control-allow-credentials")).toBeNull();
    const allowed = (response.headers.get("access-control-allow-headers") ?? "").toLowerCase();
    for (const name of [
      "authorization",
      "content-type",
      "accept",
      "mcp-protocol-version",
      "mcp-session-id",
      "last-event-id",
    ])
      expect(allowed).toContain(name);
    const refused = await fetch(MCP_URL(), {
      method: "OPTIONS",
      headers: { origin: "https://evil.example" },
    });
    expect(refused.status).toBe(403);
  });
});

test.describe("failed requests are limited per client address", () => {
  test.beforeEach(({}, info) => test.skip(!desktopOnly(info), "pure HTTP: desktop only"));

  test("M10-04 the 121st failing request in a minute from one address is a 429 with Retry-After; another address and valid tokens are unaffected", async () => {
    const user = await makeUser("mcp-fail", { plan: "pro" });
    const token = (await mintToken(user.id)).token;
    const octet = () => 1 + Math.floor(Math.random() * 250);
    const noisy = `203.0.113.${octet()}`;
    const quiet = `198.51.100.${octet()}`;
    const failing = (ip: string) =>
      post(LIST, { "x-forwarded-for": ip, ...bearer(randomBytes(32).toString("base64url")) });
    let last = 0;
    for (let n = 1; n <= 120; n++) {
      last = (await failing(noisy)).response.status;
      expect(last, `failing request ${n}`).toBe(401);
    }
    const blocked = await failing(noisy);
    expect(blocked.response.status).toBe(429);
    expect(JSON.parse(blocked.text)).toEqual({ error: "rate_limited" });
    expect(Number(blocked.response.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await failing(quiet)).response.status).toBe(401);
    // A valid token from the blocked address still works: valid requests are never counted.
    const valid = await post(LIST, {
      "x-forwarded-for": noisy,
      ...bearer(token),
      "mcp-protocol-version": "2025-06-18",
    });
    expect(valid.response.status).toBe(200);
  });
});
