import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import {
  decide,
  toSiteAccess,
  type AccessRefusal,
  type AccessRow,
  type AccessSource,
  type SiteAccess,
  type SiteNeed,
} from "./decide";

/**
 * The access helper (Wave F, M19-06). Every server-side check of "may this user act on this site"
 * calls one of the three `require*` functions below; each reads `public.site_access` (the SQL rule)
 * once and decides with `decide`. Nothing here is cached across requests: no module-level state, no
 * `unstable_cache`, no "use cache" (tests/unit/m19-access-static.test.ts).
 *
 * The results carry `access.ownerId` and `access.plan`: callers use them, never the actor, for the
 * account, plan, theme scope, media folder and every `p_owner_id`.
 */

export * from "./decide";

type Admin = SupabaseClient<Database>;
type Row<T extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][T]["Row"];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuid = (value: unknown): value is string =>
  typeof value === "string" && UUID.test(value);

const refuse = (reason: AccessRefusal["reason"]): AccessRefusal => ({ ok: false, reason });

export interface SiteAccessInput {
  actorId: string;
  siteId: unknown;
  need: SiteNeed;
  source: AccessSource;
}

export async function requireSiteAccess(
  admin: Admin,
  input: SiteAccessInput,
): Promise<{ ok: true; access: SiteAccess } | AccessRefusal> {
  if (!isUuid(input.actorId) || !isUuid(input.siteId)) return refuse("not_found");
  const { data, error } = await admin.rpc("site_access", {
    p_site: input.siteId,
    p_user: input.actorId,
  });
  if (error) {
    console.error("[access] reading site access failed", error.code, error.message);
    return refuse("error");
  }
  const row = ((Array.isArray(data) ? data[0] : data) ?? null) as AccessRow | null;
  const verdict = decide(row, input.need, input.source);
  return verdict === "ok" && row
    ? { ok: true, access: toSiteAccess(row, input.actorId) }
    : refuse(verdict === "ok" ? "not_found" : verdict);
}

export interface EntryAccessInput {
  actorId: string;
  entryId: unknown;
  need: SiteNeed;
  source: AccessSource;
  /** The site the URL names: when given, the entry's own site must equal it (T5). */
  siteId?: string;
}

/** The entry, and access decided on the entry's OWN site (never the URL's). */
export async function requireEntryAccess(
  admin: Admin,
  input: EntryAccessInput,
): Promise<{ ok: true; access: SiteAccess; entry: Row<"content_entries"> } | AccessRefusal> {
  if (!isUuid(input.entryId)) return refuse("not_found");
  const found = await admin.from("content_entries").select("*").eq("id", input.entryId).maybeSingle();
  if (found.error) {
    console.error("[access] reading the entry failed", found.error.message);
    return refuse("error");
  }
  if (!found.data || (input.siteId !== undefined && found.data.site_id !== input.siteId)) {
    return refuse("not_found");
  }
  const site = await requireSiteAccess(admin, { ...input, siteId: found.data.site_id });
  return site.ok ? { ...site, entry: found.data } : site;
}

export interface TermAccessInput {
  actorId: string;
  termId: unknown;
  need: SiteNeed;
  source: AccessSource;
  siteId?: string;
}

/** The term, and access decided on the term's own site. */
export async function requireTermAccess(
  admin: Admin,
  input: TermAccessInput,
): Promise<{ ok: true; access: SiteAccess; term: Row<"content_terms"> } | AccessRefusal> {
  if (!isUuid(input.termId)) return refuse("not_found");
  const found = await admin.from("content_terms").select("*").eq("id", input.termId).maybeSingle();
  if (found.error) {
    console.error("[access] reading the term failed", found.error.message);
    return refuse("error");
  }
  if (!found.data || (input.siteId !== undefined && found.data.site_id !== input.siteId)) {
    return refuse("not_found");
  }
  const site = await requireSiteAccess(admin, { ...input, siteId: found.data.site_id });
  return site.ok ? { ...site, term: found.data } : site;
}

export type SiteActivityAction =
  | "site_published"
  | "design_published"
  | "page_published"
  | "post_published"
  | "post_unpublished"
  | "entry_trashed"
  | "entry_restored"
  | "entry_deleted"
  | "entry_purged"
  | "page_created"
  | "post_created"
  | "revision_restored"
  | "version_restored"
  | "term_renamed"
  | "term_deleted"
  | "schedule_set"
  | "schedule_canceled";

/**
 * One activity row for a publish-class action on a shared site (autosaves are not recorded, G12).
 * The database takes the role from the rule, not from here. Only recorded when the site has a team
 * (a member acted, or the owner acted on a site that has members): never throws.
 */
export async function recordSiteActivity(
  admin: Admin,
  access: SiteAccess,
  action: SiteActivityAction,
  entryId?: string | null,
): Promise<void> {
  try {
    const { error } = await admin.rpc("record_site_activity", {
      p_site: access.siteId,
      p_actor: access.actorId,
      p_action: action,
      p_entry: entryId ?? undefined,
    });
    if (error) console.error("[access] recording activity failed", error.code);
  } catch (err) {
    console.error("[access] recording activity failed", err instanceof Error ? err.name : "unknown");
  }
}
