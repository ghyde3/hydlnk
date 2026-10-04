import { describe, expect, it, vi } from "vitest";
import { makeDeps } from "./support/mcp-fakes";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabase: () => {
    throw new Error("no database in this test");
  },
}));
vi.mock("@/lib/env/server", () => ({ serverEnv: new Proxy({}, { get: () => "x" }) }));

const { createMcpEndpoint, createMcpServe, readBodyCapped } = await import("@/lib/mcp/endpoint");
const { createVerifyToken, parseBearerHeader } = await import("@/lib/mcp/auth");
const { MCP_ALLOWED_ORIGINS, isAllowedMcpOrigin } = await import("@/lib/mcp/origin");
const { MCP_MAX_BODY_BYTES } = await import("@/lib/mcp/constants");

/**
 * M10-02, M10-04 and M10-20 at the HTTP edge of /mcp: the challenges, the credentials that never
 * work, the Origin rule, the CORS answers, the methods, the size cap and the protocol itself. The
 * token store and the tools are fakes; the endpoint, the bearer wrapper and the SDK handler are real.
 */

const APP = "http://app.localhost:3000";
const PRM = `${APP}/.well-known/oauth-protected-resource/mcp`;
const GOOD = "hl_at_" + "G".repeat(43);

function setup(
  over: {
    limit?: (
      key: string,
      limit: number,
      window: number,
    ) => Promise<{ allowed: boolean; retryAfter: number }>;
    serve?: (req: Request) => Promise<Response>;
  } = {},
) {
  const verifyCalls: string[] = [];
  const limitCalls: string[] = [];
  const served: Request[] = [];
  const unavailable = new WeakSet<Request>();
  let failVerify = false;
  const verifyToken = createVerifyToken({
    verify: async (token) => {
      verifyCalls.push(token);
      if (failVerify) throw new Error("the token store is down");
      if (token !== GOOD) return null;
      return {
        userId: "11111111-1111-4111-8111-111111111111",
        clientId: "hlc_" + "a".repeat(32),
        grantId: "33333333-3333-4333-8333-333333333333",
        scopes: ["hydlnk.read"],
        tokenId: "44444444-4444-4444-8444-444444444444",
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
      };
    },
    onUnavailable: (req) => unavailable.add(req),
    log: () => undefined,
  });
  const endpoint = createMcpEndpoint({
    appOrigin: APP,
    verifyToken,
    serve:
      over.serve ??
      (async (req) => {
        served.push(req);
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }),
    limit:
      over.limit ??
      (async (key) => {
        limitCalls.push(key);
        return { allowed: true, retryAfter: 0 };
      }),
    wasUnavailable: (req) => unavailable.has(req),
    log: () => undefined,
  });
  return {
    endpoint,
    verifyCalls,
    limitCalls,
    served,
    breakStore: () => {
      failVerify = true;
    },
  };
}

function request(
  init: { method?: string; headers?: Record<string, string>; body?: BodyInit | null } = {},
) {
  const headers = new Headers({
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    ...(init.headers ?? {}),
  });
  return new Request(`${APP}/mcp`, {
    method: init.method ?? "POST",
    headers,
    body:
      init.method === "GET" || init.method === "DELETE" || init.method === "OPTIONS"
        ? null
        : (init.body ?? JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" })),
  });
}
const bearer = (value: string) => ({ authorization: `Bearer ${value}` });

describe("no credential: a bare challenge", () => {
  it("is a 401 whose WWW-Authenticate names only the metadata URL and nothing else", async () => {
    const { endpoint, verifyCalls, served } = setup();
    const response = await endpoint(request());
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe(`Bearer resource_metadata="${PRM}"`);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toMatchObject({ error: "unauthorized" });
    expect(verifyCalls).toEqual([]);
    expect(served).toEqual([]);
  });

  it("builds every URL from the configured origin, never from Host, X-Forwarded-Host or Forwarded", async () => {
    const { endpoint } = setup();
    const spoof = {
      "x-forwarded-host": "evil.example",
      "x-forwarded-proto": "http",
      forwarded: "host=evil.example;proto=http",
      host: "evil.example",
    };
    for (const headers of [spoof, { ...spoof, ...bearer("nope") }]) {
      const response = await endpoint(request({ headers }));
      expect(response.status).toBe(401);
      const challenge = response.headers.get("www-authenticate")!;
      expect(challenge).toContain(PRM);
      expect(challenge + (await response.text())).not.toContain("evil.example");
    }
  });

  it("GET and DELETE with no token are 401 first, not 405", async () => {
    const { endpoint } = setup();
    for (const method of ["GET", "DELETE"]) {
      expect((await endpoint(request({ method }))).status).toBe(401);
    }
  });
});

// Wave L review, finding 6: once a token is verified, nothing bounded how often it could ask. Every
// request costs a token lookup, and a tool call costs limiter writes and an activity row even when it
// is refused, so a looping or malicious connected app could load the database without limit.
describe("a connected app has a request budget", () => {
  const TOKEN_ID = "44444444-4444-4444-8444-444444444444";

  it("is counted per token, after the credential has been checked, at 120 a minute", async () => {
    const calls: Array<[string, number, number]> = [];
    const { endpoint, served } = setup({
      limit: async (key, limit, window) => {
        calls.push([key, limit, window]);
        return { allowed: true, retryAfter: 0 };
      },
    });
    expect((await endpoint(request({ headers: bearer(GOOD) }))).status).toBe(200);
    expect(served).toHaveLength(1);
    expect(calls).toEqual([[`mcp-req:${TOKEN_ID}`, 120, 60]]);
  });

  it("over the budget is a 429 with Retry-After, and the body is never read or served", async () => {
    const { endpoint, served } = setup({
      limit: async (key) =>
        key.startsWith("mcp-req:")
          ? { allowed: false, retryAfter: 41 }
          : { allowed: true, retryAfter: 0 },
    });
    const response = await endpoint(request({ headers: bearer(GOOD) }));
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("41");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ error: "rate_limited" });
    expect(served).toEqual([]);
  });

  it("the 121st request in a minute is refused and the 120th is not (a real window)", async () => {
    const hits: number[] = [];
    const { endpoint, served } = setup({
      limit: async (key, limit) => {
        if (!key.startsWith("mcp-req:")) return { allowed: true, retryAfter: 0 };
        hits.push(1);
        return hits.length <= limit
          ? { allowed: true, retryAfter: 0 }
          : { allowed: false, retryAfter: 12 };
      },
    });
    for (let i = 0; i < 120; i += 1) {
      expect((await endpoint(request({ headers: bearer(GOOD) }))).status).toBe(200);
    }
    expect((await endpoint(request({ headers: bearer(GOOD) }))).status).toBe(429);
    expect(served).toHaveLength(120);
  });

  it("a limiter that fails lets the request through", async () => {
    const { endpoint, served } = setup({
      limit: async (key) => {
        if (key.startsWith("mcp-req:")) throw new Error("the limiter is down");
        return { allowed: true, retryAfter: 0 };
      },
    });
    expect((await endpoint(request({ headers: bearer(GOOD) }))).status).toBe(200);
    expect(served).toHaveLength(1);
  });

  it("a request with no or a bad credential is not counted against any token's budget", async () => {
    const { endpoint, limitCalls } = setup();
    await endpoint(request());
    await endpoint(request({ headers: bearer("x".repeat(43)) }));
    expect(limitCalls.every((key) => key.startsWith("mcp-401:"))).toBe(true);
  });
});

describe("credentials that never work", () => {
  const cases: Array<[string, Record<string, string>, boolean]> = [
    ["an unknown 43-character value", bearer("x".repeat(43)), true],
    ["Bearer with nothing after it", { authorization: "Bearer" }, false],
    ["Bearer with an empty value", { authorization: "Bearer " }, false],
    ["two spaces", { authorization: "Bearer  x" }, false],
    ["the Basic scheme", { authorization: "Basic x" }, false],
    ["two tokens", { authorization: "Bearer x y" }, false],
    ["a value longer than 256 characters", bearer("a".repeat(257)), false],
    ["a value with a non-ASCII character", { authorization: "Bearer café" }, false],
    ["a good token followed by a second word", { authorization: `Bearer ${GOOD} y` }, false],
  ];

  it("each is a 401 with error=invalid_token and the same resource_metadata, and malformed ones are refused before any lookup", async () => {
    const answers = new Set<string>();
    for (const [label, headers, wellFormed] of cases) {
      const { endpoint, verifyCalls, served } = setup();
      const response = await endpoint(request({ headers }));
      expect(response.status, label).toBe(401);
      const challenge = response.headers.get("www-authenticate")!;
      expect(challenge, label).toContain('error="invalid_token"');
      expect(challenge, label).toContain(`resource_metadata="${PRM}"`);
      expect(verifyCalls.length, label).toBe(wellFormed ? 1 : 0);
      expect(served, label).toEqual([]);
      answers.add(`${response.status}|${challenge}|${await response.text()}`);
    }
    // Same status, same header, same body, whatever the reason: a probe learns nothing.
    expect(answers.size).toBe(1);
  });

  it("a token only in the query string or only in the body is not a credential", async () => {
    const { endpoint, verifyCalls } = setup();
    const inQuery = new Request(`${APP}/mcp?access_token=${GOOD}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    const inBody = request({ body: JSON.stringify({ access_token: GOOD }) });
    expect((await endpoint(inQuery)).status).toBe(401);
    expect((await endpoint(inBody)).status).toBe(401);
    expect(verifyCalls).toEqual([]);
  });

  it("a session cookie is not a credential: no bearer is a 401 and no cookie is set", async () => {
    const { endpoint, verifyCalls } = setup();
    const response = await endpoint(
      request({ headers: { cookie: "sb-abc-auth-token=base64-session; hl-page=1" } }),
    );
    expect(response.status).toBe(401);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(verifyCalls).toEqual([]);
  });

  it("a lower-case scheme is accepted (RFC 7235), and the good token reaches the SDK with its identity", async () => {
    const { endpoint, served } = setup();
    const response = await endpoint(request({ headers: { authorization: `bearer ${GOOD}` } }));
    expect(response.status).toBe(200);
    expect(served).toHaveLength(1);
    const auth = served[0]!.auth!;
    expect(auth.clientId).toBe("hlc_" + "a".repeat(32));
    expect(auth.scopes).toEqual(["hydlnk.read"]);
    expect(auth.extra).toEqual({
      userId: "11111111-1111-4111-8111-111111111111",
      grantId: "33333333-3333-4333-8333-333333333333",
      tokenId: "44444444-4444-4444-8444-444444444444",
    });
    // The secret is never carried on: the row id stands in the token field.
    expect(auth.token).toBe("44444444-4444-4444-8444-444444444444");
  });

  it("the verifier never throws, and a store outage is a 503, not a 401", async () => {
    const { endpoint, breakStore } = setup();
    breakStore();
    const response = await endpoint(request({ headers: bearer(GOOD) }));
    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("5");
  });
});

describe("failures are limited per client address", () => {
  it("counts only failing requests, under mcp-401:{ip}, 120 a minute", async () => {
    const seen: Array<[string, number, number]> = [];
    const { endpoint } = setup({
      limit: async (key, limit, window) => {
        seen.push([key, limit, window]);
        return { allowed: true, retryAfter: 0 };
      },
    });
    await endpoint(request({ headers: { "x-forwarded-for": "203.0.113.7" } }));
    await endpoint(request({ headers: { ...bearer("nope"), "x-forwarded-for": "203.0.113.7" } }));
    await endpoint(request({ headers: { ...bearer(GOOD), "x-forwarded-for": "203.0.113.7" } }));
    // The good request is not a failure: it is counted against its token's own budget instead.
    expect(seen.filter(([key]) => key.startsWith("mcp-401:"))).toEqual([
      ["mcp-401:203.0.113.7", 120, 60],
      ["mcp-401:203.0.113.7", 120, 60],
    ]);
    expect(seen.filter(([key]) => key.startsWith("mcp-req:"))).toHaveLength(1);
  });

  it("the 121st failing request in a minute is a 429 with Retry-After, and another address is unaffected", async () => {
    const counts = new Map<string, number>();
    const { endpoint } = setup({
      limit: async (key, limit) => {
        const next = (counts.get(key) ?? 0) + 1;
        counts.set(key, next);
        return next > limit ? { allowed: false, retryAfter: 33 } : { allowed: true, retryAfter: 0 };
      },
    });
    const from = (ip: string) => request({ headers: { ...bearer("nope"), "x-forwarded-for": ip } });
    for (let n = 1; n <= 120; n++) expect((await endpoint(from("203.0.113.7"))).status).toBe(401);
    const blocked = await endpoint(from("203.0.113.7"));
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBe("33");
    expect(await blocked.json()).toEqual({ error: "rate_limited" });
    expect((await endpoint(from("203.0.113.8"))).status).toBe(401);
    // A valid token from the blocked address still works: valid requests are never counted.
    expect(
      (await endpoint(request({ headers: { ...bearer(GOOD), "x-forwarded-for": "203.0.113.7" } })))
        .status,
    ).toBe(200);
  });

  it("with no client address the shared unknown bucket is used, and a failing limiter lets the request through", async () => {
    const keys: string[] = [];
    const { endpoint } = setup({
      limit: async (key) => {
        keys.push(key);
        throw new Error("limiter down");
      },
    });
    const response = await endpoint(request({ headers: bearer("nope") }));
    expect(keys).toEqual(["mcp-401:unknown"]);
    expect(response.status).toBe(401);
  });
});

describe("Origin and CORS", () => {
  const refused = [
    "https://evil.example",
    "null",
    "http://app.localhost:3000.evil.example",
    "https://",
    "http:",
    "https://claude.ai.evil.example",
    "https://app.hydlnk.com",
    "http://localhost.evil.example:3000",
  ];

  it("an Origin that is not allowed is a 403 origin_not_allowed with Vary: Origin, before the token or the limiter", async () => {
    for (const origin of refused) {
      const { endpoint, verifyCalls, limitCalls, served } = setup();
      const response = await endpoint(request({ headers: { origin, ...bearer(GOOD) } }));
      expect(response.status, origin).toBe(403);
      expect(await response.json()).toEqual({ error: "origin_not_allowed" });
      expect(response.headers.get("vary")).toContain("Origin");
      expect(response.headers.get("access-control-allow-origin")).toBeNull();
      expect([verifyCalls, limitCalls, served]).toEqual([[], [], []]);
    }
  });

  it("the allowed list is one pinned constant: the app origin, claude.ai, claude.com, chatgpt.com and loopback developer tools", () => {
    expect([...MCP_ALLOWED_ORIGINS]).toEqual([
      "https://claude.ai",
      "https://claude.com",
      "https://chatgpt.com",
    ]);
    for (const origin of [
      APP,
      ...MCP_ALLOWED_ORIGINS,
      "http://localhost:3000",
      "http://127.0.0.1:6274",
      "http://localhost",
    ]) {
      expect(isAllowedMcpOrigin(origin, APP), origin).toBe(true);
    }
    for (const origin of refused) expect(isAllowedMcpOrigin(origin, APP), origin).toBe(false);
  });

  it("an allowed Origin goes on and is echoed with Vary, the exposed headers and never Allow-Credentials", async () => {
    for (const origin of [
      APP,
      "https://claude.ai",
      "https://chatgpt.com",
      "http://localhost:6274",
    ]) {
      const { endpoint } = setup();
      const response = await endpoint(request({ headers: { origin, ...bearer(GOOD) } }));
      expect(response.status, origin).toBe(200);
      expect(response.headers.get("access-control-allow-origin")).toBe(origin);
      expect(response.headers.get("vary")).toContain("Origin");
      expect(response.headers.get("access-control-expose-headers")).toBe(
        "WWW-Authenticate, Mcp-Session-Id, Retry-After",
      );
      expect(response.headers.get("access-control-allow-credentials")).toBeNull();
    }
    // The 401 of a browser client carries them too, so the page can read the challenge.
    const { endpoint } = setup();
    const challenge = await endpoint(request({ headers: { origin: "https://claude.ai" } }));
    expect(challenge.status).toBe(401);
    expect(challenge.headers.get("access-control-allow-origin")).toBe("https://claude.ai");
    expect(challenge.headers.get("access-control-expose-headers")).toContain("WWW-Authenticate");
  });

  it("no Origin at all goes on to the bearer check and adds no CORS header", async () => {
    const { endpoint } = setup();
    const response = await endpoint(request({ headers: bearer(GOOD) }));
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("a preflight is 204 with no body, no token check and no limiter, and names the headers MCP clients send", async () => {
    const { endpoint, verifyCalls, limitCalls } = setup();
    const response = await endpoint(
      request({
        method: "OPTIONS",
        headers: { origin: "https://claude.ai", "access-control-request-method": "POST" },
      }),
    );
    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    expect(response.headers.get("access-control-allow-origin")).toBe("https://claude.ai");
    expect(response.headers.get("access-control-max-age")).toBe("86400");
    expect(response.headers.get("vary")).toContain("Origin");
    expect(response.headers.get("access-control-allow-credentials")).toBeNull();
    const allowed = response.headers.get("access-control-allow-headers")!;
    for (const name of [
      "Authorization",
      "Content-Type",
      "Accept",
      "Mcp-Protocol-Version",
      "Mcp-Session-Id",
      "Last-Event-ID",
    ]) {
      expect(allowed).toContain(name);
    }
    expect([verifyCalls, limitCalls]).toEqual([[], []]);
    const bad = await endpoint(
      request({ method: "OPTIONS", headers: { origin: "https://evil.example" } }),
    );
    expect(bad.status).toBe(403);
  });
});

describe("methods and size", () => {
  it("GET and DELETE with a valid token are 405 with Allow: POST", async () => {
    for (const method of ["GET", "DELETE"]) {
      const { endpoint, served } = setup();
      const response = await endpoint(request({ method, headers: bearer(GOOD) }));
      expect(response.status).toBe(405);
      expect(response.headers.get("allow")).toBe("POST");
      expect(served).toEqual([]);
    }
  });

  it("a body over 256 KB is a 413, by its declared length or as it streams, and the SDK never sees it", async () => {
    const { endpoint, served } = setup();
    const declared = await endpoint(
      request({ headers: { ...bearer(GOOD), "content-length": String(MCP_MAX_BODY_BYTES + 1) } }),
    );
    expect(declared.status).toBe(413);
    // No Content-Length: the stream is read with a cap and stops early.
    let pulled = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        controller.enqueue(new Uint8Array(64 * 1024));
        if (pulled > 100) controller.close();
      },
    });
    const streamed = await endpoint(
      new Request(`${APP}/mcp`, {
        method: "POST",
        headers: { "content-type": "application/json", ...bearer(GOOD) },
        body: stream,
        // @ts-expect-error duplex is required by undici for a streamed body
        duplex: "half",
      }),
    );
    expect(streamed.status).toBe(413);
    expect(pulled).toBeLessThan(20);
    expect(served).toEqual([]);
  });

  it("a body exactly at the cap is read and served", async () => {
    const body = new Uint8Array(MCP_MAX_BODY_BYTES).fill(32);
    const read = await readBodyCapped(
      new Request(`${APP}/mcp`, { method: "POST", body }),
      MCP_MAX_BODY_BYTES,
    );
    expect(read?.byteLength).toBe(MCP_MAX_BODY_BYTES);
    expect(
      await readBodyCapped(
        new Request(`${APP}/mcp`, { method: "POST", body: new Uint8Array(MCP_MAX_BODY_BYTES + 1) }),
        MCP_MAX_BODY_BYTES,
      ),
    ).toBeNull();
  });

  it("an error inside the SDK is a plain 500 with no message", async () => {
    const { endpoint } = setup({
      serve: async () => {
        throw new Error("boom at /Users/gary/secret.ts with hl_at_canary");
      },
    });
    const response = await endpoint(request({ headers: bearer(GOOD) }));
    expect(response.status).toBe(500);
    expect(await response.text()).not.toMatch(/Users|canary|boom/);
  });
});

describe("bearer header parsing", () => {
  it("accepts one scheme, one space and one short URL-safe token, and nothing else", () => {
    expect(parseBearerHeader(null)).toEqual({ kind: "none" });
    expect(parseBearerHeader("Bearer abc_DEF-123")).toEqual({
      kind: "token",
      token: "abc_DEF-123",
    });
    expect(parseBearerHeader("BEARER abc")).toEqual({ kind: "token", token: "abc" });
    for (const bad of [
      "Bearer",
      "Bearer ",
      "Bearer  x",
      "Basic x",
      "Bearer x y",
      `Bearer ${"a".repeat(257)}`,
      "Bearer café",
      "Bearer a.b",
      "Token abc",
      "",
    ]) {
      expect(parseBearerHeader(bad), JSON.stringify(bad)).toEqual({ kind: "bad" });
    }
    expect(parseBearerHeader(`Bearer ${"a".repeat(256)}`).kind).toBe("token");
  });
});

describe("the protocol, through the real SDK handler (stateless, both generations)", () => {
  function protocolSetup() {
    const fakes = makeDeps();
    const serve = createMcpServe(() => fakes.deps, "1.0.0");
    const endpoint = createMcpEndpoint({
      appOrigin: APP,
      verifyToken: createVerifyToken({
        verify: async (token) =>
          token === GOOD
            ? {
                userId: "11111111-1111-4111-8111-111111111111",
                clientId: "hlc_" + "a".repeat(32),
                grantId: "33333333-3333-4333-8333-333333333333",
                scopes: ["hydlnk.read", "hydlnk.write", "hydlnk.publish"],
                tokenId: "44444444-4444-4444-8444-444444444444",
              }
            : null,
      }),
      serve,
      limit: async () => ({ allowed: true, retryAfter: 0 }),
      log: () => undefined,
    });
    const rpc = async (body: unknown, headers: Record<string, string> = {}) => {
      const response = await endpoint(
        request({ headers: { ...bearer(GOOD), ...headers }, body: JSON.stringify(body) }),
      );
      const text = await response.text();
      const data = text.split("\n").find((line) => line.startsWith("data:"));
      return {
        response,
        text,
        message: data
          ? JSON.parse(data.slice(5))
          : text.trim().startsWith("{")
            ? JSON.parse(text)
            : null,
      };
    };
    return { rpc, fakes, endpoint };
  }

  const ENVELOPE = {
    "io.modelcontextprotocol/protocolVersion": "2026-07-28",
    "io.modelcontextprotocol/clientInfo": { name: "test", version: "1" },
    "io.modelcontextprotocol/clientCapabilities": {},
  };

  it("initialize answers for 2025-06-18 and 2025-11-25 with serverInfo and tools capabilities only, and issues no session", async () => {
    const { rpc } = protocolSetup();
    for (const version of ["2025-06-18", "2025-11-25"]) {
      const { response, message } = await rpc({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: version,
          capabilities: {},
          clientInfo: { name: "t", version: "1" },
        },
      });
      expect(response.status).toBe(200);
      expect(message.result.protocolVersion).toBe(version);
      expect(message.result.serverInfo).toEqual({ name: "hydlnk", version: "1.0.0" });
      expect(Object.keys(message.result.capabilities)).toEqual(["tools"]);
      expect(response.headers.get("mcp-session-id")).toBeNull();
      expect(message.result.instructions.length).toBeLessThanOrEqual(1200);
    }
  });

  it("notifications/initialized is accepted with a 202", async () => {
    const { rpc } = protocolSetup();
    const { response } = await rpc({ jsonrpc: "2.0", method: "notifications/initialized" });
    expect(response.status).toBe(202);
  });

  it("tools/list returns the twelve tools in order, whatever the token's scopes, with their security schemes", async () => {
    const { rpc } = protocolSetup();
    const { message } = await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    expect(message.result.tools.map((tool: { name: string }) => tool.name)).toEqual([
      "list_pages",
      "get_page",
      "get_analytics",
      "get_domains",
      "update_profile",
      "add_block",
      "update_block",
      "move_block",
      "remove_block",
      "set_theme",
      "create_preview_link",
      "publish_page",
    ]);
    const publish = message.result.tools.at(-1);
    expect(publish._meta).toEqual({
      securitySchemes: [{ type: "oauth2", scopes: ["hydlnk.publish"] }],
    });
    expect(publish.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    });
    expect(publish.outputSchema).toBeUndefined();
    expect(publish.inputSchema.additionalProperties).toBe(false);
  });

  it("the 2026-07-28 form works too: server/discover and a tools/list with the per-request envelope", async () => {
    const { rpc } = protocolSetup();
    const discover = await rpc(
      { jsonrpc: "2.0", id: 3, method: "server/discover", params: { _meta: ENVELOPE } },
      { "mcp-protocol-version": "2026-07-28", "mcp-method": "server/discover" },
    );
    expect(discover.response.status).toBe(200);
    expect(discover.message.result.supportedVersions).toContain("2026-07-28");
    const list = await rpc(
      { jsonrpc: "2.0", id: 4, method: "tools/list", params: { _meta: ENVELOPE } },
      { "mcp-protocol-version": "2026-07-28", "mcp-method": "tools/list" },
    );
    expect(list.message.result.tools).toHaveLength(12);
  });

  it("an unknown tool is -32602, resources, prompts and completion are method not found, malformed JSON is -32700 with a 400", async () => {
    const { rpc, endpoint } = protocolSetup();
    expect(
      (
        await rpc({
          jsonrpc: "2.0",
          id: 5,
          method: "tools/call",
          params: { name: "nope", arguments: {} },
        })
      ).message.error.code,
    ).toBe(-32602);
    for (const method of ["resources/list", "prompts/list", "completion/complete"]) {
      expect(
        (await rpc({ jsonrpc: "2.0", id: 6, method, params: {} })).message.error.code,
        method,
      ).toBe(-32601);
    }
    const bad = await endpoint(request({ headers: bearer(GOOD), body: "{not json" }));
    expect(bad.status).toBe(400);
    expect((await bad.json()).error.code).toBe(-32700);
  });

  it("an unsupported protocol version gets the SDK's version negotiation", async () => {
    const { rpc } = protocolSetup();
    const { message } = await rpc({
      jsonrpc: "2.0",
      id: 7,
      method: "initialize",
      params: {
        protocolVersion: "1999-01-01",
        capabilities: {},
        clientInfo: { name: "t", version: "1" },
      },
    });
    expect(["2025-06-18", "2025-11-25", "2026-07-28"]).toContain(message.result.protocolVersion);
  });

  it("a tool call goes through runTool: bad input is invalid_input with issues and reads no page", async () => {
    const { rpc, fakes } = protocolSetup();
    const { response, message } = await rpc({
      jsonrpc: "2.0",
      id: 8,
      method: "tools/call",
      params: { name: "add_block", arguments: { type: "banana" } },
    });
    expect(response.status).toBe(200);
    expect(message.result.isError).toBe(true);
    expect(message.result.structuredContent.error.code).toBe("invalid_input");
    expect(fakes.calls).not.toContain("page");
    // The activity row of a call is scheduled, not awaited.
    expect(fakes.deferred).toHaveLength(1);
  });

  it("a read-only token calling a write tool gets insufficient_scope with the step-up challenge, and the SDK adds its own meta beside it", async () => {
    const fakes = makeDeps();
    const endpoint = createMcpEndpoint({
      appOrigin: APP,
      verifyToken: createVerifyToken({
        verify: async () => ({
          userId: "11111111-1111-4111-8111-111111111111",
          clientId: "hlc_" + "a".repeat(32),
          grantId: null,
          scopes: ["hydlnk.read"],
          tokenId: "44444444-4444-4444-8444-444444444444",
        }),
      }),
      serve: createMcpServe(() => fakes.deps, "1.0.0"),
      limit: async () => ({ allowed: true, retryAfter: 0 }),
      log: () => undefined,
    });
    const response = await endpoint(
      request({
        headers: bearer(GOOD),
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 9,
          method: "tools/call",
          params: { name: "publish_page", arguments: {} },
        }),
      }),
    );
    const data = (await response.text()).split("\n").find((line) => line.startsWith("data:"))!;
    const result = JSON.parse(data.slice(5)).result;
    expect(result.isError).toBe(true);
    expect(result.structuredContent.error).toMatchObject({
      code: "insufficient_scope",
      requiredScope: "hydlnk.publish",
    });
    expect(result._meta["mcp/www_authenticate"][0]).toContain(`resource_metadata="${PRM}"`);
    expect(fakes.calls).toEqual([]);
  });
});

// Wave L second review, finding 10: a request that carries no bearer, or one that cannot be a token,
// is counted against the address's failure budget BEFORE the bearer wrapper runs, so a flood of them
// costs one limiter write each and nothing more.
describe("a malformed credential is counted before the bearer wrapper runs", () => {
  function counting(allowed: boolean) {
    const order: string[] = [];
    const endpoint = createMcpEndpoint({
      appOrigin: APP,
      verifyToken: async () => {
        order.push("verify");
        return undefined;
      },
      serve: async () => new Response("{}", { status: 200 }),
      limit: async (key) => {
        order.push(key.split(":")[0]!);
        return allowed ? { allowed: true, retryAfter: 0 } : { allowed: false, retryAfter: 9 };
      },
      log: () => undefined,
    });
    return { endpoint, order };
  }

  it.each([
    ["Bearer with nothing after it", { authorization: "Bearer" }],
    ["the Basic scheme", { authorization: "Basic x" }],
    ["a value longer than 256 characters", { authorization: `Bearer ${"a".repeat(257)}` }],
  ])("%s: a spent budget is a 429 and the wrapper never runs", async (_n, headers) => {
    const { endpoint, order } = counting(false);
    const response = await endpoint(request({ headers }));
    expect(response.status).toBe(429);
    expect(order).toEqual(["mcp-401"]);
  });

  it("with budget left it is still the same 401, counted once", async () => {
    const { endpoint, order } = counting(true);
    const response = await endpoint(request({ headers: { authorization: "Basic x" } }));
    expect(response.status).toBe(401);
    // Counted first, then the wrapper; the 401 it answers is not counted a second time.
    expect(order).toEqual(["mcp-401", "verify"]);
  });
});
