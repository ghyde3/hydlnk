import "server-only";
import type { EntrySummary, TermSummary, TypeSummary } from "@/lib/content";
import {
  getPostCore,
  listPostsCore,
  listTermsCore,
  listTypesCore,
  type PostEntry,
} from "@/lib/posts/routes-core";
import { createAdminSupabase } from "@/lib/supabase/admin";

/**
 * What the Posts screen and the post editor open with (M16-12, M16-13), read through the same cores
 * as their routes, with the gated session user as the actor: the content writer checks that the
 * site is theirs, so no id from the request reaches another account's rows. `siteId` is the current
 * page of the page switcher (`getAppContext`), never a value from the URL.
 */

export interface PostsScreenData {
  type: TypeSummary | null;
  used: number;
  items: EntrySummary[];
  nextCursor: string | null;
  terms: TermSummary[];
}

export async function loadPostsScreen(userId: string, siteId: string): Promise<PostsScreenData> {
  const admin = createAdminSupabase();
  const types = await listTypesCore(admin, { userId, siteId });
  if (types.body.kind !== "ok") throw new Error("Loading the blog failed.");
  const type = types.body.types.find((item) => item.key === "post") ?? null;
  const empty = { type, used: types.body.usage.posts, items: [], nextCursor: null, terms: [] };
  if (!type?.enabled) return empty;
  const [posts, terms] = await Promise.all([
    listPostsCore({ userId, siteId }),
    listTermsCore(admin, { userId, siteId }),
  ]);
  if (posts.body.kind !== "ok" || terms.body.kind !== "ok") {
    throw new Error("Loading the posts failed.");
  }
  return {
    ...empty,
    items: posts.body.items,
    nextCursor: posts.body.nextCursor,
    terms: terms.body.terms,
  };
}

export interface PostEditorData {
  entry: PostEntry;
  terms: TermSummary[];
  archivePath: string;
}

/** One post of the site, or null when it is not a post of this site (the page answers 404). */
export async function loadPostEditor(
  userId: string,
  siteId: string,
  entryId: string,
): Promise<PostEditorData | null> {
  const admin = createAdminSupabase();
  const found = await getPostCore({ userId, siteId, entryId });
  if (found.body.kind === "missing") return null;
  if (found.body.kind !== "ok") throw new Error("Loading the post failed.");
  const [types, terms] = await Promise.all([
    listTypesCore(admin, { userId, siteId }),
    listTermsCore(admin, { userId, siteId }),
  ]);
  if (types.body.kind !== "ok" || terms.body.kind !== "ok") {
    throw new Error("Loading the post failed.");
  }
  const type = types.body.types.find((item) => item.key === "post");
  // A blog that is off has no editor: its posts come back when it is turned on again.
  if (!type?.enabled) return null;
  return {
    entry: found.body.entry,
    terms: terms.body.terms,
    archivePath: type.archivePath ?? "blog",
  };
}
