import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The agent harness docs, held by a test so they cannot rot quietly:
 *   (a) CLAUDE.md and AGENTS.md stay short (under 200 lines each) and STATUS.md under 60;
 *   (b) CLAUDE.md keeps the working principles and points at the docs agents rely on;
 *   (c) every repo path that docs/FEATURE_MAP.md, docs/KNOWLEDGE.md and STATUS.md name exists.
 * Reads files only.
 */

const ROOT = resolve(__dirname, "../..");
const read = (path: string) => readFileSync(resolve(ROOT, path), "utf8");
const lines = (path: string) => read(path).split("\n").length;

describe("agent harness docs", () => {
  it("keeps CLAUDE.md, AGENTS.md and STATUS.md short", () => {
    expect(lines("CLAUDE.md")).toBeLessThan(200);
    expect(lines("AGENTS.md")).toBeLessThan(200);
    expect(lines("STATUS.md")).toBeLessThan(60);
  });

  it("keeps the working principles and the pointers in CLAUDE.md", () => {
    const claude = read("CLAUDE.md");
    for (const phrase of [
      "Surface assumptions",
      "Simplicity first",
      "Surgical changes",
      "No done without evidence",
      "Corrections become checks",
      "docs/FEATURE_MAP.md",
      "docs/KNOWLEDGE.md",
      "STATUS.md",
      "scripts/cloud-init.sh",
    ]) {
      expect(claude, `CLAUDE.md should mention "${phrase}"`).toContain(phrase);
    }
  });

  /** Backticked tokens that look like repo paths: a known top-level folder or root file. */
  function repoPaths(doc: string): string[] {
    const found = new Set<string>();
    for (const match of read(doc).matchAll(/`([^`\s]+)`/g)) {
      const token = match[1]!.replace(/[:#].*$/, "").replace(/[.,;]$/, "");
      if (/[*<>{}$]|\.\.\./.test(token)) continue; // globs, placeholders
      const inFolder = /^(src|tests|supabase|scripts|docs|design|\.claude|\.github|public)\//.test(
        token,
      );
      const rootFile = /^[A-Za-z0-9_.-]+\.(md|json|ts|mts|mjs|toml)$/.test(token);
      if (inFolder || rootFile) found.add(token);
    }
    return [...found];
  }

  it.each(["docs/FEATURE_MAP.md", "docs/KNOWLEDGE.md", "STATUS.md"])(
    "%s names only paths that exist",
    (doc) => {
      const missing = repoPaths(doc).filter((path) => !existsSync(resolve(ROOT, path)));
      expect(missing, `${doc} names paths that do not exist`).toEqual([]);
    },
  );
});
