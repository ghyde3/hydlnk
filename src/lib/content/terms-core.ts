import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { updateEntryWithClient } from "./entries-core";
import { failure, mapDbError } from "./errors";
import { activeAccount, enabledType, ownedEntry, ownedSite } from "./guards";
import type { ContentActor, ContentResult } from "./types";

type Admin = SupabaseClient<Database>;
type Taxonomy = "category" | "tag";

const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/;
const MAX_NAME = 80;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type TermSummary = {
  id: string;
  typeId: string;
  taxonomy: Taxonomy;
  name: string;
  slug: string;
  parentId: string | null;
};

const COLUMNS = "id, type_id, taxonomy, name, slug, parent_id";

function summary(row: {
  id: string;
  type_id: string;
  taxonomy: string;
  name: string;
  slug: string;
  parent_id: string | null;
}): TermSummary {
  return {
    id: row.id,
    typeId: row.type_id,
    taxonomy: row.taxonomy as Taxonomy,
    name: row.name,
    slug: row.slug,
    parentId: row.parent_id,
  };
}

const nameIssue = (name: unknown) =>
  typeof name !== "string" ||
  name.trim().length === 0 ||
  name.length > MAX_NAME ||
  // eslint-disable-next-line no-control-regex
  /[\u0000-\u001f\u007f]/.test(name);
const slugIssue = (slug: unknown) => typeof slug !== "string" || !SLUG.test(slug);

/** Ownership, then a live account. Term writes are refused for a suspended account. */
async function writableSite(admin: Admin, actor: ContentActor, siteId: string) {
  const site = await ownedSite(admin, actor.userId, siteId);
  if (!site.ok) return site;
  const account = await activeAccount(admin, actor.userId);
  if (!account.ok) return account;
  return { ok: true as const, siteId: site.site.id };
}

/** A term of this site, or `not_found`. */
async function siteTerm(admin: Admin, siteId: string, termId: unknown) {
  if (typeof termId !== "string" || !UUID.test(termId)) return failure("not_found");
  const found = await admin
    .from("content_terms")
    .select(COLUMNS)
    .eq("id", termId)
    .eq("site_id", siteId)
    .maybeSingle();
  if (found.error) {
    console.error("[content] reading the term failed", found.error.message);
    return failure("error");
  }
  return found.data ? { ok: true as const, term: found.data } : failure("not_found");
}

/** Add a category (one level deep) or a flat tag to an enabled type. */
export async function createTermWithClient(
  admin: Admin,
  input: {
    actor: ContentActor;
    siteId: string;
    typeKey: string;
    taxonomy: Taxonomy;
    name: string;
    slug: string;
    parentId?: string;
  },
): Promise<ContentResult<TermSummary>> {
  const site = await writableSite(admin, input.actor, input.siteId);
  if (!site.ok) return site;
  const type = await enabledType(admin, site.siteId, input.typeKey);
  if (!type.ok) return type;
  if (type.type.body_format !== "markdown") {
    return failure("invalid", "That content type has no categories or tags.");
  }
  if (input.taxonomy !== "category" && input.taxonomy !== "tag") return failure("invalid");
  if (nameIssue(input.name)) return failure("invalid", "Give the term a name.");
  if (slugIssue(input.slug)) {
    return failure("invalid", "Use lower-case letters, numbers and hyphens for the slug.");
  }
  let parentId: string | null = null;
  if (input.parentId !== undefined) {
    if (input.taxonomy === "tag") return failure("invalid", "Tags have no parent.");
    if (typeof input.parentId !== "string" || !UUID.test(input.parentId)) {
      return failure("invalid", "That parent category doesn’t exist.");
    }
    const parent = await admin
      .from("content_terms")
      .select("id, parent_id")
      .eq("id", input.parentId)
      .eq("site_id", site.siteId)
      .eq("type_id", type.type.id)
      .eq("taxonomy", "category")
      .maybeSingle();
    if (parent.error) {
      console.error("[content] reading the parent term failed", parent.error.message);
      return failure("error");
    }
    if (!parent.data) return failure("invalid", "That parent category doesn’t exist.");
    if (parent.data.parent_id !== null) {
      return failure("invalid", "Categories go one level deep.");
    }
    parentId = parent.data.id;
  }
  const inserted = await admin
    .from("content_terms")
    .insert({
      site_id: site.siteId,
      type_id: type.type.id,
      taxonomy: input.taxonomy,
      name: input.name,
      slug: input.slug,
      parent_id: parentId,
    })
    .select(COLUMNS)
    .single();
  if (inserted.error) return mapDbError(inserted.error);
  return { ok: true, ...summary(inserted.data) };
}

/** Change a term's name or slug. */
export async function renameTermWithClient(
  admin: Admin,
  input: { actor: ContentActor; siteId: string; termId: string; name?: string; slug?: string },
): Promise<ContentResult<TermSummary>> {
  const site = await writableSite(admin, input.actor, input.siteId);
  if (!site.ok) return site;
  const found = await siteTerm(admin, site.siteId, input.termId);
  if (!found.ok) return found;
  const patch: Database["public"]["Tables"]["content_terms"]["Update"] = {};
  if (input.name !== undefined) {
    if (nameIssue(input.name)) return failure("invalid", "Give the term a name.");
    patch.name = input.name;
  }
  if (input.slug !== undefined) {
    if (slugIssue(input.slug)) {
      return failure("invalid", "Use lower-case letters, numbers and hyphens for the slug.");
    }
    patch.slug = input.slug;
  }
  if (Object.keys(patch).length === 0) return failure("invalid", "Nothing to change.");
  const updated = await admin
    .from("content_terms")
    .update(patch)
    .eq("id", found.term.id)
    .eq("site_id", site.siteId)
    .select(COLUMNS)
    .maybeSingle();
  if (updated.error) return mapDbError(updated.error);
  if (!updated.data) return failure("not_found");
  return { ok: true, ...summary(updated.data) };
}

/** Delete a term. Its children become top-level and its entry links go (both by foreign key). */
export async function deleteTermWithClient(
  admin: Admin,
  input: { actor: ContentActor; siteId: string; termId: string },
): Promise<ContentResult<{ id: string }>> {
  const site = await writableSite(admin, input.actor, input.siteId);
  if (!site.ok) return site;
  const found = await siteTerm(admin, site.siteId, input.termId);
  if (!found.ok) return found;
  const deleted = await admin
    .from("content_terms")
    .delete()
    .eq("id", found.term.id)
    .eq("site_id", site.siteId)
    .select("id");
  if (deleted.error) return mapDbError(deleted.error);
  if (deleted.data.length === 0) return failure("not_found");
  return { ok: true, id: found.term.id };
}

/**
 * Set the terms in an entry's draft at `expectedRev`. It writes only the draft (through the same
 * conditional update as any save); content_entry_terms is rebuilt by publish.
 */
export async function setEntryTermsWithClient(
  admin: Admin,
  input: {
    actor: ContentActor;
    entryId: string;
    expectedRev: number;
    categories: string[];
    tags: string[];
  },
): Promise<ContentResult<{ rev: number; unchanged: boolean }>> {
  const owned = await ownedEntry(admin, input.actor.userId, input.entryId);
  if (!owned.ok) return owned;
  const account = await activeAccount(admin, input.actor.userId);
  if (!account.ok) return account;
  const { entry } = owned;
  if (entry.deleted_at !== null) return failure("not_found");
  const lists = [input.categories, input.tags];
  if (
    lists.some((l) => !Array.isArray(l) || l.some((id) => typeof id !== "string" || !UUID.test(id)))
  ) {
    return failure("invalid", "Those categories or tags aren’t valid.");
  }
  const categories = [...new Set(input.categories)];
  const tags = [...new Set(input.tags)];
  const wanted = [...categories, ...tags];
  if (wanted.length > 0) {
    const found = await admin
      .from("content_terms")
      .select("id, taxonomy")
      .eq("site_id", entry.site_id)
      .eq("type_id", entry.type_id)
      .in("id", wanted);
    if (found.error) {
      console.error("[content] reading the terms failed", found.error.message);
      return failure("error");
    }
    const taxonomy = new Map(found.data.map((t) => [t.id, t.taxonomy]));
    if (
      categories.some((id) => taxonomy.get(id) !== "category") ||
      tags.some((id) => taxonomy.get(id) !== "tag")
    ) {
      return failure("invalid", "One of those categories or tags doesn’t exist for this type.");
    }
  }
  const draft =
    entry.draft && typeof entry.draft === "object" && !Array.isArray(entry.draft)
      ? (entry.draft as Record<string, unknown>)
      : {};
  return updateEntryWithClient(admin, {
    actor: input.actor,
    entryId: entry.id,
    expectedRev: input.expectedRev,
    draft: { ...draft, terms: { categories, tags } },
  });
}
