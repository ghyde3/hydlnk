import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";
import { blockedBodyLinks } from "./blocklist";
import { failure, mapDbError } from "./errors";
import { activeAccount, enabledType, ownedEntry } from "./guards";
import { issuesOf, schemaForType } from "./schemas";
import type { ContentActor, ContentFailure, ContentResult } from "./types";

type Admin = SupabaseClient<Database>;
type Deps = { now?: () => Date };
type Input = { actor: ContentActor; entryId: string; expectedRev: number };

/** A refused rpc: a stale rev (22023) re-reads the rev and answers conflict with it. */
async function refused(
  admin: Admin,
  entryId: string,
  err: { code?: string | null; message?: string | null },
): Promise<ContentFailure> {
  // HL012 from the slug trigger reads `slug "…"`; a path clash reads `path "…"`.
  if (err.code === "HL012" && err.message?.startsWith("slug ")) return failure("slug_taken");
  const mapped = mapDbError(err);
  if (mapped.error !== "conflict") return mapped;
  const reread = await admin.from("content_entries").select("rev").eq("id", entryId).maybeSingle();
  if (reread.error) return failure("error");
  if (!reread.data) return failure("not_found");
  return failure("conflict", undefined, Number(reread.data.rev));
}

/** The checks both operations share, before anything is written. */
async function prepare(admin: Admin, input: Input) {
  const owned = await ownedEntry(admin, input.actor.userId, input.entryId);
  if (!owned.ok) return owned;
  const account = await activeAccount(admin, input.actor.userId);
  if (!account.ok) return account;
  const { entry } = owned;
  if (entry.deleted_at !== null) return failure("not_found");
  if (!Number.isSafeInteger(input.expectedRev) || input.expectedRev < 1) {
    return failure("invalid", "Send the revision you are editing.");
  }
  const type = await enabledType(admin, entry.site_id, entry.type_id);
  if (!type.ok) return type;
  if (Number(entry.rev) !== input.expectedRev) {
    return failure("conflict", undefined, Number(entry.rev));
  }
  return { ok: true as const, entry, type: type.type };
}

/** Publish the entry's draft, strictly validated, stored exactly as it is. */
export async function publishEntryWithClient(
  admin: Admin,
  input: Input,
  deps: Deps = {},
): Promise<ContentResult<{ rev: number; publishedAt: string; siteId: string }>> {
  const ready = await prepare(admin, input);
  if (!ready.ok) return ready;
  const { entry, type } = ready;

  const schema = schemaForType(type.key, "publish");
  if (!schema) return failure("invalid", "That content type can’t be published yet.");
  const parsed = schema.safeParse(entry.draft);
  if (!parsed.success) return { ...failure("invalid"), issues: issuesOf(parsed.error) };
  if (type.key === "post") {
    const blocked = await blockedBodyLinks(admin, entry.draft);
    if (blocked) return blocked;
  }

  const publishedAt = (deps.now?.() ?? new Date()).toISOString();
  const { data, error } = await admin.rpc("publish_entry", {
    p_entry_id: entry.id,
    p_owner_id: input.actor.userId,
    p_expected_rev: input.expectedRev,
    p_published: entry.draft as Json,
    p_published_at: publishedAt,
    p_source: input.actor.source,
  });
  if (error) return refused(admin, entry.id, error);
  return { ok: true, rev: Number(data), publishedAt, siteId: entry.site_id };
}

/** Take the entry off the site. The draft stays. */
export async function unpublishEntryWithClient(
  admin: Admin,
  input: Input,
): Promise<ContentResult<{ rev: number; siteId: string }>> {
  const ready = await prepare(admin, input);
  if (!ready.ok) return ready;
  const { entry } = ready;
  const { data, error } = await admin.rpc("unpublish_entry", {
    p_entry_id: entry.id,
    p_owner_id: input.actor.userId,
    p_expected_rev: input.expectedRev,
  });
  if (error) return refused(admin, entry.id, error);
  return { ok: true, rev: Number(data), siteId: entry.site_id };
}
