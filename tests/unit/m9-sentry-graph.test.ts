import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { listFiles, ROOT, walk } from "./support/module-graph";

/**
 * M9-10 no marketing and no tenant: Sentry's code is reachable from the app host only. A module
 * graph scan of the source: nothing under the marketing site, the tenant routes, the click redirect,
 * the view beacon, /media, the tenant renderer, the tenant assets or the page components imports an
 * `@sentry/*` package or src/lib/sentry; the SDK is a static import in exactly two modules, which are
 * loaded only through dynamic imports; and the tenant CSP and script are untouched.
 */

const PUBLIC_ROOTS = [
  "src/app/(marketing)",
  "src/app/(tenant)",
  "src/app/r",
  "src/app/api/e",
  "src/app/media",
  "src/lib/tenant-render",
  "src/lib/tenant-assets",
  "src/components/page",
  "src/components/marketing",
  "src/components/tenant",
];

const sentryPackages = (graph: ReturnType<typeof walk>) => [...graph.packages.keys()].filter((name) => name.startsWith("@sentry/"));
const sentryFiles = (graph: ReturnType<typeof walk>) =>
  [...graph.files.keys()].map((file) => file.replace(`${ROOT}/`, "")).filter((file) => file.startsWith("src/lib/sentry/"));

describe("M9-10 nothing public reaches Sentry", () => {
  it.each(PUBLIC_ROOTS)("%s exists and neither it nor anything it imports reaches @sentry/* or src/lib/sentry", (root) => {
    const entries = listFiles(root);
    expect(entries.length, `${root} has source files`).toBeGreaterThan(0);
    const graph = walk(entries);
    expect(sentryPackages(graph)).toEqual([]);
    expect(sentryFiles(graph)).toEqual([]);
  });

  it("the two tenant routes do not either", () => {
    const graph = walk(["src/app/(tenant)/t/[handle]/route.ts", "src/app/(tenant)/sites/[pageId]/route.ts"]);
    expect(sentryPackages(graph)).toEqual([]);
    expect(sentryFiles(graph)).toEqual([]);
  });

  it("the shared error panels the marketing site draws do not reach it (reportError is called by the app's own boundaries)", () => {
    const graph = walk(["src/components/error-page.tsx", "src/components/error-panel.tsx", "src/components/not-found-panel.tsx", "src/app/(marketing)/error.tsx", "src/app/(share)/error.tsx"]);
    expect(sentryPackages(graph)).toEqual([]);
    expect(sentryFiles(graph)).toEqual([]);
  });
});

describe("M9-10 where Sentry is imported", () => {
  const allSource = [...listFiles("src"), "next.config.ts"];

  it("@sentry/* is imported only by src/lib/sentry/client.ts and server.ts (and next.config.ts, lazily, for the build wrapper)", () => {
    const importers = new Set<string>();
    for (const file of allSource) {
      const graph = walk([file]);
      for (const [name, files] of graph.packages) if (name.startsWith("@sentry/") && files.has(file)) importers.add(file);
    }
    expect([...importers].sort()).toEqual(["next.config.ts", "src/lib/sentry/client.ts", "src/lib/sentry/server.ts"]);
  });

  it("src/lib/sentry is imported only by the app host's own files", () => {
    const importers = new Set<string>();
    for (const file of allSource) {
      if (file.startsWith("src/lib/sentry/")) continue;
      const source = readFileSync(resolve(ROOT, file), "utf8");
      if (/from\s+["'](?:@\/lib\/sentry\/[^"']+|\.{1,2}\/(?:src\/)?lib\/sentry\/[^"']+)["']|import\(\s*["']@\/lib\/sentry\//.test(source)) importers.add(file);
    }
    expect([...importers].sort()).toEqual(
      [
        "next.config.ts",
        "src/app/(editor)/app/(screens)/error.tsx",
        "src/app/(editor)/error.tsx",
        "src/app/global-error.tsx",
        "src/components/app/error-monitor.tsx",
        "src/instrumentation.ts",
      ].sort(),
    );
  });

  it("the SDK is a dynamic import from the starter: nothing the app host's layout imports statically reaches @sentry/*", () => {
    const layout = walk(["src/app/(editor)/app/layout.tsx"], { staticOnly: true, stopAtServerActions: true });
    expect(sentryPackages(layout)).toEqual([]);
    expect(sentryFiles(layout)).toEqual([]);
    // ... and the dynamic import is there, behind the DSN check.
    const starter = readFileSync(resolve(ROOT, "src/components/app/error-monitor.tsx"), "utf8");
    expect(starter).toMatch(/if \(process\.env\.NEXT_PUBLIC_SENTRY_DSN\) \{[\s\S]*import\("@\/lib\/sentry\/client"\)/);
    const full = walk(["src/app/(editor)/app/layout.tsx"]);
    expect(sentryPackages(full)).toEqual(["@sentry/nextjs"]);
  });

  it("instrumentation.ts imports the server config only inside the DSN branch, and only for the Node runtime", () => {
    const source = readFileSync(resolve(ROOT, "src/instrumentation.ts"), "utf8");
    expect(source).not.toMatch(/^import .*@sentry/m);
    // The one static import is the DSN parser: pure, no SDK, and it only ever logs the variable's name.
    const staticImports = [...source.matchAll(/^import (?!type\b).*from "(@\/lib\/sentry\/[^"]+)"/gm)].map((match) => match[1]);
    expect(staticImports).toEqual(["@/lib/sentry/dsn"]);
    expect(source).toMatch(/NEXT_RUNTIME !== "nodejs"\) return/);
    expect(source).toMatch(/if \(process\.env\.NEXT_PUBLIC_SENTRY_DSN\) \{\s*const server = await import\("@\/lib\/sentry\/server"\)/);
  });

  it("the SDK is a static import in exactly the two start modules and no other source file", () => {
    const withSdk = listFiles("src").filter((file) => /from\s+["']@sentry\//.test(readFileSync(resolve(ROOT, file), "utf8")));
    expect(withSdk.sort()).toEqual(["src/lib/sentry/client.ts", "src/lib/sentry/server.ts"]);
  });
});

describe("M9-10 the tenant boundary is untouched", () => {
  it("the tenant CSP still says connect-src 'self' and names no analytics or monitoring host", () => {
    const source = readFileSync(resolve(ROOT, "src/lib/routing/tenant-headers.ts"), "utf8");
    expect(source).toContain(`"connect-src 'self'"`);
    expect(source).not.toMatch(/sentry|ingest\.|\.io\b/i);
  });

  it("the tenant script and every tenant asset source never name Sentry, and the script has no network, import or eval code", () => {
    for (const file of listFiles("src/lib/tenant-assets", /\.(js|ts|css)$/)) {
      expect(readFileSync(resolve(ROOT, file), "utf8"), file).not.toMatch(/sentry/i);
    }
    const script = readFileSync(resolve(ROOT, "src/lib/tenant-assets/script/tenant.js"), "utf8");
    expect(script).not.toMatch(/\b(import|require|fetch|XMLHttpRequest|eval)\b\s*\(|^\s*import\s/m);
  });
});
