import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { cn } from "@/lib/cn";
import { code, importsOf, tenantGraph } from "./m9-icons-helpers";

/**
 * M9-01: `cn`, the one class-name helper of the HYDLNK UI. The table uses the classes this app
 * really writes (tokens like `text-ink`, `bg-surface`, the custom `hl:` breakpoint), and the scans
 * hold the two boundaries: the helper imports only the two packages at their pinned versions, and
 * the tenant side never reaches it.
 */

const ROOT = process.cwd();
const read = (path: string) => readFileSync(resolve(ROOT, path), "utf8");
const pkg = JSON.parse(read("package.json")) as { dependencies: Record<string, string> };
const installed = (name: string) =>
  JSON.parse(read(`node_modules/${name}/package.json`)) as { version: string; license: string };

describe("M9-01 cn", () => {
  it("merges a conflicting utility, the later one wins", () => {
    expect(cn("p-2", "p-4")).toBe("p-4");
    expect(cn("bg-surface", "bg-page")).toBe("bg-page");
    expect(cn("min-h-11", "min-h-12")).toBe("min-h-12");
  });

  it("drops falsy values and reads arrays and objects like clsx", () => {
    expect(
      cn("text-sm", false, undefined, null, ["font-semibold", { hidden: true, block: false }]),
    ).toBe("text-sm font-semibold hidden");
  });

  it("keeps a color and a size together: they are not in conflict", () => {
    expect(cn("text-ink", "text-sm")).toBe("text-ink text-sm");
    expect(cn("text-sm", "text-ink")).toBe("text-sm text-ink");
  });

  it("reads the custom hl: breakpoint as a variant: the same breakpoint merges, another is kept", () => {
    expect(cn("hl:size-11", "hl:size-[280px]")).toBe("hl:size-[280px]");
    expect(cn("size-11", "hl:size-[280px]")).toBe("size-11 hl:size-[280px]");
    expect(cn("hl:w-auto", "w-full")).toBe("hl:w-auto w-full");
  });

  it("returns an empty string for nothing", () => {
    expect(cn()).toBe("");
    expect(cn(undefined)).toBe("");
    expect(cn(false, null, "")).toBe("");
  });

  it("joins the call sites' real shapes (selected tab, align class, optional className)", () => {
    const selected = true as boolean;
    expect(
      cn(
        "inline-flex min-h-11 rounded-sm px-3.5 text-sm font-semibold",
        selected ? "bg-surface text-ink ring-1 ring-line-2" : "bg-transparent text-text-2",
      ),
    ).toBe(
      "inline-flex min-h-11 rounded-sm px-3.5 text-sm font-semibold bg-surface text-ink ring-1 ring-line-2",
    );
    expect(cn("flex gap-0.5 rounded-md border border-line bg-track p-[3px]", "w-full")).toBe(
      "flex gap-0.5 rounded-md border border-line bg-track p-[3px] w-full",
    );
    expect(cn("flex gap-0.5", undefined)).toBe("flex gap-0.5");
  });
});

describe("M9-01 the helper's file and its two packages", () => {
  it("exports cn and the ClassValue type only, imports only clsx and tailwind-merge, no directive", () => {
    const source = read("src/lib/cn.ts");
    const text = code(source);
    expect(text).toMatch(/export function cn\(\.\.\.inputs: ClassValue\[\]\): string/);
    expect(text).toMatch(/return twMerge\(clsx\(inputs\)\)/);
    const imports = [...text.matchAll(/^import .* from "([^"]+)"/gm)].map((m) => m[1]);
    expect(imports.sort()).toEqual(["clsx", "tailwind-merge"]);
    const exports = [...text.matchAll(/^export (?:type )?(?:function |\{ ?)?(\w+)/gm)].map(
      (m) => m[1],
    );
    expect(exports.sort()).toEqual(["ClassValue", "cn"]);
    expect(source).not.toMatch(/["']use client["']/);
    expect(text).not.toMatch(/server-only/);
  });

  it("clsx 2.1.1 and tailwind-merge 3.7.0 are pinned exactly, MIT licensed", () => {
    expect(pkg.dependencies.clsx).toBe("2.1.1");
    expect(pkg.dependencies["tailwind-merge"]).toBe("3.7.0");
    for (const name of ["clsx", "tailwind-merge"]) {
      expect(installed(name).license, name).toBe("MIT");
      expect(installed(name).version, name).toBe(pkg.dependencies[name]);
    }
  });
});

describe("M9-01 the tenant side never gets it", () => {
  const graph = tenantGraph();

  it("nothing reachable from the tenant routes or under tenant-render, tenant-assets and components/page imports @/lib/cn, clsx or tailwind-merge", () => {
    const offenders: string[] = [];
    for (const [file, source] of graph.files) {
      if (!/\.(tsx?|jsx?|mjs)$/.test(file)) continue;
      if (/from\s+["']@\/lib\/cn["']|import\(\s*["']@\/lib\/cn["']/.test(code(source))) {
        offenders.push(file.replace(`${ROOT}/`, ""));
      }
    }
    expect(offenders).toEqual([]);
    expect(importsOf(graph, ["clsx", "tailwind-merge"])).toEqual([]);
  });

  it("the one tenant script is a plain script: no import, no clsx, no tailwind-merge", () => {
    const script = read("src/lib/tenant-assets/script/tenant.js");
    expect(script).not.toMatch(/^\s*import\s/m);
    expect(script).not.toMatch(/clsx|tailwind-merge|\bcn\(/);
  });
});
