import "server-only";
import { checkPostBody } from "@/lib/content";
import { entrySlugIssue } from "@/lib/content/schemas";
import { cleanLine, cleanMultiline } from "./doc-view";
import { ToolFailure } from "./errors";
import { createImageResolver } from "./images";
import { buildPostDraft, type PostChanges, type ResolvedImages } from "./post-view";
import { checkTermIds, mcpActor, refusal } from "./tools/content-common";
import type { ToolCall } from "./types";

/**
 * What `create_entry` and `update_entry` do to their arguments before the writer sees a draft
 * (M18-05, plan 3.5). Tenant content is untrusted and so is what an AI sends for it:
 *
 *   - one-line fields lose line breaks and hidden characters, as the page tools' fields do;
 *   - a slug is checked with the entry slug rule (it is never repaired);
 *   - an image comes only by `imageId`, resolved in the folder of the token's user;
 *   - category and tag ids must be terms of that site's blog;
 *   - the body is stored as sent, and the whole next body goes through the checks Publish runs
 *     (`checkPostBody`): allowed schemes, uploads only, the caller's own existing files.
 *
 * Nothing here writes. The link blocklist runs inside the writer's create and update.
 */

export interface PostFieldArgs {
  title?: string | undefined;
  slug?: string | undefined;
  body?: string | undefined;
  excerpt?: string | undefined;
  featuredImageId?: string | null | undefined;
  ogImageId?: string | null | undefined;
  seoTitle?: string | undefined;
  seoDescription?: string | undefined;
  noindex?: boolean | undefined;
  categories?: string[] | undefined;
  tags?: string[] | undefined;
}

function checkedSlug(slug: string): string {
  const trimmed = slug.trim();
  const issue = entrySlugIssue(trimmed);
  if (issue) {
    throw new ToolFailure("invalid_input", issue, { issues: [{ path: "slug", message: issue }] });
  }
  return trimmed;
}

/** The next draft of a post, checked; `current` is the stored draft (`{}` for a new post). */
export async function preparePostDraft(
  call: ToolCall,
  siteId: string,
  current: unknown,
  args: PostFieldArgs,
): Promise<Record<string, unknown>> {
  const changes: PostChanges = {
    ...(args.title !== undefined ? { title: cleanLine(args.title).trim() } : {}),
    ...(args.slug !== undefined ? { slug: checkedSlug(args.slug) } : {}),
    ...(args.excerpt !== undefined ? { excerpt: cleanMultiline(args.excerpt).trim() } : {}),
    ...(args.body !== undefined ? { body: args.body } : {}),
    ...(args.seoTitle !== undefined ? { seoTitle: cleanLine(args.seoTitle).trim() } : {}),
    ...(args.seoDescription !== undefined
      ? { seoDescription: cleanLine(args.seoDescription).trim() }
      : {}),
    ...(args.noindex !== undefined ? { noindex: args.noindex } : {}),
    ...(await checkTermIds(call, siteId, { categories: args.categories, tags: args.tags })),
  };

  const images: ResolvedImages = {};
  if (args.featuredImageId !== undefined || args.ogImageId !== undefined) {
    const resolve = createImageResolver(call.admin, call.userId);
    if (args.featuredImageId !== undefined) {
      images.featuredImage =
        args.featuredImageId === null ? null : await resolve(args.featuredImageId);
    }
    if (args.ogImageId !== undefined) {
      images.ogImage = args.ogImageId === null ? null : await resolve(args.ogImageId);
    }
  }

  const draft = buildPostDraft(current, changes, images);
  const refused = await checkPostBody({ actor: mcpActor(call), draft });
  if (refused) throw await refusal(call, refused);
  return draft;
}
