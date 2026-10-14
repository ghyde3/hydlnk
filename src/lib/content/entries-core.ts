import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";
import { blockedBodyLinks } from "./blocklist";
import { failure, mapDbError } from "./errors";
import { pruneTerms } from "./prune-terms";
import { activeAccount, enabledType, ownedEntry, ownedSite } from "./guards";
import {
  MAX_DRAFT_BYTES,
  draftBytes,
  issuesOf,
  schemaForType,
  untrimmedPathIssue,
} from "./schemas";
import type { ContentActor, ContentFailure, ContentResult } from "./types";

type Admin = SupabaseClient<Database>;

/** A revision is recorded on a save only when the newest is older than this. */
export const REVISION_MIN_AGE = "10 minutes";

/** The draft against the type's lenient schema and the link blocklist. Stores nothing. */
async function checkDraft(
  admin: Admin,
  typeKey: string,
  draft: unknown,
): Promise<ContentFailure | null> {
  const schema = schemaForType(typeKey, "draft");
  if (!schema) return failure("invalid", "That content type can’t be edited yet.");
  const parsed = schema.safeParse(draft);
  if (!parsed.success) {
    return { ...failure("invalid"), issues: issuesOf(parsed.error) };
  }
  const spaced = untrimmedPathIssue(typeKey, draft);
  if (spaced) return { ...failure("invalid"), issues: [spaced] };
  if (draftBytes(draft) > MAX_DRAFT_BYTES) return failure("too_large");
  if (typeKey === "post") return blockedBodyLinks(admin, draft);
  return null;
}

/** Key-order-insensitive JSON equality (the database returns jsonb keys in its own order). */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : 1));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export async function createEntryWithClient(
  admin: Admin,
  input: {
    actor: ContentActor;
    siteId: string;
    typeKey: string;
    draft: unknown;
    /** Make the entry under this id (a page brought back by a version restore keeps its old id). */
    id?: string;
  },
): Promise<ContentResult<{ id: string; rev: number; updatedAt: string }>> {
  const { actor } = input;
  const account = await activeAccount(admin, actor.userId);
  if (!account.ok) return account;
  const site = await ownedSite(admin, actor.userId, input.siteId);
  if (!site.ok) return site;
  const type = await enabledType(admin, site.site.id, input.typeKey);
  if (!type.ok) return type;
  const refused = await checkDraft(admin, type.type.key, input.draft);
  if (refused) return refused;

  const inserted = await admin
    .from("content_entries")
    .insert({
      ...(input.id === undefined ? {} : { id: input.id }),
      site_id: site.site.id,
      type_id: type.type.id,
      draft: input.draft as Json,
    })
    .select("id, rev, updated_at")
    .single();
  if (inserted.error) return mapDbError(inserted.error);
  return {
    ok: true,
    id: inserted.data.id,
    rev: Number(inserted.data.rev),
    updatedAt: inserted.data.updated_at,
  };
}

export async function updateEntryWithClient(
  admin: Admin,
  input: { actor: ContentActor; entryId: string; expectedRev: number; draft: unknown },
): Promise<ContentResult<{ rev: number; unchanged: boolean }>> {
  const { actor, expectedRev } = input;
  const owned = await ownedEntry(admin, actor.userId, input.entryId);
  if (!owned.ok) return owned;
  const account = await activeAccount(admin, actor.userId);
  if (!account.ok) return account;
  const { entry } = owned;
  if (entry.deleted_at !== null) return failure("not_found");
  if (!Number.isSafeInteger(expectedRev) || expectedRev < 1) {
    return failure("invalid", "Send the revision you are editing.");
  }
  const type = await enabledType(admin, entry.site_id, entry.type_id);
  if (!type.ok) return type;
  const refused = await checkDraft(admin, type.type.key, input.draft);
  if (refused) return refused;
  // A term deleted since the last save is dropped from the draft here.
  let draft = input.draft;
  if (type.type.key === "post") {
    const pruned = await pruneTerms(admin, { siteId: entry.site_id, typeId: entry.type_id }, draft);
    if (!pruned.ok) return pruned;
    draft = pruned.draft;
  }

  const currentRev = Number(entry.rev);
  if (currentRev !== expectedRev) return failure("conflict", undefined, currentRev);
  if (canonical(entry.draft) === canonical(draft)) {
    return { ok: true, rev: currentRev, unchanged: true };
  }

  const updated = await admin
    .from("content_entries")
    .update({ draft: draft as Json, rev: expectedRev + 1 })
    .eq("id", entry.id)
    .eq("site_id", entry.site_id)
    .eq("rev", expectedRev)
    .select("rev");
  if (updated.error) return mapDbError(updated.error);
  if (updated.data.length === 0) {
    const reread = await admin
      .from("content_entries")
      .select("rev")
      .eq("id", entry.id)
      .maybeSingle();
    if (reread.error) return mapDbError(reread.error);
    if (!reread.data) return failure("not_found");
    return failure("conflict", undefined, Number(reread.data.rev));
  }

  // The save stands even when the revision cannot be recorded; it is only history.
  const recorded = await admin.rpc("record_entry_revision", {
    p_entry_id: entry.id,
    p_source: actor.source,
    p_max_age: REVISION_MIN_AGE,
  });
  if (recorded.error) {
    console.error("[content] recording a revision failed", recorded.error.message);
  }
  return { ok: true, rev: expectedRev + 1, unchanged: false };
}
