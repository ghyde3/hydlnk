import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * M9-02 steps 2 and 7 and M9-06 step 7, proven on a production build (`pnpm build`, or the build of
 * another checkout: `HL_BUILD_DIR=/path/.next pnpm test tests/unit/m9-proving-build.test.ts`). Without
 * a build the file is skipped, as m10-library-boundary.test.ts is; CI's browser job has one.
 *
 * - The marketing routes' and the tenant routes' client chunks hold no Lucide code (the static HTML
 *   pipeline and the marketing site never reach the library).
 * - The editor ships only the icons it imports: two icons nothing imports ('zap', 'anchor') are not
 *   in its chunks, while the ones it does draw ('pencil') are (the scan is not vacuous).
 * - The template dialog's code is not in the editor's first-load chunks: it is a lazy chunk the
 *   route's loadable manifest names (the component is loaded when the picker opens).
 */

const buildDir = resolve(process.env.HL_BUILD_DIR ?? join(process.cwd(), ".next"));
const appDir = join(buildDir, "server", "app");
// A complete build only: CI restores a partial `.next` (its cache) before building, so the directories
// alone are not enough. BUILD_ID is written last by `next build`.
const haveBuild =
  existsSync(join(buildDir, "BUILD_ID")) &&
  existsSync(join(buildDir, "static", "chunks")) &&
  existsSync(appDir);

function manifests(dir: string, suffix: RegExp): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...manifests(path, suffix));
    else if (suffix.test(name)) out.push(path);
  }
  return out;
}

/** The JS chunks a route's client reference manifest names: what the route's client modules load. */
function chunkTexts(files: string[]): Map<string, string> {
  const texts = new Map<string, string>();
  for (const file of files) {
    for (const [chunk] of readFileSync(file, "utf8").matchAll(/static\/chunks\/[\w~.-]+\.js/g)) {
      if (!texts.has(chunk)) texts.set(chunk, readFileSync(join(buildDir, chunk), "utf8"));
    }
  }
  return texts;
}

const clientManifests = (group: string) =>
  manifests(join(appDir, group), /client-reference-manifest\.js$/);

describe.skipIf(!haveBuild)("M9-02 / M9-06 the production build's chunks", () => {
  it("the marketing routes' chunks contain no Lucide code", () => {
    const texts = chunkTexts(clientManifests("(marketing)"));
    expect(texts.size).toBeGreaterThan(0);
    expect([...texts].filter(([, text]) => /lucide/i.test(text)).map(([name]) => name)).toEqual([]);
  });

  it("the tenant routes' chunks and the one tenant script contain no Lucide code", () => {
    // A tenant route is static HTML from a route handler: its client manifest names no page chunk
    // beyond the framework's, so the manifests exist and the chunks they do name are clean.
    expect(clientManifests("(tenant)").length).toBeGreaterThan(0);
    const texts = chunkTexts(clientManifests("(tenant)"));
    expect([...texts].filter(([, text]) => /lucide/i.test(text)).map(([name]) => name)).toEqual([]);
    const tenantDir = resolve(process.cwd(), "public/_t");
    const scripts = existsSync(tenantDir)
      ? readdirSync(tenantDir).filter((name) => name.endsWith(".js"))
      : [];
    for (const name of scripts) {
      expect(/lucide/i.test(readFileSync(join(tenantDir, name), "utf8")), name).toBe(false);
    }
  });

  const editorRoutes = ["editor", "design", "share"].map((name) =>
    join(appDir, "(editor)", "app", "(screens)", "(workspace)", name),
  );
  // Vitest runs a skipped describe's body to collect its tests: without a build there is nothing to read.
  const editorTexts = haveBuild
    ? chunkTexts(editorRoutes.flatMap((dir) => manifests(dir, /client-reference-manifest\.js$/)))
    : new Map<string, string>();

  it("the editor draws its icons from the library and ships none that nothing imports", () => {
    const all = [...editorTexts.values()];
    expect(all.some((text) => text.includes('name:"pencil"'))).toBe(true);
    for (const unused of ["zap", "anchor"]) {
      expect(
        all.some((text) => text.includes(`name:"${unused}"`)),
        `the icon '${unused}' is in the editor's chunks`,
      ).toBe(false);
    }
  });

  it("the editor's first-load chunks hold no dialog code; the dialog is a lazy chunk the loadable manifest names", () => {
    for (const [name, text] of editorTexts) {
      expect(/DialogContent|react-dialog/.test(text), name).toBe(false);
    }
    const loadable = manifests(editorRoutes[0]!, /react-loadable-manifest\.json$/)
      .map((file) => readFileSync(file, "utf8"))
      .join("\n");
    const lazy = [...new Set(loadable.match(/static\/chunks\/[\w~.-]+\.js/g) ?? [])];
    const holder = lazy.filter((chunk) =>
      /DialogContent/.test(readFileSync(join(buildDir, chunk), "utf8")),
    );
    expect(holder.length).toBeGreaterThan(0);
  });
});
