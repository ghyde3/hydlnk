import { POST_LIMITS } from "@/lib/content/schemas";
import type { ImageRef } from "@/lib/document";
import { suggestSlug } from "./slug";

/**
 * The post editor's view of a post draft (M16-13). Pure. The stored draft is the writer's
 * `postDraftSchema` object and may hold keys the screen has no field for (`fields`, `seo.ogImage`,
 * an image's `focus`): they are kept as they are. The screen edits a flat form and writes it back
 * over the stored object, so nothing it does not know is dropped.
 */
export interface PostForm {
  title: string;
  slug: string;
  body: string;
  excerpt: string;
  featuredImage: ImageRef | null;
  seoTitle: string;
  seoDescription: string;
  noindex: boolean;
  categories: string[];
  tags: string[];
}

type Stored = Record<string, unknown>;

const isRecord = (value: unknown): value is Stored =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const str = (value: unknown): string => (typeof value === "string" ? value : "");
const ids = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];

function imageOf(value: unknown): ImageRef | null {
  if (!isRecord(value)) return null;
  const { path, width, height } = value;
  if (typeof path !== "string" || typeof width !== "number" || typeof height !== "number") {
    return null;
  }
  return { path, width, height };
}

/** The form of a stored draft. Anything missing or of the wrong type reads as empty. */
export function readPostForm(stored: unknown): PostForm {
  const draft = isRecord(stored) ? stored : {};
  const seo = isRecord(draft.seo) ? draft.seo : {};
  const terms = isRecord(draft.terms) ? draft.terms : {};
  return {
    title: str(draft.title),
    slug: str(draft.slug),
    body: str(draft.body),
    excerpt: str(draft.excerpt),
    featuredImage: imageOf(draft.featuredImage),
    seoTitle: str(seo.title),
    seoDescription: str(seo.description),
    noindex: seo.noindex === true,
    categories: ids(terms.categories),
    tags: ids(terms.tags),
  };
}

/**
 * The draft to store: `base` (the stored draft as loaded) with the form's fields written over it.
 * An empty SEO title or description and an unset "hide from search engines" are left out, and `seo`
 * itself when nothing is in it; a featured image that did not change keeps its stored object.
 */
export function toStoredDraft(form: PostForm, base: unknown): Stored {
  const draft: Stored = isRecord(base) ? { ...base } : {};
  draft.title = form.title;
  draft.slug = form.slug;
  draft.body = form.body;
  draft.excerpt = form.excerpt;

  const before = imageOf(draft.featuredImage);
  if (form.featuredImage === null) draft.featuredImage = null;
  else if (before === null || before.path !== form.featuredImage.path) {
    draft.featuredImage = { ...form.featuredImage };
  }

  const seo: Stored = isRecord(draft.seo) ? { ...draft.seo } : {};
  if (form.seoTitle === "") delete seo.title;
  else seo.title = form.seoTitle;
  if (form.seoDescription === "") delete seo.description;
  else seo.description = form.seoDescription;
  if (form.noindex) seo.noindex = true;
  else delete seo.noindex;
  if (Object.keys(seo).length === 0) delete draft.seo;
  else draft.seo = seo;

  const terms: Stored = isRecord(draft.terms) ? { ...draft.terms } : {};
  terms.categories = [...form.categories];
  terms.tags = [...form.tags];
  draft.terms = terms;
  return draft;
}

/** JSON with every object's keys in order: two drafts with the same content read the same. */
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/**
 * Whether the slug still follows the title: true for a post that was never published whose slug is
 * empty or is exactly what its title suggests. Once the person types a slug of their own, or the
 * post has been live (its address is in use), the slug stays put.
 */
export function slugFollowsTitle(form: PostForm, everPublished: boolean): boolean {
  if (everPublished) return false;
  return form.slug === "" || form.slug === suggestSlug(form.title);
}

export type PostField =
  "title" | "slug" | "body" | "excerpt" | "featuredImage" | "seo" | "terms" | "post";

export const POST_FIELD_LABEL: Record<PostField, string> = {
  title: "Title",
  slug: "Slug",
  body: "Body",
  excerpt: "Excerpt",
  featuredImage: "Featured image",
  seo: "Search",
  terms: "Categories and tags",
  post: "Post",
};

/** The field of the screen an issue's path belongs to (`seo.title` is "seo"; anything else, the post). */
export function fieldOfIssue(path: string): PostField {
  const head = path.split(".")[0] ?? "";
  return head in POST_FIELD_LABEL && head !== "post" ? (head as PostField) : "post";
}

export const postFieldId = (field: PostField) => `post-field-${field}`;

/** How full the body is, for the meter shown near the limit: `near` from 80%, `over` past 512 KiB. */
export function bodyUsage(bytes: number): { near: boolean; over: boolean; text: string } {
  const limit = POST_LIMITS.bodyBytes;
  const kib = (n: number) => Math.ceil(n / 1024).toLocaleString("en-US");
  return {
    near: bytes >= limit * 0.8,
    over: bytes > limit,
    text: `${kib(bytes)} of ${kib(limit)} KiB`,
  };
}
