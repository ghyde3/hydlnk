import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  countEntriesWithClient,
  createEntryWithClient,
  createTerm,
  deleteTerm,
  enableType,
  getEntry,
  listTermsWithClient,
  listTypes,
  listTypesWithClient,
  publishEntry,
  renameTerm,
  restoreEntry,
  trashEntry,
  unpublishEntry,
  updateType,
  listEntries,
  type ContentActor,
  type ContentFailure,
  type EntrySummary,
  type TermSummary,
  type TypeSummary,
} from "@/lib/content";
import { LIST_STATUSES, POST_LIMITS, type ListStatus } from "@/lib/content/schemas";
import { postLimitMessage } from "@/lib/limits/messages";
import { PLAN_LIMITS } from "@/lib/limits/table";
import { toPlan, type Plan } from "@/lib/pages/plans";
import { isEntryOfSite } from "@/lib/site-pages/entry-revisions-core";
import { fromFailure, type EntrySaveBody } from "@/lib/site-pages/entry-save-core";
import type { Database } from "@/lib/supabase/database.types";
import { termSlug } from "./slug";
import type { PostEntry } from "./types";

/**
 * The server side of the Posts screen and the post editor (M16-02, M16-12, M16-14, M16-15): one core
 * per app route under /api/pages/{id}/. Each wraps the content writer, which checks the owner, the
 * suspension and the type itself (another account's site, entry or term answers like a missing one),
 * and speaks the editor's save vocabulary (`{kind, ...}`, see `entry-save-core.ts`). This layer adds
 * what the URL promises: the entry is a POST of the site named in it. A page entry, an entry of
 * another site and a malformed id all answer `missing`, the one answer, so ids cannot be probed.
 *
 * The user id is always the verified session's. Limits are the database's (HL010 posts per plan,
 * HL015 terms per type); nothing here counts before it writes. The writes that change what is live
 * go through the writer's own wrappers, which expire the entry's and the type's cache tags.
 */

type Admin = SupabaseClient<Database>;

export interface PostsResponse<Body> {
  status: number;
  body: Body;
}

type Refusal = Exclude<EntrySaveBody, { kind: "ok" }>;
type Answer<Ok> = PostsResponse<Ok | Refusal>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MISSING = { status: 404, body: { kind: "missing" } } as const;
const POST = ["post"] as const;
const POST_KEY = "post";

const invalid = (message: string) => ({ status: 422, body: { kind: "invalid", message } }) as const;
const actor = (userId: string): ContentActor => ({ userId, source: "editor" });
const refused = (failure: ContentFailure): PostsResponse<Refusal> =>
  fromFailure(failure) as PostsResponse<Refusal>;

/** The effective plan of the session user, for the limit's number and words. Read with the secret key by id. */
async function planOf(admin: Admin, userId: string): Promise<Plan> {
  const account = await admin.from("accounts").select("plan").eq("id", userId).maybeSingle();
  if (account.error) throw new Error(`Reading the plan failed: ${account.error.message}`);
  return toPlan(account.data?.plan);
}

// Types ------------------------------------------------------------------------------------------

export type TypesBody = {
  kind: "ok";
  types: TypeSummary[];
  /** Posts the site holds, the trash included (as HL010 counts), against the plan's posts per site. */
  usage: { posts: number; limit: number };
};

/** GET types: the site's types, on or off, and the posts usage for the header's meter. */
export async function listTypesCore(
  admin: Admin,
  input: { userId: string; siteId: string },
): Promise<Answer<TypesBody>> {
  if (!UUID.test(input.siteId)) return MISSING;
  const who = actor(input.userId);
  const types = await listTypesWithClient(admin, { actor: who, siteId: input.siteId });
  if (!types.ok) return refused(types);
  const count = await countEntriesWithClient(admin, {
    actor: who,
    siteId: input.siteId,
    typeKey: POST_KEY,
  });
  // A site without the post type (none exists today) simply holds no posts.
  if (!count.ok && count.error !== "not_found") return refused(count);
  const plan = await planOf(admin, input.userId);
  return {
    status: 200,
    body: {
      kind: "ok",
      types: types.types,
      usage: { posts: count.ok ? count.count : 0, limit: PLAN_LIMITS[plan].entriesPerType },
    },
  };
}

/**
 * POST types/post {enabled?, archivePath?}: turn the blog on or off, or move its archive. The path is
 * changed first, so "turn on at /news" claims `/news` and never `/blog`. A path a page uses or a
 * reserved word answers `{kind: "path"}` (HL012) and nothing changes: a refused turn on puts the
 * previous path back.
 */
export async function setPostTypeCore(input: {
  userId: string;
  siteId: string;
  enabled: unknown;
  archivePath: unknown;
}): Promise<Answer<{ kind: "ok"; type: TypeSummary }>> {
  const { enabled, archivePath } = input;
  if (enabled === undefined && archivePath === undefined) return invalid("Nothing to change.");
  if (enabled !== undefined && typeof enabled !== "boolean") {
    return invalid("Say whether the blog is on or off.");
  }
  if (archivePath !== undefined && typeof archivePath !== "string") {
    return invalid("Use lower-case letters, numbers and hyphens for the address.");
  }
  if (!UUID.test(input.siteId)) return MISSING;
  const who = actor(input.userId);
  let type: TypeSummary | null = null;
  // Turning on at an address moves the path first; if the turn on is then refused, the path the
  // type had is put back, so a refusal changes nothing.
  let previousPath: string | null = null;
  if (archivePath !== undefined && enabled !== undefined) {
    const types = await listTypes({ actor: who, siteId: input.siteId });
    if (!types.ok) return refused(types);
    previousPath = types.types.find((t) => t.key === POST_KEY)?.archivePath ?? null;
  }
  if (archivePath !== undefined) {
    const moved = await updateType({
      actor: who,
      siteId: input.siteId,
      typeKey: POST_KEY,
      archivePath,
    });
    if (!moved.ok) return refused(moved);
    type = moved;
  }
  if (enabled !== undefined) {
    const switched = await enableType({
      actor: who,
      siteId: input.siteId,
      typeKey: POST_KEY,
      enabled,
    });
    if (!switched.ok) {
      if (previousPath !== null && previousPath !== archivePath) {
        const back = await updateType({
          actor: who,
          siteId: input.siteId,
          typeKey: POST_KEY,
          archivePath: previousPath,
        });
        if (!back.ok) console.error("[posts] restoring the archive path failed", back.error);
      }
      return refused(switched);
    }
    type = switched;
  }
  if (!type) return invalid("Nothing to change.");
  return {
    status: 200,
    body: {
      kind: "ok",
      type: {
        typeId: type.typeId,
        key: type.key,
        label: type.label,
        labelPlural: type.labelPlural,
        enabled: type.enabled,
        archivePath: type.archivePath,
      },
    },
  };
}

// Posts ------------------------------------------------------------------------------------------

export const POSTS_PAGE_SIZE = 20;
const POST_SORTS = ["updated_at", "published_at"] as const;
export type PostSort = (typeof POST_SORTS)[number];
const MAX_QUERY = 100;
const MAX_CURSOR = 600;

export type PostsListBody = { kind: "ok"; items: EntrySummary[]; nextCursor: string | null };

/** GET posts?status&term&q&sort&cursor: the site's posts, 20 a page. With no status, everything but the trash. */
export async function listPostsCore(input: {
  userId: string;
  siteId: string;
  status?: string | null;
  term?: string | null;
  q?: string | null;
  sort?: string | null;
  cursor?: string | null;
}): Promise<Answer<PostsListBody>> {
  if (!UUID.test(input.siteId)) return MISSING;
  const status = input.status || undefined;
  if (status !== undefined && !(LIST_STATUSES as readonly string[]).includes(status)) {
    return invalid("Unknown status.");
  }
  const sort = input.sort || "updated_at";
  if (!(POST_SORTS as readonly string[]).includes(sort)) return invalid("Unknown sort.");
  const term = input.term || undefined;
  if (term !== undefined && !UUID.test(term)) return invalid("Unknown category.");
  const q = input.q?.trim() || undefined;
  if (q !== undefined && q.length > MAX_QUERY) return invalid("Search for something shorter.");
  const cursor = input.cursor || undefined;
  if (cursor !== undefined && cursor.length > MAX_CURSOR) {
    return invalid("That page cursor isn’t valid.");
  }
  const out = await listEntries({
    actor: actor(input.userId),
    siteId: input.siteId,
    typeKey: POST_KEY,
    status: status as ListStatus | undefined,
    termId: term,
    q,
    sort: sort as PostSort,
    cursor,
    limit: POSTS_PAGE_SIZE,
  });
  if (!out.ok) return refused(out);
  return { status: 200, body: { kind: "ok", items: out.items, nextCursor: out.nextCursor } };
}

/**
 * POST posts {title?}: a new draft post. The database refuses the insert past the plan's posts
 * (HL010) whatever is sent; the answer then carries the plan's own sentence.
 */
export async function createPostCore(
  admin: Admin,
  input: { userId: string; siteId: string; title: unknown },
): Promise<Answer<{ kind: "ok"; id: string; rev: number }>> {
  const title = input.title ?? "";
  if (typeof title !== "string" || title.length > POST_LIMITS.title) {
    return invalid("Use a shorter title.");
  }
  if (!UUID.test(input.siteId)) return MISSING;
  const who = actor(input.userId);
  const made = await createEntryWithClient(admin, {
    actor: who,
    siteId: input.siteId,
    typeKey: POST_KEY,
    draft: { title, slug: "", body: "" },
  });
  if (made.ok) return { status: 201, body: { kind: "ok", id: made.id, rev: made.rev } };
  if (made.error !== "entry_limit") return refused(made);
  const plan = await planOf(admin, input.userId);
  const count = await countEntriesWithClient(admin, {
    actor: who,
    siteId: input.siteId,
    typeKey: POST_KEY,
  });
  return {
    status: made.status,
    body: {
      kind: "limit",
      message: postLimitMessage(plan, count.ok ? count.count : undefined),
    },
  };
}

export type { PostEntry };

/** GET entries/{entryId}: one post of the site with its draft (trashed posts included). Never the live copy. */
export async function getPostCore(input: {
  userId: string;
  siteId: string;
  entryId: string;
}): Promise<Answer<{ kind: "ok"; entry: PostEntry }>> {
  if (!UUID.test(input.siteId) || !UUID.test(input.entryId)) return MISSING;
  const out = await getEntry({ actor: actor(input.userId), entryId: input.entryId });
  if (!out.ok) return refused(out);
  if (out.siteId !== input.siteId || out.typeKey !== POST_KEY) return MISSING;
  return {
    status: 200,
    body: {
      kind: "ok",
      entry: {
        id: out.id,
        rev: out.rev,
        status: out.status,
        hasUnpublishedChanges: out.hasUnpublishedChanges,
        draft: out.draft,
        publishedAt: out.publishedAt,
        firstPublishedAt: out.firstPublishedAt,
        updatedAt: out.updatedAt,
        deletedAt: out.deletedAt,
      },
    },
  };
}

export const POST_ACTIONS = ["publish", "unpublish", "trash", "restore"] as const;
export type PostAction = (typeof POST_ACTIONS)[number];
export type PostActionBody = { kind: "ok"; rev: number; publishedAt?: string };

/**
 * POST entries/{entryId}/publish | unpublish | trash | restore {rev}: one post, at the rev the
 * editor holds. A stale rev answers `conflict` and changes nothing. Publish validates strictly and
 * makes only this post live; a failure lists `issues` by field, and a taken or reserved slug answers
 * `{kind: "slug"}`. Nothing here touches another post, a page or the design.
 */
export async function postActionCore(
  admin: Admin,
  action: PostAction,
  input: { userId: string; siteId: string; entryId: string; expectedRev: unknown },
): Promise<Answer<PostActionBody>> {
  const rev = input.expectedRev;
  if (typeof rev !== "number" || !Number.isSafeInteger(rev) || rev < 1) {
    return invalid("Send the revision you are editing.");
  }
  // Restore reads the trash; the others never act on a trashed post.
  const side = action === "restore" ? "yes" : "no";
  if (!(await isEntryOfSite(admin, input.siteId, input.entryId, POST, side))) return MISSING;
  const write = { actor: actor(input.userId), entryId: input.entryId, expectedRev: rev };
  if (action === "publish") {
    const out = await publishEntry(write);
    if (!out.ok) return refused(out);
    return { status: 200, body: { kind: "ok", rev: out.rev, publishedAt: out.publishedAt } };
  }
  const out =
    action === "unpublish"
      ? await unpublishEntry(write)
      : action === "trash"
        ? await trashEntry(write)
        : await restoreEntry(write);
  if (!out.ok) return refused(out);
  return { status: 200, body: { kind: "ok", rev: out.rev } };
}

// Terms ------------------------------------------------------------------------------------------

const TERM_TAKEN = "A category or tag with that slug already exists. Choose another name.";

const termOf = (term: TermSummary): TermSummary => ({
  id: term.id,
  typeId: term.typeId,
  taxonomy: term.taxonomy,
  name: term.name,
  slug: term.slug,
  parentId: term.parentId,
});

/** A term refusal: the unique index answers `slug_taken` with the entry's words, so they are replaced. */
function termRefused(failure: ContentFailure): PostsResponse<Refusal> {
  if (failure.error === "slug_taken") {
    return { status: failure.status, body: { kind: "slug", message: TERM_TAKEN } };
  }
  return refused(failure);
}

/** GET terms: the blog's categories, then its tags, by name. */
export async function listTermsCore(
  admin: Admin,
  input: { userId: string; siteId: string },
): Promise<Answer<{ kind: "ok"; terms: TermSummary[] }>> {
  if (!UUID.test(input.siteId)) return MISSING;
  const out = await listTermsWithClient(admin, {
    actor: actor(input.userId),
    siteId: input.siteId,
    typeKey: POST_KEY,
  });
  if (!out.ok) return refused(out);
  return { status: 200, body: { kind: "ok", terms: out.terms.map(termOf) } };
}

/** POST terms {taxonomy, name, slug?, parentId?}: a category (one level deep) or a tag. The 501st answers `limit` (HL015). */
export async function createTermCore(input: {
  userId: string;
  siteId: string;
  taxonomy: unknown;
  name: unknown;
  slug: unknown;
  parentId: unknown;
}): Promise<Answer<{ kind: "ok"; term: TermSummary }>> {
  if (input.taxonomy !== "category" && input.taxonomy !== "tag") {
    return invalid("Choose a category or a tag.");
  }
  if (typeof input.name !== "string" || input.name.trim() === "") {
    return invalid("Give it a name.");
  }
  if (input.slug !== undefined && typeof input.slug !== "string") {
    return invalid("Use lower-case letters, numbers and hyphens for the slug.");
  }
  if (
    input.parentId !== undefined &&
    input.parentId !== null &&
    typeof input.parentId !== "string"
  ) {
    return invalid("That parent category doesn’t exist.");
  }
  if (!UUID.test(input.siteId)) return MISSING;
  const name = input.name.trim();
  const out = await createTerm({
    actor: actor(input.userId),
    siteId: input.siteId,
    typeKey: POST_KEY,
    taxonomy: input.taxonomy,
    name,
    slug: input.slug ?? termSlug(name),
    ...(typeof input.parentId === "string" ? { parentId: input.parentId } : {}),
  });
  if (!out.ok) return termRefused(out);
  return { status: 201, body: { kind: "ok", term: termOf(out) } };
}

/** PATCH terms/{termId} {name?, slug?}. */
export async function renameTermCore(input: {
  userId: string;
  siteId: string;
  termId: string;
  name: unknown;
  slug: unknown;
}): Promise<Answer<{ kind: "ok"; term: TermSummary }>> {
  if (input.name === undefined && input.slug === undefined) return invalid("Nothing to change.");
  if (input.name !== undefined && (typeof input.name !== "string" || input.name.trim() === "")) {
    return invalid("Give it a name.");
  }
  if (input.slug !== undefined && typeof input.slug !== "string") {
    return invalid("Use lower-case letters, numbers and hyphens for the slug.");
  }
  if (!UUID.test(input.siteId) || !UUID.test(input.termId)) return MISSING;
  const out = await renameTerm({
    actor: actor(input.userId),
    siteId: input.siteId,
    termId: input.termId,
    ...(input.name === undefined ? {} : { name: (input.name as string).trim() }),
    ...(input.slug === undefined ? {} : { slug: input.slug as string }),
  });
  if (!out.ok) return termRefused(out);
  return { status: 200, body: { kind: "ok", term: termOf(out) } };
}

/** DELETE terms/{termId}: the posts stay; the term leaves the live pages at their next publish. */
export async function deleteTermCore(input: {
  userId: string;
  siteId: string;
  termId: string;
}): Promise<Answer<{ kind: "ok"; id: string }>> {
  if (!UUID.test(input.siteId) || !UUID.test(input.termId)) return MISSING;
  const out = await deleteTerm({
    actor: actor(input.userId),
    siteId: input.siteId,
    termId: input.termId,
  });
  if (!out.ok) return refused(out);
  return { status: 200, body: { kind: "ok", id: out.id } };
}
