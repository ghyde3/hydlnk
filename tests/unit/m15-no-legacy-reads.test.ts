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
 *
 * What fails, per file: the word site_pages; on `.from("pages")`, a select of `*` (or no columns), of
 * `blocks`, with an argument the file does not spell out (a literal, a same-file constant or a choice
 * between them), or built away from the `.from`; a select of the whole `draft` or `published` column
 * (also through `pages!inner(...)`) in a file that is not a listed design reader; and, in a file that
 * does select them, any `.draft.blocks` or `.published.blocks` on something that is not a listed
 * entry row.
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
const BLOCKS_IN_SELECT = /\bblocks\b|(?:draft|published)\s*->>?\s*'?blocks/;
/** Query methods after which a `.from("pages")` chain is a write or a count, not an unseen read. */
const WRITES = new Set(["insert", "update", "upsert", "delete"]);

/**
 * The files that may select the whole `draft` or `published` column of `pages`, each with why: they
 * read the site's design (theme, profile, menu, rev) and take the blocks from Home's page entry.
 * `entries` names the variables in that file that hold a page ENTRY row, so `<name>.draft.blocks`
 * and `<name>.published.blocks` there are entry reads; the same access on anything else fails.
 */
export const DESIGN_READERS: Record<string, { why: string; entries?: string[] }> = {
  "src/app/(tenant)/published-page.ts": {
    why: "the live design; the blocks are replaced by Home's entry's before anything renders",
    entries: ["home"],
  },
  "src/lib/admin/account-queries.ts": { why: "published is only tested for null (is it live)" },
  "src/lib/admin/draft-view.ts": { why: "the admin draft view's design; blocks come from entries" },
  "src/lib/analytics/dashboard/source.ts": { why: "the plan and whether the site is live" },
  "src/lib/analytics/ingest/pages.ts": { why: "the live design; Home's blocks are its entry's" },
  "src/lib/editor/draft-write.ts": {
    why: "the design a tool edits; blocks are read from and written to the entry",
    entries: ["entry"],
  },
  "src/lib/editor/page-data.ts": {
    why: "the editor's design; Home's blocks are loaded from its entry",
    entries: ["homeDraft", "homeEntry", "home"],
  },
  "src/lib/mcp/page-access.ts": {
    why: "the tools' design; Home's blocks are joined from its entry",
  },
  "src/lib/previews/shared.ts": {
    why: "the shared draft link's design; Home's blocks are its entry's draft",
    entries: ["home"],
  },
  "src/lib/publish/core.ts": {
    why: "the design Publish validates; the frozen blocks are dropped and Home's entry's used",
    entries: ["homeDraft"],
  },
  "src/lib/site-pages/sub-pages-core.ts": { why: "Home's draft menu (nav) only" },
  "src/lib/versions/client.ts": {
    why: "the stored design a restore keeps for Undo; blocks are Home's entry's",
    entries: ["home"],
  },
  "src/lib/versions/core.ts": { why: "the design and its rev for record and restore" },
  "src/lib/versions/load.ts": { why: "the live design for History; blocks are Home's entry's" },
};

function unwrap(node: ts.Expression): ts.Expression {
  let current = node;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isTypeAssertionExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

/** Every string a select argument can be, or null when it cannot be known from this file alone. */
function literalValues(node: ts.Expression, sf: ts.SourceFile, depth = 0): string[] | null {
  const expr = unwrap(node);
  if (ts.isStringLiteralLike(expr)) return [expr.text];
  if (depth > 4) return null;
  if (ts.isConditionalExpression(expr)) {
    const a = literalValues(expr.whenTrue, sf, depth + 1);
    const b = literalValues(expr.whenFalse, sf, depth + 1);
    return a && b ? [...a, ...b] : null;
  }
  if (ts.isTemplateExpression(expr)) {
    let out = [expr.head.text];
    for (const span of expr.templateSpans) {
      const values = literalValues(span.expression, sf, depth + 1);
      if (!values) return null;
      out = out.flatMap((prefix) => values.map((v) => prefix + v + span.literal.text));
    }
    return out;
  }
  if (ts.isIdentifier(expr)) {
    // A top-level `const NAME = <literal>` of the same file.
    for (const statement of sf.statements) {
      if (!ts.isVariableStatement(statement)) continue;
      if (!(statement.declarationList.flags & ts.NodeFlags.Const)) continue;
      for (const decl of statement.declarationList.declarations) {
        if (ts.isIdentifier(decl.name) && decl.name.text === expr.text && decl.initializer) {
          return literalValues(decl.initializer, sf, depth + 1);
        }
      }
    }
  }
  return null;
}

/** The top-level columns of a PostgREST select list (commas inside parentheses do not split). */
function columns(list: string): string[] {
  const out: string[] = [];
  let level = 0;
  let current = "";
  for (const ch of list) {
    if (ch === "(") level += 1;
    if (ch === ")") level -= 1;
    if (ch === "," && level === 0) {
      out.push(current.trim());
      current = "";
    } else current += ch;
  }
  out.push(current.trim());
  return out.filter((c) => c !== "");
}

/** What a column list of `pages` does that the frozen copies forbid, and whether it takes a whole document. */
function judgeColumns(list: string): { problems: string[]; wholeDoc: boolean } {
  const problems: string[] = [];
  let wholeDoc = false;
  if (list.trim() === "") problems.push("selects * from pages (an empty select)");
  for (const column of columns(list)) {
    // An embedded resource is judged on its own (pages(...) below); other tables are not ours.
    if (column.includes("(")) continue;
    if (column.includes("*")) problems.push(`selects * from pages: ${list}`);
    else if (BLOCKS_IN_SELECT.test(column)) problems.push(`selects blocks from pages: ${list}`);
    else {
      const source = (column.includes(":") ? column.slice(column.indexOf(":") + 1) : column)
        .split("::")[0]!
        .trim();
      if (source === "draft" || source === "published") wholeDoc = true;
    }
  }
  return { problems, wholeDoc };
}

/** The column lists of `pages` embedded in another table's select: `pages!inner(a, b)`, `pages(a)`. */
function embeddedPagesLists(select: string): string[] {
  const out: string[] = [];
  const opener = /(?:^|[\s,(:])pages(?:![a-z_]+)?\s*\(/g;
  for (let match = opener.exec(select); match; match = opener.exec(select)) {
    let level = 1;
    let index = opener.lastIndex;
    while (index < select.length && level > 0) {
      if (select[index] === "(") level += 1;
      if (select[index] === ")") level -= 1;
      index += 1;
    }
    out.push(select.slice(opener.lastIndex, index - 1));
  }
  return out;
}

/** The legacy reads found in one source file (empty when clean). */
export function legacyReads(source: string, file = "x.ts"): string[] {
  const code = strip(source, file);
  const found: string[] = [];
  if (SITE_PAGES.test(code)) found.push("names site_pages");

  const sf = ts.createSourceFile(
    file,
    code,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  let wholeDoc = false;
  const judge = (list: string) => {
    const verdict = judgeColumns(list);
    found.push(...verdict.problems);
    if (verdict.wholeDoc) wholeDoc = true;
  };
  const blockReads: Array<{ receiver: string; text: string }> = [];

  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text;
      const first = node.arguments[0];
      // .from("pages") and everything chained on it.
      if (
        method === "from" &&
        node.arguments.length === 1 &&
        first &&
        ts.isStringLiteralLike(first) &&
        first.text === "pages"
      ) {
        let current: ts.Node = node;
        let selects = 0;
        let writes = 0;
        while (
          current.parent &&
          ts.isPropertyAccessExpression(current.parent) &&
          ts.isCallExpression(current.parent.parent)
        ) {
          const call: ts.CallExpression = current.parent.parent;
          const name = current.parent.name.text;
          if (WRITES.has(name)) writes += 1;
          if (name === "select") {
            selects += 1;
            const arg = call.arguments[0];
            if (!arg) found.push("selects * from pages (select with no columns)");
            else {
              const values = literalValues(arg, sf);
              if (!values) {
                found.push(
                  `selects from pages with columns this file does not spell out: ${arg.getText(sf)}`,
                );
              } else values.forEach(judge);
            }
          }
          current = call;
        }
        if (selects === 0 && writes === 0) {
          found.push('builds a pages query whose select is not chained on .from("pages")');
        }
      }
      // pages embedded in another table's select.
      if (method === "select" && first) {
        for (const value of literalValues(first, sf) ?? []) {
          embeddedPagesLists(value).forEach(judge);
        }
      }
    }
    // <x>.draft.blocks and <x>.published.blocks (also ?. and ["blocks"], through casts).
    const named =
      ts.isPropertyAccessExpression(node) && node.name.text === "blocks"
        ? node.expression
        : ts.isElementAccessExpression(node) &&
            ts.isStringLiteralLike(node.argumentExpression) &&
            node.argumentExpression.text === "blocks"
          ? node.expression
          : null;
    if (named) {
      const holder = unwrap(named);
      if (
        ts.isPropertyAccessExpression(holder) &&
        (holder.name.text === "draft" || holder.name.text === "published")
      ) {
        blockReads.push({
          receiver: unwrap(holder.expression).getText(sf).replace(/\s+/g, ""),
          text: node.getText(sf).replace(/\s+/g, " "),
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

  if (wholeDoc) {
    const allowed = DESIGN_READERS[file];
    if (!allowed) {
      found.push("selects pages.draft or pages.published whole and is not a listed design reader");
    }
    const entries = new Set(allowed?.entries ?? []);
    for (const read of blockReads) {
      if (!entries.has(read.receiver)) {
        found.push(
          `reads the blocks of a draft or published copy next to a pages select: ${read.text}`,
        );
      }
    }
  }
  return found;
}

describe("M15-05: no code reads the frozen copies", () => {
  it('fails on a planted .from("site_pages") read', () => {
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

  it('fails on select("*") and on a select with no columns on pages', () => {
    expect(legacyReads(`admin.from("pages").select("*").eq("id", id)`)).toHaveLength(1);
    expect(legacyReads(`admin.from("pages").select()`)).toHaveLength(1);
    expect(legacyReads(`admin.from("pages").select("id, accounts!inner(plan), *")`)).toHaveLength(
      1,
    );
    expect(
      legacyReads(`admin.from("pages").update({ name }).eq("id", id).select("*")`),
    ).toHaveLength(1);
    expect(legacyReads(`admin.from("domains").select("id, pages!inner(*)")`)).toHaveLength(1);
  });

  it("fails on a select argument the file does not spell out", () => {
    expect(legacyReads(`admin.from("pages").select(columns)`)).toHaveLength(1);
    expect(legacyReads(`admin.from("pages").select(cols.join(","))`)).toHaveLength(1);
    expect(legacyReads(`const q = admin.from("pages"); q.select("id");`)).toHaveLength(1);
    // A constant of the same file is spelled out, and is judged by its value.
    expect(legacyReads(`const C = "id, handle";\nadmin.from("pages").select(C)`)).toEqual([]);
    expect(legacyReads(`const C = "id, blocks";\nadmin.from("pages").select(C)`)).toHaveLength(1);
    expect(
      legacyReads(
        `const B = "id";\nconst C = \`\${B}, draft->blocks\`;\nadmin.from("pages").select(w ? C : B)`,
      ),
    ).toHaveLength(1);
  });

  it("fails on a whole draft or published select outside the listed design readers", () => {
    expect(legacyReads(`admin.from("pages").select("id, draft")`, "src/lib/new/thing.ts")).toEqual([
      "selects pages.draft or pages.published whole and is not a listed design reader",
    ]);
    expect(
      legacyReads(`admin.from("pages").select("doc:published")`, "src/lib/new/thing.ts"),
    ).toHaveLength(1);
    expect(
      legacyReads(
        `admin.from("domains").select("id, pages!inner(id, draft)")`,
        "src/lib/new/thing.ts",
      ),
    ).toHaveLength(1);
  });

  it("fails on .draft.blocks or .published.blocks after a draft or published select, even in a listed reader", () => {
    const reader = "src/lib/versions/load.ts";
    const select = `const row = await admin.from("pages").select("draft, published").single();\n`;
    expect(legacyReads(select, reader)).toEqual([]);
    expect(legacyReads(`${select}use(row.data.draft.blocks);`, reader)).toHaveLength(1);
    expect(legacyReads(`${select}use(row.data.published?.blocks);`, reader)).toHaveLength(1);
    expect(
      legacyReads(`${select}use((row.data.draft as { blocks?: unknown } | null)?.blocks);`, reader),
    ).toHaveLength(1);
    expect(legacyReads(`${select}use(row.data.published!["blocks"]);`, reader)).toHaveLength(1);
    // An entry row the list names for that file is not a frozen copy.
    expect(legacyReads(`${select}use(home.draft.blocks);`, "src/lib/versions/client.ts")).toEqual(
      [],
    );
    expect(
      legacyReads(`${select}use(page.draft.blocks);`, "src/lib/versions/client.ts"),
    ).toHaveLength(1);
  });

  it("every listed design reader exists, says why, and still selects draft or published from pages", () => {
    for (const [file, entry] of Object.entries(DESIGN_READERS)) {
      expect(entry.why.length, file).toBeGreaterThan(10);
      const source = readFileSync(resolve(ROOT, file), "utf8");
      // Not on the list, the same file must trip the whole-document rule: the entry is still needed.
      expect(legacyReads(source, `${file}.unlisted`), file).toContain(
        "selects pages.draft or pages.published whole and is not a listed design reader",
      );
    }
  });

  it("allows what is not a legacy read", () => {
    expect(legacyReads(`// site_pages is frozen\n/* site_pages */ const a = 1;`)).toEqual([]);
    expect(
      legacyReads(`admin.from("pages").select("id, owner_id, draft")`, "src/lib/publish/core.ts"),
    ).toEqual([]);
    expect(legacyReads(`admin.from("pages").update({ draft }).eq("id", id)`)).toEqual([]);
    expect(legacyReads(`admin.from("pages").select("id, domains(hostname, status)")`)).toEqual([]);
    expect(legacyReads(`admin.from("domains").select("id, pages!inner(owner_id)")`)).toEqual([]);
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
