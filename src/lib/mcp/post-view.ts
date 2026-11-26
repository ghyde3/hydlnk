import { postPublishSchema } from "@/lib/content/schemas";
import type { ImageRef } from "@/lib/document";
import { bodyRange, contentHash } from "./body-range";
import { imageIdOf } from "./images";
import { boundIssues } from "./result";
import type { OwnedEntry } from "./types";

/**
 * A post draft as the AI sees it, and the draft a write builds (M18-04, M18-05). Pure: no database.
 * The view is made from the DRAFT only; the published copy never reaches this module.
 */

type Doc = Record<string, unknown>;

const record = (value: unknown): Doc =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Doc) : {};
const text = (value: unknown): string => (typeof value === "string" ? value : "");
const ids = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

function imageId(value: unknown): string | null {
  const path = record(value).path;
  return typeof path === "string" && path !== "" ? imageIdOf({ path }) : null;
}

/** The body of a stored draft, exactly as stored. */
export function bodyOf(draft: unknown): string {
  return text(record(draft).body);
}

/** What Publish's schema would refuse in this draft: a missing title, a bad slug, a field too long. */
export function postPublishIssues(draft: unknown): Array<{ path: string; message: string }> {
  const parsed = postPublishSchema.safeParse(draft);
  if (parsed.success) return [];
  return boundIssues(
    parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
  );
}

export function postView(
  entry: OwnedEntry,
  range: { offset: number; length: number },
  ctx: { imageUrlPrefix: string; liveUrl: string | null },
): Record<string, unknown> {
  const draft = record(entry.draft);
  const seo = record(draft.seo);
  const terms = record(draft.terms);
  const body = text(draft.body);
  const part = bodyRange(body, range.offset, range.length);
  return {
    id: entry.id,
    pageId: entry.siteId,
    type: entry.typeKey,
    rev: entry.rev,
    status: entry.status,
    hasUnpublishedChanges: entry.hasUnpublishedChanges,
    title: text(draft.title),
    slug: text(draft.slug),
    excerpt: text(draft.excerpt),
    body: part.text,
    bodyOffset: part.offset,
    nextOffset: part.nextOffset,
    bodyChars: part.bodyChars,
    contentHash: contentHash(body),
    featuredImageId: imageId(draft.featuredImage),
    ogImageId: imageId(seo.ogImage),
    seoTitle: text(seo.title),
    seoDescription: text(seo.description),
    noindex: seo.noindex === true,
    categories: ids(terms.categories),
    tags: ids(terms.tags),
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    publishedAt: entry.publishedAt,
    firstPublishedAt: entry.firstPublishedAt,
    ...(entry.deletedAt ? { deletedAt: entry.deletedAt } : {}),
    ...(ctx.liveUrl ? { liveUrl: ctx.liveUrl } : {}),
    publishIssues: entry.status === "trashed" ? [] : postPublishIssues(entry.draft),
    imageUrlPrefix: ctx.imageUrlPrefix,
  };
}

/** The fields a write names; a key left out is a field left alone. */
export interface PostChanges {
  title?: string | undefined;
  slug?: string | undefined;
  excerpt?: string | undefined;
  body?: string | undefined;
  seoTitle?: string | undefined;
  seoDescription?: string | undefined;
  noindex?: boolean | undefined;
  categories?: string[] | undefined;
  tags?: string[] | undefined;
}

/** The images a write names, already resolved under the caller's own folder; null removes one. */
export interface ResolvedImages {
  featuredImage?: ImageRef | null | undefined;
  ogImage?: ImageRef | null | undefined;
}

/**
 * The next draft: the stored one with the named fields replaced. `fields` (the custom fields of a
 * later stage) and every key this function does not know are carried over untouched, and so is
 * every field the write did not name.
 */
export function buildPostDraft(
  current: unknown,
  changes: PostChanges,
  images: ResolvedImages,
): Record<string, unknown> {
  const next: Doc = { ...record(current) };
  if (changes.title !== undefined) next.title = changes.title;
  if (changes.slug !== undefined) next.slug = changes.slug;
  if (changes.excerpt !== undefined) next.excerpt = changes.excerpt;
  if (changes.body !== undefined) next.body = changes.body;
  if (images.featuredImage !== undefined) next.featuredImage = images.featuredImage;
  if (
    changes.seoTitle !== undefined ||
    changes.seoDescription !== undefined ||
    changes.noindex !== undefined ||
    images.ogImage !== undefined
  ) {
    const seo: Doc = { ...record(next.seo) };
    if (changes.seoTitle !== undefined) seo.title = changes.seoTitle;
    if (changes.seoDescription !== undefined) seo.description = changes.seoDescription;
    if (changes.noindex !== undefined) seo.noindex = changes.noindex;
    if (images.ogImage !== undefined) seo.ogImage = images.ogImage;
    next.seo = seo;
  }
  if (changes.categories !== undefined || changes.tags !== undefined) {
    const terms: Doc = { ...record(next.terms) };
    if (changes.categories !== undefined) terms.categories = changes.categories;
    if (changes.tags !== undefined) terms.tags = changes.tags;
    next.terms = terms;
  }
  return next;
}
