import { z } from "zod";
import { tokenOverridesSchema, tokenSetSchema } from "@/lib/theme";
import { blockSchema } from "./blocks";
import { safeUrlSchema } from "./url";

/**
 * Page document (`pages.draft`) and published document (`pages.published`).
 * See PLAN.md -> Data model. Publishing freezes the fully resolved tokens next to the content.
 */

/** Upper bound on blocks per page: keeps validation, rendering and the jsonb row bounded. */
export const MAX_BLOCKS = 100;

export const profileSchema = z.strictObject({
  displayName: z.string().trim().min(1).max(60),
  bio: z.string().max(160),
  avatarUrl: safeUrlSchema.nullable(),
});

const documentShape = {
  version: z.literal(1),
  profile: profileSchema,
  // Any UUID-shaped string (Postgres `uuid` semantics), not only RFC 4122 versions 1-8, so
  // system themes seeded with fixed ids still validate.
  themeId: z.guid().nullable(),
  tokens: tokenOverridesSchema,
  blocks: z.array(blockSchema).max(MAX_BLOCKS),
};

/** Block ids are analytics keys, so two blocks must never share one. */
function requireUniqueBlockIds(
  doc: { blocks: readonly { id: string }[] },
  ctx: z.core.$RefinementCtx,
): void {
  const seen = new Set<string>();
  doc.blocks.forEach((block, index) => {
    if (seen.has(block.id)) {
      ctx.addIssue({
        code: "custom",
        path: ["blocks", index, "id"],
        message: "Block ids must be unique within a page",
      });
    }
    seen.add(block.id);
  });
}

export const pageDocumentSchema = z.strictObject(documentShape).superRefine(requireUniqueBlockIds);

export const publishedDocumentSchema = z
  .strictObject({ ...documentShape, resolvedTokens: tokenSetSchema })
  .superRefine(requireUniqueBlockIds);

export type Profile = z.infer<typeof profileSchema>;
export type PageDocument = z.infer<typeof pageDocumentSchema>;
export type PublishedDocument = z.infer<typeof publishedDocumentSchema>;
