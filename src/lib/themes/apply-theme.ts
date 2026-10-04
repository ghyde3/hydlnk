import type { DraftDoc } from "@/lib/document";

/**
 * Applying a theme to a draft: the page points at the theme and its own overrides are cleared, which
 * is what the Design screen's apply does. The hook (`useThemeLibrary`) and the `set_theme` tool both
 * call this, so the rule lives once (M10-28). Pure: returns a new document and never mutates `doc`.
 */
export function applyThemeToDoc<D extends Pick<DraftDoc, "theme">>(
  doc: D,
  themeId: string | null,
): D {
  return { ...doc, theme: { ref: themeId, overrides: {} } };
}
