import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * M13-11: the admin's draft view gets the share preview's response headers (nonce CSP,
 * `private, no-store`, noindex, no Referer) on top of a session rewrite.
 */

vi.mock("@/lib/env/client", () => ({
  clientEnv: {
    NEXT_PUBLIC_ROOT_DOMAIN: "localhost:3000",
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
  },
}));
const rewriteWithSession = vi.hoisted(() => vi.fn());
vi.mock("@/lib/routing/session", () => ({ rewriteWithSession }));

const { adminDraftProxy, isAdminDraftLookalike, isAdminDraftPath } =
  await import("@/lib/previews/admin-draft-proxy");

const ID = "11111111-2222-4333-8444-555555555555";

describe("isAdminDraftPath", () => {
  it("is the page and its sub-pages, never the bare prefix or a look-alike", () => {
    expect(isAdminDraftPath(`/admin-draft/${ID}`)).toBe(true);
    expect(isAdminDraftPath(`/admin-draft/${ID}/items`)).toBe(true);
    expect(isAdminDraftPath("/admin-draft")).toBe(false);
    expect(isAdminDraftPath("/admin-draft/")).toBe(false);
    expect(isAdminDraftPath("/admin-drafts/x")).toBe(false);
    expect(isAdminDraftPath("/admin/pages")).toBe(false);
  });
});

describe("isAdminDraftLookalike", () => {
  it("catches other spellings of the route, and nothing else", () => {
    for (const path of [
      `/Admin-draft/${ID}`,
      `/ADMIN-DRAFT/${ID}`,
      `/admin%2Ddraft/${ID}`,
      `/admin%2ddraft/${ID}`,
      `/admin-draft%2F${ID}`,
      `/admin%252Ddraft/${ID}`,
      `/%61dmin-draft/${ID}`,
      "/admin-draft",
      "/admin-draft/",
    ]) {
      expect(isAdminDraftLookalike(path), path).toBe(true);
    }
    for (const path of [
      `/admin-draft/${ID}`,
      `/admin-drafts/${ID}`,
      "/admin/pages",
      "/",
      "/settings",
      "/admin%ZZdraft/x",
    ]) {
      expect(isAdminDraftLookalike(path), path).toBe(false);
    }
  });
});

describe("adminDraftProxy", () => {
  beforeEach(() => {
    rewriteWithSession.mockReset();
    rewriteWithSession.mockImplementation(async (_request, destination: URL) =>
      NextResponse.rewrite(destination),
    );
  });

  it("rewrites through the session and sets the share headers with a fresh nonce on both sides", async () => {
    const request = new NextRequest(`http://app.localhost:3000/admin-draft/${ID}`, {
      headers: { "content-security-policy": "script-src 'nonce-chosen-by-client'" },
    });
    const destination = new URL(`http://app.localhost:3000/app/admin-draft/${ID}`);
    const response = await adminDraftProxy(request, destination);

    expect(rewriteWithSession).toHaveBeenCalledTimes(1);
    const [, , requestHeaders] = rewriteWithSession.mock.calls[0] as [
      unknown,
      URL,
      Record<string, string>,
    ];
    const csp = response.headers.get("content-security-policy") ?? "";
    const nonce = /'nonce-([^']+)'/.exec(csp)?.[1];
    expect(nonce).toBeTruthy();
    expect(csp).toContain("'strict-dynamic'");
    expect(csp).toContain("script-src-attr 'none'");
    expect(csp).toContain("form-action 'none'");
    // The page renders under the same policy, and the client's own header is replaced.
    expect(requestHeaders["content-security-policy"]).toBe(csp);
    expect(csp).not.toContain("chosen-by-client");

    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("a different nonce on every request", async () => {
    const request = () => new NextRequest(`http://app.localhost:3000/admin-draft/${ID}`);
    const dest = new URL(`http://app.localhost:3000/app/admin-draft/${ID}`);
    const a = (await adminDraftProxy(request(), dest)).headers.get("content-security-policy");
    const b = (await adminDraftProxy(request(), dest)).headers.get("content-security-policy");
    expect(a).not.toBe(b);
  });
});
