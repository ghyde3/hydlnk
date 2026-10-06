import { toPublishForm, type DraftDoc, type PublishDoc } from "@/lib/document";
import type { ThemeRow } from "./types";

/**
 * What a page would look like with `theme` applied (M6-44), as the publish form the preview draws.
 * A pure function of the draft and one theme row: it is `toPublishForm` of the draft with its theme
 * set to `{ ref: <the theme's id>, overrides: {} }`. Applying a theme clears the page-level
 * overrides (M3-20), so the preview leaves them out; every block keeps its own style, and the real
 * profile and blocks are drawn. The draft is read and never changed (it may be frozen), and nothing
 * here is stored, published or sent anywhere: a preview is derived, on screen only.
 */
export function previewForm(draft: DraftDoc, theme: ThemeRow): PublishDoc {
  return toPublishForm({ ...draft, theme: { ref: theme.id, overrides: {} } }, theme.tokens);
}
