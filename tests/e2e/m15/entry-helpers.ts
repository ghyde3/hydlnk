import { expect, type Page } from "@playwright/test";
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

