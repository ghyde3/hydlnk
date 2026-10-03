import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * M2-08: Storage is reached from server code only, through the secret key. No client code touches
 * `page-media`: replacing or removing an image in the editor changes the draft reference and makes
 * no Storage call, so an object the published copy references stays readable.
 */

const SRC = join(process.cwd(), "src");

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sources(path));
    else if (/\.(ts|tsx)$/.test(name)) out.push(path);
  }
  return out;
}

const files = sources(SRC).map((path) => ({
  path: relative(process.cwd(), path),
  text: readFileSync(path, "utf8"),
}));

const COMMENTS = /\/\*[\s\S]*?\*\/|\/\/.*$/gm;

const isClient = (text: string) => /^\s*(?:\/\*[\s\S]*?\*\/\s*)?["']use client["']/.test(text);

describe("M2-08 Storage stays server-only", () => {
  it("only server modules create a Storage client or call .storage", () => {
    const users = files
      .filter((f) => /\.storage\b|storage\.from\(/.test(f.text.replace(COMMENTS, "")))
      .map((f) => f.path)
      .sort();
    // upload.ts (the route), quota.ts (M4-31: bytes stored per account, an over-quota upload removed),
    // cleanup-admin.ts (M5-14: objects nothing references any more are removed),
    // delete-media.ts (M4-34: an account's objects removed with it) and publish/core.ts (the
    // background object must exist) and versions/core.ts (M6-49: a version's photo and background
    // object are looked up before they are shown or restored). Each imports "server-only", checked below.
    expect(users).toEqual([
      "src/lib/media/cleanup-admin.ts",
      "src/lib/media/quota.ts",
      "src/lib/media/upload.ts",
      "src/lib/pages/delete-media.ts",
      "src/lib/publish/core.ts",
      "src/lib/versions/core.ts",
    ]);
    for (const path of users) {
      expect(files.find((f) => f.path === path)!.text, path).toMatch(/import "server-only"/);
    }
  });

  it("no client component imports the secret-key client or the upload and publish internals", () => {
    const offenders = files
      .filter((f) => isClient(f.text))
      .filter((f) =>
        /@\/lib\/supabase\/admin|@\/lib\/env\/server|@\/lib\/media\/(?:upload|quota|cleanup|cleanup-admin|pipeline|rate-limit)["']|@\/lib\/publish\/core/.test(
          f.text,
        ),
      )
      .map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it("no client component deletes or lists objects", () => {
    const offenders = files
      .filter((f) => isClient(f.text))
      .filter((f) => /\.remove\(\s*\[|storage\/v1\/object|\/storage\//.test(f.text))
      .map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it("the bucket name lives in one place", () => {
    const users = files
      .filter((f) => /["'`]page-media["'`]/.test(f.text.replace(COMMENTS, "")))
      .map((f) => f.path)
      .sort();
    expect(users).toEqual(["src/lib/media/limits.ts"]);
  });
});

describe("M5-12 tenant media is never routed through the image optimizer", () => {
  it("no source file imports next/image (a lint-style check: tenant media is a plain <img>)", () => {
    const offenders = files
      .filter((f) =>
        /from\s+["']next\/image["']|require\(\s*["']next\/image["']\s*\)/.test(
          f.text.replace(COMMENTS, ""),
        ),
      )
      .map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it("the components that draw tenant pages and previews never reach for next/image", () => {
    const tenant = files.filter((f) =>
      /^src\/(components\/(page|design|editor)|app\/\(tenant\))\//.test(f.path),
    );
    expect(tenant.length).toBeGreaterThan(10);
    for (const f of tenant) expect(f.text.replace(COMMENTS, ""), f.path).not.toMatch(/next\/image/);
  });

  it("next.config declares no images block: no remotePatterns, no loader, no /_next/image route for Storage", () => {
    const config = ["next.config.ts", "next.config.mjs", "next.config.js"]
      .map((name) => join(process.cwd(), name))
      .filter((path) => existsSync(path))
      .map((path) => readFileSync(path, "utf8").replace(COMMENTS, ""))
      .join("\n");
    expect(config.length).toBeGreaterThan(0);
    expect(config).not.toMatch(/\bimages\s*:/);
    expect(config).not.toMatch(/remotePatterns|domains\s*:|loaderFile/);
  });
});
