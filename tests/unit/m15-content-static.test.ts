import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * M15-03: src/lib/content is the only code that writes the content tables, held by scanning the
 * source. Comments are stripped first so a comment that names a rule never trips the scan.
 */

const ROOT = process.cwd();
const CONTENT_DIR = "src/lib/content";

function walk(path: string, out: string[] = []): string[] {
  const full = resolve(ROOT, path);
  if (statSync(full).isDirectory()) {
    for (const name of readdirSync(full)) walk(join(path, name), out);
  } else if (/\.tsx?$/.test(path)) {
    out.push(path);
  }
  return out;
}

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

const code = (file: string) => strip(readFileSync(resolve(ROOT, file), "utf8"), file);

export const TABLE_WRITE =
  /\.from\(\s*["'`](?:content_(?:types|entries|entry_revisions|terms|entry_terms)|site_paths)["'`]\s*\)\s*\.(?:insert|update|upsert|delete)\b/;
export const WRITER_RPC =
  /\.rpc\(\s*["'`](?:(?:publish|unpublish|trash|restore)_entry|record_entry_revision)["'`]/;

const outside = walk("src").filter((file) => !file.startsWith(`${CONTENT_DIR}/`));
const inside = walk(CONTENT_DIR);

describe("the scan patterns", () => {
  it("flags a write to a content table", () => {
    expect(TABLE_WRITE.test(`admin.from('content_entries').update({})`)).toBe(true);
    expect(TABLE_WRITE.test(`admin.from("site_paths")\n.delete()`)).toBe(true);
    expect(TABLE_WRITE.test(`admin.from('content_entries').select('id')`)).toBe(false);
  });
  it("flags the writer functions", () => {
    expect(WRITER_RPC.test(`admin.rpc('publish_entry', {})`)).toBe(true);
    expect(WRITER_RPC.test(`admin.rpc("record_entry_revision")`)).toBe(true);
    expect(WRITER_RPC.test(`admin.rpc('publish_site')`)).toBe(false);
  });
  it("ignores a comment that names the rule", () => {
    expect(TABLE_WRITE.test(strip(`// admin.from('content_entries').update(`))).toBe(false);
  });
});

describe("src/lib/content is the only writer", () => {
  it("no other file under src writes a content table or the path registry", () => {
    expect(outside.filter((file) => TABLE_WRITE.test(code(file)))).toEqual([]);
  });
  it("no other file under src calls the entry functions", () => {
    expect(outside.filter((file) => WRITER_RPC.test(code(file)))).toEqual([]);
  });
  it("index.ts starts with import 'server-only'", () => {
    expect(readFileSync(resolve(ROOT, CONTENT_DIR, "index.ts"), "utf8")).toMatch(
      /^(?:\s*\/\*[\s\S]*?\*\/)?\s*import ["']server-only["'];/,
    );
  });
  it("only the wrapper imports the admin client or next/cache", () => {
    const offenders = inside.filter(
      (file) =>
        !/\/(?:index|wrapper|server)\.ts$/.test(file) &&
        /from ["'](?:@\/lib\/supabase\/admin|next\/cache)["']|@\/lib\/publish\/invalidate/.test(
          code(file),
        ),
    );
    expect(offenders).toEqual([]);
  });
});
