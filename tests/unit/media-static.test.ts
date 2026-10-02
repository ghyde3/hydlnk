import { readFileSync, readdirSync, statSync } from "node:fs";
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
    expect(users).toEqual(["src/lib/media/upload.ts", "src/lib/publish/core.ts"]);
    for (const path of users) {
      expect(files.find((f) => f.path === path)!.text, path).toMatch(/import "server-only"/);
    }
  });

  it("no client component imports the secret-key client or the upload and publish internals", () => {
    const offenders = files
      .filter((f) => isClient(f.text))
      .filter((f) =>
        /@\/lib\/supabase\/admin|@\/lib\/env\/server|@\/lib\/media\/upload|@\/lib\/publish\/core/.test(
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
