import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * M8-02, M8-03, M8-04: the shape of the live tenant path, as static scans of the source. The live
 * page is a static route handler that returns finished HTML, so what is reachable from the route
 * files must be plain server code: no client component, no stylesheet import, no request API; the
 * route files are static and cached; `(tenant)` holds no page, layout or boundary file.
 */

const ROOT = process.cwd();
const read = (path: string) => readFileSync(resolve(ROOT, path), "utf8");
const rel = (path: string) => relative(ROOT, path);

const TENANT = "src/app/(tenant)";
// The `[...rest]` siblings are gone (Wave J security review): every path that is not a page answers
// from /sites/unknown, which is `sites/[pageId]/route.ts` with the sentinel id.
const ROUTES = [`${TENANT}/t/[handle]/route.ts`, `${TENANT}/sites/[pageId]/route.ts`];

/** Source without comments (a word in a comment is not a use). */
const code = (source: string) => source.replace(/\/\*[\s\S]*?\*\/|(^|[^:"'`])\/\/.*$/gm, "$1");

const EXTENSIONS = ["", ".ts", ".tsx", ".js", ".mjs", "/index.ts", "/index.tsx"];

function resolveImport(from: string, spec: string): string | null {
  const base = spec.startsWith("@/")
    ? join(ROOT, "src", spec.slice(2))
    : spec.startsWith(".")
      ? resolve(dirname(from), spec)
      : null;
  if (base === null) return null;
  for (const extension of EXTENSIONS) {
    const candidate = `${base}${extension}`;
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/** Runtime imports only: `import type` and `export type` vanish at build time. */
const IMPORT =
  /(?:^|\n)\s*(?:import|export)\s+(?!type\b)(?:[^'";]*?\sfrom\s+)?["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;

function walk(entries: string[]): Map<string, string> {
  const seen = new Map<string, string>();
  const queue = entries.map((entry) => resolve(ROOT, entry));
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    const source = readFileSync(file, "utf8");
    seen.set(file, source);
    if (!/\.(tsx?|jsx?|mjs)$/.test(file)) continue;
    for (const match of code(source).matchAll(IMPORT)) {
      const spec = (match[1] ?? match[2])!;
      const target = resolveImport(file, spec);
      if (target) queue.push(target);
    }
  }
  return seen;
}

const graph = walk(ROUTES);
const files = [...graph.keys()].map(rel).sort();

describe("M8-02 the live path holds no client component", () => {
  it("reaches the renderer, the builder and the panels from the four route files", () => {
    for (const expected of [
      "src/components/page/page-renderer.tsx",
      "src/components/page/blocks.tsx",
      "src/lib/tenant-render/live-page.tsx",
      "src/lib/tenant-render/respond.ts",
      "src/components/tenant/unclaimed-panel.tsx",
      "src/app/(tenant)/published-page.ts",
    ]) {
      expect(files, expected).toContain(expected);
    }
  });

  it("no module reachable from the route files has a 'use client' directive", () => {
    const client = [...graph]
      .filter(([, source]) =>
        /^\s*(?:(?:\/\*[\s\S]*?\*\/|\/\/[^\n]*)\s*)*["']use client["']/.test(source),
      )
      .map(([file]) => rel(file));
    expect(client).toEqual([]);
  });

  it("the only stylesheet in the graph is the renderer's own import, which a route handler never emits (the page's CSS is inlined by the builder from the same files)", () => {
    const css = [...graph.keys()].filter((file) => /\.css$/.test(file)).map(rel);
    expect(css.filter((file) => file !== "src/components/page/page-renderer.css")).toEqual([]);
  });

  it("the live path imports nothing from the editor, the share route or the marketing site", () => {
    const forbidden = files.filter((file) =>
      /^src\/(app\/\((editor|share|marketing)\)|components\/(editor|marketing|workspace)|lib\/editor)/.test(
        file,
      ),
    );
    expect(forbidden).toEqual([]);
  });

  it("uses no hook of React and no browser API in any module of the live path", () => {
    const offenders: string[] = [];
    for (const [file, source] of graph) {
      if (!/\.(tsx?|jsx?)$/.test(file)) continue;
      const text = code(source);
      if (
        /\buse(State|Effect|Ref|Memo|Callback|Context|Reducer|LayoutEffect|Transition)\s*\(/.test(
          text,
        )
      )
        offenders.push(`${rel(file)}: a hook`);
      if (/\b(window|localStorage|sessionStorage|navigator)\./.test(text))
        offenders.push(`${rel(file)}: a browser API`);
    }
    expect(offenders).toEqual([]);
  });
});

describe("M8-04 no request API is read on the live path", () => {
  const PATTERNS: Array<[string, RegExp]> = [
    ["headers()", /\bheaders\s*\(\s*\)/],
    ["cookies()", /\bcookies\s*\(\s*\)/],
    ["searchParams", /\bsearchParams\b/],
    ["request.url", /\brequest\.url\b/],
    ["request.headers", /\brequest\.headers\b/],
    ["nextUrl", /\bnextUrl\b/],
    ["draftMode()", /\bdraftMode\s*\(/],
    ["connection()", /\bconnection\s*\(/],
  ];

  it("none of the modules the route files reach under src/app/(tenant), src/lib/tenant-render and src/components/tenant does", () => {
    const own = [...graph].filter(([file]) =>
      /src\/(app\/\(tenant\)|lib\/tenant-render|components\/tenant|components\/page)\//.test(file),
    );
    const found: string[] = [];
    for (const [file, source] of own) {
      const text = code(source);
      for (const [name, pattern] of PATTERNS) {
        if (pattern.test(text)) found.push(`${rel(file)}: ${name}`);
      }
    }
    expect(found).toEqual([]);
  });

  it("the route handlers do not even take the request as a parameter", () => {
    for (const route of ROUTES) {
      const text = code(read(route));
      expect(text, route).not.toMatch(/\(\s*request\b/);
      expect(text, route).not.toMatch(/\bnew URL\(/);
    }
  });
});

describe("M8-04 the routes are static and cached, never dynamic", () => {
  it.each(ROUTES)("%s is force-static, generated on demand, with the 24-hour backstop", (route) => {
    const text = code(read(route));
    expect(text).toMatch(/export const dynamic = "force-static";/);
    expect(text).toMatch(/export const dynamicParams = true;/);
    expect(text).toMatch(/export const revalidate = 86400;/);
    expect(text).toMatch(/export function generateStaticParams\(\)\s*\{\s*return \[\];\s*\}/);
    // A static handler must not export a method that makes it dynamic.
    expect(text).not.toMatch(/export (async )?function (POST|PUT|PATCH|DELETE|OPTIONS)\b/);
  });

  it("export const revalidate is PAGE_REVALIDATE_SECONDS (a literal, because Next.js reads it statically)", async () => {
    const { PAGE_REVALIDATE_SECONDS } = await import("@/lib/publish/tags");
    expect(PAGE_REVALIDATE_SECONDS).toBe(86_400);
  });

  it("the public read keeps its key, its tag and its backstop", () => {
    const text = code(read(`${TENANT}/published-page.ts`));
    expect(text).toMatch(/\["tenant-page",\s*PUBLIC_READ_CACHE_VERSION,\s*pageId\]/);
    expect(text).toMatch(/tags:\s*\[pageTag\(pageId\)\]/);
    expect(text).toMatch(/revalidate:\s*PAGE_REVALIDATE_SECONDS/);
  });

  it("the OG and counter routes stay dynamic and are not part of the static path", () => {
    for (const route of [
      `${TENANT}/t/[handle]/og/route.ts`,
      `${TENANT}/sites/[pageId]/og/route.ts`,
      `${TENANT}/t/[handle]/hl-query-count/route.ts`,
      `${TENANT}/t/[handle]/hl-fail-next-read/route.ts`,
    ]) {
      expect(read(route), route).toMatch(/export const dynamic = "force-dynamic"/);
    }
  });
});

describe("M8-03 the tenant group has no page, layout or boundary file any more", () => {
  const all: string[] = [];
  const list = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) list(path);
      else all.push(rel(path));
    }
  };
  list(resolve(ROOT, TENANT));

  it("finds no page.tsx, layout.tsx, template.tsx, loading.tsx, error.tsx, not-found.tsx or default.tsx", () => {
    const forbidden = all.filter((file) =>
      /\/(page|layout|template|loading|error|global-error|not-found|default)\.(tsx|ts|jsx|js)$/.test(
        file,
      ),
    );
    expect(forbidden).toEqual([]);
  });

  it("holds only route handlers, the public read and the stylesheet source", () => {
    const unexpected = all.filter(
      (file) =>
        !/\/route\.ts$/.test(file) &&
        !/published-page\.ts$/.test(file) &&
        !/tenant\.css$/.test(file),
    );
    expect(unexpected).toEqual([]);
  });

  it("none of the panels has a 'use client' directive", () => {
    for (const file of readdirSync(resolve(ROOT, "src/components/tenant"))) {
      expect(read(`src/components/tenant/${file}`), file).not.toMatch(/["']use client["']/);
    }
  });
});

describe("M8-02 one renderer, one module that outputs block markup", () => {
  it("PageRenderer's props are the seven it had plus the three of Wave M: site, subPage and inertLinks", () => {
    const text = code(read("src/components/page/page-renderer.tsx"));
    const body = /export interface PageRendererProps \{([\s\S]*?)\n\}/.exec(text)![1]!;
    const props = [...body.matchAll(/^\s{2}(\w+)\??:/gm)].map((match) => match[1]);
    expect(props).toEqual([
      "doc",
      "pageId",
      "mode",
      "chrome",
      "footer",
      "thumbnail",
      "inertEmbeds",
      "inertLinks",
      "site",
      "subPage",
    ]);
  });

  it("nothing in the builder or the panels writes block or renderer markup of its own", () => {
    for (const dir of ["src/lib/tenant-render", "src/components/tenant"]) {
      for (const file of readdirSync(resolve(ROOT, dir))) {
        const text = code(read(`${dir}/${file}`));
        expect(text, `${dir}/${file}`).not.toMatch(/data-block-type|data-page-root|["']pg-[a-z]/);
      }
    }
  });

  it("only the Publish action and the invalidation module import revalidateTag or updateTag", () => {
    const users: string[] = [];
    const scan = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) scan(path);
        else if (/\.(tsx?|jsx?)$/.test(entry.name)) {
          const text = code(readFileSync(path, "utf8"));
          if (
            /import\s*\{[^}]*\b(revalidateTag|updateTag)\b[^}]*\}\s*from\s*["']next\/cache["']/.test(
              text,
            )
          )
            users.push(rel(path));
        }
      }
    };
    scan(resolve(ROOT, "src"));
    expect(users.sort()).toEqual(["src/lib/publish/actions.ts", "src/lib/publish/invalidate.ts"]);
  });
});
