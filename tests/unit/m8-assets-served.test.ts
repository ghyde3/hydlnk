import { readdirSync } from "node:fs";
import { join } from "node:path";
import { NextResponse, type NextRequest } from "next/server";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { describe, expect, it, vi } from "vitest";
import { FONT_MANIFEST } from "@/lib/tenant-assets/fonts";
import { TENANT_ASSET_HEADERS, tenantAssetHeaders } from "@/lib/tenant-assets/headers";
import { TENANT_SCRIPT_SRC } from "@/lib/tenant-assets/generated";

/**
 * M8-01 step 5, M8-05 step 1: the script and the font files are static files under /_t/ that the
 * proxy never sees and that carry an immutable cache. The headers come from next.config.ts (the
 * platform serves public/ files as they are), so the last block is the gate that the config wires
 * the rules in.
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
vi.mock("@/lib/routing/custom-domain", () => ({ resolveCustomDomain: vi.fn() }));

const { config } = await import("@/proxy");
const runs = (url: string) => unstable_doesMiddlewareMatch({ config, url });


describe("the proxy never runs for the tenant script or a font file", () => {
  it.each([
    TENANT_SCRIPT_SRC,
    "/_t/p.3f9a1c7e2b40.js",
    "/_t/f/fraunces-latin.3f9a1c7e2b40.woff2",
    "/_t/f/inter-latin-ext.0123456789ab.woff2",
  ])(
    "%s",
    (path) => {
      expect(runs(path)).toBe(false);
    },
  );

  it("whatever is vendored in public/_t is skipped, and the tenant prefixes still run the proxy", () => {
    const names = readdirSync(join(process.cwd(), "public/_t"), { recursive: true }) as string[];
    const files = names.filter((name) => /\.(?:js|woff2)$/.test(name));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) expect(runs(`/_t/${file}`), file).toBe(false);
    // The extension rule never covers the internal prefixes, so a file-looking tenant path is routed by host.
    for (const path of ["/t/mara/p.3f9a1c7e2b40.js", "/sites/x/p.3f9a1c7e2b40.js", "/r/x/y.js", "/app/p.js"]) {
      expect(runs(path), path).toBe(true);
    }
  });
});

const { pathToRegexp } = await import("next/dist/compiled/path-to-regexp");

describe("the header rules of /_t/: one per file, by its exact path", () => {
  const FONTS = ["fraunces-latin.3f9a1c7e2b40.woff2", "inter-latin.0123456789ab.woff2"];
  const rules = tenantAssetHeaders("p.3f9a1c7e2b40.js", [...FONTS, FONTS[0]!]);
  const matching = (list: typeof rules, path: string) =>
    list.filter((rule) => pathToRegexp(rule.source).test(path));
  const value = (list: typeof rules, key: string) =>
    list.flatMap((rule) => rule.headers).find((header) => header.key === key)?.value;

  it("the script: immutable for a year, text/javascript, nosniff", () => {
    const hit = matching(rules, "/_t/p.3f9a1c7e2b40.js");
    expect(hit).toHaveLength(1);
    expect(value(hit, "Cache-Control")).toBe("public, max-age=31536000, immutable");
    expect(value(hit, "Content-Type")).toBe("text/javascript; charset=utf-8");
    expect(value(hit, "X-Content-Type-Options")).toBe("nosniff");
  });

  it.each(FONTS)("the font file %s: immutable for a year, font/woff2, nosniff", (file) => {
    const hit = matching(rules, `/_t/f/${file}`);
    expect(hit).toHaveLength(1);
    expect(value(hit, "Cache-Control")).toBe("public, max-age=31536000, immutable");
    expect(value(hit, "Content-Type")).toBe("font/woff2");
    expect(value(hit, "X-Content-Type-Options")).toBe("nosniff");
  });

  it("a font listed twice is one rule", () => {
    expect(rules).toHaveLength(1 + FONTS.length);
  });

  it("matches no other path: not an old hash, not the notices file, not a page, route or tenant path", () => {
    for (const path of [
      "/_t/p.000000000000.js",
      "/_t/f/inter-latin.ffffffffffff.woff2",
      "/_t/f/NOTICE.txt",
      "/_t/",
      "/",
      "/t/mara",
      "/sites/x",
      "/r/x/y",
      "/api/e",
      "/marketing/demo/a.avif",
      "/_next/static/a.js",
    ]) {
      expect(matching(rules, path), path).toEqual([]);
    }
  });

  it("the real list is the current script and every file of the font manifest, and sets no cookie", () => {
    expect(matching(TENANT_ASSET_HEADERS, TENANT_SCRIPT_SRC)).toHaveLength(1);
    const files = new Set(
      Object.values(FONT_MANIFEST.families).flatMap((family) => family?.faces.map((f) => f.file) ?? []),
    );
    expect(TENANT_ASSET_HEADERS).toHaveLength(1 + files.size);
    for (const file of files) expect(matching(TENANT_ASSET_HEADERS, `/_t/f/${file}`)).toHaveLength(1);
    for (const rule of TENANT_ASSET_HEADERS) {
      for (const header of rule.headers) expect(header.key.toLowerCase()).not.toMatch(/cookie|vary/);
    }
  });
});

describe("next.config.ts serves them (red until the one `headers()` hunk is applied)", () => {
  it("returns the /_t/ rules", async () => {
    const { default: nextConfig } = await import("../../next.config");
    expect(typeof nextConfig.headers, "add `headers: async () => TENANT_ASSET_HEADERS` to next.config.ts").toBe(
      "function",
    );
    const rules = await nextConfig.headers!();
    for (const rule of TENANT_ASSET_HEADERS) expect(rules).toContainEqual(rule);
  });
});
