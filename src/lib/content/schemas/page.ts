import { z } from "zod";
import { featuredOverLimit, FEATURED_LIMIT_MESSAGE } from "@/lib/document/link-icons";
import { LIMITS } from "@/lib/document/limits";
import { publishBlock } from "@/lib/document/publish";
import {
  blockSchema,
  draftDocObject,
  publishBlockSchema,
  refinePublishDesign,
  requireUniqueIds,
  text,
  type Block,
} from "@/lib/document/schema";
import { SUB_PAGE_LIMITS, draftSubPageSchema, publishSubPageSchema } from "@/lib/document/sub-page";

/**
 * The 'page' entry type (stage 1b). A page entry's draft is `{path, title, description, blocks}`:
 * a sub-page, or Home (path '/', the site's own blocks). The design (profile, theme, banner, menu,
 * share card) stays in `pages.draft`, whose schemas are at the bottom of this file.
 *
 * The sub-page schemas are the document's own, re-exported so the content layer imports one place.
 * Home differs in three ways only: the path is the literal '/', the title and description may be
 * empty (Home has none today), and the rest, the block schemas, limits, unique ids and the
 * featured-link rule, are the ones `publishDocSchema` enforces for Home's blocks.
 */
export { draftSubPageSchema as subPageDraftSchema, publishSubPageSchema as subPagePublishSchema };

const tooManyBlocks = { error: `Use ${LIMITS.blocks} blocks or fewer.` };

function titleField(mode: "draft" | "publish") {
  return text(mode, { max: SUB_PAGE_LIMITS.title });
}
function descriptionField(mode: "draft" | "publish") {
  return text(mode, { max: SUB_PAGE_LIMITS.description });
}

/** Home's entry draft: lenient about completeness, strict about structure. */
export const homeEntryDraftSchema = z
  .object({
    path: z.literal("/"),
    title: titleField("draft"),
    description: descriptionField("draft"),
    blocks: z.array(blockSchema).max(LIMITS.blocks, tooManyBlocks),
  })
  .superRefine(requireUniqueIds);
export type HomeEntryDraft = z.infer<typeof homeEntryDraftSchema>;

/**
 * The Publish gate's validator for Home's entry draft: the draft's checks, plus every visible block
 * complete and safe (hidden blocks are exempt, Publish drops them) and at most
 * `LIMITS.featuredLinks` featured links. The same checks, with the same issue paths, as
 * `publishDocSchema` applies to Home's blocks.
 */
export const homeEntryPublishSchema = homeEntryDraftSchema.superRefine((doc, ctx) => {
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

/** Home's published blocks: what `toPublishForm(draft).blocks` gives, from the entry's blocks alone. */
export function toHomeEntryPublishForm(blocks: readonly Block[]): Block[] {
  const out: Block[] = [];
  for (const block of blocks) {
    if (block.visible === false) continue;
    const form = publishBlock(block);
    if (form) out.push(form);
  }
  return out;
}

/** Whether a page entry's draft is Home's: its path, trimmed, is '/'. Spaces are refused elsewhere. */
function isHomePath(value: unknown): boolean {
  const path = (value as { path?: unknown } | null)?.path;
  return typeof path === "string" && path.trim() === "/";
}

/**
 * One schema for the 'page' type: Home's when the path is '/', the sub-page's otherwise. It never
 * transforms, so the writer stores exactly what it was given.
 */
function pageSchema(mode: "draft" | "publish"): z.ZodType {
  const home = mode === "draft" ? homeEntryDraftSchema : homeEntryPublishSchema;
  const sub = mode === "draft" ? draftSubPageSchema : publishSubPageSchema;
  return z.unknown().superRefine((value, ctx) => {
    const result = (isHomePath(value) ? home : sub).safeParse(value);
    if (result.success) return;
    for (const issue of result.error.issues) {
      ctx.addIssue({ code: "custom", message: issue.message, path: issue.path });
    }
  });
}
export const pageDraftSchema = pageSchema("draft");
export const pagePublishSchema = pageSchema("publish");

/**
 * The site design: the page document without 'blocks'. A frozen `blocks` key left in
 * `pages.draft` is stripped when parsing, never read and never an error.
 */
export const designDraftSchema = draftDocObject
  .omit({ blocks: true })
  .superRefine((doc, ctx) => requireUniqueIds({ ...doc, blocks: [] }, ctx));
export type DesignDraft = z.infer<typeof designDraftSchema>;

/** The Publish gate's validator for the design: `publishDocSchema` without the blocks. */
export const designPublishSchema = designDraftSchema.superRefine((doc, ctx) =>
  refinePublishDesign(doc as Parameters<typeof refinePublishDesign>[0], ctx),
);
