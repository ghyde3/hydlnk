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

import { invalidatePage } from "@/lib/publish/invalidate";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { createEntryWithClient, updateEntryWithClient } from "./entries-core";
import { publishEntryWithClient, unpublishEntryWithClient } from "./publish-core";
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
