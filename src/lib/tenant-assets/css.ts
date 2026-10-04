import { readFileSync } from "node:fs";
import { join } from "node:path";
import { filterCss, parseCss, serializeCss, type CssNode } from "./css-split";
import { buildFontFaces } from "./fonts";

/**
 * The live page's one `<style>` element (M8-02): the tenant base rules, the renderer rules the
 * page needs and the page's `@font-face` rules, minified, from the same two files the editor
 * preview imports. Nothing tenant-written is ever put in it: two pages with the same block types
 * and fonts get the same bytes, and the theme arrives as the root's inline `--t-*` properties.
 *
 * Which renderer rules a page needs: the profile, footer, background and shared rules always;
 * each block type's rules (its `.pg-*` classes) only when the page has a block of that type. The
 * editor-only rules (the phone bezel, the empty-block placeholder) are left out.
 *
 * The files are read as text on first use, the way the OG image reads its font (og-font.ts): a
 * literal path under `process.cwd()` that the build traces into the function bundle.
 */

/**
 * The class family of each block type: a rule whose selector names a class of that family is that
 * block type's. The renderer's classes are `pg-` plus one of these words, so each entry is the part
 * after the prefix (the renderer module is the one place that spells out markup, M2-05). A class of
 * no family is shared by every page.
 */
const BLOCK_CLASS_FAMILIES: Record<string, readonly string[]> = {
  link: ["link"],
  card: ["card"],
  header: ["header"],
  text: ["text"],
  divider: ["divider"],
  image: ["image"],
  social: ["social"],
  embed: ["embed"],
  grid: ["grid", "cell"],
};

/** Every block type with rules of its own, in the order of the table above. */
export const STYLED_BLOCK_TYPES: readonly string[] = Object.keys(BLOCK_CLASS_FAMILIES);

const CLASS_PREFIX = "pg-";

/** The block type a renderer class belongs to (a link icon's class: `link`), or null for a shared one. */
function blockOfClass(name: string): string | null {
  for (const [type, families] of Object.entries(BLOCK_CLASS_FAMILIES)) {
    for (const family of families) {
      const base = `${CLASS_PREFIX}${family}`;
      if (name === base || name.startsWith(`${base}-`)) return type;
    }
  }
  return null;
}

/** Classes that exist only in the editor preview (an incomplete block's dashed box). */
const PREVIEW_ONLY_CLASSES = new Set([`${CLASS_PREFIX}placeholder`]);

/*
 * Each file is read with a literal path inside the call, the way og-font.ts reads its font: that is
 * the form the build's file tracing understands, so both files ship with the route's function
 * (a page is regenerated at runtime after a Publish). A path held in a variable would not be traced.
 */
const tenantNodes = (): CssNode[] =>
  parseCss(readFileSync(join(process.cwd(), "src/app/(tenant)/tenant.css"), "utf8"));
const rendererNodes = (): CssNode[] =>
  parseCss(readFileSync(join(process.cwd(), "src/components/page/page-renderer.css"), "utf8"));

let parsed: { tenant: CssNode[]; renderer: CssNode[] } | undefined;
function sources() {
  parsed ??= { tenant: tenantNodes(), renderer: rendererNodes() };
  return parsed;
}

const classesOf = (selector: string): string[] =>
  [...selector.matchAll(/\.(pg-[a-z0-9-]+)/g)].map((match) => match[1]!);

/** The base rules every tenant document has: the text-size and margin resets (no `.tenant-*` class). */
function pageBaseSelector(selector: string): boolean {
  return !/\.tenant-/.test(selector);
}

function rendererSelector(types: ReadonlySet<string>): (selector: string) => boolean {
  return (selector) => {
    // The editor's phone bezel is a mount the live page never has.
    if (selector.includes("[data-page-frame]")) return false;
    for (const name of classesOf(selector)) {
      if (PREVIEW_ONLY_CLASSES.has(name)) return false;
      const type = blockOfClass(name);
      if (type !== null && !types.has(type)) return false;
    }
    return true;
  };
}

const cache = new Map<string, string>();

/** Minified tenant base + the renderer rules for these block types (no fonts). */
export function pageRulesCss(blockTypes: Iterable<string>): string {
  const types = new Set([...blockTypes].filter((type) => type in BLOCK_CLASS_FAMILIES));
  const key = [...types].sort().join(",");
  let css = cache.get(key);
  if (css === undefined) {
    const { tenant, renderer } = sources();
    css =
      serializeCss(filterCss(tenant, pageBaseSelector)) +
      serializeCss(filterCss(renderer, rendererSelector(types)));
    cache.set(key, css);
  }
  return css;
}

export interface TenantCssInput {
  /** The published document's blocks: only their `type` is read. */
  blocks: readonly { type: string }[];
  /** The published document's tokens: only the three font tokens are read. */
  tokens: { fontHeading?: unknown; fontBody?: unknown; weightHeading?: unknown };
}

/**
 * The text of the page's `<style>` element: `@font-face` rules for the faces its tokens select,
 * the tenant base rules and the renderer rules for the block types it holds.
 */
export function tenantInlineCss(doc: TenantCssInput): string {
  return buildFontFaces(doc.tokens) + pageRulesCss(doc.blocks.map((block) => block.type));
}

let stateCss: string | undefined;

/**
 * The `<style>` text of the placeholder, the 404 panels and the error panel (M8-03): every rule of
 * tenant.css (the `.tenant-*` classes of those states), no renderer rules, no fonts. System fonts
 * only, as those states have always been.
 */
export function tenantStateCss(): string {
  stateCss ??= serializeCss(filterCss(sources().tenant, () => true));
  return stateCss;
}
