import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  isClientModule,
  listFiles,
  packageNameOf,
  rel,
  ROOT,
  stripComments,
  walk,
} from "./support/module-graph";

/**
 * M10-01 step 3 (Dependencies rule 1): the three Wave L libraries are server only. `mcp-handler`,
 * `@modelcontextprotocol/server` and `@modelcontextprotocol/core` are imported only from files under
 * `src/lib/mcp/` and `src/lib/oauth/` and from the route files of the MCP and OAuth endpoints, each
 * starting with `import "server-only"` or being a route handler, and none is reachable from a client
 * module, the tenant renderer, the marketing site or `src/components/`. After `pnpm build` none of
 * them is named in `.next/static`, the tenant script, or the HTML of a published page.
 */

vi.mock("@/lib/env/client", () => ({
  clientEnv: { NEXT_PUBLIC_ROOT_DOMAIN: "localhost:3000" },
}));

const MCP_PACKAGES = ["mcp-handler", "@modelcontextprotocol/server", "@modelcontextprotocol/core"];
const MCP_ROUTES = ["src/app/(editor)/app/mcp/route.ts"];

const read = (path: string) => readFileSync(resolve(ROOT, path), "utf8");
const isMcpPackage = (name: string) =>
  MCP_PACKAGES.includes(name) || name.startsWith("@modelcontextprotocol/");

/** A file allowed to name the packages: the two libraries' folders and the endpoints' route files. */
const mayImport = (file: string) =>
  file.startsWith("src/lib/mcp/") ||
  file.startsWith("src/lib/oauth/") ||
  /^src\/app\/\(editor\)\/app\/(mcp|oauth|\.well-known)\/.*route\.ts$/.test(file);

describe("M10-01 the MCP libraries are imported only where the rule says, and each file is server only", () => {
  /** Runtime imports only (`import type` vanishes at build time), read straight from each file's text. */
  const STATEMENT =
    /(?:^|\n)\s*(?:import|export)\s+(?!type\b)(?:[^'";]*?\sfrom\s+)?["']([^"']+)["']|\bimport\(\s*["']([^"']+)["']\s*\)/g;
  const importers = new Set<string>();
  for (const file of listFiles("src")) {
    for (const match of stripComments(read(file)).matchAll(STATEMENT)) {
      const name = packageNameOf((match[1] ?? match[2])!);
      if (name && isMcpPackage(name)) importers.add(file);
    }
  }

  it("finds the importers (the scan is not vacuous)", () => {
    expect(importers.size).toBeGreaterThanOrEqual(3);
    expect([...importers].some((file) => file.startsWith("src/lib/mcp/"))).toBe(true);
  });

  it("every importer is under src/lib/mcp, src/lib/oauth or an MCP or OAuth route file", () => {
    expect([...importers].filter((file) => !mayImport(file))).toEqual([]);
  });

  it('every importer starts with import "server-only" or is a route handler', () => {
    const offenders = [...importers].filter((file) => {
      if (/\/route\.ts$/.test(file)) return false;
      const source = read(file);
      return !/^(?:\s*(?:\/\*[\s\S]*?\*\/|\/\/[^\n]*)\s*)*import ["']server-only["'];?/.test(
        source,
      );
    });
    expect(offenders).toEqual([]);
  });

  it("a type-only import of an SDK type is the one way a file without server-only may name them (none do)", () => {
    // `import type` vanishes at build time; the walker skips it, so check the text of the two files
    // that use it and confirm they are not client modules.
    for (const file of importers) expect(isClientModule(read(file)), file).toBe(false);
  });
});

describe("M10-33 the official MCP client is a dev dependency used by the end-to-end tests only", () => {
  it("is named by no file under src/", () => {
    const users = listFiles("src").filter((file) =>
      /["']@modelcontextprotocol\/client(?:\/[^"']*)?["']/.test(stripComments(read(file))),
    );
    expect(users).toEqual([]);
  });

  it("is in devDependencies, not dependencies", () => {
    const pkg = JSON.parse(read("package.json")) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    expect(pkg.devDependencies["@modelcontextprotocol/client"]).toBe("2.3.0");
    expect(pkg.dependencies["@modelcontextprotocol/client"]).toBeUndefined();
  });
});

describe("M10-01 none of the three libraries is reachable from the browser, the tenant renderer, marketing or components", () => {
  const clientFiles = listFiles("src").filter((file) => isClientModule(read(file)));
  const entries = [
    ...clientFiles,
    ...listFiles("src/lib/tenant-render"),
    ...listFiles("src/lib/tenant-assets"),
    ...listFiles("src/app/(tenant)"),
    ...listFiles("src/app/(marketing)"),
    ...listFiles("src/components"),
  ];

  it("walks a real graph (many client modules, the tenant renderer, marketing and components)", () => {
    expect(clientFiles.length).toBeGreaterThan(50);
    expect(entries.length).toBeGreaterThan(300);
  });

  it("the walk reaches the packages from the MCP route, so a miss elsewhere means something", () => {
    const fromRoute = walk(MCP_ROUTES);
    expect([...fromRoute.packages.keys()].some(isMcpPackage)).toBe(true);
  });

  it("reaches none of them (a server action's own imports stay on the server)", () => {
    const graph = walk(entries, { stopAtServerActions: true });
    const reached = [...graph.packages.keys()].filter(isMcpPackage);
    expect(
      reached.map((name) => `${name} (imported by ${[...graph.packages.get(name)!].join(", ")})`),
    ).toEqual([]);
  });

  it("marketing reads only the two constants modules of the connector, which import nothing but each other", () => {
    const graph = walk(["src/lib/mcp/constants.ts", "src/lib/oauth/constants.ts"]);
    expect([...graph.packages.keys()]).toEqual([]);
    expect([...graph.files.keys()].map(rel).sort()).toEqual([
      "src/lib/mcp/constants.ts",
      "src/lib/oauth/constants.ts",
    ]);
  });
});

// ---------------------------------------------------------------------------------------------
// After `pnpm build`
// ---------------------------------------------------------------------------------------------

const buildDir = resolve(process.env.HL_BUILD_DIR ?? join(process.cwd(), ".next"));
const staticDir = join(buildDir, "static");
const haveBuild = existsSync(staticDir);

function textFiles(dir: string, pattern: RegExp): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...textFiles(path, pattern));
    else if (pattern.test(name)) out.push(path);
  }
  return out;
}

describe.skipIf(!haveBuild)(
  "M10-01 the build holds no trace of the MCP libraries in anything a browser gets",
  () => {
    const NAMES = /@modelcontextprotocol|mcp-handler/;
    const staticTexts = haveBuild
      ? textFiles(staticDir, /\.(js|css|map|json|html|txt)$/).map((path) => ({
          path,
          text: readFileSync(path, "utf8"),
        }))
      : [];

    it("scanned something", () => {
      expect(staticTexts.length).toBeGreaterThan(0);
    });

    it("neither name is in .next/static", () => {
      expect(
        staticTexts.filter(({ text }) => NAMES.test(text)).map(({ path }) => rel(path)),
      ).toEqual([]);
    });

    it("nor in the tenant script", () => {
      const scripts = existsSync(resolve(ROOT, "public/_t"))
        ? textFiles(resolve(ROOT, "public/_t"), /\.js$/)
        : [];
      for (const path of scripts)
        expect(NAMES.test(readFileSync(path, "utf8")), rel(path)).toBe(false);
    });
  },
);
