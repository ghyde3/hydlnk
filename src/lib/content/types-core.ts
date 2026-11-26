import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { failure, mapDbError } from "./errors";
import { activeAccount, ownedSite } from "./guards";
import type { ContentActor, ContentResult } from "./types";

type Admin = SupabaseClient<Database>;

/** The archive path rule of content_types (a CHECK); checked first so a bad one reads as `invalid`. */
const ARCHIVE_PATH = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
const MAX_LABEL = 60;

export type TypeSummary = {
  typeId: string;
  key: string;
  label: string;
  labelPlural: string;
  enabled: boolean;
  archivePath: string | null;
};

const COLUMNS = "id, key, label, label_plural, enabled, archive_path";

function summary(row: {
  id: string;
  key: string;
  label: string;
  label_plural: string;
  enabled: boolean;
  archive_path: string | null;
}): TypeSummary {
  return {
    typeId: row.id,
    key: row.key,
    label: row.label,
    labelPlural: row.label_plural,
    enabled: row.enabled,
    archivePath: row.archive_path,
  };
}

/** Ownership and a live account, then the site's type by key. Reads the type whether it is on or off. */
async function ownedType(admin: Admin, actor: ContentActor, siteId: string, typeKey: string) {
  const site = await ownedSite(admin, actor.userId, siteId);
  if (!site.ok) return site;
  const account = await activeAccount(admin, actor.userId);
  if (!account.ok) return account;
  if (typeof typeKey !== "string") return failure("not_found");
  const found = await admin
    .from("content_types")
    .select("id, key")
    .eq("site_id", site.site.id)
    .eq("key", typeKey)
    .maybeSingle();
  if (found.error) {
    console.error("[content] reading the type failed", found.error.message);
    return failure("error");
  }
  if (!found.data) return failure("not_found");
  return { ok: true as const, siteId: site.site.id, type: found.data };
}

function labelIssue(value: unknown): boolean {
  return (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.length > MAX_LABEL ||
    // eslint-disable-next-line no-control-regex
    /[\u0000-\u001f\u007f]/.test(value)
  );
}

/** Turn a built-in type on or off. The page type is always on. The database claims or frees the archive path. */
export async function enableTypeWithClient(
  admin: Admin,
  input: { actor: ContentActor; siteId: string; typeKey: string; enabled: boolean },
): Promise<ContentResult<TypeSummary>> {
  const owned = await ownedType(admin, input.actor, input.siteId, input.typeKey);
  if (!owned.ok) return owned;
  if (typeof input.enabled !== "boolean") return failure("invalid");
  if (owned.type.key === "page" && !input.enabled) {
    return failure("invalid", "The page type can’t be turned off.");
  }
  const updated = await admin
    .from("content_types")
    .update({ enabled: input.enabled })
    .eq("id", owned.type.id)
    .eq("site_id", owned.siteId)
    .select(COLUMNS)
    .maybeSingle();
  if (updated.error) return mapDbError(updated.error);
  if (!updated.data) return failure("not_found");
  return { ok: true, ...summary(updated.data) };
}

/** Change a type's labels or archive path. The page type has no archive path. */
export async function updateTypeWithClient(
  admin: Admin,
  input: {
    actor: ContentActor;
    siteId: string;
    typeKey: string;
    archivePath?: string;
    label?: string;
    labelPlural?: string;
  },
): Promise<ContentResult<TypeSummary>> {
  const owned = await ownedType(admin, input.actor, input.siteId, input.typeKey);
  if (!owned.ok) return owned;
  const patch: Database["public"]["Tables"]["content_types"]["Update"] = {};
  if (input.label !== undefined) {
    if (labelIssue(input.label)) return failure("invalid", "Give the type a name.");
    patch.label = input.label;
  }
  if (input.labelPlural !== undefined) {
    if (labelIssue(input.labelPlural)) return failure("invalid", "Give the type a plural name.");
    patch.label_plural = input.labelPlural;
  }
  if (input.archivePath !== undefined) {
    if (owned.type.key === "page") return failure("invalid", "Pages have no archive address.");
    if (typeof input.archivePath !== "string" || !ARCHIVE_PATH.test(input.archivePath)) {
      return failure("invalid", "Use lower-case letters, numbers and hyphens for the address.");
    }
    patch.archive_path = input.archivePath;
  }
  if (Object.keys(patch).length === 0) return failure("invalid", "Nothing to change.");
  const updated = await admin
    .from("content_types")
    .update(patch)
    .eq("id", owned.type.id)
    .eq("site_id", owned.siteId)
    .select(COLUMNS)
    .maybeSingle();
  if (updated.error) return mapDbError(updated.error);
  if (!updated.data) return failure("not_found");
  return { ok: true, ...summary(updated.data) };
}
