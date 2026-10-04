import { NextRequest, NextResponse } from "next/server";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IMAGE_PATH_PATTERN } from "@/lib/document/schema";
import { STORED_PATH_PATTERN } from "@/lib/media/limits";

vi.mock("@/lib/env/client", () => ({
  clientEnv: {
    NEXT_PUBLIC_ROOT_DOMAIN: "localhost:3000",
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
  },
}));

// The proxy's three side effects are all instrumented: the Supabase session refresh on the app
// host, the custom-domain lookup, and the rewrite itself (read from the response).
const rewriteWithSession = vi.fn(async (_request: NextRequest, url: URL) =>
  NextResponse.rewrite(url),
);
vi.mock("@/lib/routing/session", () => ({ rewriteWithSession }));
const resolveCustomDomain = vi.fn<(host: string) => Promise<string | null>>();
vi.mock("@/lib/routing/custom-domain", () => ({ resolveCustomDomain }));

const { config, proxy } = await import("@/proxy");

/**
 * M7-14: `/media/{uid}/{name}.{webp|png|jpg}` never reaches the proxy. The matcher's static-
 * extension rule (outside /app, /t, /sites and /r) skips it, so on every host the request goes
 * straight to the route handler: no host rewrite, no session refresh (and so no Supabase auth call
 * and no `no-store` from the app host's headers), no tenant headers, no custom-domain lookup.
 * Nothing in src/proxy.ts changed for this: the rule was already there.
 */

const UID = "0b6f1a5e-7c1d-4a52-9d0e-3a7c5e8f2b14";
const HEX32 = "0123456789abcdef0123456789abcdef";

/** The names the pipeline stores (STORED_PATH_PATTERN) and the older ones a page may still hold. */
const STORED_NAMES = [
  `${UID}/img-${HEX32}.webp`,
  `${UID}/avatar-${HEX32}.webp`,
  `${UID}/bg-${HEX32}.webp`,
  `${UID}/img-0123456789ab.webp`,
  `${UID}/0b8f2f7a-1e01-4c0b-9d57-6f1c2a523a1e.png`,
  `${UID}/0b8f2f7a-1e01-4c0b-9d57-6f1c2a523a1e.jpg`,
  `${UID}/night-market-banner.png`,
  `${UID}/${"a".repeat(64)}.webp`,
];

/** Whether Next.js would run the proxy for a request to this path (Next's own matcher logic). */
const runs = (url: string) => unstable_doesMiddlewareMatch({ config, url });

const HOSTS = {
  app: "app.localhost:3000",
  tenant: "mara.localhost:3000",
  custom: "links.example.test",
  marketing: "localhost:3000",
};

beforeEach(() => {
  rewriteWithSession.mockClear();
  resolveCustomDomain.mockReset();
  resolveCustomDomain.mockResolvedValue("page-1");
});

/** What Next does: run the proxy only when the matcher says so. Returns the response or null. */
async function through(host: string, path: string): Promise<NextResponse | null> {
  if (!runs(path)) return null;
  return (await proxy(new NextRequest(`http://${host}${path}`, { headers: { host } }))) ?? null;
}

describe("M7-14 the matcher skips every stored image name", () => {
  it("the fixtures are real stored names", () => {
    for (const path of STORED_NAMES) expect(path).toMatch(IMAGE_PATH_PATTERN);
    expect(STORED_NAMES.slice(0, 3).every((path) => STORED_PATH_PATTERN.test(path))).toBe(true);
  });

  it.each(STORED_NAMES)("/media/%s skips the proxy", (path) => {
    expect(runs(`/media/${path}`)).toBe(false);
  });

  it("an excluded extension that fails the pattern skips the proxy too, and gets the route's 404", () => {
    for (const path of [
      "/media/x/y.svg",
      "/media/x/y.gif",
      "/media/x/y.avif",
      "/media/x/y.png",
      `/media/${UID}/img-0123456789ab.jpeg`, // the stored extension is jpg, never jpeg
    ]) {
      expect(runs(path), path).toBe(false);
    }
    // A query string is not part of the path the matcher reads; the route refuses it itself.
    expect(runs(`/media/${STORED_NAMES[0]}?x=1`)).toBe(false);
  });

  it.each([
    "/media",
    "/media/",
    "/media/x",
    "/media/x/y",
    "/media/x/y.html",
    "/media/x/y.webp.exe",
    `/media/${STORED_NAMES[0]}/`,
    `/media/${UID}`,
    `/media/${UID}/img-0123456789ab`,
    `/media/${UID}/img-0123456789ab.webp/extra`,
  ])("%s still gets its host's routing and its host's plain 404", (path) => {
    expect(runs(path)).toBe(true);
  });
});

describe("M7-14 an instrumented proxy sees nothing of an image request", () => {
  it.each(Object.entries(HOSTS))(
    "on the %s host: zero proxy calls for every stored name",
    async (_kind, host) => {
      for (const path of STORED_NAMES) {
        const response = await through(host, `/media/${path}`);
        expect(response, `${host} ${path}`).toBeNull(); // the proxy was never invoked
      }
      expect(rewriteWithSession).not.toHaveBeenCalled(); // no Supabase auth call, no session
      expect(resolveCustomDomain).not.toHaveBeenCalled(); // no custom-domain lookup
    },
  );

  it("so the app host's no-store headers and rewrite to /app never apply to an image", async () => {
    // For contrast: a path that does run the proxy on the app host is rewritten under /app by the
    // session helper (whose headers are no-store). The image path never gets there.
    const page = await through(HOSTS.app, "/media/x");
    expect(rewriteWithSession).toHaveBeenCalledTimes(1);
    expect(new URL(page!.headers.get("x-middleware-rewrite") ?? "").pathname).toBe("/app/media/x");
    rewriteWithSession.mockClear();
    expect(await through(HOSTS.app, `/media/${STORED_NAMES[0]}`)).toBeNull();
    expect(rewriteWithSession).not.toHaveBeenCalled();
  });

  it("a path the matcher does not exclude is routed like any other path of its host", async () => {
    const tenant = await through(HOSTS.tenant, "/media/x/y.html");
    expect(new URL(tenant!.headers.get("x-middleware-rewrite") ?? "").pathname).toBe(
      "/t/mara/media/x/y.html",
    );
    const custom = await through(HOSTS.custom, "/media/x");
    expect(new URL(custom!.headers.get("x-middleware-rewrite") ?? "").pathname).toBe(
      "/sites/page-1/media/x",
    );
    // The root host serves it as-is, so the /media route answers its own plain 404.
    const marketing = await through(HOSTS.marketing, "/media/x/y");
    expect(marketing!.headers.get("x-middleware-rewrite")).toBeNull();
  });
});
