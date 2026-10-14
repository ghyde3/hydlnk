import { expect, type Page } from "@playwright/test";
import { toSubPagePublishForm, type SubPageDraft } from "@/lib/document";
import { adminClient } from "../fixtures/auth";

/** Setup shared by the page-entry editor specs (1b1-17); 1b1-22 folds it into the common helpers. */

export interface Seeded {
  homeId: string;
  subId: string;
}

/** The moved layout of a new site: a '/' entry holding a link block, and one sub-page with a header. */
export async function seedEntries(siteId: string): Promise<Seeded> {
  const admin = adminClient();
  const type = await admin
    .from("content_types")
    .select("id")
    .eq("site_id", siteId)
    .eq("key", "page")
    .single();
  if (type.error) throw new Error(type.error.message);
  const insert = async (draft: unknown) => {
    // A site made through insertPage already has its Home entry: Home's content goes into it.
    if ((draft as { path?: string }).path === "/") {
      const home = await seedHome(siteId);
      const set = await admin
        .from("content_entries")
        .update({ draft: draft as never })
        .eq("id", home);
      if (set.error) throw new Error(set.error.message);
      return home;
    }
    const made = await admin
      .from("content_entries")
      .insert({ site_id: siteId, type_id: type.data.id, draft: draft as never })
      .select("id")
      .single();
    if (made.error) throw new Error(made.error.message);
    return made.data.id as string;
  };
  const homeId = await insert({
    path: "/",
    title: "",
    description: "",
    blocks: [
      {
        id: "lnk-aaaaaaaa",
        type: "link",
        visible: true,
        label: "Book",
        url: "https://example.com/book",
      },
    ],
  });
  const subId = await insert({
    path: "gallery",
    title: "Gallery",
    description: "",
    blocks: [{ id: "hdr-aaaaaaaa", type: "header", visible: true, text: "Mine" }],
  });
  return { homeId, subId };
}

/** Only Home's '/' entry, with `blocks` (none by default): the moved layout of a site with no sub-pages yet. */
export async function seedHome(siteId: string, blocks: unknown[] = []): Promise<string> {
  const admin = adminClient();
  // A site made through insertPage is already moved and has its Home entry: reuse it.
  const existing = await admin
    .from("content_entries")
    .select("id, draft")
    .eq("site_id", siteId)
    .eq("draft->>path", "/")
    .limit(1);
  if (existing.error) throw new Error(existing.error.message);
  if (existing.data.length > 0) {
    const row = existing.data[0]!;
    if (blocks.length > 0) {
      const set = await admin
        .from("content_entries")
        .update({ draft: { ...(row.draft as object), blocks } as never })
        .eq("id", row.id);
      if (set.error) throw new Error(set.error.message);
    }
    return row.id as string;
  }
  const type = await admin
    .from("content_types")
    .select("id")
    .eq("site_id", siteId)
    .eq("key", "page")
    .single();
  if (type.error) throw new Error(type.error.message);
  const made = await admin
    .from("content_entries")
    .insert({
      site_id: siteId,
      type_id: type.data.id,
      draft: { path: "/", title: "", description: "", blocks } as never,
    })
    .select("id")
    .single();
  if (made.error) throw new Error(made.error.message);
  return made.data.id as string;
}

export async function entry(id: string) {
  const { data, error } = await adminClient()
    .from("content_entries")
    .select("rev, draft")
    .eq("id", id)
    .single();
  if (error) throw new Error(error.message);
  return {
    rev: Number(data.rev),
    draft: data.draft as { blocks: Array<Record<string, unknown>> } & Record<string, unknown>,
  };
}

export async function editSubPageHeader(page: Page, text: string) {
  await page.getByTestId("page-row").filter({ hasText: "Gallery" }).click();
  const block = page.locator("li[data-block-id]").first();
  await expect(block).toBeVisible();
  if ((await page.locator('[data-field="text"]').count()) === 0) await block.click();
  await page.locator('[data-field="text"]').first().fill(text);
}

/** Home's '/' entry plus every sub-page of a layout built in site_pages: runs the cutover mover for one site. */
export async function moveSite(siteId: string): Promise<void> {
  const moved = await adminClient().rpc("move_site_content", { p_site: siteId });
  if (moved.error) throw new Error(`move_site_content failed: ${moved.error.message}`);
}

/**
 * A sub-page entry (a new page the way the editor would create it), live when `live` is set: the
 * draft is published as it stands. Returns the entry id. A site without a Home entry is
 * moved first (`moveSite`), so its Home comes from the site's draft.
 */
export async function addPageEntry(
  siteId: string,
  doc: { path: string; title: string; description?: string; blocks?: unknown[] },
  opts: { live?: boolean } = {},
): Promise<string> {
  const admin = adminClient();
  const type = await admin
    .from("content_types")
    .select("id")
    .eq("site_id", siteId)
    .eq("key", "page")
    .single();
  if (type.error) throw new Error(type.error.message);
  const home = await admin
    .from("content_entries")
    .select("id")
    .eq("site_id", siteId)
    .eq("draft->>path", "/")
    .limit(1);
  if (home.error) throw new Error(home.error.message);
  if (home.data.length === 0) await moveSite(siteId); // a site made the old way: Home moves first
  const draft = { description: "", blocks: [], ...doc };
  const made = await admin
    .from("content_entries")
    .insert({ site_id: siteId, type_id: type.data.id, draft: draft as never })
    .select("id")
    .single();
  if (made.error) throw new Error(`adding a page entry failed: ${made.error.message}`);
  if (opts.live) {
    const owner = await admin.from("pages").select("owner_id").eq("id", siteId).single();
    if (owner.error) throw new Error(owner.error.message);
    const published = await admin.rpc("publish_entry", {
      p_entry_id: made.data.id,
      p_owner_id: owner.data.owner_id,
      p_expected_rev: 1,
      p_published: toSubPagePublishForm(draft as unknown as SubPageDraft) as never,
      p_published_at: new Date().toISOString(),
      p_source: "system",
    });
    if (published.error)
      throw new Error(`publishing a page entry failed: ${published.error.message}`);
  }
  return made.data.id as string;
}

/** The sub-page entries of a site (Home's '/' entry left out), trash included, oldest first. */
export async function subPageEntries(siteId: string) {
  const { data, error } = await adminClient()
    .from("content_entries")
    .select("id, draft, published, published_at, live_path, deleted_at, rev")
    .eq("site_id", siteId)
    .neq("draft->>path", "/")
    .order("created_at");
  if (error) throw new Error(error.message);
  return data as unknown as Array<{
    id: string;
    draft: { path: string; title: string; blocks: unknown[] } & Record<string, unknown>;
    published: unknown;
    published_at: string | null;
    live_path: string | null;
    deleted_at: string | null;
    rev: number;
  }>;
}

/** Take a page away at once, the way Delete page does (to the trash). */
export async function trashPageEntry(siteId: string, entryId: string): Promise<void> {
  const admin = adminClient();
  const row = await admin.from("content_entries").select("rev").eq("id", entryId).single();
  const owner = await admin.from("pages").select("owner_id").eq("id", siteId).single();
  if (row.error || owner.error) throw new Error((row.error ?? owner.error)!.message);
  const out = await admin.rpc("trash_entry", {
    p_entry_id: entryId,
    p_owner_id: owner.data.owner_id,
    p_expected_rev: row.data.rev,
  });
  if (out.error) throw new Error(`trash_entry failed: ${out.error.message}`);
}

/** Write an entry's draft (and, with `published`, its live form) as a second writer would, moving the rev. */
export async function writeEntry(
  entryId: string,
  patch: { draft?: unknown; published?: unknown },
): Promise<void> {
  const admin = adminClient();
  const current = await admin.from("content_entries").select("rev").eq("id", entryId).single();
  if (current.error) throw new Error(current.error.message);
  const out = await admin
    .from("content_entries")
    .update({
      ...(patch.draft !== undefined ? { draft: patch.draft as never } : {}),
      ...(patch.published !== undefined
        ? { published: patch.published as never, published_at: new Date().toISOString() }
        : {}),
      rev: Number(current.data.rev) + 1,
    })
    .eq("id", entryId);
  if (out.error) throw new Error(`writeEntry failed: ${out.error.message}`);
}
