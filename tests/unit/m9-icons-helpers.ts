import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

/**
 * Shared by the M9-01 to M9-04 scans (cn, Lucide, brand marks): a module graph of the source from
 * chosen entry files, with each file's bare package imports kept, so a test can say "no module
 * reachable from the tenant routes imports `clsx`". Runtime imports only (`import type` vanishes at
 * build time). Same shape as the walker in m8-render-graph.test.ts, which does not keep packages.
 */

export const ROOT = process.cwd();
export const rel = (path: string) => relative(ROOT, path);

/** The two tenant route handlers: the whole live public page is reachable from them. */
export const TENANT_ROUTES = [
  "src/app/(tenant)/t/[handle]/route.ts",
  "src/app/(tenant)/sites/[pageId]/route.ts",
];

/** Source without comments (a word in a comment is not a use). */
export const code = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\/|(^|[^:"'`])\/\/.*$/gm, "$1");

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

const IMPORT =
  /(?:^|\n)\s*(?:import|export)\s+(?!type\b)(?:[^'";]*?\sfrom\s+)?["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;

export interface Graph {
  /** Every source file reached, absolute path to its text. */
  files: Map<string, string>;
  /** The package (non-relative, non-`@/`) import specifiers of each file. */
  packages: Map<string, string[]>;
}

/** Files under `dir` (relative to the repo root) with one of the extensions, recursively. */
export function filesUnder(dir: string, extensions = [".ts", ".tsx"]): string[] {
  const out: string[] = [];
  const walk = (current: string) => {
    for (const name of readdirSync(current)) {
      const path = join(current, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (extensions.some((extension) => name.endsWith(extension))) out.push(rel(path));
    }
  };
  walk(resolve(ROOT, dir));
  return out;
}

export function walkGraph(entries: string[]): Graph {
  const files = new Map<string, string>();
  const packages = new Map<string, string[]>();
  const queue = entries.map((entry) => resolve(ROOT, entry));
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (files.has(file)) continue;
    const source = readFileSync(file, "utf8");
    files.set(file, source);
    if (!/\.(tsx?|jsx?|mjs)$/.test(file)) continue;
    const bare: string[] = [];
    for (const match of code(source).matchAll(IMPORT)) {
      const spec = (match[1] ?? match[2])!;
      const target = resolveImport(file, spec);
      if (target) queue.push(target);
      else if (!spec.startsWith(".") && !spec.startsWith("@/")) bare.push(spec);
    }
    packages.set(file, bare);
  }
  return { files, packages };
}

/** Whether a package specifier is `name` or a subpath of it (`lucide-react`, `lucide-react/dynamic`). */
export const isPackage = (spec: string, name: string) =>
  spec === name || spec.startsWith(`${name}/`);

/** The files of a graph (relative paths) that import one of the packages, as `file: spec`. */
export function importsOf(graph: Graph, names: string[]): string[] {
  const found: string[] = [];
  for (const [file, specs] of graph.packages) {
    for (const spec of specs) {
      if (names.some((name) => isPackage(spec, name))) found.push(`${rel(file)}: ${spec}`);
    }
  }
  return found.sort();
}

/** The graph of everything the tenant side reaches: the two routes plus every file of its folders. */
export function tenantGraph(): Graph {
  return walkGraph([
    ...TENANT_ROUTES,
    ...filesUnder("src/lib/tenant-render"),
    ...filesUnder("src/lib/tenant-assets"),
    ...filesUnder("src/components/page"),
  ]);
}
