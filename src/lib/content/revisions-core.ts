import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { canonical, updateEntryWithClient } from "./entries-core";
import { failure } from "./errors";
import { activeAccount, ownedEntry } from "./guards";
import type { RevisionSummary } from "./schemas/summaries";
import type { ContentActor, ContentFailure, ContentResult, ContentSource } from "./types";

type Admin = SupabaseClient<Database>;

export type { RevisionSummary };

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
 *
 * The draft it replaces is never lost (M15-10): a save records a revision only when the newest one
 * is older than `REVISION_MIN_AGE`, so the current draft may exist nowhere else. Before the update,
 * the current draft is recorded as a revision at its own rev (`record_entry_revision` with no age
 * rule). The order makes it safe to stop anywhere: the revision first, and the draft is replaced
 * only once it exists; a restore refused afterwards (a conflict, an invalid snapshot) leaves one
 * more revision and the draft as it was. Recording can prune the entry's oldest revisions to the
 * plan's `revisions_kept`, the restored one included: its snapshot was read first and is applied
 * all the same. A restore that would change nothing, or is checked against a stale rev, records
 * nothing.
 */
export async function restoreRevisionWithClient(
  admin: Admin,
  input: {
    actor: ContentActor;
    entryId: string;
    rev: number;
    expectedRev: number;
    /**
     * Run on the snapshot before anything is written (a tool save runs Publish's body checks,
     * `checkPostBody`, on what it would store). A failure it answers is the answer, and nothing
     * is written.
     */
    check?: (snapshot: unknown) => Promise<ContentFailure | null>;
  },
): Promise<ContentResult<{ rev: number; unchanged: boolean }>> {
  const owned = await ownedEntry(admin, input.actor.userId, input.entryId);
  if (!owned.ok) return owned;
  const { entry } = owned;
  if (!Number.isSafeInteger(input.rev) || input.rev < 1) return failure("not_found");
  const found = await admin
    .from("content_entry_revisions")
    .select("snapshot")
    .eq("entry_id", entry.id)
    .eq("rev", input.rev)
    .maybeSingle();
  if (found.error) {
    console.error("[content] reading the revision failed", found.error.message);
    return failure("error");
  }
  if (!found.data) return failure("not_found");
  const snapshot = found.data.snapshot;
  if (input.check) {
    const refused = await input.check(snapshot);
    if (refused) return refused;
  }

  let expectedRev = input.expectedRev;
  const replaces =
    entry.deleted_at === null &&
    Number(entry.rev) === expectedRev &&
    canonical(entry.draft) !== canonical(snapshot);
  if (replaces) {
    // A suspended account writes nothing, a revision included.
    const account = await activeAccount(admin, input.actor.userId);
    if (!account.ok) return account;
    const kept = await keepCurrentDraft(admin, entry, input.actor.source);
    if (!kept.ok) return kept;
    expectedRev = kept.rev;
  }
  return updateEntryWithClient(admin, {
    actor: input.actor,
    entryId: entry.id,
    expectedRev,
    draft: snapshot,
  });
}

/**
 * Makes sure a revision holds the entry's current draft, and answers the rev the entry is at then.
 * Normally that is one `record_entry_revision` at the entry's rev (or nothing: the revision at that
 * rev already is this draft). A draft that differs from the revision at its own rev (a page the
 * content move rewrote: its first revision kept the draft before the rewrite) has no rev of its own
 * to be recorded at, so the entry moves one rev on first, with the same draft, as Publish does.
 * Any failure answers `error` and nothing is restored.
 */
async function keepCurrentDraft(
  admin: Admin,
  entry: { id: string; site_id: string; rev: number | string; draft: unknown },
  source: ContentSource,
): Promise<{ ok: true; rev: number } | ReturnType<typeof failure>> {
  const rev = Number(entry.rev);
  const record = () =>
    admin.rpc("record_entry_revision", { p_entry_id: entry.id, p_source: source });
  const recorded = await record();
  if (recorded.error) {
    console.error("[content] recording the draft before a restore failed", recorded.error.message);
    return failure("error");
  }
  if (recorded.data === true) return { ok: true, rev };

  // A revision at this rev was there already. It is this draft, unless the move rewrote the page.
  const existing = await admin
    .from("content_entry_revisions")
    .select("snapshot")
    .eq("entry_id", entry.id)
    .eq("rev", rev)
    .maybeSingle();
  if (existing.error || !existing.data) {
    console.error(
      "[content] reading the revision at the draft's rev failed",
      existing.error?.message,
    );
    return failure("error");
  }
  if (canonical(existing.data.snapshot) === canonical(entry.draft)) return { ok: true, rev };

  const moved = await admin
    .from("content_entries")
    .update({ rev: rev + 1 })
    .eq("id", entry.id)
    .eq("site_id", entry.site_id)
    .eq("rev", rev)
    .select("rev");
  if (moved.error) {
    console.error("[content] moving the entry's rev before a restore failed", moved.error.message);
    return failure("error");
  }
  // Another writer came first: the update below answers the conflict, with the current rev.
  if (moved.data.length === 0) return { ok: true, rev };
  const again = await record();
  if (again.error || again.data !== true) {
    console.error("[content] recording the draft before a restore failed", again.error?.message);
    return failure("error");
  }
  return { ok: true, rev: rev + 1 };
}
