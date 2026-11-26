import type { z } from "zod";
import { pageDraftSchema, pagePublishSchema } from "./page";
import { postDraftSchema, postPublishSchema } from "./post";

export { postDraftSchema, postPublishSchema, POST_LIMITS } from "./post";
export type { PostDraft, PostPublish } from "./post";
export {
  designDraftSchema,
  designPublishSchema,
  homeEntryDraftSchema,
  homeEntryPublishSchema,
  pageDraftSchema,
  pagePublishSchema,
  toHomeEntryPublishForm,
} from "./page";
export { entrySlugIssue } from "./slug";
export { LIST_ORDERS, LIST_SORTS, LIST_STATUSES } from "./enums";
export type { EntryStatus, ListOrder, ListSort, ListStatus } from "./enums";

export type EntrySchemaMode = "draft" | "publish";

/** The most issues a refusal carries, as in the page draft writer. */
export const MAX_ISSUES = 10;

/**
 * The schema for an entry type's content: 'post' (built in), 'page' (a sub-page, or Home when the path is '/'), or null
 * for a type this stage cannot validate (the caller answers type_disabled or invalid). Custom types
 * arrive in stage 5.
 */
export function schemaForType(typeKey: string, mode: EntrySchemaMode): z.ZodType | null {
  if (typeKey === "post") return mode === "draft" ? postDraftSchema : postPublishSchema;
  if (typeKey === "page") return mode === "draft" ? pageDraftSchema : pagePublishSchema;
  return null;
}

export type ContentIssue = { path: string; message: string };

/** A Zod error as at most MAX_ISSUES `{path, message}` rows, paths dotted (`blocks.2.url`). */
export function issuesOf(error: z.ZodError): ContentIssue[] {
  return error.issues
    .slice(0, MAX_ISSUES)
    .map((issue) => ({ path: issue.path.join("."), message: issue.message }));
}

/**
 * A page path with spaces around it. The schemas validate a trimmed copy and never transform, so the
 * stored path would differ from the validated one (and so would the path it claims): refuse it.
 */
export function untrimmedPathIssue(typeKey: string, draft: unknown): ContentIssue | null {
  if (typeKey !== "page") return null;
  const path = (draft as { path?: unknown } | null)?.path;
  return typeof path === "string" && path !== path.trim()
    ? { path: "path", message: "Remove the spaces around the address." }
    : null;
}

/** The size of a draft as Postgres counts it for the 1 MiB cap: jsonb text puts a space after `:` and `,`. */
export function draftBytes(value: unknown): number {
  const encoder = new TextEncoder();
  const size = (v: unknown): number => {
    if (Array.isArray(v))
      return 2 + v.reduce<number>((n, x) => n + size(x), 0) + Math.max(0, v.length - 1) * 2;
    if (v && typeof v === "object") {
      const entries = Object.entries(v as Record<string, unknown>).filter(
        ([, x]) => x !== undefined,
      );
      return (
        2 +
        entries.reduce(
          (n, [k, x]) => n + encoder.encode(JSON.stringify(k)).length + 2 + size(x),
          0,
        ) +
        Math.max(0, entries.length - 1) * 2
      );
    }
    return encoder.encode(JSON.stringify(v) ?? "null").length;
  };
  return size(value);
}

/** The most a draft may weigh (the CHECK on content_entries.draft). */
export const MAX_DRAFT_BYTES = 1024 * 1024;
