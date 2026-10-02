import { publishFormsEqual, type PublishDoc } from "@/lib/document";

/** The three states of the editor header's status chip (M2-27). */
export type PublishStatus = "not-published" | "unpublished-changes" | "published";

export const PUBLISH_STATUS_LABEL: Record<PublishStatus, string> = {
  "not-published": "Not published",
  "unpublished-changes": "Unpublished changes",
  published: "Published",
};

/**
 * The state is computed from data, never a client flag: the draft's publish form (visible blocks
 * only, resolved tokens, `rev` ignored) is deep-compared with `pages.published`.
 *
 *   hasPublished  `pages.published_at` is set: the page was published at least once
 *   published     the stored publish form, or null when it could not be read (then it cannot
 *                 equal anything, so the page shows unpublished changes)
 *   form          `toPublishForm(draft, themeTokens)`
 */
export function computePublishStatus(input: {
  hasPublished: boolean;
  published: PublishDoc | null;
  form: PublishDoc;
}): PublishStatus {
  if (!input.hasPublished) return "not-published";
  if (input.published === null) return "unpublished-changes";
  return publishFormsEqual(input.form, input.published) ? "published" : "unpublished-changes";
}
