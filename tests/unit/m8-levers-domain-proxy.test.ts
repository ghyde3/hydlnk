import { NextRequest, NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CustomDomainDeps } from "@/lib/routing/custom-domain";

/**
 * M8-10 in the proxy: the lookup is asked the way it was before (the Host header and nothing else), and
 * the test header `x-hl-domain-cache: HIT|MISS` appears only when HYDLNK_QUERY_COUNTER=1 and only on
 * a custom host's response, never otherwise.
 */

vi.mock("@/lib/env/client", () => ({
  clientEnv: {
    NEXT_PUBLIC_ROOT_DOMAIN: "localhost:3000",
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
  },
}));
vi.mock("@/lib/routing/session", () => ({
  rewriteWithSession: vi.fn(async (_request: NextRequest, url: URL) => NextResponse.rewrite(url)),
}));
const resolveCustomDomain =
  vi.fn<(host: string, deps?: CustomDomainDeps) => Promise<string | null>>();
vi.mock("@/lib/routing/custom-domain", () => ({ resolveCustomDomain }));

const { proxy } = await import("@/proxy");

const PAGE = "11111111-1111-4111-8111-111111111111";
const HEADER = "x-hl-domain-cache";

const request = (host: string, path = "/", method = "GET") =>
  new NextRequest(`http://${host}${path}`, { method, headers: { host } });

/** The lookup answers `PAGE` and reports where the answer came from. */
const answers = (state: "HIT" | "MISS" | "BYPASS" | "NONE", pageId: string | null = PAGE) =>
  resolveCustomDomain.mockImplementation(async (_host, deps) => {
    deps?.report?.(state);
    return pageId;
  });

beforeEach(() => {
  resolveCustomDomain.mockReset();
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("M8-10 the flag is off: nothing about the cache is visible", () => {
  it.each(["", "0", "true", "yes"])(
    "HYDLNK_QUERY_COUNTER=%j: the lookup gets the Host only and no response carries the header",
    async (value) => {
      vi.stubEnv("HYDLNK_QUERY_COUNTER", value);
      answers("HIT");
      for (const [path, method] of [
        ["/", "GET"],
        ["/og", "GET"],
        ["/r/x/y", "GET"],
        ["/api/e", "POST"],
      ] as const) {
        const response = await proxy(request("links.example.org", path, method));
        expect(response.headers.has(HEADER), `${method} ${path}`).toBe(false);
      }
      expect(
        resolveCustomDomain.mock.calls.every(
          (call) => call.length === 1 && call[0] === "links.example.org",
        ),
      ).toBe(true);
    },
  );

  it("unset: the same", async () => {
    vi.stubEnv("HYDLNK_QUERY_COUNTER", "");
    delete process.env.HYDLNK_QUERY_COUNTER;
    answers("MISS");
    const response = await proxy(request("links.example.org"));
    expect(response.headers.has(HEADER)).toBe(false);
    expect(resolveCustomDomain).toHaveBeenCalledWith("links.example.org");
  });
});

describe("M8-10 the flag is on (a test run only): HIT or MISS on a custom host's response", () => {
  beforeEach(() => {
    vi.stubEnv("HYDLNK_QUERY_COUNTER", "1");
  });

  it("a page rewrite carries MISS, then HIT", async () => {
    answers("MISS");
    expect((await proxy(request("links.example.org"))).headers.get(HEADER)).toBe("MISS");
    answers("HIT");
    expect((await proxy(request("links.example.org"))).headers.get(HEADER)).toBe("HIT");
  });

  it("the plain 404 rewrite of an unknown host carries it too", async () => {
    answers("HIT", null);
    const response = await proxy(request("nobody.example.org"));
    expect(response.headers.get("x-middleware-rewrite")).toContain("/sites/unknown");
    expect(response.headers.get(HEADER)).toBe("HIT");
  });

  it("a pass-through (/r/*, /api/e) carries it", async () => {
    answers("MISS");
    for (const [path, method] of [
      ["/r/a/b", "GET"],
      ["/api/e", "POST"],
    ] as const) {
      const response = await proxy(request("links.example.org", path, method));
      expect(response.headers.get("x-middleware-next")).toBe("1");
      expect(response.headers.get(HEADER), path).toBe("MISS");
    }
  });

  it("a host with no cache involved (BYPASS, NONE) carries nothing", async () => {
    answers("BYPASS");
    expect((await proxy(request("links.example.org"))).headers.has(HEADER)).toBe(false);
    answers("NONE", null);
    expect((await proxy(request("203.0.113.5"))).headers.has(HEADER)).toBe(false);
  });

  it("the marketing, app and tenant hosts never carry it and never ask the lookup", async () => {
    answers("HIT");
    for (const host of ["localhost:3000", "mara.localhost:3000"]) {
      const response = await proxy(request(host));
      expect(response.headers.has(HEADER), host).toBe(false);
    }
    expect(resolveCustomDomain).not.toHaveBeenCalled();
  });

  it("a lookup that throws is a 404 rewrite with no header and no cookie", async () => {
    resolveCustomDomain.mockRejectedValue(new Error("boom"));
    const response = await proxy(request("links.example.org"));
    expect(response.headers.get("x-middleware-rewrite")).toContain("/sites/unknown");
    expect(response.headers.has(HEADER)).toBe(false);
    expect(response.headers.has("set-cookie")).toBe(false);
  });
});
