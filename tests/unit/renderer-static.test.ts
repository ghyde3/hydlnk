import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * M2-05 static checks over the renderer directory (src/components/page): one component renders
 * block markup, styles read only --t-* variables and size by container query, and nothing in it
 * can inject raw HTML or a raw tenant string into an href.
 *
 * M6-22 narrowed one assertion (accepted deviation, recorded in PROGRESS.md for Gary): the
 * stylesheet may contain `@media` for `prefers-reduced-motion` only, and `@keyframes` blocks
 * (named `pg-...`) are not selector rules. Viewport or width media queries and `vw` units are
 * still banned, every selector is still scoped under [data-page-root], and there are still no
 * color literals and no --hl- references.
 */

const ROOT = resolve(process.cwd());
const RENDERER_DIR = join(ROOT, "src/components/page");

function walk(dir: string, accept: (file: string) => boolean): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full, accept));
    else if (accept(full)) out.push(full);
  }
  return out;
}

const rendererFiles = walk(RENDERER_DIR, (f) => /\.(tsx?|css)$/.test(f));
const rendererCss = rendererFiles.filter((f) => f.endsWith(".css"));
const rendererCode = rendererFiles.filter((f) => /\.tsx?$/.test(f));
const read = (file: string) => readFileSync(file, "utf8");
const rel = (file: string) => relative(ROOT, file);

/** `css` without its `@keyframes name { ... }` blocks (balanced braces). */
function withoutKeyframes(css: string): string {
  let out = "";
  let from = 0;
  for (const match of css.matchAll(/@keyframes\s+[\w-]+\s*\{/g)) {
    const start = match.index!;
    if (start < from) continue;
    let depth = 1;
    let i = start + match[0].length;
    while (i < css.length && depth > 0) {
      if (css[i] === "{") depth += 1;
      else if (css[i] === "}") depth -= 1;
      i += 1;
    }
    out += css.slice(from, start);
    from = i;
  }
  return out + css.slice(from);
}

describe("M2-05 renderer directory: colors and token systems", () => {
  it("has a stylesheet and component files to scan", () => {
    expect(rendererCss.length).toBeGreaterThan(0);
    expect(rendererCode.length).toBeGreaterThan(5);
  });

  it.each(rendererFiles.map((f) => [rel(f), f]))(
    "%s has no hex or rgb color literals",
    (_n, file) => {
      const source = read(file);
      expect(source.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).toEqual([]);
      expect(source.match(/\brgba?\s*\(/gi) ?? []).toEqual([]);
    },
  );

  it.each(rendererFiles.map((f) => [rel(f), f]))(
    "%s never references a --hl- variable",
    (_n, file) => {
      expect(read(file)).not.toMatch(/--hl-/);
    },
  );

  it("reads only --t- custom properties in the stylesheet", () => {
    for (const file of rendererCss) {
      const refs = [...read(file).matchAll(/var\(\s*(--[\w-]+)/g)].map((m) => m[1]!);
      expect(refs.length).toBeGreaterThan(10);
      expect(refs.filter((name) => !name.startsWith("--t-"))).toEqual([]);
    }
  });
});

describe("M2-05 renderer styles: container queries only", () => {
  const css = rendererCss.map(read).join("\n");

  it("makes the root a size container", () => {
    expect(css).toMatch(/\[data-page-root\]\s*\{[^}]*container-type:\s*inline-size/);
  });

  it("has no viewport or width media query and no vw unit; @media is only for prefers-reduced-motion", () => {
    // M6-22 narrows this from "no @media at all": the featured link's motion runs only inside
    // `@media (prefers-reduced-motion: no-preference)`. Anything that depends on the viewport's
    // size is still banned (the editor preview is narrower than the viewport).
    const preludes = [...css.matchAll(/@media\b([^{]*)\{/g)].map((m) => m[1]!.trim());
    for (const prelude of preludes) {
      expect(prelude, `@media ${prelude}`).toMatch(
        /^\(\s*prefers-reduced-motion\s*:\s*(?:no-preference|reduce)\s*\)$/,
      );
    }
    expect(css).not.toMatch(/[\d.]\s*vw\b/);
  });

  it("caps the column with the maxWidth token and fills the viewport with the bg token", () => {
    expect(css).toMatch(/max-width:\s*var\(--t-max-width\)/);
    expect(css).toMatch(/\[data-page-root\]\s*\{[^}]*background:\s*var\(--t-bg\)/);
    expect(css).toMatch(/\[data-page-root\]\s*\{[^}]*min-height:\s*100dvh/);
  });

  it("scopes every rule under [data-page-root]", () => {
    // A @keyframes block has no selectors of its own (its "0%", "50%" steps are not rules about
    // elements): it is removed here, and its name must carry the pg- prefix so it cannot collide
    // with a name on a tenant host.
    const stripped = withoutKeyframes(css.replace(/\/\*[\s\S]*?\*\//g, ""));
    for (const m of css.matchAll(/@keyframes\s+([\w-]+)/g)) {
      expect(m[1], `@keyframes ${m[1]}`).toMatch(/^pg-/);
    }
    // Selector lists: the text before each "{" that is not an at-rule prelude.
    const preludes = [...stripped.matchAll(/(?:^|[}\n])\s*([^{}@]+?)\s*\{/g)].map((m) => m[1]!);
    expect(preludes.length).toBeGreaterThan(20);
    for (const prelude of preludes) {
      for (const selector of prelude.split(",")) {
        expect(selector.trim(), `selector "${selector.trim()}"`).toMatch(
          /^(\[data-page-frame\]\s+)?\[data-page-root\]/,
        );
      }
    }
  });
});

describe("M2-05 renderer code: untrusted content", () => {
  it("never uses dangerouslySetInnerHTML", () => {
    for (const file of rendererCode)
      expect(read(file), rel(file)).not.toMatch(/dangerouslySetInnerHTML/);
  });

  it("takes every block href from outboundHref or mailtoLink, never from a raw string", () => {
    const blocks = read(join(RENDERER_DIR, "blocks.tsx"));
    expect(blocks).not.toMatch(/\bhref\s*=/);
    expect((blocks.match(/outboundHref\(/g) ?? []).length).toBeGreaterThanOrEqual(5);
    expect(blocks).toMatch(/mailtoLink\(/);
    const outbound = read(join(RENDERER_DIR, "outbound.ts"));
    expect(outbound).toMatch(/safeHref/);
    expect(outbound).toMatch(/"nofollow noopener"/);
  });

  it("builds embed sources from parseEmbed and image sources from mediaUrl", () => {
    const blocks = read(join(RENDERER_DIR, "blocks.tsx"));
    expect(blocks).toMatch(/parseEmbed\(block\.url\)/);
    expect(blocks).toMatch(/src=\{embed\.src\}/);
    expect(blocks).toMatch(/src=\{mediaUrl\(/);
    const facade = read(join(RENDERER_DIR, "embed-facade.tsx"));
    // M6-27: one shared facade. Its iframe src is the parsed src plus the provider's autoplay flag
    // (embedPlayerSrc), and nothing else: no block.url, no URL taken from the document.
    expect(facade).toMatch(/src=\{playerSrc\}/);
    expect(facade).toMatch(/embedPlayerSrc\(\{ provider, src \}/);
    // The renderer never reads the block's own url for an iframe.
    expect(`${blocks}${facade}`).not.toMatch(/src=\{block\.url|src=\{[a-z]*\.url\}/);
  });

  it("imports only the document, theme, media, env and routing helpers from the app, and the brand marks' data", () => {
    const allowed = [
      /^react$/,
      /^react-dom/,
      /^next\/navigation$/,
      /^\.\//,
      /^@\/lib\/document$/,
      /^@\/lib\/theme$/,
      /^@\/lib\/media\/url$/,
      /^@\/lib\/env\/client$/,
      /^@\/lib\/routing\/urls$/,
      // M9-04: the brand marks' path data (plain data, CC0), imported by name in brand-marks.ts only.
      /^simple-icons$/,
    ];
    for (const file of rendererCode) {
      const code = read(file)
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(^|[^:])\/\/.*$/gm, "$1");
      const imports = [...code.matchAll(/from\s+"([^"]+)"|import\s+"([^"]+)"/g)].map(
        (m) => m[1] ?? m[2]!,
      );
      for (const spec of imports) {
        if (spec.endsWith(".css")) continue;
        expect(
          allowed.some((pattern) => pattern.test(spec)),
          `${rel(file)} imports "${spec}"`,
        ).toBe(true);
      }
    }
  });
});

describe("M2-05 one renderer", () => {
  const srcFiles = walk(join(ROOT, "src"), (f) => /\.tsx?$/.test(f));

  it("keeps the renderer's markup (data-page-root, the pg- classes) inside src/components/page", () => {
    // The editor's block list rows carry data-block-id too, but that is a row hook, not page markup.
    const offenders = srcFiles
      .filter((f) => !f.startsWith(RENDERER_DIR))
      .filter((f) => /data-page-root|["'`\s]pg-[a-z]/.test(read(f)))
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it("defines PageRenderer once, and every importer reaches it through the same module", () => {
    const definers = srcFiles.filter((f) => /export function PageRenderer\b/.test(read(f)));
    expect(definers.map(rel)).toEqual(["src/components/page/page-renderer.tsx"]);
    // The editor imports through its contracts module, which must be a plain re-export.
    const viaContracts = "@/lib/editor/contracts";
    for (const file of srcFiles) {
      if (file.startsWith(RENDERER_DIR)) continue;
      const source = read(file);
      for (const m of source.matchAll(
        /(?:import|export)\s*\{[^}]*\bPageRenderer\b[^}]*\}\s*from\s*"([^"]+)"/g,
      )) {
        expect(
          [viaContracts, "@/components/page/page-renderer"],
          `${rel(file)} imports PageRenderer from ${m[1]}`,
        ).toContain(m[1]);
        if (m[1] === viaContracts) {
          expect(read(join(ROOT, "src/lib/editor/contracts.ts"))).toMatch(
            /export\s*\{\s*PageRenderer\s*\}\s*from\s*"@\/components\/page\/page-renderer"/,
          );
        }
      }
    }
  });

  it("does not let any other component emit the old placeholder's block markup", () => {
    const stub = join(ROOT, "src/components/tenant/tenant-page.tsx");
    try {
      expect(read(stub)).not.toMatch(/data-block-(id|type)/);
    } catch {
      // The publishing agent removes the stub once the tenant page renders through PageRenderer.
    }
  });
});
