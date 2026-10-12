import type { z } from "zod";
import { draftSubPageSchema, publishSubPageSchema } from "@/lib/document/sub-page";
import { postDraftSchema, postPublishSchema } from "./post";

export { postDraftSchema, postPublishSchema, POST_LIMITS } from "./post";
export type { PostDraft, PostPublish } from "./post";
export { entrySlugIssue } from "./slug";

export type EntrySchemaMode = "draft" | "publish";

/** The most issues a refusal carries, as in the page draft writer. */
export const MAX_ISSUES = 10;

/**
 * The schema for an entry type's content: 'post' (built in), 'page' (the sub-page document), or null
 * for a type this stage cannot validate (the caller answers type_disabled or invalid). Custom types
 * arrive in stage 5.
 */
export function schemaForType(typeKey: string, mode: EntrySchemaMode): z.ZodType | null {
  if (typeKey === "post") return mode === "draft" ? postDraftSchema : postPublishSchema;
  if (typeKey === "page") return mode === "draft" ? draftSubPageSchema : publishSubPageSchema;
  return null;
}

export type ContentIssue = { path: string; message: string };

/** A Zod error as at most MAX_ISSUES `{path, message}` rows, paths dotted (`blocks.2.url`). */
export function issuesOf(error: z.ZodError): ContentIssue[] {
  return error.issues
    .slice(0, MAX_ISSUES)
    .map((issue) => ({ path: issue.path.join("."), message: issue.message }));
}
