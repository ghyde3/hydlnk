import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * M6-09, M6-10, M6-11, M6-12 static checks: the share link is the one ungated route that reads a
 * draft; nothing public selects `draft`; the secret key stays on the server; the proxy half of the
 * share feature carries no `server-only` import; the token is never logged.
 */

const ROOT = process.cwd();
const read = (path: string) => readFileSync(resolve(ROOT, path), "utf8");
/** The code of a file without its comments, so a sentence that names a rule is not mistaken for a breach of it. */
const code = (path: string) =>
  read(path)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

function walk(dir: string, out: string[] = []): string[] {
  const abs = resolve(ROOT, dir);
  for (const name of readdirSync(abs)) {
    const path = join(dir, name);
    if (statSync(resolve(ROOT, path)).isDirectory()) walk(path, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(path);
  }
  return out;
}

/** The text of every `.select(...)` call in a source file (the first argument, as written). */
function selectArguments(source: string): string[] {
  const found: string[] = [];
  const pattern = /\.select\(\s*(`[^`]*`|"[^"]*"|'[^']*')/g;
  for (let match = pattern.exec(source); match; match = pattern.exec(source)) {
    found.push(match[1]!);
  }
  return found;
}

describe("M6-10 isolation: nothing public reads a draft", () => {
  const publicDirs = ["src/app/(tenant)", "src/app/(marketing)", "src/components/tenant"];
  const publicFiles = publicDirs.flatMap((dir) => walk(dir));

  it("finds the public modules", () => {
    expect(publicFiles.length).toBeGreaterThan(10);
    expect(publicFiles).toContain("src/app/(tenant)/published-page.ts");
  });

  it.each(publicFiles.map((file) => [file]))("%s selects no draft and no *", (file) => {
    for (const argument of selectArguments(read(file))) {
      expect(argument, `${file}: ${argument}`).not.toMatch(/\bdraft\b/);
    }
  });

  it("the share route is the only ungated page route that reads a draft", () => {
    const ungated = walk("src/app/(editor)/app").filter(
      (file) => !file.includes("/(screens)/") && !file.includes("/admin/"),
    );
    const readers = ungated.filter((file) => {
      const source = read(file);
      return selectArguments(source).some((argument) => /\bdraft\b/.test(argument));
    });
    // Route files select no draft themselves: the share page goes through its one loader, and the
    // owner's preview reads through the editor's loader, with the user's own session.
    expect(readers).toEqual([]);

    // The share route lives in its own route group, `(share)`: everything outside the signed-in
    // screens and the admin screens counts as ungated.
    const importsLoader = [...ungated, ...walk("src/app/(share)")].filter((file) =>
      read(file).includes("@/lib/previews/shared"),
    );
    expect(importsLoader).toEqual(["src/app/(share)/app/share/page.tsx"]);

    const previewLibs = walk("src/lib/previews").filter((file) =>
      selectArguments(read(file)).some((argument) => /\bdraft\b/.test(argument)),
    );
    expect(previewLibs).toEqual(["src/lib/previews/shared.ts"]);
  });

  it("the share loader selects named columns only, never *, and no account field but plan and suspension", () => {
    const [links, themes] = selectArguments(read("src/lib/previews/shared.ts"));
    expect(links).toBeDefined();
    expect(links).not.toContain("*");
    expect(themes).not.toContain("*");
    expect(links).toContain("accounts!inner(plan, suspended_at)");
    expect(links).not.toMatch(/email|stripe|customer|role/);
  });
});

describe("M6-11 the owner's draft preview reads with the user's own session", () => {
  const route = "src/app/(editor)/app/preview/[pageId]/page.tsx";

  it("imports no secret-key client and no server env", () => {
    const source = code(route);
    expect(source).not.toMatch(/@\/lib\/supabase\/admin/);
    expect(source).not.toMatch(/createAdminSupabase/);
    expect(source).not.toMatch(/@\/lib\/env\/server/);
    expect(source).not.toMatch(/SUPABASE_SECRET_KEY/);
    expect(source).toContain("createServerSupabase");
  });

  it("checks ownership from pages.owner_id and never reads the hl-page cookie", () => {
    const source = code(route);
    expect(source).toMatch(/\.eq\("owner_id", user\.id\)/);
    expect(source).not.toMatch(/hl-page|CURRENT_PAGE_COOKIE|getCurrentPage|cookies\(/);
  });

  it("is gated before anything of the draft is read", () => {
    const source = read(route);
    expect(source.indexOf("requireUser()")).toBeGreaterThan(-1);
    expect(source.indexOf("requireUser()")).toBeLessThan(source.indexOf("loadEditorPageData("));
  });
});

describe("M6-09 the share feature's server code", () => {
  it("the actions file is a server action module and is server-only", () => {
    const source = read("src/lib/previews/actions.ts");
    expect(source.trimStart().startsWith('"use server"')).toBe(true);
    expect(source).toContain('import "server-only"');
    expect(source).toContain("createAdminSupabase");
  });

  it("no client component imports the secret-key client or the server env", () => {
    for (const file of [
      ...walk("src/components/previews"),
      "src/components/editor/page-name.tsx",
    ]) {
      const source = read(file);
      expect(source, file).not.toMatch(
        /@\/lib\/supabase\/admin|@\/lib\/env\/server|SUPABASE_SECRET_KEY/,
      );
    }
    // The dialog reaches the server only through the actions module.
    expect(read("src/components/previews/share-preview.tsx")).toContain("@/lib/previews/actions");
  });

  it("the proxy half has no server-only import and no secret-key client (the proxy bundle cannot load them)", () => {
    for (const file of [
      "src/lib/previews/share-headers.ts",
      "src/lib/previews/share-limit.ts",
      "src/lib/previews/share-proxy.ts",
    ]) {
      const source = code(file);
      expect(source, file).not.toMatch(/server-only/);
      expect(source, file).not.toMatch(/@\/lib\/supabase\/admin|@\/lib\/env\/server/);
    }
  });

  it("no module of the feature logs or interpolates a token into a message", () => {
    for (const file of walk("src/lib/previews")) {
      const source = read(file);
      for (const line of source.split("\n")) {
        if (!/console\.(log|info|warn|error|debug)/.test(line)) continue;
        expect(line, `${file}: ${line.trim()}`).not.toMatch(/token|url|hash/i);
      }
    }
  });

  it("only the hash is stored: the insert carries a page id and a hash, nothing else", () => {
    const source = read("src/lib/previews/core.ts");
    expect(source).toMatch(
      /\.insert\(\{ page_id: pageId, token_hash: hashPreviewToken\(token\) \}\)/,
    );
    expect(source).not.toMatch(/expires_at:/);
  });

  it("no secret-key string is written anywhere in the feature", () => {
    const files = [
      ...walk("src/lib/previews"),
      ...walk("src/components/previews"),
      ...walk("src/app/(share)"),
      ...walk("src/app/(editor)/app/preview"),
    ];
    for (const file of files) {
      expect(read(file), relative(".", file)).not.toMatch(/sb_secret_/);
    }
  });
});

describe("M6-10 the share route", () => {
  it("is dynamic, has no OG or Twitter tags and is not indexed", () => {
    const source = read("src/app/(share)/app/share/page.tsx");
    expect(source).toContain('export const dynamic = "force-dynamic"');
    expect(source).toMatch(/robots = \{ index: false, follow: false \}/);
    expect(source).not.toMatch(/openGraph|twitter/);
  });

  it("renders no view beacon and no tenant page wrapper", () => {
    for (const file of [
      "src/app/(share)/app/share/page.tsx",
      "src/app/(editor)/app/preview/[pageId]/page.tsx",
    ]) {
      const source = read(file);
      expect(source, file).not.toMatch(/ViewBeacon|view-beacon|TenantPage\b/);
      expect(source, file).toContain('mode="preview"');
      expect(source, file).toContain("PreviewFrame");
    }
  });

  it("the 404 is one component with one sentence and reads no session", () => {
    const source = read("src/app/(share)/not-found.tsx");
    expect(source).toContain("INACTIVE_LINK_MESSAGE");
    expect(source).not.toMatch(/getAppContext|getSessionUser|cookies\(|headers\(/);
  });
});

// Import graph ------------------------------------------------------------------------------------

/** `@/x` and relative specifiers of a source file as repo-relative paths of files that exist (packages are skipped). */
function importsOf(file: string): string[] {
  const source = code(file);
  const found: string[] = [];
  const pattern = /(?:\bfrom\s+|\bimport\s*\(\s*|^\s*import\s+)["']([^"']+)["']/gm;
  for (let match = pattern.exec(source); match; match = pattern.exec(source)) {
    const specifier = match[1]!;
    const base = specifier.startsWith("@/")
      ? join("src", specifier.slice(2))
      : specifier.startsWith(".")
        ? join(file, "..", specifier)
        : null;
    if (!base) continue;
    for (const candidate of [
      base,
      `${base}.ts`,
      `${base}.tsx`,
      join(base, "index.ts"),
      join(base, "index.tsx"),
    ]) {
      try {
        if (statSync(resolve(ROOT, candidate)).isFile() && /\.(ts|tsx)$/.test(candidate)) {
          found.push(candidate);
          break;
        }
      } catch {
        // not this candidate
      }
    }
  }
  return found;
}

/** Every repo file `entries` reach through static and dynamic imports (the entries included). */
function reachable(entries: string[]): Set<string> {
  const seen = new Set<string>();
  const queue = [...entries];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    queue.push(...importsOf(file));
  }
  return seen;
}

describe("M6-10 the share route ships nothing of the signed-in app", () => {
  const entries = [
    "src/app/(share)/layout.tsx",
    "src/app/(share)/not-found.tsx",
    "src/app/(share)/error.tsx",
    "src/app/(share)/app/share/page.tsx",
  ];
  const graph = [...reachable(entries)];

  it("finds the route's modules (the crawler works)", () => {
    expect(graph).toContain("src/components/page/page-renderer.tsx");
    expect(graph).toContain("src/components/previews/preview-bars.tsx");
    expect(graph).toContain("src/lib/previews/shared.ts");
    expect(graph.length).toBeGreaterThan(20);
  });

  it("reaches no browser Supabase client, no editor module, no app shell and no preview-link action", () => {
    const forbidden = graph.filter((file) =>
      /^src\/(?:lib\/supabase\/browser|components\/editor\/(?!status-chip)|components\/app\/|components\/admin\/|components\/previews\/(?:share-preview|preview-link)|lib\/previews\/actions|lib\/pages\/(?:context|maybe-context))/.test(
        file,
      ),
    );
    expect(forbidden).toEqual([]);
  });

  it("the preview bars import the status chip from its own module, not from the editor header", () => {
    const bars = code("src/components/previews/preview-bars.tsx");
    expect(bars).toContain("@/components/editor/status-chip");
    expect(bars).not.toContain("editor-header");
    const chip = read("src/components/editor/status-chip.tsx");
    expect(chip).not.toMatch(/^"use client"/);
    expect(code("src/components/editor/status-chip.tsx")).not.toMatch(
      /components\/editor|supabase/,
    );
    // The header uses the same chip.
    expect(code("src/components/editor/editor-header.tsx")).toContain('from "./status-chip"');
  });

  it("is a route group of its own, with its own root layout, 404 and error page; none reads a session", () => {
    for (const file of [
      "src/app/(share)/layout.tsx",
      "src/app/(share)/not-found.tsx",
      "src/app/(share)/error.tsx",
    ]) {
      expect(code(file), file).not.toMatch(
        /getAppContext|getSessionUser|maybe-context|cookies\(|supabase/,
      );
    }
    // And the editor's own groups no longer hold it.
    expect(() => statSync(resolve(ROOT, "src/app/(editor)/app/share"))).toThrow();
    expect(read("src/app/(share)/layout.tsx")).toMatch(/robots: \{ index: false, follow: false \}/);
  });
});
