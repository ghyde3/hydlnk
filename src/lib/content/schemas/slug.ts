import { z } from "zod";
import {
  PATH_MESSAGES,
  RESERVED_ENTRY_SLUGS,
  SUB_PAGE_PATH_PATTERN,
  isReservedPath,
} from "@/lib/document/path";

export const SLUG_MESSAGES = {
  format: PATH_MESSAGES.format,
  reserved: "That slug is reserved. Choose another.",
} as const;

/** The problem with a typed entry's slug, or null when it can be published. No trimming, no case folding. */
export function entrySlugIssue(slug: string): string | null {
  if (!SUB_PAGE_PATH_PATTERN.test(slug)) return SLUG_MESSAGES.format;
  if (RESERVED_ENTRY_SLUGS.includes(slug) || isReservedPath(slug)) return SLUG_MESSAGES.reserved;
  return null;
}

/** The strict slug: the segment rule of a sub-page path, minus the archive words and reserved paths. */
export const strictEntrySlug = z.string().superRefine((value, ctx) => {
  const issue = entrySlugIssue(value);
  if (issue) ctx.addIssue({ code: "custom", message: issue });
});

/** The draft slug: any short string, empty included. */
export const draftEntrySlug = z.string().max(80, { error: SLUG_MESSAGES.format });
