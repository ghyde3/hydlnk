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
 * run against a test database). They write through the one writer; they do not expire the page tag.
 */
export { createEntryWithClient, updateEntryWithClient } from "./entries-core";
export { purgeEntryWithClient, restoreEntryWithClient, trashEntryWithClient } from "./trash-core";

import { invalidatePage } from "@/lib/publish/invalidate";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { createEntryWithClient, updateEntryWithClient } from "./entries-core";
import { getEntryWithClient, listEntriesWithClient } from "./query-core";
import { publishEntryWithClient, unpublishEntryWithClient } from "./publish-core";
import { restoreEntryWithClient, trashEntryWithClient } from "./trash-core";
import {
  createTermWithClient,
  deleteTermWithClient,
  renameTermWithClient,
  setEntryTermsWithClient,
} from "./terms-core";
import { listRevisionsWithClient, restoreRevisionWithClient } from "./revisions-core";
import { enableTypeWithClient, updateTypeWithClient } from "./types-core";
import type { ContentActor } from "./types";

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

/** Expire the site's cached public page. The write already stands, so a failure is only logged. */
function expireSite(siteId: string) {
  try {
    invalidatePage(siteId);
  } catch (error) {
    console.error("[content] expiring the site cache failed", error);
  }
}

type EntryWrite = { actor: ContentActor; entryId: string; expectedRev: number };

/** Publish an entry's draft at `expectedRev`, then expire the site's page tag. */
export async function publishEntry(input: EntryWrite) {
  const out = await publishEntryWithClient(createAdminSupabase(), input);
  if (out.ok) expireSite(out.siteId);
  return out;
}

/** Take an entry off the site at `expectedRev`, then expire the site's page tag. */
export async function unpublishEntry(input: EntryWrite) {
  const out = await unpublishEntryWithClient(createAdminSupabase(), input);
  if (out.ok) expireSite(out.siteId);
  return out;
}

/** Move an entry to the trash at `expectedRev`, then expire the site's page tag (the live copy is gone). */
export async function trashEntry(input: EntryWrite) {
  const out = await trashEntryWithClient(createAdminSupabase(), input);
  if (out.ok) expireSite(out.siteId);
  return out;
}

/** Restore a trashed entry (within 30 days) as a draft at `expectedRev`, then expire the site's page tag. */
export async function restoreEntry(input: EntryWrite) {
  const out = await restoreEntryWithClient(createAdminSupabase(), input);
  if (out.ok) expireSite(out.siteId);
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

/** Turn a built-in type on or off. */
export function enableType(input: Parameters<typeof enableTypeWithClient>[1]) {
  return enableTypeWithClient(createAdminSupabase(), input);
}

/** Change a type's labels or archive path. */
export function updateType(input: Parameters<typeof updateTypeWithClient>[1]) {
  return updateTypeWithClient(createAdminSupabase(), input);
}

/** Add a category (one level) or a tag to an enabled type. */
export function createTerm(input: Parameters<typeof createTermWithClient>[1]) {
  return createTermWithClient(createAdminSupabase(), input);
}

/** Change a term's name or slug. */
export function renameTerm(input: Parameters<typeof renameTermWithClient>[1]) {
  return renameTermWithClient(createAdminSupabase(), input);
}

/** Delete a term; its children become top-level and its entry links go. */
export function deleteTerm(input: Parameters<typeof deleteTermWithClient>[1]) {
  return deleteTermWithClient(createAdminSupabase(), input);
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
