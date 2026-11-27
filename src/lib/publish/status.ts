import { publishFormsEqual, type PublishDoc } from "@/lib/document";

/**
 * Per-item publish states (M15-10). The site publishes in parts: the design (theme, menu, profile
 * and every other key of the publish form except `blocks`), Home (its `blocks`) and each page.
 * Pure and client-safe: the editor's publish bar and the MCP `get_page` tool both read it.
 */
export type ItemPublishState = "live" | "changed" | "draft";

/** The one vocabulary for an item's state, in the publish bar and the pages card. */
export const ITEM_STATE_LABEL: Record<ItemPublishState, string> = {
  live: "Live",
  changed: "Unpublished changes",
  draft: "Draft",
};

/** The publish form without Home's blocks: what "Publish design" writes. */
function designOf(doc: PublishDoc): Omit<PublishDoc, "blocks"> {
  const { blocks: _blocks, ...design } = doc;
  return design;
}

/**
 * Splits the site's one comparison in two. Design = the publish form without `blocks`; Home = its
 * `blocks`. Both are compared with `publishFormsEqual` (key order and `undefined` keys ignored).
 *
 *   hasPublished  `pages.published_at` is set: the site was published at least once
 *   published     the stored publish form, or null when it could not be read (then it cannot
 *                 equal anything: both halves read "changed")
 *   form          `toPublishForm(draft, themeTokens)`
 */
export function splitPublishState(input: {
  hasPublished: boolean;
  published: PublishDoc | null;
  form: PublishDoc;
}): { design: ItemPublishState; home: ItemPublishState } {
  if (!input.hasPublished) return { design: "draft", home: "draft" };
  if (input.published === null) return { design: "changed", home: "changed" };
  return {
    design: publishFormsEqual(designOf(input.form), designOf(input.published)) ? "live" : "changed",
    home: publishFormsEqual(input.form.blocks, input.published.blocks) ? "live" : "changed",
  };
}
