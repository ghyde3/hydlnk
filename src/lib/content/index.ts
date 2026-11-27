import "server-only";

/**
 * The content writer (M15-03): the only code that writes content_* and calls the entry functions.
 * Callers pass a ContentActor; every operation checks access through the one helper (src/lib/access:
 * the owner or a member with the need, the owner not suspended) and that the type is enabled. Operations arrive in later tasks; for now this exports types.
 */
export type {
  ContentActor,
  ContentErrorCode,
  ContentFailure,
  ContentResult,
  ContentSource,
  PublishRun,
} from "./types";

/**
 * The same operations for callers that hold their own client (a route's tool core, a version restore
 * run against a test database). They write through the one writer; they do not expire any cache tag.
 */
export { createEntryWithClient, updateEntryWithClient } from "./entries-core";
export { purgeEntryWithClient, restoreEntryWithClient, trashEntryWithClient } from "./trash-core";
export { listRevisionsWithClient, restoreRevisionWithClient } from "./revisions-core";
export type { RevisionSummary } from "./revisions-core";
/** Scheduling (Wave E), for callers that hold their own client (the worker, tests). */
export {
  cancelScheduleWithClient,
  listSchedulesWithClient,
  scheduleEntryWithClient,
} from "./schedule-core";
export type { ScheduleFailure, ScheduleResult } from "./schedule-core";
export { publishEntryWithClient, unpublishEntryWithClient } from "./publish-core";
/** Publish page (M15-10): the one call of `publish_site_page`, for the Publish gate. */
export { publishSitePageWithClient } from "./site-page-publish-core";
export type { SitePagePublishWrite } from "./site-page-publish-core";

import { invalidateEntry, invalidatePage, invalidateType } from "@/lib/publish/invalidate";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { createEntryWithClient, updateEntryWithClient } from "./entries-core";
import { countEntriesWithClient, getEntryWithClient, listEntriesWithClient } from "./query-core";
import { unsafeBodySchemes } from "./blocklist";
import { bodyShapeIssue } from "./body-shape";
import { failure } from "./errors";
import { siteFor } from "./guards";
import { POST_BODY_TOO_LARGE, postBodyTooLarge } from "./schemas";
import { bodyImageIssue, bodyImages, checkOwnImages, postImages } from "./images";
import { publishEntryWithClient, unpublishEntryWithClient } from "./publish-core";
import type { EntryPlace } from "./publish-core";
import { restoreEntryWithClient, trashEntryWithClient } from "./trash-core";
import {
  cancelScheduleWithClient,
  listSchedulesWithClient,
  scheduleEntryWithClient,
  siteScheduleSummariesWithClient,
} from "./schedule-core";
import {
  createTermWithClient,
  deleteTermWithClient,
  listTermsWithClient,
  renameTermWithClient,
  setEntryTermsWithClient,
} from "./terms-core";
import { listRevisionsWithClient, restoreRevisionWithClient } from "./revisions-core";
import { enableTypeWithClient, listTypesWithClient, updateTypeWithClient } from "./types-core";
import type { ContentActor, ContentFailure, ContentResult } from "./types";
import type { TypeSummary as TypeSummaryOf } from "./types-core";

/**
 * What Publish checks on a post body, for a caller that wants it at save (the MCP tools, M18-05):
 * a body the bounded lexer reads (`bodyShapeIssue`), only http, https, mailto and tel addresses,
 * every image an upload, at most `BODY_IMAGES_MAX` of them, each in the site owner's folder and
 * present in Storage. Reads only; it stores nothing. The
 * editor's lenient draft save does not call it, and Publish runs every check again.
 */
export async function checkPostBody(input: {
  actor: ContentActor;
  /** The entry's site: its OWNER's folder is the one the images must be in (the access helper's). */
  siteId: string;
  draft: unknown;
}): Promise<ContentFailure | null> {
  // The size first: nothing over the limit is ever lexed (three scans of a huge body otherwise).
  const raw = (input.draft as { body?: unknown } | null)?.body;
  if (typeof raw === "string" && postBodyTooLarge(raw)) {
    return {
      ...failure("invalid", POST_BODY_TOO_LARGE),
      issues: [{ path: "body", message: POST_BODY_TOO_LARGE }],
    };
  }
  // A body the bounded lexer refuses is refused here, before the readers below would skip it.
  const shape = bodyShapeIssue(input.draft);
  if (shape) return shape;
  const unsafe = unsafeBodySchemes(input.draft);
  if (unsafe) return unsafe;
  const foreign = bodyImageIssue(input.draft);
  if (foreign) return foreign;
  const body = (input.draft as { body?: unknown } | null)?.body;
  const uses = typeof body === "string" ? bodyImages(body) : [];
  if (uses.length === 0) return null;
  const admin = createAdminSupabase();
  // The site owner's folder, never the actor's (a member writes into the owner's site; Wave F).
  const site = await siteFor(admin, input.actor, input.siteId, "read");
  if (!site.ok) return site;
  return checkOwnImages(admin, site.access.ownerId, uses);
}

/**
 * What Publish would refuse in a post draft that needs no read (`get_entry`'s `publishIssues`,
 * M18-04), as `{path, message}` rows: a body over the limit or one the bounded lexer refuses, a link or image with a scheme that is
 * not allowed, a body image that is not an upload or one image too many, and an image (body,
 * featured or share) outside the owner's own folder. Not here, because each needs a read that only
 * Publish makes: the link blocklist, whether each file still exists in Storage, and a live slug
 * another post uses. Pure; it stores and reads nothing.
 */
export function postDraftIssues(input: {
  /** The entry's site owner (`access.ownerId` of the access helper): the folder images must be in. */
  ownerId: string;
  draft: unknown;
}): Array<{ path: string; message: string }> {
  const raw = (input.draft as { body?: unknown } | null)?.body;
  if (typeof raw === "string" && postBodyTooLarge(raw)) {
    return [{ path: "body", message: POST_BODY_TOO_LARGE }];
  }
  const shape = bodyShapeIssue(input.draft);
  const issues: Array<{ path: string; message: string }> = [...(shape?.issues ?? [])];
  issues.push(...(unsafeBodySchemes(input.draft)?.issues ?? []));
  issues.push(...(bodyImageIssue(input.draft)?.issues ?? []));
  for (const use of postImages(input.draft)) {
    if (!use.path.startsWith(`${input.ownerId}/`)) {
      issues.push({
        path: use.field,
        message: "That image isn’t in your uploads. Upload it again.",
      });
    }
  }
  return issues;
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
 * The write already stands: a failure is tried once more at once, then logged, and the answer is
 * false so the caller can say the live copy may take a moment (`cacheStale`) and offer a retry.
 */
export function expireEntry(entryId: string, place: EntryPlace): boolean {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      if (place.typeKey === "page") invalidatePage(place.siteId);
      else invalidateEntry({ ...place, entryId });
      return true;
    } catch (error) {
      console.error(`[content] expiring the entry cache failed (attempt ${attempt})`, error);
    }
  }
  return false;
}

/** A write's answer, flagged when its cache expiry failed twice (the live copy may lag a moment). */
function expired<T extends { ok: true } & EntryPlace>(entryId: string, out: T) {
  return expireEntry(entryId, placeOf(out)) ? out : { ...out, cacheStale: true as const };
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
  return out.ok ? expired(input.entryId, out) : out;
}

/** Take an entry off the site at `expectedRev`, then expire its cache tags. */
export async function unpublishEntry(input: EntryWrite) {
  const out = await unpublishEntryWithClient(createAdminSupabase(), input);
  return out.ok ? expired(input.entryId, out) : out;
}

/** Move an entry to the trash at `expectedRev`, then expire its cache tags (the live copy is gone). */
export async function trashEntry(input: EntryWrite) {
  const out = await trashEntryWithClient(createAdminSupabase(), input);
  return out.ok ? expired(input.entryId, out) : out;
}

/** Restore a trashed entry (within 30 days) as a draft at `expectedRev`, then expire its cache tags. */
export async function restoreEntry(input: EntryWrite) {
  const out = await restoreEntryWithClient(createAdminSupabase(), input);
  return out.ok ? expired(input.entryId, out) : out;
}

/**
 * Schedule a publish (the draft at `expectedRev`, checked now as Publish would) or an unpublish
 * (Wave E). Nothing live changes, so nothing expires.
 */
export function scheduleEntry(
  input: Parameters<typeof scheduleEntryWithClient>[1],
  deps?: Parameters<typeof scheduleEntryWithClient>[2],
) {
  return scheduleEntryWithClient(createAdminSupabase(), input, deps);
}

/** Cancel an entry's pending scheduled publish or unpublish at `expectedRev`. */
export function cancelSchedule(input: Parameters<typeof cancelScheduleWithClient>[1]) {
  return cancelScheduleWithClient(createAdminSupabase(), input);
}

/** The site's entries that have a pending or a failed schedule, with their summaries (the publish bar). */
export function listSiteSchedules(input: Parameters<typeof siteScheduleSummariesWithClient>[1]) {
  return siteScheduleSummariesWithClient(createAdminSupabase(), input);
}

/** An entry's pending schedules and the newest finished one of each action. */
export function listSchedules(input: Parameters<typeof listSchedulesWithClient>[1]) {
  return listSchedulesWithClient(createAdminSupabase(), input);
}

/**
 * Expire an entry's cache again (the retry the editor offers after `cacheStale`). Checks the owner
 * like a read; true once the expiry went through.
 */
export async function expireEntryAgain(input: { actor: ContentActor; entryId: string }) {
  const found = await getEntryWithClient(createAdminSupabase(), input);
  if (!found.ok) return found;
  return { ok: true as const, expired: expireEntry(input.entryId, placeOf(found)) };
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

/**
 * A type's address or names and its switch in one call, all or nothing (M16-02, M18-10). The
 * settings go first, while the switch is as it was: an address a page uses is refused there, and
 * "turn on at /news" claims `/news`, never the old address. The switch goes second; when it is
 * refused (turning on claims the new address, and a page may use it), every setting this call
 * changed is put back while the type is still as it was, and the switch's refusal is the answer.
 * Putting them back can fail too (the account or the site changed between the writes): that
 * refusal carries `settingsStand: true`. The one implementation for the Posts route and the
 * `update_content_type` tool.
 */
export async function updateTypeAndSwitch(input: {
  actor: ContentActor;
  siteId: string;
  typeKey: string;
  settings: { archivePath?: string; label?: string; labelPlural?: string };
  enabled: boolean;
}): Promise<ContentResult<TypeSummaryOf> & { settingsStand?: true }> {
  const { actor, siteId, typeKey, settings } = input;
  const listed = await listTypes({ actor, siteId });
  if (!listed.ok) return listed;
  const before = listed.types.find((type) => type.key === typeKey);
  if (!before) return failure("not_found");

  const updated = await updateType({ actor, siteId, typeKey, ...settings });
  if (!updated.ok) return updated;
  const switched = await enableType({ actor, siteId, typeKey, enabled: input.enabled });
  if (switched.ok) return switched;

  const undo = {
    ...(settings.archivePath !== undefined &&
    before.archivePath !== null &&
    updated.archivePath !== before.archivePath
      ? { archivePath: before.archivePath }
      : {}),
    ...(settings.label !== undefined && updated.label !== before.label
      ? { label: before.label }
      : {}),
    ...(settings.labelPlural !== undefined && updated.labelPlural !== before.labelPlural
      ? { labelPlural: before.labelPlural }
      : {}),
  };
  if (Object.keys(undo).length === 0) return switched;
  const back = await updateType({ actor, siteId, typeKey, ...undo });
  if (back.ok) return switched;
  console.error("[content] putting the type's settings back failed", back.error);
  return { ...switched, settingsStand: true };
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
// The access check itself (Wave F: the one helper), for an app route that reads published data with
// the secret key.
export { siteFor } from "./guards";
export type { TermSummary } from "./terms-core";
export type { TypeSummary } from "./types-core";
