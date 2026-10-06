import { z } from "zod";
import type { ToolAnnotationSet } from "../types";

/**
 * Pieces every tool shares: the `pageId` and `ifRev` inputs and the annotation sets. Nothing here
 * touches the database.
 *
 * `pageId` is a string with a uuid format, not `z.guid()`: a malformed id must answer exactly like
 * another account's page (`not_found`, the same sentence), and a format check at the input step
 * would answer it differently.
 */

export const pageIdField = z
  .string()
  .max(64)
  .meta({ format: "uuid" })
  .optional()
  .describe(
    "The page's id from list_pages. Leave it out only when the account has exactly one page.",
  );

export const subPageIdField = z
  .string()
  .max(64)
  .meta({ format: "uuid" })
  .optional()
  .describe(
    "Work on this page of the site instead of Home: its id from list_pages. Leave it out, or send home, for Home.",
  );

export const ifRevField = z
  .number()
  .int()
  .min(0)
  .optional()
  .describe(
    "The rev from get_page. Pass it so a change made in the app after you read the page is not overwritten. If it no longer matches, the write is refused with conflict. Each page has its own rev: pass the one get_page gave for the page you are changing.",
  );

export const READ_ONLY: ToolAnnotationSet = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

export const WRITE_IDEMPOTENT: ToolAnnotationSet = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

export const WRITE_NOT_IDEMPOTENT: ToolAnnotationSet = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
};

export const DESTRUCTIVE_IDEMPOTENT: ToolAnnotationSet = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: false,
};

export const DRAFT_ONLY = "Changes the draft only. Nothing is live until publish_page.";
