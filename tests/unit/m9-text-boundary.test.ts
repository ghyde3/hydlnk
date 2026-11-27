import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * M9-12: the library boundary of the rich text editor, as static scans of the source. Tiptap and
 * ProseMirror are imported only by the editor module (`src/components/blocks/forms/text-editor/`),
 * which the text form loads on demand; nothing a visitor receives reaches them (the tenant routes
 * and everything under them, the renderer, the share page, the marketing site, the one tenant
 * script). The editor stores structured marks only: it never reads or writes HTML, makes no request
 * and keeps nothing in the browser's storage.
 *
 * Wave B (M16-13) adds the library's second and last home: the post body editor
 * (`src/components/posts/body-editor/`), which edits a post's Markdown body. Its one door is the
 * post editor (`src/components/posts/post-editor.tsx`), and that component is drawn by one route
 * only, `/posts/[entryId]`, whose whole purpose is that editor. So the library sits in that
 * route's own chunk: the workspace (Edit, Design, Share) still loads none of it, and the rules
 * for what a visitor receives are unchanged and now name both modules.
 */

const ROOT = process.cwd();
const rel = (path: string) => relative(ROOT, path);
const code = (source: string) => source.replace(/\/\*[\s\S]*?\*\/|(^|[^:"'`])\/\/.*$/gm, "$1");

const EDITOR_DIR = "src/components/blocks/forms/text-editor";
const BODY_EDITOR_DIR = "src/components/posts/body-editor";
const BODY_EDITOR_DOOR = "src/components/posts/post-editor.tsx";
const BODY_EDITOR_ROUTE = "src/app/(editor)/app/(screens)/posts/[entryId]/page.tsx";
const LIBRARY_DIRS = [EDITOR_DIR, BODY_EDITOR_DIR];
const BANNED = /^(@tiptap\/|prosemirror-)/;

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

/** Runtime imports only (`import type` and `export type` vanish at build time), dynamic ones included. */
const IMPORT =
  /(?:^|\n)\s*(?:import|export)\s+(?!type\b)(?:[^'";]*?\sfrom\s+)?["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;

const filesUnder = (dir: string): string[] =>
  readdirSync(resolve(ROOT, dir)).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(resolve(ROOT, path)).isDirectory()) return filesUnder(path);
    return /\.(tsx?|js|mjs)$/.test(name) ? [path] : [];
  });

/** Every module reachable from `entries`, and every bare package specifier on the way. */
function reach(entries: string[]) {
  const modules = new Map<string, string>();
  const packages = new Map<string, string>();
  const queue = entries.map((entry) => resolve(ROOT, entry));
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (modules.has(file)) continue;
    const source = readFileSync(file, "utf8");
    modules.set(file, source);
    for (const match of code(source).matchAll(IMPORT)) {
      const spec = (match[1] ?? match[2])!;
      const target = resolveImport(file, spec);
      if (target) queue.push(target);
      else if (!spec.startsWith(".") && !spec.startsWith("@/")) packages.set(spec, rel(file));
    }
  }
  return { modules, packages };
}

const PUBLIC_ROOTS = [
  ...filesUnder("src/app/(tenant)"),
  ...filesUnder("src/app/(share)"),
  ...filesUnder("src/app/(marketing)"),
  ...filesUnder("src/components/page"),
  ...filesUnder("src/components/tenant"),
  ...filesUnder("src/components/marketing"),
  ...filesUnder("src/lib/tenant-render"),
  ...filesUnder("src/lib/tenant-assets"),
];

describe("M9-12 nothing a visitor receives reaches the editor library", () => {
  const { modules, packages } = reach(PUBLIC_ROOTS);

  it("starts from the tenant routes, the renderer, the share page, the marketing site and the tenant script", () => {
    const names = [...modules.keys()].map(rel);
    for (const expected of [
      "src/components/page/blocks.tsx",
      "src/lib/tenant-render/live-page.tsx",
      "src/lib/tenant-assets/script/tenant.js",
    ]) {
      expect(names, expected).toContain(expected);
    }
    expect(names.some((name) => name.startsWith("src/app/(marketing)/"))).toBe(true);
    expect(names.some((name) => name.startsWith("src/app/(share)/"))).toBe(true);
  });

  it("reaches no module of the text editor and no Tiptap or ProseMirror package", () => {
    const editor = [...modules.keys()]
      .map(rel)
      .filter((file) => LIBRARY_DIRS.some((dir) => file.startsWith(dir)));
    expect(editor).toEqual([]);
    const banned = [...packages].filter(([spec]) => BANNED.test(spec));
    expect(banned).toEqual([]);
  });

  it("does not reach the text form either, which is the editor's one door", () => {
    const form = [...modules.keys()]
      .map(rel)
      .filter((file) => file.endsWith("forms/text-form.tsx"));
    expect(form).toEqual([]);
  });

  it("does not reach the post editor, the body editor's one door", () => {
    expect([...modules.keys()].map(rel)).not.toContain(BODY_EDITOR_DOOR);
  });

  it("the tenant script names neither library", () => {
    const script = readFileSync(resolve(ROOT, "src/lib/tenant-assets/script/tenant.js"), "utf8");
    expect(script).not.toMatch(/tiptap|prosemirror/i);
  });
});

describe("M9-12 the editor modules are the only importers of the library", () => {
  it("no file outside the two editor modules imports @tiptap or prosemirror at run time or build time", () => {
    const offenders: string[] = [];
    for (const file of [...filesUnder("src"), ...filesUnder("scripts")]) {
      if (LIBRARY_DIRS.some((dir) => file.startsWith(dir))) continue;
      const source = code(readFileSync(resolve(ROOT, file), "utf8"));
      if (/["'](@tiptap\/|prosemirror-)/.test(source)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  it("the text form reaches the editor only through a dynamic import() (a type import is erased)", () => {
    const source = code(
      readFileSync(resolve(ROOT, "src/components/blocks/forms/text-form.tsx"), "utf8"),
    );
    const staticImports = [
      ...source.matchAll(/(?:^|\n)\s*import\s+(?!type\b)[^'";]*?from\s+["']([^"']+)["']/g),
    ].map((m) => m[1]!);
    expect(staticImports.filter((spec) => spec.includes("text-editor"))).toEqual([]);
    expect(source).toMatch(/import\(\s*["']\.\/text-editor\/text-editor["']\s*\)/);
  });

  it("no other module of the blocks forms or the editor screen imports the editor module", () => {
    const offenders = [
      ...filesUnder("src/components"),
      ...filesUnder("src/lib"),
      ...filesUnder("src/app"),
    ]
      .filter((file) => !file.startsWith(EDITOR_DIR) && !file.endsWith("forms/text-form.tsx"))
      .filter((file) =>
        /["'][^"']*text-editor\/[^"']*["']/.test(code(readFileSync(resolve(ROOT, file), "utf8"))),
      );
    expect(offenders).toEqual([]);
  });
});

describe("M16-13 the post body editor has one door, on one route", () => {
  const sources = [
    ...filesUnder("src/components"),
    ...filesUnder("src/lib"),
    ...filesUnder("src/app"),
  ].map((file) => [file, code(readFileSync(resolve(ROOT, file), "utf8"))] as const);

  it("only the post editor imports the body editor module", () => {
    const importers = sources
      .filter(([file]) => !file.startsWith(BODY_EDITOR_DIR))
      .filter(([, source]) => /["'][^"']*body-editor\/[^"']*["']/.test(source))
      .map(([file]) => file);
    expect(importers).toEqual([BODY_EDITOR_DOOR]);
  });

  it("only the post's own route draws the post editor, so no other screen's bundle carries the library", () => {
    const importers = sources
      .filter(([file]) => file !== BODY_EDITOR_DOOR)
      .filter(([, source]) => /["'][^"']*posts\/post-editor["']/.test(source))
      .map(([file]) => file);
    expect(importers).toEqual([BODY_EDITOR_ROUTE]);
  });

  it("the workspace (Edit, Design, Share) reaches neither the door nor the module", () => {
    const { modules } = reach(filesUnder("src/app/(editor)/app/(screens)/(workspace)"));
    const names = [...modules.keys()].map(rel);
    expect(names.length).toBeGreaterThan(50);
    expect(names).not.toContain(BODY_EDITOR_DOOR);
    expect(names.filter((file) => file.startsWith(BODY_EDITOR_DIR))).toEqual([]);
  });

  it("the body editor never reads or writes HTML, makes no request and keeps nothing in storage", () => {
    const offenders = sources
      .filter(([file]) => file.startsWith(BODY_EDITOR_DIR))
      .filter(([, source]) =>
        /\b(getHTML|generateHTML|generateJSON|innerHTML|outerHTML|insertAdjacentHTML|dangerouslySetInnerHTML|fetch|XMLHttpRequest|WebSocket|sendBeacon|localStorage|sessionStorage|indexedDB|document\.cookie)\b/.test(
          source,
        ),
      );
    expect(offenders.map(([file]) => file)).toEqual([]);
  });
});

describe("M9-12 the editor keeps to the structured model", () => {
  const files = filesUnder(EDITOR_DIR);
  const sources = files.map(
    (file) => [file, code(readFileSync(resolve(ROOT, file), "utf8"))] as const,
  );

  it("never calls getHTML, generateHTML or generateJSON, and writes no HTML", () => {
    const offenders = sources.filter(([, source]) =>
      /\b(getHTML|generateHTML|generateJSON|innerHTML|outerHTML|insertAdjacentHTML|dangerouslySetInnerHTML)\b/.test(
        source,
      ),
    );
    expect(offenders.map(([file]) => file)).toEqual([]);
  });

  it("the rest of the app never calls them either", () => {
    const offenders = filesUnder("src").filter((file) =>
      /\b(getHTML|generateHTML|generateJSON)\s*\(/.test(
        code(readFileSync(resolve(ROOT, file), "utf8")),
      ),
    );
    expect(offenders).toEqual([]);
  });

  it("makes no request and keeps nothing in the browser's storage", () => {
    const offenders = sources.filter(([, source]) =>
      /\b(fetch|XMLHttpRequest|WebSocket|sendBeacon|localStorage|sessionStorage|indexedDB|document\.cookie)\b/.test(
        source,
      ),
    );
    expect(offenders.map(([file]) => file)).toEqual([]);
  });

  it("holds the whole text editor in the five modules it was written as", () => {
    expect(files.map((file) => file.slice(EDITOR_DIR.length + 1)).sort()).toEqual([
      "convert.ts",
      "extensions.ts",
      "model.ts",
      "text-editor.tsx",
      "toolbar.tsx",
    ]);
  });
});
