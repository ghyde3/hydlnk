import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * Wave L, the rules of src/lib/mcp that are easiest to break by accident, held by scanning the
 * source (M10-01, M10-02, M10-20, M10-21, M10-23, M10-24, M10-31): the tools call shared code and
 * never the secret-key client, the draft is read in one place, nothing here writes `published`,
 * nothing per user lives at module level, and the library options that would send data anywhere
 * are absent.
 */

const ROOT = process.cwd();
const MCP_DIR = "src/lib/mcp";
const ROUTE_DIR = "src/app/(editor)/app/mcp";

function walk(path: string, out: string[] = []): string[] {
  const full = resolve(ROOT, path);
  if (statSync(full).isDirectory()) {
    for (const name of readdirSync(full)) walk(join(path, name), out);
  } else if (/\.tsx?$/.test(path)) {
    out.push(path);
  }
  return out;
}

const read = (file: string) => readFileSync(resolve(ROOT, file), "utf8");
const mcpFiles = walk(MCP_DIR);
const toolFiles = mcpFiles.filter((file) => file.startsWith(`${MCP_DIR}/tools/`));
/** The draft writer lives with the editor's other draft code (M10-23); the same rules scan it. */
const DRAFT_WRITER = "src/lib/editor/draft-write.ts";
const ownFiles = [...mcpFiles, DRAFT_WRITER, ...walk(ROUTE_DIR)];

/** The source without comments, so a comment that names a rule never trips the scan of the rule. */
function code(file: string): string {
  const source = read(file);
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const ranges: Array<[number, number]> = [];
  const visit = (node: ts.Node) => {
    for (const comment of [
      ...(ts.getLeadingCommentRanges(source, node.getFullStart()) ?? []),
      ...(ts.getTrailingCommentRanges(source, node.getEnd()) ?? []),
    ]) {
      ranges.push([comment.pos, comment.end]);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  let out = source;
  for (const [pos, end] of [...new Set(ranges.map((range) => range.join(":")))]
    .map((key) => key.split(":").map(Number) as [number, number])
    .sort((a, b) => b[0] - a[0])) {
    out = out.slice(0, pos) + " ".repeat(end - pos) + out.slice(end);
  }
  return out;
}

describe("the tools share code and never reach the database client themselves", () => {
  it("scans the twelve tools and the registry", () => {
    expect(toolFiles.length).toBeGreaterThanOrEqual(14);
  });

  it("no module under tools/ imports the secret-key client or supabase-js", () => {
    for (const file of toolFiles) {
      expect(code(file), file).not.toMatch(/@\/lib\/supabase\/admin|@supabase\/supabase-js/);
    }
  });

  it("no tool reads a user id from its arguments, a header or a cookie", () => {
    for (const file of toolFiles) {
      const source = code(file);
      expect(source, file).not.toMatch(/args\.(userId|user_id|ownerId|owner_id|email)\b/);
      expect(source, file).not.toMatch(/\b(cookies|headers)\(\)|req\.headers|x-user/i);
    }
  });

  it("every handler is reached through runTool and nowhere else", () => {
    for (const file of mcpFiles.filter((name) => !name.includes("/tools/"))) {
      const source = code(file);
      if (file.endsWith("run-tool.ts")) continue;
      expect(source, file).not.toMatch(/\.handler\(/);
    }
    expect(code(`${MCP_DIR}/server.ts`)).toContain("runTool(tool, identity");
  });
});

describe("the draft is read in one place and written in one", () => {
  it("only page-access.ts and the draft writer select the draft column", () => {
    const selecting = ownFiles.filter((file) =>
      /\.select\([^)]*(\bdraft\b|DRAFT_COLUMNS)/.test(code(file)),
    );
    expect(selecting.sort()).toEqual([DRAFT_WRITER, `${MCP_DIR}/page-access.ts`]);
  });

  it("page-access selects the draft only with the owner filter in the same query", () => {
    const source = code(`${MCP_DIR}/page-access.ts`);
    for (const query of source.split("admin\n").slice(1)) {
      const chain = query.slice(0, 400);
      if (/DRAFT_COLUMNS|withDraft/.test(chain))
        expect(chain).toMatch(/\.eq\("owner_id", userId\)/);
    }
    expect(source).toContain('.eq("owner_id", userId)');
  });

  it("the draft writer's update sets the draft column and nothing else, filtered on id, owner and rev", () => {
    const source = code(DRAFT_WRITER);
    const updates = source.match(/\.update\(\{[^}]*\}\)/g) ?? [];
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatch(/^\.update\(\{ draft: next as unknown as Json \}\)$/);
    expect(source).toMatch(/\.eq\("id", pageId\)\s*\.eq\("owner_id", userId\)/);
    expect(source).toMatch(/draft->>rev/);
  });

  it("nothing under src/lib/mcp writes `published` or `published_at`", () => {
    for (const file of ownFiles) {
      expect(code(file), file).not.toMatch(/\.(update|upsert|insert)\([^)]*published/);
    }
  });

  it("no tool or helper fetches a URL: no fetch, http, https or dns import", () => {
    for (const file of ownFiles) {
      const source = code(file);
      expect(source, file).not.toMatch(
        /\bfetch\(|from "node:(https?|dns|net|tls)"|from "(https?|dns)"|axios|undici/,
      );
    }
  });
});

describe("nothing per user or per request lives at module level", () => {
  /** Module-scope `let` and mutable collections, found with the parser. */
  function moduleState(file: string): string[] {
    const sf = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true);
    const found: string[] = [];
    for (const statement of sf.statements) {
      if (!ts.isVariableStatement(statement)) continue;
      const kind = statement.declarationList.flags & ts.NodeFlags.Let ? "let" : "const";
      for (const declaration of statement.declarationList.declarations) {
        const name = declaration.name.getText(sf);
        const init = declaration.initializer?.getText(sf) ?? "";
        if (kind === "let") found.push(`${file}:${name}`);
        else if (/^new (Map|Set|WeakMap|WeakSet)\b|^\[\]$|^\{\}$/.test(init))
          found.push(`${file}:${name}`);
      }
    }
    return found;
  }

  // Documented exceptions: the secret-key client is stateless and shared by every request.
  const ALLOWED = [`${MCP_DIR}/deps.ts:admin`];

  it("finds no module-scope let and no mutable Map or Set outside the documented list", () => {
    const found = mcpFiles.flatMap(moduleState).filter((entry) => !ALLOWED.includes(entry));
    expect(found).toEqual([]);
  });

  it("the route file holds only the endpoint and a WeakSet of requests", () => {
    const state = walk(ROUTE_DIR).flatMap(moduleState);
    expect(state.map((entry) => entry.split(":")[1]).sort()).toEqual(["unavailable"]);
  });
});

describe("the library options that would send data anywhere are absent", () => {
  const files = ownFiles.map((file) => [file, code(file)] as const);

  it("verbose logs are off, there is no onEvent and no WebMCP bridge", () => {
    for (const [file, source] of files) {
      expect(source, file).not.toMatch(/experimental_webMcp|webmcp-script|\bonEvent\b/);
    }
    expect(code(`${MCP_DIR}/endpoint.ts`)).toMatch(/verboseLogs: false/);
    expect(code(`${MCP_DIR}/endpoint.ts`)).toMatch(/maxSubscriptions: 0/);
  });

  it("mcp-handler's origin helpers are never used, and withMcpAuth always gets an explicit resource URL", () => {
    for (const [file, source] of files) {
      expect(source, file).not.toMatch(
        /getPublicOrigin|getPublicUrl|X-Forwarded|x-forwarded-(host|proto)|\bForwarded\b/,
      );
      for (const call of source.matchAll(
        /(withMcpAuth|protectedResourceHandler|generateProtectedResourceMetadata)\(([\s\S]*?)\);/g,
      )) {
        expect(call[2], `${file}: ${call[1]}`).toMatch(/resourceUrl/);
      }
    }
    const endpoint = code(`${MCP_DIR}/endpoint.ts`);
    expect(endpoint).toMatch(/required: true/);
    expect(endpoint).not.toMatch(/requiredScopes/);
  });

  it("no response sets Access-Control-Allow-Credentials", () => {
    for (const [file, source] of files) {
      const hits = [...source.matchAll(/Access-Control-Allow-Credentials/gi)];
      // The endpoint deletes the header from what it relays; it never sets it.
      for (const hit of hits) {
        const around = source.slice(Math.max(0, hit.index! - 30), hit.index! + 60);
        expect(around, file).toMatch(/headers\.delete\(/);
      }
    }
  });

  it("the three SDK packages are imported only from src/lib/mcp, src/lib/oauth and the route files", () => {
    const allowed = (file: string) =>
      file.startsWith(`${MCP_DIR}/`) ||
      file.startsWith("src/lib/oauth/") ||
      /^src\/app\/\(editor\)\/app\/(mcp|oauth|\.well-known)\//.test(file);
    const offenders = walk("src").filter((file) => {
      if (allowed(file)) return false;
      return /from "(mcp-handler|@modelcontextprotocol\/(server|core))"/.test(read(file));
    });
    expect(offenders).toEqual([]);
  });
});
