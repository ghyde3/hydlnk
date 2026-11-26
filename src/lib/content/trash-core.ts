import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { failure, mapDbError } from "./errors";
import { needForEntryWrite, recordSiteActivity, type EntryWriteOp } from "@/lib/access";
import { entryFor, siteType } from "./guards";
import type { EntryPlace } from "./publish-core";
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

/**
 * Access to the entry (trashed rows included) for `op`: trashing a live entry is publish-class,
 * restoring into the drafts is an edit (needForEntryWrite). Then a well-formed rev.
 */
async function prepare(admin: Admin, input: Input, op: EntryWriteOp) {
  const owned = await entryFor(admin, input.actor, input.entryId, (e) => needForEntryWrite(e, op));
  if (!owned.ok) return owned;
  if (!Number.isSafeInteger(input.expectedRev) || input.expectedRev < 1) {
    return failure("invalid", "Send the revision you are editing.");
  }
  // The type is read on or off: trash and restore always work, and the caller expires by type.
  const type = await siteType(admin, owned.entry.site_id, owned.entry.type_id);
  if (!type.ok) return type;
  const place: EntryPlace = {
    siteId: owned.entry.site_id,
    typeId: type.type.id,
    typeKey: type.type.key,
  };
  return { ok: true as const, entry: owned.entry, access: owned.access, place };
}

/** Move the entry to the trash: the live copy goes at once, the draft stays for 30 days. */
export async function trashEntryWithClient(
  admin: Admin,
  input: Input,
): Promise<ContentResult<{ rev: number } & EntryPlace>> {
  const ready = await prepare(admin, input, "trash");
  if (!ready.ok) return ready;
  const { entry } = ready;
  if (entry.deleted_at !== null) return failure("not_found");
  const { data, error } = await admin.rpc("trash_entry", {
    p_entry_id: entry.id,
    p_owner_id: ready.access.ownerId,
    p_expected_rev: input.expectedRev,
  });
  if (error) return refused(admin, entry.id, error);
  await recordSiteActivity(admin, ready.access, "entry_trashed", entry.id);
  return { ok: true, rev: Number(data), ...ready.place };
}

/** Bring a trashed entry back as a draft, within 30 days. It does not republish. */
export async function restoreEntryWithClient(
  admin: Admin,
  input: Input,
): Promise<ContentResult<{ rev: number } & EntryPlace>> {
  const ready = await prepare(admin, input, "restore");
  if (!ready.ok) return ready;
  const { entry } = ready;
  if (entry.deleted_at === null) return failure("not_found");
  const { data, error } = await admin.rpc("restore_entry", {
    p_entry_id: entry.id,
    p_owner_id: ready.access.ownerId,
    p_expected_rev: input.expectedRev,
  });
  if (error) return refused(admin, entry.id, error);
  await recordSiteActivity(admin, ready.access, "entry_restored", entry.id);
  return { ok: true, rev: Number(data), ...ready.place };
}

/**
 * Delete a trashed entry for good, at once instead of after 30 days. By default only a trashed entry
 * that was never published, so nothing live or restorable is lost. `includePublished` lifts that for
 * an editor sub-page delete (the entry is trashed first, so its live copy is already gone). The cascade removes its revisions and links. The claim on its
 * path was released when it was trashed.
 */
export async function purgeEntryWithClient(
  admin: Admin,
  input: { actor: ContentActor; entryId: string; includePublished?: boolean },
): Promise<ContentResult<{ siteId: string }>> {
  // Deleting for good is publish-class (G17).
  const owned = await entryFor(admin, input.actor, input.entryId, (e) => needForEntryWrite(e, "purge"));
  if (!owned.ok) return owned;
  const { entry } = owned;
  // trash_entry clears `published`, so "never published" is first_published_at, which is never cleared.
  const anyHistory = input.includePublished === true;
  if (
    entry.deleted_at === null ||
    entry.published !== null ||
    (!anyHistory && entry.first_published_at !== null)
  ) {
    return failure("not_found");
  }
  let query = admin
    .from("content_entries")
    .delete()
    .eq("id", entry.id)
    .eq("site_id", entry.site_id)
    .not("deleted_at", "is", null)
    .is("published", null);
  if (!anyHistory) query = query.is("first_published_at", null);
  const deleted = await query.select("id");
  if (deleted.error) return mapDbError(deleted.error);
  if (deleted.data.length === 0) return failure("not_found");
  await recordSiteActivity(admin, owned.access, "entry_purged", null);
  return { ok: true, siteId: entry.site_id };
}
