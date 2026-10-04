import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isClientModule, listFiles, rel, ROOT, walk } from "./support/module-graph";

/**
 * M9-09 server only: src/emails/ is imported by src/lib/domains server code and nowhere else, the
 * library is in no client bundle, no tenant route and not on the marketing site, no route, preview
 * server or CLI script for it exists, and rendering makes no network call.
 */

const REACT_EMAIL = ["react-email", "@react-email/render"];
const allSource = listFiles("src");

/** Every source file under src that names `target` in a runtime import, and the file it resolves to. */
function importersOf(match: (file: string) => boolean): string[] {
  const importers: string[] = [];
  for (const file of allSource) {
    const graph = walk([file]);
    // `walk` follows imports: the direct importers are the files whose own text reaches the target in one hop.
    const own = readFileSync(resolve(ROOT, file), "utf8");
    for (const target of graph.files.keys()) {
      const targetPath = rel(target);
      if (targetPath !== file && match(targetPath) && importsDirectly(own, targetPath)) importers.push(file);
    }
  }
  return [...new Set(importers)].sort();
}

/** True when `source` imports (directly) a module whose repo path is `targetPath`. */
function importsDirectly(source: string, targetPath: string): boolean {
  const withoutExtension = targetPath.replace(/\.(tsx?|jsx?)$/, "").replace(/\/index$/, "");
  const alias = withoutExtension.startsWith("src/") ? `@/${withoutExtension.slice(4)}` : null;
  const stripped = source.replace(/\/\*[\s\S]*?\*\/|(^|[^:"'`])\/\/.*$/gm, "$1");
  for (const match of stripped.matchAll(/(?:from\s+|import\(\s*|import\s+)["']([^"']+)["']/g)) {
    const spec = match[1]!;
    if (alias && (spec === alias || spec === `${alias}/index`)) return true;
    if (spec.startsWith(".") && spec.endsWith(withoutExtension.split("/").pop()!)) return true;
  }
  return false;
}

describe("M9-09 the template is imported by the domains server code and nowhere else", () => {
  it("src/emails/ exists and holds the one template", () => {
    expect(listFiles("src/emails")).toEqual(["src/emails/domain-live.tsx"]);
  });

  it("the only importer of src/emails/* is src/lib/domains/live-email.ts", () => {
    const importers = importersOf((path) => path.startsWith("src/emails/"));
    expect(importers).toEqual(["src/lib/domains/live-email.ts"]);
  });

  it("react-email (and its renderer) is imported only by src/emails and src/lib/domains/live-email.ts", () => {
    const names = new Set(REACT_EMAIL);
    const importers = new Set<string>();
    for (const file of allSource) {
      for (const [pkg, files] of walk([file]).packages) if (names.has(pkg) && files.has(file)) importers.add(file);
    }
    expect([...importers].sort()).toEqual(["src/emails/domain-live.tsx", "src/lib/domains/live-email.ts"]);
  });
});

describe("M9-09 the library reaches no client bundle, no tenant route and not the marketing site", () => {
  const reaches = (entries: string[], options?: Parameters<typeof walk>[1]) => {
    const graph = walk(entries, options);
    const hit = [...graph.files.keys()].map(rel).filter((file) => file.startsWith("src/emails/"));
    const packages = REACT_EMAIL.filter((name) => graph.packages.has(name));
    return { files: hit, packages };
  };

  it("no 'use client' module reaches it (a client component's imports are what the browser downloads)", () => {
    const clientModules = allSource.filter((file) => isClientModule(readFileSync(resolve(ROOT, file), "utf8")));
    expect(clientModules.length).toBeGreaterThan(50);
    // A client component that imports a server action downloads a reference to it, not its code.
    const offenders = clientModules.filter((file) => {
      const found = reaches([file], { stopAtServerActions: true });
      return found.files.length > 0 || found.packages.length > 0;
    });
    expect(offenders).toEqual([]);
  });

  it("the tenant routes and everything under tenant-render, tenant-assets and components/page do not reach it", () => {
    const found = reaches([
      "src/app/(tenant)/t/[handle]/route.ts",
      "src/app/(tenant)/sites/[pageId]/route.ts",
      ...listFiles("src/lib/tenant-render"),
      ...listFiles("src/lib/tenant-assets"),
      ...listFiles("src/components/page"),
    ]);
    expect(found).toEqual({ files: [], packages: [] });
  });

  it("the marketing site does not reach it", () => {
    const found = reaches([...listFiles("src/app/(marketing)"), ...listFiles("src/components/marketing")]);
    expect(found).toEqual({ files: [], packages: [] });
  });
});

describe("M9-09 no route, preview server or CLI script for the library", () => {
  it("package.json has no script that runs it, and no file under scripts or src/app names it", () => {
    const pkg = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8")) as { scripts: Record<string, string> };
    for (const [name, command] of Object.entries(pkg.scripts)) {
      expect(`${name} ${command}`, name).not.toMatch(/react-email|\bemail (dev|build|export|start)\b/);
    }
    const files = [...listFiles("scripts", /\.(m?[jt]sx?)$/), ...listFiles("src/app")];
    const named = files.filter((file) => /react-email|@react-email/.test(readFileSync(resolve(ROOT, file), "utf8")));
    expect(named).toEqual([]);
  });
});

describe("M9-09 rendering makes no network call", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("with fetch stubbed to throw, both parts still render", async () => {
    const fetchSpy = vi.fn(() => {
      throw new Error("a network call at render time");
    });
    vi.stubGlobal("fetch", fetchSpy);
    const { liveEmailContent } = await import("@/lib/domains/live-email");
    const content = await liveEmailContent("links.example.test");
    expect(content.html).toContain("Open links.example.test");
    expect(content.text).toContain("Open links.example.test");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
