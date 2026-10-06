import { readFileSync } from "node:fs";
import { join } from "node:path";
import { filterCss, parseCss, serializeCss, type CssNode } from "./css-split";
import { fontEntry } from "@/lib/design/fonts";
import { lockMarker } from "@/lib/document/lock";
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
  faq: ["faq"],
  contact: ["contact"],
  discount: ["discount"],
  book: ["book"],
  // The block's own class and its parts (the badge, the mark) have two different bases.
  apps: ["apps", "app"],
  map: ["map"],
  // A page link is drawn with the link button's classes (M11-07); the family has no rules of its own.
  page_link: ["pagelink"],
};

/** Every block type with rules of its own, in the order of the table above. */
export const STYLED_BLOCK_TYPES: readonly string[] = Object.keys(BLOCK_CLASS_FAMILIES);

/**
 * The page-level features with rules of their own (M9-23, M9-24): not block types, but they follow
 * the same rule, a page carries a feature's selectors only when it uses the feature, so a page that
 * uses none is byte-identical to before. A selector naming a class of a family (or, for the banner,
 * the `data-banner` attribute of the root) is that feature's.
 *
 *   banner       the support banner (the banner classes)
 *   logo         the profile's logo and the row it sits in (the logo classes)
 *   name-style   the name's size classes (small, large, extra large) and its own font; a medium
 *                name in the heading font has none
 */
const FEATURE_CLASS_FAMILIES: Record<string, readonly string[]> = {
  banner: ["banner"],
  logo: ["logo"],
  "name-style": ["name-s", "name-l", "name-xl", "name-font"],
  // A locked link's padlock and hidden words (M9-30): only a page with a locked link carries them.
  lock: ["lock"],
  // The site menu and a sub-page's header and title (M11-06, M11-07): only a page that draws them carries them.
  menu: ["menu"],
  sitehead: ["sitehead", "pagetitle"],
};

/** Every page feature with rules of its own. */
export const STYLED_PAGE_FEATURES: readonly string[] = Object.keys(FEATURE_CLASS_FAMILIES);

/** The page feature a renderer class belongs to, or null (a block's class or a shared one). */
function featureOfClass(name: string): string | null {
  for (const [feature, families] of Object.entries(FEATURE_CLASS_FAMILIES)) {
    for (const family of families) {
      const base = `pg-${family}`;
      if (name === base || name.startsWith(`${base}-`)) return feature;
    }
  }
  return null;
}

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

// Read once per server process (a dev server re-reads them when this module reloads).
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

function rendererSelector(
  types: ReadonlySet<string>,
  features: ReadonlySet<string>,
): (selector: string) => boolean {
  return (selector) => {
    // The editor's phone bezel is a mount the live page never has.
    if (selector.includes("[data-page-frame]")) return false;
    // The root of a page with a banner carries `data-banner` (M9-23): its stacking rules go with the banner's.
    if (selector.includes("[data-banner]") && !features.has("banner")) return false;
    for (const name of classesOf(selector)) {
      if (PREVIEW_ONLY_CLASSES.has(name)) return false;
      const type = blockOfClass(name);
      if (type !== null && !types.has(type)) return false;
      const feature = featureOfClass(name);
      if (feature !== null && !features.has(feature)) return false;
    }
    return true;
  };
}

const cache = new Map<string, string>();

/**
 * Minified tenant base + the renderer rules for these block types and page features (no fonts).
 * `features` are the names of `STYLED_PAGE_FEATURES` the page uses; none by default.
 */
export function pageRulesCss(
  blockTypes: Iterable<string>,
  features: Iterable<string> = [],
): string {
  const types = new Set([...blockTypes].filter((type) => type in BLOCK_CLASS_FAMILIES));
  const used = new Set([...features].filter((feature) => feature in FEATURE_CLASS_FAMILIES));
  const key = `${[...types].sort().join(",")}|${[...used].sort().join(",")}`;
  let css = cache.get(key);
  if (css === undefined) {
    const { tenant, renderer } = sources();
    css =
      serializeCss(filterCss(tenant, pageBaseSelector)) +
      serializeCss(filterCss(renderer, rendererSelector(types, used)));
    cache.set(key, css);
  }
  return css;
}

export interface TenantCssInput {
  /** The published document's blocks: only their `type` is read (and, for a link, whether it has a lock). */
  blocks: readonly { type: string; lock?: unknown }[];
  /** The published document's tokens: only the three font tokens are read. */
  tokens: { fontHeading?: unknown; fontBody?: unknown; weightHeading?: unknown };
  /** The published document's banner (M9-23): only whether there is one is read. */
  banner?: unknown;
  /** The profile's logo and name style (M9-24): only whether each is in use is read, and the name font. */
  profile?: { logo?: unknown; nameFont?: unknown; nameSize?: unknown };
  /** The page draws the site menu (M11-07). */
  menu?: boolean;
  /** The page is a sub-page: it draws the small site header and the title (M11-06). */
  subPage?: boolean;
}

/**
 * The page features a published document uses, for `pageRulesCss`: the banner, the logo, and a
 * name styled with its own size or font. A value outside its list counts as not used (the renderer
 * draws the default for it), so a hostile string never adds a rule.
 */
export function pageFeaturesOf(
  doc: Pick<TenantCssInput, "banner" | "profile"> &
    Partial<Pick<TenantCssInput, "blocks" | "menu" | "subPage">>,
): string[] {
  const features: string[] = [];
  if (doc.menu === true) features.push("menu");
  if (doc.subPage === true) features.push("sitehead");
  // A locked link (M9-30): only a link block with one of the two known lock kinds counts.
  if (doc.blocks?.some((block) => block.type === "link" && lockMarker(block.lock) !== null)) {
    features.push("lock");
  }
  if (doc.banner !== undefined && doc.banner !== null) features.push("banner");
  const profile = doc.profile;
  if (profile?.logo !== undefined && profile.logo !== null) features.push("logo");
  const sized =
    profile?.nameSize === "small" ||
    profile?.nameSize === "large" ||
    profile?.nameSize === "xlarge";
  if (sized || fontEntry(profile?.nameFont) !== null) features.push("name-style");
  return features;
}

/**
 * The text of the page's `<style>` element: `@font-face` rules for the faces its tokens select
 * (and its name font), the tenant base rules and the renderer rules for the block types and page
 * features it uses.
 */
export function tenantInlineCss(doc: TenantCssInput): string {
  return (
    buildFontFaces({ ...doc.tokens, nameFont: doc.profile?.nameFont }) +
    pageRulesCss(
      // A page link is drawn as a link button (M11-07), so it carries the link rules too.
      doc.blocks.map((block) => (block.type === "page_link" ? "link" : block.type)),
      pageFeaturesOf(doc),
    )
  );
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
