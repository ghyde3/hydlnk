import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
const resolveCustomDomain = vi.fn<(host: string) => Promise<string | null>>();
vi.mock("@/lib/routing/custom-domain", () => ({ resolveCustomDomain }));

const { proxy } = await import("@/proxy");

const request = (host: string, path: string) =>
  new NextRequest(`http://${host}${path}`, { headers: { host } });
const rewriteOf = (response: Response) => {
  const value = response.headers.get("x-middleware-rewrite");
  return value ? new URL(value).pathname : null;
};

beforeEach(() => resolveCustomDomain.mockReset());

describe("the click redirect is not served on the marketing host", () => {
  it.each(["localhost:3000", "hydlnk-abc123.vercel.app", "127.0.0.1:3000"])(
    "/r/<page>/<block> on %s is the plain 404",
    async (host) => {
      const response = await proxy(request(host, "/r/00000000-0000-4000-8000-0000000000b1/blk"));
      expect(rewriteOf(response)).toBe("/404-not-found");
    },
  );

  it("other marketing paths and /api/e are untouched", async () => {
    expect(rewriteOf(await proxy(request("localhost:3000", "/pricing")))).toBeNull();
    expect(rewriteOf(await proxy(request("localhost:3000", "/api/e")))).toBeNull();
  });
});

describe("a static-looking path under an internal prefix reaches the host checks", () => {
  const path = "/app/api/domains/0b0e1f2a-3c4d-4e5f-8a9b-0c1d2e3f4a5b.png";

  it("on the marketing host it is the plain 404", async () => {
    expect(rewriteOf(await proxy(request("localhost:3000", path)))).toBe("/404-not-found");
  });

  it("on a tenant host it is rewritten under /t/<handle>, never to the app route", async () => {
    expect(rewriteOf(await proxy(request("mara.localhost:3000", path)))).toBe(`/t/mara${path}`);
  });

  it("on an unknown custom host it is the unknown-site 404", async () => {
    resolveCustomDomain.mockResolvedValue(null);
    expect(rewriteOf(await proxy(request("links.example.test", path)))).toBe(`/sites/unknown${path}`);
  });
});
