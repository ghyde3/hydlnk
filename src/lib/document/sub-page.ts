import { z } from "zod";
import { featuredOverLimit, FEATURED_LIMIT_MESSAGE } from "./link-icons";
import { LIMITS } from "./limits";
import { requireMarkRanges } from "./marks";
import { PATH_MESSAGES, isPathFormat, isReservedPath } from "./path";
import { mapPublishIssues, publishBlock, type PublishError } from "./publish";
import { blockSchema, publishBlockSchema, requireUniqueIds, text, type Block } from "./schema";

/**
 * A sub-page document (M11-04): `{path, title, description, blocks}`, stored in `site_pages.draft`
 * and `site_pages.published`. The blocks are Home's blocks: the same schemas, limits, URL rules and
 * publish form (`blockSchema`, `publishBlockSchema`, `publishBlock`), never a copy. The theme,
 * profile, banner, share card and menu belong to the site (Home's document), not to a sub-page.
 *
 * Plain text everywhere: nothing here is markup, and the renderer escapes it like every other text.
 * Three schemas, the same shape as Home's:
 *   draftSubPageSchema      lenient: half-typed content autosaves (any path text, empty title).
 *   publishSubPageSchema    strict, for a draft-shaped document: the Publish gate.
 *   publishedSubPageSchema  strict, for the stored form `toSubPagePublishForm` produces.
 */

export const SUB_PAGE_LIMITS = {
  title: 60,
  description: 160,
  /** A draft keeps any path text up to this long, so a half-typed path autosaves and shows its error. */
  draftPath: 64,
} as const;

const tooManyBlocks = { error: `Use ${LIMITS.blocks} blocks or fewer.` };

function titleField(mode: "draft" | "publish") {
  return text(mode, { max: SUB_PAGE_LIMITS.title, required: "Add a page title." });
}
function descriptionField(mode: "draft" | "publish") {
  return text(mode, { max: SUB_PAGE_LIMITS.description });
}

/** The path at Publish: the segment rule and the reserved list, with their own messages. */
const strictPath = z.string().superRefine((value, ctx) => {
  if (!isPathFormat(value)) ctx.addIssue({ code: "custom", message: PATH_MESSAGES.format });
  else if (isReservedPath(value)) ctx.addIssue({ code: "custom", message: PATH_MESSAGES.reserved });
});

/** The draft: what the editor autosaves for a sub-page. Lenient about completeness, strict about structure. */
export const draftSubPageSchema = z
  .object({
    path: z.string().trim().max(SUB_PAGE_LIMITS.draftPath, { error: PATH_MESSAGES.format }),
    title: titleField("draft"),
    description: descriptionField("draft"),
    blocks: z.array(blockSchema).max(LIMITS.blocks, tooManyBlocks),
  })
  .superRefine(requireUniqueIds);
export type SubPageDraft = z.infer<typeof draftSubPageSchema>;

/**
 * The Publish gate's validator for a draft-shaped sub-page: the draft's checks, plus a valid
 * non-reserved path, a title, a plain-text description, and every visible block complete and safe
 * (hidden blocks are exempt, they are dropped by `toSubPagePublishForm`). Issues carry the draft's
 * paths (`path`, `title`, `blocks.2.url`...).
 */
export const publishSubPageSchema = draftSubPageSchema.superRefine((doc, ctx) => {
  const path = strictPath.safeParse(doc.path);
  if (!path.success) {
    for (const issue of path.error.issues) {
      ctx.addIssue({ code: "custom", message: issue.message, path: ["path"] });
    }
  }
  for (const [field, schema] of [
    ["title", titleField("publish")],
    ["description", descriptionField("publish")],
  ] as const) {
    const result = schema.safeParse(doc[field]);
    if (!result.success) {
      for (const issue of result.error.issues) {
        ctx.addIssue({ code: "custom", message: issue.message, path: [field] });
      }
    }
  }
  doc.blocks.forEach((block, index) => {
    if (block.visible === false) return;
    const result = publishBlockSchema.safeParse(block);
    if (result.success) return;
    for (const issue of result.error.issues) {
      ctx.addIssue({
        code: "custom",
        message: issue.message,
        path: ["blocks", index, ...issue.path],
      });
    }
  });
  for (const index of featuredOverLimit(doc.blocks)) {
    ctx.addIssue({
      code: "custom",
      message: FEATURED_LIMIT_MESSAGE,
      path: ["blocks", index, "featured"],
    });
  }
});

/** The stored published form (`site_pages.published`): what the public sub-page loads and renders from. */
export const publishedSubPageSchema = z
  .object({
    path: strictPath,
    title: titleField("publish"),
    description: descriptionField("publish"),
    blocks: z.array(publishBlockSchema).max(LIMITS.blocks, tooManyBlocks),
  })
  .superRefine(requireUniqueIds)
  .superRefine(requireMarkRanges)
  .superRefine((doc, ctx) => {
    for (const index of featuredOverLimit(doc.blocks)) {
      ctx.addIssue({
        code: "custom",
        message: FEATURED_LIMIT_MESSAGE,
        path: ["blocks", index, "featured"],
      });
    }
  });
export type SubPagePublish = z.infer<typeof publishedSubPageSchema>;

/**
 * The publish form of a sub-page draft: trimmed path, title and description, hidden blocks removed,
 * every block through the same `publishBlock` as Home's. Pure and total; it does not validate (the
 * gate runs `publishSubPageSchema` first and `publishedSubPageSchema` on this result).
 */
export function toSubPagePublishForm(draft: SubPageDraft): SubPagePublish {
  const blocks: Block[] = [];
  for (const block of draft.blocks) {
    if (block.visible === false) continue;
    const form = publishBlock(block);
    if (form) blocks.push(form);
  }
  return {
    path: draft.path.trim(),
    title: draft.title.trim(),
    description: draft.description.trim(),
    blocks,
  };
}

/** A new, empty sub-page draft (title "New page", no blocks) at `path`. */
export function emptySubPageDraft(path: string, title = "New page"): SubPageDraft {
  return { path, title, description: "", blocks: [] };
}

/**
 * The problems that stop a raw sub-page draft from publishing, one error per field, in the shape
 * Home's `collectPublishErrors` gives: `path`, `title` and `description` have no block; every other
 * issue names its block (and icon, cell or mark). Empty when the draft can be published. The caller
 * adds the page's name (`subPageId`, `pageTitle`).
 */
export function collectSubPagePublishErrors(draft: unknown): PublishError[] {
  const result = publishSubPageSchema.safeParse(draft);
  if (result.success) return [];
  return mapPublishIssues(result.error.issues, draft);
}
