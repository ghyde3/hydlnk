import { GOOGLE_FONTS_API, GOOGLE_FONTS_STATIC, tenantFontStylesheetUrl } from "@/lib/design";
import type { TokenSet } from "@/lib/theme";

type FontTokens = Pick<TokenSet, "fontHeading" | "fontBody" | "weightHeading">;

/**
 * Loads the two fonts of a published tenant page (M3-04): preconnect hints for the Google Fonts
 * API and its static host, and one stylesheet link whose `family` params are the page's heading and
 * body families and nothing else (one param when they are the same). The URL comes from
 * `tenantFontStylesheetUrl`, which only ever builds it from allowlisted names, so no tenant string
 * reaches a request. Server-rendered with the page: React hoists the links into `<head>`. The
 * stylesheet is requested with no Referer, so Google is not told which tenant page a visitor is on.
 */
export function TenantFonts({ tokens }: { tokens: FontTokens }) {
  return (
    <>
      <link rel="preconnect" href={GOOGLE_FONTS_API} />
      <link rel="preconnect" href={GOOGLE_FONTS_STATIC} crossOrigin="anonymous" />
      <link
        rel="stylesheet"
        href={tenantFontStylesheetUrl(tokens)}
        precedence="tenant-fonts"
        referrerPolicy="no-referrer"
      />
    </>
  );
}

/**
 * The same fonts for a live preview in the editor app. Plain links without `precedence`, so a font
 * change updates the one `href` in place instead of suspending the screen while a new stylesheet
 * loads. Used by the editor's preview panel and the Design screen's preview.
 */
export function PreviewFonts({ tokens }: { tokens: FontTokens }) {
  return (
    <>
      <link rel="preconnect" href={GOOGLE_FONTS_API} />
      <link rel="preconnect" href={GOOGLE_FONTS_STATIC} crossOrigin="anonymous" />
      <link rel="stylesheet" href={tenantFontStylesheetUrl(tokens)} data-preview-fonts="" />
    </>
  );
}
