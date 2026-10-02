import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { NextResponse, type NextRequest } from "next/server";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { describe, expect, it, vi } from "vitest";

// Importing the proxy module pulls in env validation and the session helper; neither matters for
// the matcher, so both are stubbed the way routing-proxy-tenant.test.ts stubs them.
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
vi.mock("@/lib/routing/custom-domain", () => ({ resolveCustomDomain: vi.fn() }));

const { config } = await import("@/proxy");

/** Whether Next.js would run the proxy for a request to this path (Next's own matcher logic). */
const runs = (url: string) => unstable_doesMiddlewareMatch({ config, url });

/**
 * The proxy does the host routing, so it must run for every page, route handler and tracking route
 * on every host, and may skip only what is static. Skipping a path means the request reaches the
 * root app without a rewrite, tenant headers or session refresh: harmless for a file in public/,
 * wrong for anything that is routed by host.
 */
describe("proxy matcher: static assets skip the proxy", () => {
  it.each([
    // The showreel, its posters, the demo and Open Graph images in public/marketing.
    "/marketing/showreel/showreel-16x9.mp4",
    "/marketing/showreel/showreel-16x9.webm",
    "/marketing/showreel/showreel-4x5.mp4",
    "/marketing/showreel/showreel-4x5.webm",
    "/marketing/showreel/showreel-16x9-poster.webp",
    "/marketing/demo/fennmoor-card.avif",
    "/marketing/og/pricing.jpg",
    // Static file extensions anywhere.
    "/clip.mp4",
    "/clip.webm",
    "/a/b/c.png",
    "/photo.jpeg",
    "/photo.jpg",
    "/photo.avif",
    "/photo.webp",
    "/mark.svg",
    "/favicon.ico",
    "/app.css",
    "/font.woff2",
    "/manifest.webmanifest",
    // Framework files and the two host-aware text routes, which answer on every host themselves.
    "/_next/static/chunks/app.js",
    "/_next/image",
    "/__nextjs_original-stack-frames",
    "/robots.txt",
    "/sitemap.xml",
  ])("%s", (path) => {
    expect(runs(path)).toBe(false);
  });
});

describe("proxy matcher: everything routed by host still runs the proxy", () => {
  it.each([
    "/",
    "/pricing",
    "/learn/getting-started",
    "/login",
    "/signup",
    "/auth/callback",
    "/app/settings",
    "/t/mara",
    "/t/mara/og",
    "/sites/page-1",
    "/r/abc123",
    "/api/e",
    "/api/stripe/webhook",
    // Near misses: a name or extension that merely looks static. Only files are skipped, so a
    // path under /marketing/ that is not a static file still gets its host's routing and 404.
    "/marketing",
    "/marketing/",
    "/marketing/x",
    "/marketing/showreel",
    "/marketing-tips",
    "/marketingx/clip.mp4x",
    "/mp4",
    "/video.mp4/more",
    "/video.mp4x",
    "/webm",
    // A query string is not part of the path.
    "/pricing?file=clip.mp4",
    "/pricing?next=/marketing/x",
    // Dot segments are resolved before matching, so they cannot hide a routed path behind a file name.
    "/marketing/../t/mara",
    "/marketing/%2e%2e/t/mara",
    "/marketing/x.mp4/../../t/mara",
  ])("%s", (path) => {
    expect(runs(path)).toBe(true);
  });

  it("skips every file in public/ (so adding a showreel video or image never needs a matcher change)", () => {
    const files = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        return statSync(path).isDirectory() ? files(path) : [path];
      });
    const paths = files("public").map((file) => `/${file.slice("public/".length)}`);
    expect(paths.length).toBeGreaterThan(30);
    expect(paths.filter((path) => runs(path))).toEqual([]);
  });

  it("is still one literal pattern, which Next.js has to read at build time", () => {
    expect(Array.isArray(config.matcher)).toBe(true);
    expect(config.matcher).toHaveLength(1);
    expect(typeof config.matcher[0]).toBe("string");
  });
});
