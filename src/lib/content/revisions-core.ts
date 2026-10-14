import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { updateEntryWithClient } from "./entries-core";
import { failure } from "./errors";
import { ownedEntry } from "./guards";
import type { ContentActor, ContentResult, ContentSource } from "./types";

type Admin = SupabaseClient<Database>;

export type RevisionSummary = {
  rev: number;
  wasPublished: boolean;
  source: ContentSource;
  createdAt: string;
};

/** An entry's revisions, newest first, without snapshots. Reads check ownership only. */
export async function listRevisionsWithClient(
  admin: Admin,
  input: { actor: ContentActor; entryId: string },
): Promise<ContentResult<{ revisions: RevisionSummary[] }>> {
  const owned = await ownedEntry(admin, input.actor.userId, input.entryId);
  if (!owned.ok) return owned;
  const found = await admin
    .from("content_entry_revisions")
    .select("rev, was_published, source, created_at")
    .eq("entry_id", owned.entry.id)
    .order("rev", { ascending: false });
  if (found.error) {
    console.error("[content] listing revisions failed", found.error.message);
    return failure("error");
  }
  return {
    ok: true,
    revisions: found.data.map((r) => ({
      rev: Number(r.rev),
      wasPublished: r.was_published,
      source: r.source as ContentSource,
      createdAt: r.created_at,
    })),
  };
}

/**
 * Save a revision's snapshot as the draft, at `expectedRev`. It goes through updateEntry, so the
 * lenient schema, the blocklist, the conditional update and revision-on-save all apply. It does
 * not publish.
 */
export async function restoreRevisionWithClient(
  admin: Admin,
  input: { actor: ContentActor; entryId: string; rev: number; expectedRev: number },
): Promise<ContentResult<{ rev: number; unchanged: boolean }>> {
  const owned = await ownedEntry(admin, input.actor.userId, input.entryId);
  if (!owned.ok) return owned;
  if (!Number.isSafeInteger(input.rev) || input.rev < 1) return failure("not_found");
  const found = await admin
    .from("content_entry_revisions")
    .select("snapshot")
    .eq("entry_id", owned.entry.id)
    .eq("rev", input.rev)
    .maybeSingle();
  if (found.error) {
    console.error("[content] reading the revision failed", found.error.message);
    return failure("error");
  }
  if (!found.data) return failure("not_found");
  return updateEntryWithClient(admin, {
    actor: input.actor,
    entryId: owned.entry.id,
    expectedRev: input.expectedRev,
    draft: found.data.snapshot,
  });
}
