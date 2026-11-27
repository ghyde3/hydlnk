import { adminClient, supabaseUrl } from "../fixtures/auth";
import type { IngestPage } from "../m4/analytics-ingest-helpers";

/**
 * Blog fixtures for the public specs of Wave B (M16-03 to M16-07, M16-10): the blog is switched on
 * and posts are written the way the writer does it (an entry row, then the real `publish_entry`),
 * with the secret key. Nothing here touches the seed.
 */

export type Site = Pick<IngestPage, "pageId" | "userId">;

/** Turns the site's blog on and returns the Post type's id. */
export async function enableBlog(siteId: string, enabled = true): Promise<string> {
  const { data, error } = await adminClient()
    .from("content_types")
    .update({ enabled })
    .eq("site_id", siteId)
    .eq("key", "post")
    .select("id")
    .single();
  if (error) throw new Error(`switching the blog failed: ${error.message}`);
  return data.id as string;
}

export async function addTerm(
  site: Site,
  typeId: string,
  taxonomy: "category" | "tag",
  slug: string,
  name: string,
): Promise<string> {
  const { data, error } = await adminClient()
    .from("content_terms")
    .insert({ site_id: site.pageId, type_id: typeId, taxonomy, slug, name })
    .select("id")
    .single();
  if (error) throw new Error(`adding a term failed: ${error.message}`);
  return data.id as string;
}

export interface PostInput {
  title: string;
  slug: string;
  body?: string;
  excerpt?: string;
  featuredImage?: { path: string; width: number; height: number } | null;
  seo?: Record<string, unknown>;
  terms?: { categories?: string[]; tags?: string[] };
  /** false keeps it a draft. */
  live?: boolean;
  publishedAt?: string;
}

const documentOf = (post: PostInput) => ({
  title: post.title,
  slug: post.slug,
  body: post.body ?? `Hello from ${post.title}.`,
  ...(post.excerpt !== undefined ? { excerpt: post.excerpt } : {}),
  ...(post.featuredImage !== undefined ? { featuredImage: post.featuredImage } : {}),
  ...(post.seo ? { seo: post.seo } : {}),
  ...(post.terms ? { terms: post.terms } : {}),
});

async function publish(site: Site, entryId: string, rev: number, post: PostInput): Promise<number> {
  const published = await adminClient().rpc("publish_entry", {
    p_entry_id: entryId,
    p_owner_id: site.userId,
    p_expected_rev: rev,
    p_published: documentOf(post) as never,
    ...(post.publishedAt ? { p_published_at: post.publishedAt } : {}),
  });
  if (published.error) throw new Error(`publishing a post failed: ${published.error.message}`);
  return Number(published.data);
}

/** A post entry: a draft, or published through the real `publish_entry`. Returns its id and rev. */
export async function addPost(
  site: Site,
  typeId: string,
  post: PostInput,
): Promise<{ id: string; rev: number }> {
  const made = await adminClient()
    .from("content_entries")
    .insert({ site_id: site.pageId, type_id: typeId, draft: documentOf(post) as never })
    .select("id, rev")
    .single();
  if (made.error) throw new Error(`adding a post failed: ${made.error.message}`);
  const id = made.data.id as string;
  let rev = Number(made.data.rev);
  if (post.live !== false) rev = await publish(site, id, rev, post);
  return { id, rev };
}

/** Publishes the entry again with these fields (a changed slug, say). */
export function republish(
  site: Site,
  entry: { id: string; rev: number },
  post: PostInput,
): Promise<number> {
  return publish(site, entry.id, entry.rev, post);
}

export async function unpublish(site: Site, entry: { id: string; rev: number }): Promise<void> {
  const { error } = await adminClient().rpc("unpublish_entry", {
    p_entry_id: entry.id,
    p_owner_id: site.userId,
    p_expected_rev: entry.rev,
  });
  if (error) throw new Error(`unpublishing a post failed: ${error.message}`);
}

export async function trash(entryId: string): Promise<void> {
  const { error } = await adminClient()
    .from("content_entries")
    .update({ deleted_at: new Date().toISOString(), published: null, published_at: null })
    .eq("id", entryId);
  if (error) throw new Error(`trashing a post failed: ${error.message}`);
}

/** The stored address of an upload of this user (the form a post body holds). */
export function uploadAddress(userId: string, file: string): string {
  return `${supabaseUrl().replace(/\/+$/, "")}/storage/v1/object/public/page-media/${userId}/${file}`;
}

/** An ISO date `days` days before 20 November 2026, so the order of a fixture is fixed. */
export function daysBefore(days: number): string {
  return new Date(Date.UTC(2026, 10, 20, 12) - days * 86_400_000).toISOString();
}
