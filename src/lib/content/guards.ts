import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { failure } from "./errors";
import {
  requireEntryAccess,
  requireSiteAccess,
  requireTermAccess,
  type AccessRefusal,
  type SiteAccess,
  type SiteNeed,
} from "@/lib/access";
import type { ContentActor, ContentFailure } from "./types";

type Admin = SupabaseClient<Database>;
type Row<T extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][T]["Row"];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A refusal of the access helper as the writer's error (a stranger's id answers like a missing one). */
export function toContentFailure(refusal: AccessRefusal): ContentFailure {
  return failure(refusal.reason);
}

/**
 * The site, when the actor meets `need` on it (Wave F: the owner or a member, through the one access
 * helper). Another user's site and a missing one answer identically. `access.ownerId` and
 * `access.plan` are the OWNER's: use them for every limit, folder and `p_owner_id`.
 */
export async function siteFor(
  admin: Admin,
  actor: ContentActor,
  siteId: unknown,
  need: SiteNeed,
): Promise<{ ok: true; access: SiteAccess; site: { id: string } } | ContentFailure> {
  const found = await requireSiteAccess(admin, {
    actorId: actor.userId,
    siteId,
    need,
    source: actor.source,
  });
  if (!found.ok) return toContentFailure(found);
  return { ok: true, access: found.access, site: { id: found.access.siteId } };
}

/**
 * The entry, when the actor meets `need` on the entry's OWN site. Another user's entry and a missing
 * one answer identically. `need` may depend on the entry (`needForEntryWrite`).
 */
export async function entryFor(
  admin: Admin,
  actor: ContentActor,
  entryId: unknown,
  need: SiteNeed | ((entry: Row<"content_entries">) => SiteNeed),
): Promise<{ ok: true; access: SiteAccess; entry: Row<"content_entries"> } | ContentFailure> {
  const found = await requireEntryAccess(admin, {
    actorId: actor.userId,
    entryId,
    need,
    source: actor.source,
  });
  return found.ok ? found : toContentFailure(found);
}

/** The term, when the actor meets `need` on the term's own site, which must also be `siteId`. */
export async function termFor(
  admin: Admin,
  actor: ContentActor,
  siteId: string,
  termId: unknown,
  need: SiteNeed,
): Promise<{ ok: true; access: SiteAccess; term: Row<"content_terms"> } | ContentFailure> {
  const found = await requireTermAccess(admin, {
    actorId: actor.userId,
    termId,
    need,
    source: actor.source,
    siteId,
  });
  return found.ok ? found : toContentFailure(found);
}

/** The site's type, by id or key, on or off. An unknown one, or one of another site, gives `not_found`. */
export async function siteType(
  admin: Admin,
  siteId: string,
  typeIdOrKey: unknown,
): Promise<{ ok: true; type: Row<"content_types"> } | ContentFailure> {
  if (typeof typeIdOrKey !== "string") return failure("not_found");
  const query = admin.from("content_types").select("*").eq("site_id", siteId);
  const found = await (
    UUID.test(typeIdOrKey) ? query.eq("id", typeIdOrKey) : query.eq("key", typeIdOrKey)
  ).maybeSingle();
  if (found.error) {
    console.error("[content] reading the type failed", found.error.message);
    return failure("error");
  }
  return found.data ? { ok: true, type: found.data } : failure("not_found");
}

/** The site's enabled type, by id or key. A type that is off gives `type_disabled`; an unknown one `not_found`. */
export async function enabledType(
  admin: Admin,
  siteId: string,
  typeIdOrKey: string,
): Promise<{ ok: true; type: Row<"content_types"> } | ContentFailure> {
  const found = await siteType(admin, siteId, typeIdOrKey);
  if (!found.ok) return found;
  return found.type.enabled ? found : failure("type_disabled");
}
