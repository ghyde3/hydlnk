import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { failure } from "./errors";
import type { ContentFailure } from "./types";

type Admin = SupabaseClient<Database>;

const TAXONOMIES = [
  ["categories", "category"],
  ["tags", "tag"],
] as const;

/**
 * A post draft with the term ids that no longer count taken out: a term that was deleted, one that
 * belongs to another site or type, or an id listed under the wrong taxonomy. The draft is returned
 * as it came when nothing needs to go; only `terms` is ever touched.
 */
export async function pruneTerms(
  admin: Admin,
  scope: { siteId: string; typeId: string },
  draft: unknown,
): Promise<{ ok: true; draft: unknown } | ContentFailure> {
  if (!draft || typeof draft !== "object" || Array.isArray(draft)) return { ok: true, draft };
  const record = draft as Record<string, unknown>;
  const terms = record.terms;
  if (!terms || typeof terms !== "object" || Array.isArray(terms)) return { ok: true, draft };
  const listed = terms as Record<string, unknown>;
  const ids = TAXONOMIES.flatMap(([key]) => {
    const list = listed[key];
    return Array.isArray(list) ? list.filter((id): id is string => typeof id === "string") : [];
  });
  if (ids.length === 0) return { ok: true, draft };

  const found = await admin
    .from("content_terms")
    .select("id, taxonomy")
    .eq("site_id", scope.siteId)
    .eq("type_id", scope.typeId)
    .in("id", ids);
  if (found.error) {
    console.error("[content] reading the terms failed", found.error.message);
    return failure("error");
  }
  const taxonomy = new Map(found.data.map((t) => [t.id, t.taxonomy]));
  let changed = false;
  const next: Record<string, unknown> = { ...listed };
  for (const [key, kind] of TAXONOMIES) {
    const list = listed[key];
    if (!Array.isArray(list)) continue;
    const kept = list.filter((id) => typeof id === "string" && taxonomy.get(id) === kind);
    if (kept.length !== list.length) {
      changed = true;
      next[key] = kept;
    }
  }
  return { ok: true, draft: changed ? { ...record, terms: next } : draft };
}
