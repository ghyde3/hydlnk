import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isValidSubPagePath, stripHiddenCharacters } from "@/lib/document";
import { loadDraftPreview, type SharedPreview } from "@/lib/previews/shared";
import type { Database } from "@/lib/supabase/database.types";
import { isUuid } from "./account-view";

/**
 * What the admin's read-only draft view shows (M13-11): a site's saved draft, Home or one of its
 * pages, loaded by the share preview's own loader (`loadDraftPreview`), so it is cleaned the same way
 * (hidden characters out) and drawn by the same renderer. Unlike a share link there is no token, no
 * expiry and no suspension check: a support request about a suspended account is still a support
 * request. It reads named columns and writes nothing.
 */

export type AdminDraftView =
  | { kind: "missing" }
  | {
      kind: "active";
      preview: Extract<SharedPreview, { kind: "active" }>;
      ownerId: string;
      handle: string;
      pageId: string;
      /** The page being viewed ("" for Home) and every page of the site, for the switcher. */
      path: string;
      pages: { path: string; title: string }[];
    };

export const adminDraftBase = (pageId: string): string => `/admin-draft/${pageId}`;

export async function loadAdminDraftView(
  db: SupabaseClient<Database>,
  pageId: unknown,
  path: string,
): Promise<AdminDraftView> {
  if (!isUuid(pageId)) return { kind: "missing" };
  if (path !== "" && !isValidSubPagePath(path)) return { kind: "missing" };

  const page = await db
    .from("pages")
    .select("id, handle, owner_id, draft, accounts!inner(plan)")
    .eq("id", pageId.toLowerCase())
    .maybeSingle();
  if (page.error) throw new Error(`Loading a draft for support failed: ${page.error.message}`);
  if (!page.data) return { kind: "missing" };

  const preview = await loadDraftPreview(
    db,
    {
      id: page.data.id,
      handle: page.data.handle,
      ownerId: page.data.owner_id,
      draft: page.data.draft,
      plan: page.data.accounts.plan,
    },
    { path, base: adminDraftBase(page.data.id), expiresAt: "" },
  );
  if (preview.kind !== "active") return { kind: "missing" };

  const rows = await db
    .from("site_pages")
    .select("path:draft->>path, title:draft->>title")
    .eq("page_id", page.data.id)
    .order("created_at", { ascending: true });
  if (rows.error) throw new Error(`Listing the pages of a draft failed: ${rows.error.message}`);
  const pages = (rows.data ?? []).flatMap((row) => {
    const { path: rowPath, title } = row as unknown as { path: unknown; title: unknown };
    if (typeof rowPath !== "string" || typeof title !== "string") return [];
    // The path is tenant-controlled and becomes a link in the admin's bar: only a valid sub-page
    // path (one lowercase segment, not reserved) is kept (Wave N security review).
    const cleanPath = rowPath.trim();
    if (!isValidSubPagePath(cleanPath)) return [];
    const clean = stripHiddenCharacters(title).trim();
    return clean === "" ? [] : [{ path: cleanPath, title: clean }];
  });

  return {
    kind: "active",
    preview,
    ownerId: page.data.owner_id,
    handle: page.data.handle,
    pageId: page.data.id,
    path,
    pages,
  };
}
