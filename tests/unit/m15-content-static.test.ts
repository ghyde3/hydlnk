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
  /\.rpc\(\s*["'`](?:(?:publish|unpublish|trash|restore)_entry|record_entry_revision|purge_trashed_entries|claim_site_path)["'`]/;
/** Any `.from(` of a content table that is not directly a read; catches `const t = admin.from(...)`. */
export const TABLE_FROM_NOT_READ =
  /\.from\(\s*["'`](?:content_(?:types|entries|entry_revisions|terms|entry_terms)|site_paths)["'`]\s*\)(?!\s*\.select\b)/;
const TABLE_NAME = /content_(?:types|entries|entry_revisions|terms|entry_terms)|site_paths/;
const WRITE_CALL = /\.(?:insert|update|upsert|delete)\(/;
/** Files outside the writer that may name a content table (generated types hold no calls). */
const TABLE_NAME_ALLOWED = new Set(["src/lib/supabase/database.types.ts"]);
/** An import that reaches into the writer's files instead of its index. */
export const DEEP_IMPORT =
  /from\s+["'](?:@\/lib\/content\/(?!schemas(?:\/|["']))|(?:\.\.?\/)+(?:lib\/)?content\/(?!schemas(?:\/|["'])))/;

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
  it("flags a write made through a variable or a constant", () => {
    expect(
      TABLE_FROM_NOT_READ.test(`const t = admin.from("content_entries");\nawait t.update({})`),
    ).toBe(true);
    expect(TABLE_FROM_NOT_READ.test(`admin.from('content_entries').select('id')`)).toBe(false);
    expect(WRITER_RPC.test(`admin.rpc('purge_trashed_entries')`)).toBe(true);
    expect(WRITER_RPC.test(`admin.rpc('claim_site_path', {})`)).toBe(true);
    expect(DEEP_IMPORT.test(`import { x } from "@/lib/content/publish-core";`)).toBe(true);
    expect(DEEP_IMPORT.test(`import { x } from "@/lib/content";`)).toBe(false);
    expect(DEEP_IMPORT.test(`import { x } from "@/lib/content/schemas";`)).toBe(false);
    expect(DEEP_IMPORT.test(`import { x } from "@/lib/content/schemas/post";`)).toBe(false);
    expect(DEEP_IMPORT.test(`import { x } from "@/lib/content/schemas-evil";`)).toBe(true);
  });
  it("ignores a comment that names the rule", () => {
    expect(TABLE_WRITE.test(strip(`// admin.from('content_entries').update(`))).toBe(false);
  });
});

describe("src/lib/content is the only writer", () => {
  it("no other file under src writes a content table or the path registry", () => {
    expect(outside.filter((file) => TABLE_WRITE.test(code(file)))).toEqual([]);
  });
  it("no other file under src takes a content table for anything but a read", () => {
    expect(outside.filter((file) => TABLE_FROM_NOT_READ.test(code(file)))).toEqual([]);
  });
  it("no other file names a content table next to a write call", () => {
    expect(
      outside.filter(
        (file) =>
          !TABLE_NAME_ALLOWED.has(file) &&
          TABLE_NAME.test(code(file)) &&
          WRITE_CALL.test(code(file)),
      ),
    ).toEqual([]);
  });
  it("no other file imports past the index of the writer", () => {
    expect(outside.filter((file) => DEEP_IMPORT.test(code(file)))).toEqual([]);
  });
  it("the cores and their helpers import server-only", () => {
    const files = readdirSync(resolve(ROOT, CONTENT_DIR)).filter((name) =>
      /(?:-core|^guards|^blocklist|^images)\.ts$/.test(name),
    );
    expect(files.length).toBeGreaterThanOrEqual(10);
    for (const name of files) {
      expect(readFileSync(resolve(ROOT, CONTENT_DIR, name), "utf8"), name).toMatch(
        /^(?:\s*\/\*[\s\S]*?\*\/)?\s*import ["']server-only["'];/,
      );
    }
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

describe("the shared schemas module", () => {
  const schemaFiles = walk(`${CONTENT_DIR}/schemas`);
  it("holds the post schemas, limits and list enums", () => {
    expect(schemaFiles.length).toBeGreaterThanOrEqual(4);
    const index = readFileSync(resolve(ROOT, CONTENT_DIR, "schemas/index.ts"), "utf8");
    expect(index).toMatch(/POST_LIMITS/);
    expect(index).toMatch(/LIST_SORTS/);
  });
  it("nothing under it imports server-only, the admin client or next/cache", () => {
    const offenders = schemaFiles.filter((file) =>
      /server-only|@\/lib\/supabase\/admin|next\/cache|@\/lib\/publish\/invalidate/.test(
        code(file),
      ),
    );
    expect(offenders).toEqual([]);
  });
  it("imports only from itself, zod and the document modules, none of which are server-only", () => {
    for (const file of schemaFiles) {
      const imports = [...code(file).matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]);
      for (const spec of imports) {
        if (spec === undefined) continue;
        expect(spec, file).toMatch(/^(?:zod|\.\/.*|@\/lib\/document\/.*)$/);
        if (spec.startsWith("@/lib/document/")) {
          const target = `src/${spec.slice(2)}.ts`;
          expect(code(target), target).not.toMatch(/server-only|supabase\/admin|next\/cache/);
        }
      }
    }
  });
});
