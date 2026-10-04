import "server-only";

/**
 * What the live page's HTML builder (M8-02) takes from this folder, and nothing else:
 *
 *   tenantInlineCss(doc)      the text of the page's one `<style>` element: `@font-face` rules for the
 *                             faces its tokens select, the tenant base rules and the renderer rules
 *                             for the block types it holds. Minified; byte-identical for pages with
 *                             the same block types and fonts.
 *   tenantStateCss()          the `<style>` text of the placeholder, the 404 panels and the error panel
 *   tenantFontPreloads(tokens) the `href` of each `<link rel="preload" as="font" type="font/woff2" crossorigin>`
 *                             (the latin file of each face the page uses), same URLs as the @font-face rules
 *   tenantFontFaces(tokens)   just the `@font-face` rules (what `tenantInlineCss` starts with)
 *   TENANT_SCRIPT_SRC         `/_t/p.{hash}.js`: the one script, loaded as `<script src defer data-page-id>`
 *   TENANT_SCRIPT_INTEGRITY   its `sha384-...` Subresource Integrity value (optional on the tag)
 *
 * The script and the font files are static files under public/_t/, served by the platform with an
 * immutable cache (the `headers()` rule in next.config.ts), so they never reach the proxy or a function.
 */
export {
  TENANT_SCRIPT_FILE,
  TENANT_SCRIPT_INTEGRITY,
  TENANT_SCRIPT_SRC,
} from "./generated";
export { STYLED_BLOCK_TYPES, tenantInlineCss, tenantStateCss, type TenantCssInput } from "./css";
export { tenantFontFaces, tenantFontPreloads } from "./fonts";
export { TENANT_ASSET_PREFIX, TENANT_FONT_DIR } from "./constants";
