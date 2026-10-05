import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import { buildTenantScript, stripScript } from "@/lib/tenant-assets/build";
import {
  TENANT_SCRIPT_FILE,
  TENANT_SCRIPT_INTEGRITY,
  TENANT_SCRIPT_SRC,
} from "@/lib/tenant-assets/generated";

vi.mock("@/lib/env/client", () => ({
  clientEnv: { NEXT_PUBLIC_ROOT_DOMAIN: "localhost:3000" },
}));

/**
 * M8-05 step 1: one plain, hashed script file. The readable source is one file; the hashed copy in
 * public/_t is produced from it by `pnpm tenant-assets` (and by dev, build and test), and this test
 * fails when that copy or the generated constants are missing or stale.
 */

const root = process.cwd();
const SOURCE_PATH = "src/lib/tenant-assets/script/tenant.js";
const source = readFileSync(join(root, SOURCE_PATH), "utf8");
const built = buildTenantScript(source);

describe("M8-05 the script build", () => {
  it("the hashed file exists, is the build of the source, and is named after the hash of its bytes", () => {
    const path = join(root, "public/_t", built.file);
    expect(existsSync(path), "run `pnpm tenant-assets`").toBe(true);
    const bytes = readFileSync(path, "utf8");
    expect(bytes).toBe(built.code);
    expect(built.file).toBe(
      `p.${createHash("sha256").update(bytes).digest("hex").slice(0, 12)}.js`,
    );
    expect(built.file).toMatch(/^p\.[0-9a-f]{12}\.js$/);
  });

  it("the generated constants are current", () => {
    expect(TENANT_SCRIPT_FILE).toBe(built.file);
    expect(TENANT_SCRIPT_SRC).toBe(`/_t/${built.file}`);
    expect(TENANT_SCRIPT_INTEGRITY).toBe(built.integrity);
    expect(TENANT_SCRIPT_INTEGRITY).toBe(
      `sha384-${createHash("sha384").update(built.code).digest("base64")}`,
    );
  });

  it("no older hashed script is left in public/_t", () => {
    const scripts = readdirSync(join(root, "public/_t")).filter((name) => /^p\..*\.js$/.test(name));
    expect(scripts).toEqual([built.file]);
  });

  it("the path starts with none of /app, /t/, /sites/ or /r/", () => {
    expect(TENANT_SCRIPT_SRC).not.toMatch(/^\/(?:app|t|sites|r)(?:\/|$)/);
  });

  it("is at most 12 KB unminified and 3 KB gzipped, ASCII only (it is served without a charset)", () => {
    expect(Buffer.byteLength(source)).toBeLessThanOrEqual(12 * 1024);
    expect(gzipSync(built.code).length).toBeLessThanOrEqual(3 * 1024);
    expect(built.code).toMatch(/^[\x00-\x7f]*$/);
  });

  it("strips comments and indentation and nothing else", () => {
    expect(stripScript("/* a */\n  var x = 1; \n\n  // note\n  var y = '//x';\n")).toBe(
      "var x = 1;\nvar y = '//x';\n",
    );
    expect(() => stripScript("var x = 1; // trailing\n")).toThrow(/own lines/);
  });
});

describe("M8-05 the script is plain browser JavaScript with a short list of things it never uses", () => {
  const FORBIDDEN: [string, RegExp][] = [
    ["import", /\bimport\b/],
    ["require", /\brequire\b/],
    ["eval", /\beval\b/],
    ["new Function", /new\s+Function/],
    ["innerHTML", /innerHTML|outerHTML|insertAdjacentHTML/],
    ["document.write", /document\.write/],
    ["document.cookie", /\bcookie\b/],
    ["localStorage", /localStorage/],
    ["sessionStorage", /sessionStorage/],
    ["indexedDB", /indexedDB/],
    ["fetch", /\bfetch\b/],
    ["XMLHttpRequest", /XMLHttpRequest/],
    ["WebSocket", /WebSocket|EventSource/],
    ["a string timer", /set(?:Timeout|Interval)\s*\(\s*["'`]/],
  ];

  it.each(FORBIDDEN)("neither the source nor the build uses %s", (_name, pattern) => {
    expect(source).not.toMatch(pattern);
    expect(built.code).not.toMatch(pattern);
  });

  it("is a single immediately invoked function in strict mode", () => {
    expect(built.code.startsWith("(function () {\n\"use strict\";")).toBe(true);
    expect(built.code.trimEnd().endsWith("})();")).toBe(true);
  });

  it("has one click listener on the document and one load listener, nothing else attached", () => {
    expect(built.code.match(/addEventListener\(/g)).toHaveLength(2);
    expect(built.code).toMatch(/doc\.addEventListener\("click"/);
    expect(built.code).toMatch(/window\.addEventListener\("load"/);
  });

  it("keeps its own list of the nine frame origins, pinned to FRAME_ORIGINS and the tenant policies' frame-src", async () => {
    const origins = [...built.code.matchAll(/"(https:\/\/[a-z0-9.-]+)"/g)].map((m) => m[1]!);
    expect(origins).toHaveLength(9);
    const { FRAME_ORIGINS, TENANT_CONTENT_SECURITY_POLICY, TENANT_PAGE_CSP } = await import(
      "@/lib/routing/tenant-headers"
    );
    // The one shared list, in the order the script holds it.
    expect(origins).toEqual([...FRAME_ORIGINS]);
    for (const policy of [TENANT_CONTENT_SECURITY_POLICY, TENANT_PAGE_CSP]) {
      const frameSrc = /frame-src ([^;]+)/.exec(policy)?.[1]?.split(" ") ?? [];
      expect([...origins].sort()).toEqual([...frameSrc].sort());
    }
  });
});
