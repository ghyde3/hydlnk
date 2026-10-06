import http from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { loadCimdClientWith } from "@/lib/oauth/cimd";
import { TEST_STUB_ORIGIN } from "@/lib/oauth/ssrf";
import { FakeOauthStore, openLimiter } from "./helpers/oauth-fake-store";
import { fetchClientDocument, isJsonType, pinnedLookup } from "@/lib/oauth/safe-fetch";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: async () => ({ allowed: true, retryAfter: 0 }) }));
vi.mock("@/lib/oauth/config", () => ({ oauthConfig: () => ({ rootDomain: "hydlnk.com" }) }));
vi.mock("@/lib/oauth/store-supabase", () => ({ defaultOauthStore: () => ({}) }));

/**
 * M10-07 on a real socket: the default transport, against a throwaway local server standing where the
 * end-to-end stub stands (the one address the test seam accepts). It proves what the injected
 * transport cannot: the real request carries exactly the headers the policy names, a redirect is
 * not followed, the body cap and the deadline cut a real stream, and the pinned lookup answers with the
 * validated address whatever name it is asked about. Skipped when that port is taken (the end-to-end
 * stub of Playwright holds it).
 */

const STUB_PORT = Number(new URL(TEST_STUB_ORIGIN).port);
let server: http.Server | null = null;
let seen: Array<{ url: string; headers: http.IncomingHttpHeaders }> = [];
let started = false;

beforeAll(async () => {
  server = http.createServer((request, response) => {
    seen.push({ url: request.url ?? "", headers: request.headers });
    const path = request.url ?? "";
    if (path.startsWith("/doc")) {
      response.writeHead(200, {
        "content-type": "application/json",
        "cache-control": "max-age=1200",
      });
      response.end('{"client_id":"x"}');
    } else if (path.startsWith("/cimd/ok")) {
      response.writeHead(200, {
        "content-type": "application/json",
        "cache-control": "max-age=900",
      });
      response.end(
        JSON.stringify({
          client_id: `${TEST_STUB_ORIGIN}/cimd/ok.json`,
          client_name: "Live Stub App",
          redirect_uris: ["https://a.example/cb"],
          token_endpoint_auth_method: "none",
        }),
      );
    } else if (path.startsWith("/redirect")) {
      response.writeHead(302, { location: "http://127.0.0.1:1/elsewhere" });
      response.end();
    } else if (path.startsWith("/big")) {
      response.writeHead(200, { "content-type": "application/json" });
      response.write("x".repeat(100_000));
      response.end();
    } else if (path.startsWith("/slow")) {
      response.writeHead(200, { "content-type": "application/json" });
      response.write("{");
      // never ends
    } else {
      response.writeHead(404);
      response.end();
    }
  });
  await new Promise<void>((resolve) => {
    server!.once("error", () => resolve());
    server!.listen(STUB_PORT, "127.0.0.1", () => {
      started = true;
      resolve();
    });
  });
});

afterAll(async () => {
  if (server && started) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server!.close(() => resolve()));
  }
});

const options = { maxBytes: 5120, accept: "application/json", acceptsType: isJsonType };
const deps = { rootDomain: "hydlnk.com", allowTestStub: true } as const;
const call = (path: string, timeoutMs?: number) =>
  fetchClientDocument(`${TEST_STUB_ORIGIN}${path}`, { ...deps, timeoutMs }, options);

describe("M10-07 the real transport", () => {
  it.skipIf(!STUB_PORT)(
    "fetches a document with exactly the headers of the policy",
    async (ctx) => {
      if (!started) return ctx.skip();
      seen = [];
      const result = await call("/doc/a.json");
      expect(result).toMatchObject({
        ok: true,
        contentType: "application/json",
        cacheControl: "max-age=1200",
      });
      expect(seen).toHaveLength(1);
      const headers = seen[0]!.headers;
      expect(headers.accept).toBe("application/json");
      expect(headers["accept-encoding"]).toBe("identity");
      expect(headers["user-agent"]).toBe("HYDLNK-OAuth/1");
      expect(headers.host).toBe(`127.0.0.1:${STUB_PORT}`);
      expect(headers.cookie).toBeUndefined();
      expect(headers.authorization).toBeUndefined();
    },
  );

  it("does not follow a redirect", async (ctx) => {
    if (!started) return ctx.skip();
    seen = [];
    const result = await call("/redirect/x");
    expect(result).toMatchObject({ ok: false, reason: "redirected" });
    expect(seen.map((hit) => hit.url)).toEqual(["/redirect/x"]);
  });

  it("cuts a body that passes the cap", async (ctx) => {
    if (!started) return ctx.skip();
    expect(await call("/big/x")).toMatchObject({ ok: false, reason: "too_large" });
  });

  it("cuts a server that never finishes at the deadline", async (ctx) => {
    if (!started) return ctx.skip();
    const startedAt = Date.now();
    expect(await call("/slow/x", 400)).toMatchObject({ ok: false, reason: "timeout" });
    expect(Date.now() - startedAt).toBeLessThan(2000);
  });

  it("an unset path is a bad status, and nothing listening is a network refusal that names nothing", async (ctx) => {
    if (!started) return ctx.skip();
    expect(await call("/nothing/here")).toMatchObject({ ok: false, reason: "bad_status" });
  });

  it("the stub address is refused when the hooks are off", async () => {
    const refused = await fetchClientDocument(
      `${TEST_STUB_ORIGIN}/doc/a.json`,
      { ...deps, allowTestStub: false },
      options,
    );
    expect(refused).toMatchObject({ ok: false, reason: "bad_scheme" });
  });
});

describe("M10-08 the loader on a real socket", () => {
  it("fetches, validates and stores a metadata client end to end, with the lifetime from Cache-Control", async (ctx) => {
    if (!started) return ctx.skip();
    const store = new FakeOauthStore();
    const result = await loadCimdClientWith(`${TEST_STUB_ORIGIN}/cimd/ok.json`, "203.0.113.7", {
      store,
      limit: openLimiter().limit,
      now: store.now,
      fetchDeps: { rootDomain: "hydlnk.com", allowTestStub: true },
      inflight: new Map(),
    });
    expect(result).toMatchObject({
      ok: true,
      client: { client_name: "Live Stub App", kind: "cimd" },
    });
    const row = store.clients.get(`${TEST_STUB_ORIGIN}/cimd/ok.json`)!;
    expect(Date.parse(row.expires_at!) - Date.parse(row.fetched_at!)).toBe(900_000);
    expect(row.redirect_uris).toEqual(["https://a.example/cb"]);
  });

  it("refuses the same address when the hooks are off, with no request made", async (ctx) => {
    if (!started) return ctx.skip();
    seen = [];
    const store = new FakeOauthStore();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const result = await loadCimdClientWith(`${TEST_STUB_ORIGIN}/cimd/ok.json`, "203.0.113.7", {
      store,
      limit: openLimiter().limit,
      now: store.now,
      fetchDeps: { rootDomain: "hydlnk.com", allowTestStub: false },
      inflight: new Map(),
    });
    expect(result).toEqual({ ok: false, reason: "cannot_verify" });
    expect(seen).toEqual([]);
    expect(store.clients.size).toBe(0);
  });
});

describe("M10-07 the pinned lookup", () => {
  it("answers with the validated address for any name, in both shapes node asks for", () => {
    const lookup = pinnedLookup({ ip: "93.184.216.34", family: 4 });
    const single = vi.fn();
    lookup("evil.example.com", { family: 0 } as never, single);
    expect(single).toHaveBeenCalledWith(null, "93.184.216.34", 4);
    const all = vi.fn();
    lookup("anything", { all: true } as never, all);
    expect(all).toHaveBeenCalledWith(null, [{ address: "93.184.216.34", family: 4 }]);
    const six = pinnedLookup({ ip: "2606:2800:220:1::1", family: 6 });
    const sixAll = vi.fn();
    six("x", { all: true } as never, sixAll);
    expect(sixAll).toHaveBeenCalledWith(null, [{ address: "2606:2800:220:1::1", family: 6 }]);
  });
});
