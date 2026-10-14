import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * M15-05 (1b1-23): after the cutover nothing under src/ reads the frozen copies. site_pages and the
 * blocks inside pages.draft / pages.published stay in the database for rollback only; the readers and
 * writers use page entries. Held by scanning the source (comments stripped, so a comment may still
 * name the table). The generated types file is the one exemption; the pre-move fixtures live in
 * tests/ and are not scanned.
 */

const ROOT = process.cwd();
const EXEMPT = new Set(["src/lib/supabase/database.types.ts"]);

function walk(path: string, out: string[] = []): string[] {
  const full = resolve(ROOT, path);
  if (statSync(full).isDirectory()) {
    for (const name of readdirSync(full)) walk(join(path, name), out);
  } else if (/\.tsx?$/.test(path)) {
    out.push(path);
  }
  return out;
}

/** Blank out every comment (offsets kept), so a comment that names a rule never trips the scan. */
function strip(source: string, file = "x.ts"): string {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const ranges = new Set<string>();
  const visit = (node: ts.Node) => {
    for (const c of [
      ...(ts.getLeadingCommentRanges(source, node.getFullStart()) ?? []),
      ...(ts.getTrailingCommentRanges(source, node.getEnd()) ?? []),
    ]) {
      ranges.add(`${c.pos}:${c.end}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  let out = source;
  for (const [pos, end] of [...ranges]
    .map((key) => key.split(":").map(Number) as [number, number])
    .sort((a, b) => b[0] - a[0])) {
    out = out.slice(0, pos) + " ".repeat(end - pos) + out.slice(end);
  }
  return out;
}

/** Any code that names the frozen table: a `.from("site_pages")`, a string, an identifier. */
const SITE_PAGES = /\bsite_pages\b/;
/** A select on pages whose column list names blocks, or a path into the frozen blocks. */
const PAGES_SELECT = /\.from\(\s*(["'`])pages\1\s*\)\s*\.select\(\s*(["'`])((?:(?!\2)[\s\S])*)\2/g;
const BLOCKS_IN_SELECT = /\bblocks\b|(?:draft|published)\s*->>?\s*'?blocks/;

/** The legacy reads found in one source file (empty when clean). */
export function legacyReads(source: string, file = "x.ts"): string[] {
  const code = strip(source, file);
  const found: string[] = [];
  if (SITE_PAGES.test(code)) found.push("names site_pages");
  for (const match of code.matchAll(PAGES_SELECT)) {
    if (BLOCKS_IN_SELECT.test(match[3] ?? "")) found.push(`selects blocks from pages: ${match[3]}`);
  }
  return found;
}

describe("M15-05: no code reads the frozen copies", () => {
  it("fails on a planted .from(\"site_pages\") read", () => {
    expect(legacyReads(`const r = await admin.from("site_pages").select("id");`)).toEqual([
      "names site_pages",
    ]);
    expect(legacyReads("db.from(`site_pages`).select('draft')")).toEqual(["names site_pages"]);
  });

  it("fails on a planted blocks read from pages.draft or pages.published", () => {
    expect(legacyReads(`admin.from("pages").select("id, draft->blocks")`)).toHaveLength(1);
    expect(legacyReads(`admin.from("pages").select("published->>blocks, handle")`)).toHaveLength(1);
    expect(legacyReads(`admin.from("pages").select("id, blocks")`)).toHaveLength(1);
  });

  it("allows what is not a legacy read", () => {
    expect(legacyReads(`// site_pages is frozen\n/* site_pages */ const a = 1;`)).toEqual([]);
    expect(legacyReads(`admin.from("pages").select("id, owner_id, draft")`)).toEqual([]);
    expect(legacyReads(`admin.from("content_entries").select("draft, published")`)).toEqual([]);
    expect(legacyReads(`admin.from("pages").select("draft->>rev")`)).toEqual([]);
  });

  it("finds none under src/", () => {
    const offenders: string[] = [];
    for (const file of walk("src")) {
      if (EXEMPT.has(file)) continue;
      const hits = legacyReads(readFileSync(resolve(ROOT, file), "utf8"), file);
      for (const hit of hits) offenders.push(`${file}: ${hit}`);
    }
    expect(offenders).toEqual([]);
  });

  it("scans the tree (a sanity check that the walk finds the code it is meant to guard)", () => {
    const files = walk("src");
    expect(files.length).toBeGreaterThan(200);
    expect(files).toContain("src/lib/publish/core.ts");
    expect(files).toContain("src/lib/content/index.ts");
  });
});
