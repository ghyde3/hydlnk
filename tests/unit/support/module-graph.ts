import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

/**
 * A small static module-graph walker for the policy scans (M9-10, M9-14, M9-09). It reads source
 * files and follows the imports that end up in a bundle: `import` and `export ... from` (not the
 * `import type` and `export type` forms, which vanish at build time), `import("...")` and
 * `require("...")`. Relative and `@/` imports are resolved to files and followed; every bare package
 * specifier is recorded against the files that name it. No network, no `node_modules` reads, no
 * bundler: a scan of ~500 files takes well under a second.
 */

export const ROOT = process.cwd();
export const rel = (path: string): string => relative(ROOT, path).split("\\").join("/");

/** Source without comments (a word in a comment is not a use). */
export const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\/|(^|[^:"'`])\/\/.*$/gm, "$1");

const EXTENSIONS = ["", ".ts", ".tsx", ".js", ".mjs", ".jsx", "/index.ts", "/index.tsx", "/index.js"];

export function resolveImport(from: string, spec: string): string | null {
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
  /(?:^|\n)\s*(?:import|export)\s+(?!type\b)(?:[^'";]*?\sfrom\s+)?["']([^"']+)["']|\bimport\(\s*["']([^"']+)["']\s*\)|\brequire\(\s*["']([^"']+)["']\s*\)/g;

/** `@scope/name/sub` is `@scope/name`; `name/sub` is `name`; relative and alias imports are not packages. */
export function packageNameOf(spec: string): string | null {
  if (spec.startsWith(".") || spec.startsWith("@/") || spec.startsWith("/")) return null;
  if (spec.startsWith("node:")) return spec;
  const parts = spec.split("/");
  return spec.startsWith("@") ? parts.slice(0, 2).join("/") : (parts[0] ?? null);
}

export interface Graph {
  /** Every reached source file, absolute path to its text. */
  files: Map<string, string>;
  /** Every bare package specifier reached, package name to the (relative) files that import it. */
  packages: Map<string, Set<string>>;
}

const CODE_FILE = /\.(tsx?|jsx?|mjs)$/;

/** True when the file starts with a `"use server"` directive: in a client bundle its exports are RPC stubs. */
export const isServerActionModule = (source: string): boolean =>
  /^\s*(?:(?:\/\*[\s\S]*?\*\/|\/\/[^\n]*)\s*)*["']use server["']/.test(source);

export interface WalkOptions {
  /** Do not follow `import("...")`: what a page loads up front, not what it fetches later. */
  staticOnly?: boolean;
  /**
   * Do not follow the imports of a `"use server"` module (record the file itself). A client component
   * that imports a server action downloads a reference to it, not the code behind it, so a scan of
   * what a browser downloads stops there.
   */
  stopAtServerActions?: boolean;
}

export function walk(entries: string[], options: WalkOptions = {}): Graph {
  const files = new Map<string, string>();
  const packages = new Map<string, Set<string>>();
  const queue = entries.map((entry) => resolve(ROOT, entry));
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (files.has(file)) continue;
    const source = readFileSync(file, "utf8");
    files.set(file, source);
    if (!CODE_FILE.test(file)) continue;
    if (options.stopAtServerActions && isServerActionModule(source)) continue;
    for (const match of stripComments(source).matchAll(IMPORT)) {
      if (options.staticOnly && match[2] !== undefined) continue;
      const spec = (match[1] ?? match[2] ?? match[3])!;
      const target = resolveImport(file, spec);
      if (target) {
        queue.push(target);
        continue;
      }
      const name = packageNameOf(spec);
      if (!name) continue;
      const importers = packages.get(name) ?? new Set<string>();
      importers.add(rel(file));
      packages.set(name, importers);
    }
  }
  return { files, packages };
}

/** Every source file under `dir` (relative to the repo root), recursively, as repo-relative paths. */
export function listFiles(dir: string, pattern: RegExp = CODE_FILE): string[] {
  const out: string[] = [];
  const visit = (absolute: string) => {
    if (!existsSync(absolute)) return;
    for (const name of readdirSync(absolute)) {
      const path = join(absolute, name);
      const stats = statSync(path);
      if (stats.isDirectory()) visit(path);
      else if (pattern.test(name)) out.push(rel(path));
    }
  };
  visit(resolve(ROOT, dir));
  return out.sort();
}

/** True when the first statement of the file is a `"use client"` directive. */
export const isClientModule = (source: string): boolean =>
  /^\s*(?:(?:\/\*[\s\S]*?\*\/|\/\/[^\n]*)\s*)*["']use client["']/.test(source);
