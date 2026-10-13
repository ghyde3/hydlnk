import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { failure, mapDbError } from "./errors";
import { activeAccount, ownedEntry } from "./guards";
import type { ContentActor, ContentFailure, ContentResult } from "./types";

type Admin = SupabaseClient<Database>;
type Input = { actor: ContentActor; entryId: string; expectedRev: number };

/** A refused rpc: a stale rev (22023) re-reads the rev and answers conflict with it. */
async function refused(
  admin: Admin,
  entryId: string,
  err: { code?: string | null; message?: string | null },
): Promise<ContentFailure> {
  const mapped = mapDbError(err);
  if (mapped.error !== "conflict") return mapped;
  const reread = await admin.from("content_entries").select("rev").eq("id", entryId).maybeSingle();
  if (reread.error) return failure("error");
  if (!reread.data) return failure("not_found");
  return failure("conflict", undefined, Number(reread.data.rev));
}

/** Ownership (trashed rows included) and a live account, then a well-formed rev. */
async function prepare(admin: Admin, input: Input) {
  const owned = await ownedEntry(admin, input.actor.userId, input.entryId);
  if (!owned.ok) return owned;
  const account = await activeAccount(admin, input.actor.userId);
  if (!account.ok) return account;
  if (!Number.isSafeInteger(input.expectedRev) || input.expectedRev < 1) {
    return failure("invalid", "Send the revision you are editing.");
  }
  return { ok: true as const, entry: owned.entry };
}

/** Move the entry to the trash: the live copy goes at once, the draft stays for 30 days. */
export async function trashEntryWithClient(
  admin: Admin,
  input: Input,
): Promise<ContentResult<{ rev: number; siteId: string }>> {
  const ready = await prepare(admin, input);
  if (!ready.ok) return ready;
  const { entry } = ready;
  if (entry.deleted_at !== null) return failure("not_found");
  const { data, error } = await admin.rpc("trash_entry", {
    p_entry_id: entry.id,
    p_owner_id: input.actor.userId,
    p_expected_rev: input.expectedRev,
  });
  if (error) return refused(admin, entry.id, error);
  return { ok: true, rev: Number(data), siteId: entry.site_id };
}

/** Bring a trashed entry back as a draft, within 30 days. It does not republish. */
export async function restoreEntryWithClient(
  admin: Admin,
  input: Input,
): Promise<ContentResult<{ rev: number; siteId: string }>> {
  const ready = await prepare(admin, input);
  if (!ready.ok) return ready;
  const { entry } = ready;
  if (entry.deleted_at === null) return failure("not_found");
  const { data, error } = await admin.rpc("restore_entry", {
    p_entry_id: entry.id,
    p_owner_id: input.actor.userId,
    p_expected_rev: input.expectedRev,
  });
  if (error) return refused(admin, entry.id, error);
  return { ok: true, rev: Number(data), siteId: entry.site_id };
}

/**
 * Delete a trashed entry for good, at once instead of after 30 days. For the owner's own undo of
 * something just made (a failed template apply): only a trashed entry that was never published, so
 * nothing live or restorable is lost. The cascade removes its revisions and links. The claim on its
 * path was released when it was trashed.
 */
export async function purgeEntryWithClient(
  admin: Admin,
  input: { actor: ContentActor; entryId: string },
): Promise<ContentResult<{ siteId: string }>> {
  const owned = await ownedEntry(admin, input.actor.userId, input.entryId);
  if (!owned.ok) return owned;
  const account = await activeAccount(admin, input.actor.userId);
  if (!account.ok) return account;
  const { entry } = owned;
  // trash_entry clears `published`, so "never published" is first_published_at, which is never cleared.
  if (entry.deleted_at === null || entry.published !== null || entry.first_published_at !== null) {
    return failure("not_found");
  }
  const deleted = await admin
    .from("content_entries")
    .delete()
    .eq("id", entry.id)
    .eq("site_id", entry.site_id)
    .not("deleted_at", "is", null)
    .is("published", null)
    .is("first_published_at", null)
    .select("id");
  if (deleted.error) return mapDbError(deleted.error);
  if (deleted.data.length === 0) return failure("not_found");
  return { ok: true, siteId: entry.site_id };
}
