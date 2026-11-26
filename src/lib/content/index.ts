import "server-only";

/**
 * The content writer (M15-03): the only code that writes content_* and calls the entry functions.
 * Callers pass a ContentActor; every operation checks ownership, suspension and that the type is
 * enabled. Operations arrive in later tasks; for now this exports types.
 */
export type {
  ContentActor,
  ContentErrorCode,
  ContentFailure,
  ContentResult,
  ContentSource,
} from "./types";

/**
 * The same operations for callers that hold their own client (a route's tool core, a version restore
 * run against a test database). They write through the one writer; they do not expire any cache tag.
 */
export { createEntryWithClient, updateEntryWithClient } from "./entries-core";
export { purgeEntryWithClient, restoreEntryWithClient, trashEntryWithClient } from "./trash-core";
export { listRevisionsWithClient, restoreRevisionWithClient } from "./revisions-core";
export type { RevisionSummary } from "./revisions-core";
/** Publish page (M15-10): the one call of `publish_site_page`, for the Publish gate. */
export { publishSitePageWithClient } from "./site-page-publish-core";
export type { SitePagePublishWrite } from "./site-page-publish-core";

import { invalidateEntry, invalidatePage, invalidateType } from "@/lib/publish/invalidate";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { createEntryWithClient, updateEntryWithClient } from "./entries-core";
import { countEntriesWithClient, getEntryWithClient, listEntriesWithClient } from "./query-core";
import { unsafeBodySchemes } from "./blocklist";
import { bodyImageIssue, bodyImages, checkOwnImages } from "./images";
import { publishEntryWithClient, unpublishEntryWithClient } from "./publish-core";
import type { EntryPlace } from "./publish-core";
import { restoreEntryWithClient, trashEntryWithClient } from "./trash-core";
import {
  createTermWithClient,
  deleteTermWithClient,
  listTermsWithClient,
  renameTermWithClient,
  setEntryTermsWithClient,
} from "./terms-core";
import { listRevisionsWithClient, restoreRevisionWithClient } from "./revisions-core";
import { enableTypeWithClient, listTypesWithClient, updateTypeWithClient } from "./types-core";
import type { ContentActor, ContentFailure } from "./types";

/**
 * What Publish checks on a post body, for a caller that wants it at save (the MCP tools, M18-05):
 * only http, https, mailto and tel addresses, every image an upload, at most `BODY_IMAGES_MAX` of
 * them, each in the actor's own folder and present in Storage. Reads only; it stores nothing. The
 * editor's lenient draft save does not call it, and Publish runs every check again.
 */
export async function checkPostBody(input: {
  actor: ContentActor;
  draft: unknown;
}): Promise<ContentFailure | null> {
  const unsafe = unsafeBodySchemes(input.draft);
  if (unsafe) return unsafe;
  const foreign = bodyImageIssue(input.draft);
  if (foreign) return foreign;
  const body = (input.draft as { body?: unknown } | null)?.body;
  const uses = typeof body === "string" ? bodyImages(body) : [];
  if (uses.length === 0) return null;
  return checkOwnImages(createAdminSupabase(), input.actor.userId, uses);
}

/** Create an entry of an enabled type. The draft is validated leniently and stored as given. */
export function createEntry(input: {
  actor: ContentActor;
  siteId: string;
  typeKey: string;
  draft: unknown;
}) {
  return createEntryWithClient(createAdminSupabase(), input);
}

/** Save an entry's draft at `expectedRev`. A stale rev returns `conflict` with `currentRev`. */
export function updateEntry(input: {
  actor: ContentActor;
  entryId: string;
  expectedRev: number;
  draft: unknown;
}) {
  return updateEntryWithClient(createAdminSupabase(), input);
}

type EntryWrite = { actor: ContentActor; entryId: string; expectedRev: number };

/**
 * Expire what the cache holds for a written entry (M16-09). A page entry expires the site tag, as
 * before; an entry of any other type expires its own tag and its type's, and leaves the site alone.
 * The write already stands, so a failure is only logged.
 */
function expireEntry(entryId: string, place: EntryPlace) {
  try {
    if (place.typeKey === "page") invalidatePage(place.siteId);
    else invalidateEntry({ ...place, entryId });
  } catch (error) {
    console.error("[content] expiring the entry cache failed", error);
  }
}

/** Expire a type that was switched on or off, renamed or moved (its archive, lists and the site's menu). */
function expireType(siteId: string, typeId: string) {
  try {
    invalidateType({ siteId, typeId });
  } catch (error) {
    console.error("[content] expiring the type cache failed", error);
  }
}

const placeOf = ({ siteId, typeId, typeKey }: EntryPlace): EntryPlace => ({
  siteId,
  typeId,
  typeKey,
});

/** Publish an entry's draft at `expectedRev`, then expire its cache tags. */
export async function publishEntry(input: EntryWrite) {
  const out = await publishEntryWithClient(createAdminSupabase(), input);
  if (out.ok) expireEntry(input.entryId, placeOf(out));
  return out;
}

/** Take an entry off the site at `expectedRev`, then expire its cache tags. */
export async function unpublishEntry(input: EntryWrite) {
  const out = await unpublishEntryWithClient(createAdminSupabase(), input);
  if (out.ok) expireEntry(input.entryId, placeOf(out));
  return out;
}

/** Move an entry to the trash at `expectedRev`, then expire its cache tags (the live copy is gone). */
export async function trashEntry(input: EntryWrite) {
  const out = await trashEntryWithClient(createAdminSupabase(), input);
  if (out.ok) expireEntry(input.entryId, placeOf(out));
  return out;
}

/** Restore a trashed entry (within 30 days) as a draft at `expectedRev`, then expire its cache tags. */
export async function restoreEntry(input: EntryWrite) {
  const out = await restoreEntryWithClient(createAdminSupabase(), input);
  if (out.ok) expireEntry(input.entryId, placeOf(out));
  return out;
}

/** One entry with its draft, published copy, rev, status and dates. Reads check ownership only. */
export function getEntry(input: { actor: ContentActor; entryId: string }) {
  return getEntryWithClient(createAdminSupabase(), input);
}

/** Page through a site's entries of one type (filters, sort, keyset cursor, at most 100 a page). */
export function listEntries(input: Parameters<typeof listEntriesWithClient>[1]) {
  return listEntriesWithClient(createAdminSupabase(), input);
}

/** Turn a built-in type on or off, then expire the type and the site (its archive appears or goes). */
export async function enableType(input: Parameters<typeof enableTypeWithClient>[1]) {
  const out = await enableTypeWithClient(createAdminSupabase(), input);
  if (out.ok) expireType(input.siteId, out.typeId);
  return out;
}

/** Change a type's labels or archive path, then expire the type and the site. */
export async function updateType(input: Parameters<typeof updateTypeWithClient>[1]) {
  const out = await updateTypeWithClient(createAdminSupabase(), input);
  if (out.ok) expireType(input.siteId, out.typeId);
  return out;
}

/** Add a category (one level) or a tag to an enabled type. */
export function createTerm(input: Parameters<typeof createTermWithClient>[1]) {
  return createTermWithClient(createAdminSupabase(), input);
}

/**
 * Change a term's name or slug, then expire its type and the site: the name and slug are drawn into
 * the term index and the archive pages (the type tag) and into every post page (the site tag).
 */
export async function renameTerm(input: Parameters<typeof renameTermWithClient>[1]) {
  const out = await renameTermWithClient(createAdminSupabase(), input);
  if (out.ok) expireType(input.siteId, out.typeId);
  return out;
}

/** Delete a term; its children become top-level and its entry links go. Expires like a rename. */
export async function deleteTerm(input: Parameters<typeof deleteTermWithClient>[1]) {
  const out = await deleteTermWithClient(createAdminSupabase(), input);
  if (out.ok) expireType(input.siteId, out.typeId);
  return out;
}

/** Set an entry's categories and tags in its draft at `expectedRev`; publish rebuilds the links. */
export function setEntryTerms(input: Parameters<typeof setEntryTermsWithClient>[1]) {
  return setEntryTermsWithClient(createAdminSupabase(), input);
}

/** An entry's revisions, newest first, without snapshots. */
export function listRevisions(input: Parameters<typeof listRevisionsWithClient>[1]) {
  return listRevisionsWithClient(createAdminSupabase(), input);
}

/** Save a revision's snapshot as the draft at `expectedRev`; it does not publish. */
export function restoreRevision(input: Parameters<typeof restoreRevisionWithClient>[1]) {
  return restoreRevisionWithClient(createAdminSupabase(), input);
}

/** Every type of a site, on or off, the page type first. */
export function listTypes(input: Parameters<typeof listTypesWithClient>[1]) {
  return listTypesWithClient(createAdminSupabase(), input);
}

/** The terms of one type of a site: categories, then tags, by name. */
export function listTerms(input: Parameters<typeof listTermsWithClient>[1]) {
  return listTermsWithClient(createAdminSupabase(), input);
}

/** How many entries of one type a site holds, drafts and the trash included (as HL010 counts). */
export function countEntries(input: Parameters<typeof countEntriesWithClient>[1]) {
  return countEntriesWithClient(createAdminSupabase(), input);
}

/** The Wave B reads for callers that hold their own client (the Posts routes' cores). */
export { countEntriesWithClient, listTermsWithClient, listTypesWithClient };
export type { EntrySummary } from "./query-core";
export type { EntryPlace } from "./publish-core";
export { BODY_IMAGES_MAX } from "./images";
// The ownership check itself, for an app route that reads published data with the secret key.
export { ownedSite } from "./guards";
export type { TermSummary } from "./terms-core";
export type { TypeSummary } from "./types-core";
