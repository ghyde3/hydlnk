import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { failure } from "./errors";
import type { ContentFailure } from "./types";

type Admin = SupabaseClient<Database>;
type Row<T extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][T]["Row"];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Writes refuse a suspended account. A failed read refuses too; a missing account reads as suspended. */
export async function activeAccount(
  admin: Admin,
  userId: string,
): Promise<{ ok: true; plan: string } | ContentFailure> {
  const account = await admin
    .from("accounts")
    .select("plan, suspended_at")
    .eq("id", userId)
    .maybeSingle();
  if (account.error) {
    console.error("[content] reading the account failed", account.error.message);
    return failure("error");
  }
  if (!account.data || account.data.suspended_at !== null) return failure("account_suspended");
  return { ok: true, plan: account.data.plan };
}

/** The site, if `userId` owns it. Another user's site and a missing one answer identically. */
export async function ownedSite(
  admin: Admin,
  userId: string,
  siteId: unknown,
): Promise<{ ok: true; site: Pick<Row<"pages">, "id" | "handle"> } | ContentFailure> {
  if (typeof siteId !== "string" || !UUID.test(siteId)) return failure("not_found");
  const site = await admin
    .from("pages")
    .select("id, handle")
    .eq("id", siteId)
    .eq("owner_id", userId)
    .maybeSingle();
  if (site.error) {
    console.error("[content] reading the site failed", site.error.message);
    return failure("error");
  }
  return site.data ? { ok: true, site: site.data } : failure("not_found");
}

/** The entry, if its site belongs to `userId`. Another user's entry and a missing one answer identically. */
export async function ownedEntry(
  admin: Admin,
  userId: string,
  entryId: unknown,
): Promise<{ ok: true; entry: Row<"content_entries"> } | ContentFailure> {
  if (typeof entryId !== "string" || !UUID.test(entryId)) return failure("not_found");
  const entry = await admin
    .from("content_entries")
    .select("*, pages!inner(owner_id)")
    .eq("id", entryId)
    .eq("pages.owner_id", userId)
    .maybeSingle();
  if (entry.error) {
    console.error("[content] reading the entry failed", entry.error.message);
    return failure("error");
  }
  if (!entry.data) return failure("not_found");
  const { pages: _owner, ...row } = entry.data;
  void _owner;
  return { ok: true, entry: row };
}

/** The site's enabled type, by id or key. A type that is off gives `type_disabled`; an unknown one `not_found`. */
export async function enabledType(
  admin: Admin,
  siteId: string,
  typeIdOrKey: string,
): Promise<{ ok: true; type: Row<"content_types"> } | ContentFailure> {
  const query = admin.from("content_types").select("*").eq("site_id", siteId);
  const found = await (UUID.test(typeIdOrKey)
    ? query.eq("id", typeIdOrKey)
    : query.eq("key", typeIdOrKey)
  ).maybeSingle();
  if (found.error) {
    console.error("[content] reading the type failed", found.error.message);
    return failure("error");
  }
  if (!found.data) return failure("not_found");
  return found.data.enabled ? { ok: true, type: found.data } : failure("type_disabled");
}
