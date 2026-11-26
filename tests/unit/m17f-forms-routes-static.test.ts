import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * M17-05 step 1, M17-06 step 2 and the threat model's rows 5 and 15, read from the source: both form
 * routes are `force-dynamic` (an invented path makes no cache entry), the public route's modules
 * never name `draft` (published only), and none of them asks the limiter to fail closed (only the
 * link lock's two callers may).
 */

const ROOT = resolve(__dirname, "../..");
const read = (path: string) => readFileSync(resolve(ROOT, path), "utf8");

const ROUTES = ["src/app/f/[pageId]/[blockId]/route.ts", "src/app/f/[pageId]/o/route.ts"];
const PUBLIC_MODULES = [
  ...ROUTES,
  "src/lib/forms/contract.ts",
  "src/lib/forms/deps.ts",
  "src/lib/forms/open-marker.ts",
  "src/lib/forms/routes.ts",
  "src/lib/forms/store.ts",
  "src/lib/forms/submit.ts",
  "src/lib/forms/token.ts",
  "src/lib/tenant-render/form-page.tsx",
  "src/components/page/form-block.tsx",
];

describe("M17-05 the form routes", () => {
  it.each(ROUTES)("%s is force-dynamic", (path) => {
    expect(read(path)).toMatch(/^export const dynamic = "force-dynamic";$/m);
    expect(read(path)).not.toMatch(/generateStaticParams|revalidate/);
  });

  it.each(PUBLIC_MODULES)("%s never reads a draft and never fails the limiter closed", (path) => {
    const code = read(path);
    expect(code).not.toMatch(/draft/i);
    expect(code).not.toContain("failClosed");
  });

  it("the resolver reads the published documents (the click's cached read), never a draft", () => {
    const pages = read("src/lib/analytics/ingest/pages.ts");
    const body = pages.slice(pages.indexOf("export async function resolveFormBlock"));
    // The click's cached read, with misses never stored (an invented /f path makes no cache entry).
    expect(body).toContain("readPublishedCached(pageId, blockId, { cacheMisses: false })");
    expect(body).toContain('block.type !== "form"');
    expect(body).toContain("block.visible === false");
  });

  it("nothing under src/app/f sets a cookie or reads one", () => {
    for (const path of ROUTES) expect(read(path)).not.toMatch(/cookie/i);
    expect(read("src/lib/forms/submit.ts")).not.toMatch(/set-cookie|cookies\(/i);
  });
});
