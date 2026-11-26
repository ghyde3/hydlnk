import "server-only";
import type {
  LatestPosts,
  PostCard,
  PostIndex,
  PublishedPost,
  SiteArchives,
  TermIndexItem,
} from "./types";

/**
 * The public reads of the blog (Wave B, M16): published columns only, the secret key, cached under
 * the site, type and entry tags. Contract stubs: Builder B writes every body (plan section 4.2).
 */

function notBuilt(): never {
  throw new Error("not built: B");
}

/** The site's enabled archives. Tag `page:<siteId>`. */
export function getSiteArchives(siteId: string): Promise<SiteArchives> {
  void siteId;
  return notBuilt();
}

/** The newest live posts of a type, newest first. Tags `type:<typeId>` and `page:<siteId>`. */
export function getPostIndex(siteId: string, typeId: string): Promise<PostIndex> {
  void siteId;
  void typeId;
  return notBuilt();
}

/** The type's terms with their live counts. Tag `type:<typeId>`. */
export function getTermIndex(siteId: string, typeId: string): Promise<TermIndexItem[]> {
  void siteId;
  void typeId;
  return notBuilt();
}

/** Old slug -> entry id, at most 200. Tag `type:<typeId>`. */
export function getSlugRedirects(siteId: string, typeId: string): Promise<Record<string, string>> {
  void siteId;
  void typeId;
  return notBuilt();
}

/** One live post, its published copy parsed with `postPublishSchema`; null when it is not live. */
export function getPublishedPost(
  siteId: string,
  typeId: string,
  entryId: string,
): Promise<PublishedPost | null> {
  void siteId;
  void typeId;
  void entryId;
  return notBuilt();
}

/** The cards of these live posts, in the order of `ids`. */
export function getPostCards(
  siteId: string,
  typeId: string,
  ids: readonly string[],
): Promise<PostCard[]> {
  void siteId;
  void typeId;
  void ids;
  return notBuilt();
}

/** What a `latest_posts` block draws; null when the type is off. Tag `type:<typeId>`. */
export function getLatestPosts(siteId: string, typeId: string): Promise<LatestPosts | null> {
  void siteId;
  void typeId;
  return notBuilt();
}

/** The id of the live post with this slug: the index, then one read only when the index is incomplete. */
export function findLivePostId(
  siteId: string,
  typeId: string,
  slug: string,
): Promise<string | null> {
  void siteId;
  void typeId;
  void slug;
  return notBuilt();
}

/** True when `entryId` is a live post of an enabled archive of this site (the beacon asks). */
export function isLivePost(siteId: string, entryId: string): Promise<boolean> {
  void siteId;
  void entryId;
  return notBuilt();
}
