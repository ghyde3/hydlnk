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
const { isPageRoutePath, isTrackingPath } = await import("@/lib/routing/paths");
const { RESERVED_PATHS, isValidSubPagePath } = await import("@/lib/document");
const { TENANT_PAGE_CSP } = await import("@/lib/routing/tenant-headers");

/**
 * M17-05 in the proxy: `/f/...` lives on a page's own hosts only (handle host, resolved custom host),
 * passed through untouched like /r and /c, and the plain 404 on the root and deployment hosts; `/f`
 * alone is still a sub-page path; a POST to `/` is still 405 and to any other path the plain 404; the
 * policy's form-action is 'self' and nothing else changed.
 */

const PAGE = "11111111-1111-4111-8111-111111111111";
const FORM_PATH = `/f/${PAGE}/formSign01`;
const MARKER_PATH = `/f/${PAGE}/o`;

const request = (
  host: string,
  path: string,
  method = "GET",
  headers: Record<string, string> = {},
) => new NextRequest(`http://${host}${path}`, { method, headers: { host, ...headers } });
const rewriteOf = (response: Response) => {
  const value = response.headers.get("x-middleware-rewrite");
  return value ? new URL(value).pathname : null;
};
const passedThrough = (response: Response) =>
  response.headers.get("x-middleware-next") === "1" &&
  !response.headers.has("x-middleware-rewrite");

beforeEach(() => resolveCustomDomain.mockReset());

describe("M17-05 the form routes on a page's own hosts", () => {
  it("are page routes and tracking paths; /f alone and /form are not", () => {
    for (const path of [FORM_PATH, MARKER_PATH, "/f/x"]) {
      expect(isPageRoutePath(path), path).toBe(true);
      expect(isTrackingPath(path), path).toBe(true);
    }
    for (const path of ["/f", "/form", "/fx/y"]) expect(isTrackingPath(path), path).toBe(false);
  });

  it("pass through untouched on a handle host, for GET, HEAD and POST", async () => {
    for (const [path, method] of [
      [FORM_PATH, "GET"],
      [FORM_PATH, "HEAD"],
      [FORM_PATH, "POST"],
      [MARKER_PATH, "GET"],
    ] as const) {
      expect(
        passedThrough(await proxy(request("mara.localhost:3000", path, method))),
        `${method} ${path}`,
      ).toBe(true);
    }
  });

  it("pass through on a verified custom host with the cookie header dropped; an unresolved host gets the 404", async () => {
    resolveCustomDomain.mockResolvedValue(PAGE);
    const response = await proxy(
      request("links.example.org", FORM_PATH, "POST", { cookie: "sb-127-auth-token=x" }),
    );
    expect(passedThrough(response)).toBe(true);
    expect(response.headers.get("x-middleware-override-headers") ?? "").not.toMatch(/cookie/);
    expect(response.headers.get("set-cookie")).toBeNull();
    resolveCustomDomain.mockResolvedValue(null);
    expect(rewriteOf(await proxy(request("nobody.example.org", FORM_PATH, "POST")))).toBe(
      "/sites/unknown",
    );
  });

  it.each(["localhost:3000", "hydlnk-abc123.vercel.app", "127.0.0.1:3000"])(
    "are the plain 404 on the root or deployment host %s",
    async (host) => {
      expect(rewriteOf(await proxy(request(host, FORM_PATH)))).toBe("/404-not-found");
      expect(rewriteOf(await proxy(request(host, MARKER_PATH)))).toBe("/404-not-found");
    },
  );

  it("on the app host they fall to the app's own 404 like any unknown path", async () => {
    expect(rewriteOf(await proxy(request("app.localhost:3000", FORM_PATH)))).toBe(
      `/app${FORM_PATH}`,
    );
  });
});

describe("M17-05 what does not change", () => {
  it("/f alone is still a valid sub-page path: f is not reserved, and /f goes to the sub-page route", async () => {
    expect(RESERVED_PATHS).not.toContain("f");
    expect(isValidSubPagePath("f")).toBe(true);
    expect(rewriteOf(await proxy(request("mara.localhost:3000", "/f")))).toBe("/t/mara/p/f");
  });

  it("a POST to / is still 405 and to any other non-tracking path the plain 404", async () => {
    const page = await proxy(request("mara.localhost:3000", "/", "POST"));
    expect(page.status).toBe(405);
    expect(page.headers.get("allow")).toBe("GET, HEAD");
    const other = await proxy(request("mara.localhost:3000", "/about", "POST"));
    expect(other.status).toBe(404);
    resolveCustomDomain.mockResolvedValue(PAGE);
    expect((await proxy(request("links.example.org", "/", "POST"))).status).toBe(405);
  });

  it("form-action is 'self' and the other directives are as they were", () => {
    expect(TENANT_PAGE_CSP).toContain("form-action 'self'");
    expect(TENANT_PAGE_CSP).not.toContain("form-action 'none'");
    expect(TENANT_PAGE_CSP.split("; ").map((d) => d.split(" ")[0])).toEqual([
      "default-src",
      "script-src",
      "style-src",
      "font-src",
      "img-src",
      "connect-src",
      "frame-src",
      "object-src",
      "base-uri",
      "form-action",
      "frame-ancestors",
    ]);
  });
});
