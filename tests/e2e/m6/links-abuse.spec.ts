import { expect, test, type Page } from "@playwright/test";
import { adminClient, userClient } from "../fixtures/auth";
import { cleanupUsers, makeUser, signedInUser } from "../fixtures/data";
import { url } from "../helpers";
import { accessToken, openEditor, pageRow, rowOf } from "../m2/editor-helpers";

/**
 * M6-20 and M6-22 abuse cases through the real doors: the owner writes a draft with the publishable
 * key and their own JWT (PostgREST, RLS applies), which the database takes like any draft; Publish
 * then refuses it, names the block and the field, writes nothing, and the live page never shows
 * any of it. The owner is a signed-in user with a published copy of mara's page.
 */

test.afterAll(cleanupUsers);
test.describe.configure({ timeout: 120_000 });

const BAD_ID = "Lk-abuse-aaaa01";
const publishButton = (page: Page) =>
  page.getByRole("button", { name: "Publish", exact: true }).first();

const link = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  type: "link",
  visible: true,
  label: "Abuse test",
  url: "https://example.com/abuse",
  ...extra,
});

/** Writes `blocks` (after the page's own) into the owner's draft with the publishable key. */
async function patchDraft(token: string, pageId: string, blocks: unknown[]): Promise<void> {
  const current = (await pageRow(pageId)).draft;
  const { data, error } = await userClient(token)
    .from("pages")
    .update({ draft: { ...current, blocks: [...current.blocks, ...blocks] } })
    .eq("id", pageId)
    .select("id");
  expect(error, "the database takes any draft").toBeNull();
  expect(data).toHaveLength(1);
}

test("M6-20 a thumbnail from another account's folder and an icon name that is a script are refused at Publish and never render", async ({
  page,
  context,
}) => {
  const owner = await signedInUser(context, { label: "la1" });
  const stranger = await makeUser("lastr");
  const token = await accessToken(context);
  const before = await pageRow(owner.pageId);
  expect(before.published).not.toBeNull();

  const cases: [string, unknown, string][] = [
    [
      "a thumbnail in user B's folder",
      {
        type: "image",
        image: { path: `${stranger.id}/avatar-0123456789ab.webp`, width: 400, height: 400 },
      },
      "That image isn’t in your uploads. Upload it again.",
    ],
    [
      "a script-shaped built-in name",
      { type: "builtin", name: 'x"onload="alert(1)' },
      "Pick an icon from the list.",
    ],
  ];
  for (const [name, icon, message] of cases) {
    // Reset to the page's own draft, then write the abusive block with the owner's JWT.
    await adminClient().from("pages").update({ draft: before.draft }).eq("id", owner.pageId);
    await patchDraft(token, owner.pageId, [link(BAD_ID, { icon })]);

    await openEditor(page);
    await publishButton(page).click();
    const alert = page.getByRole("alert").filter({ hasText: "before publishing" });
    await expect(alert, name).toBeVisible();
    await expect(alert).toContainText(message);
    await expect(rowOf(page, BAD_ID).locator('p[data-field="icon"]')).toHaveText(message);

    // pages.published is exactly what it was.
    const after = await pageRow(owner.pageId);
    expect(after.published, name).toEqual(before.published);
    expect(after.published_at, name).toBe(before.published_at);

    // The live page shows none of it.
    const html = await (await page.request.get(url(owner.handle))).text();
    expect(html, name).not.toContain(BAD_ID);
    expect(html, name).not.toContain("onload=");
    expect(html, name).not.toContain(stranger.id);
    expect(html, name).not.toContain("Abuse test");
  }
});

test("M6-22 five featured links written with the publishable key are accepted as a draft, refused at Publish, and the live page keeps its own", async ({
  page,
  context,
}) => {
  const owner = await signedInUser(context, { label: "la2" });
  const token = await accessToken(context);
  const before = await pageRow(owner.pageId);
  const ids = [
    "Lk-feat5-aaaa01",
    "Lk-feat5-aaaa02",
    "Lk-feat5-aaaa03",
    "Lk-feat5-aaaa04",
    "Lk-feat5-aaaa05",
  ];
  await patchDraft(
    token,
    owner.pageId,
    ids.map((id) => link(id, { featured: "pulse", label: `Featured ${id.slice(-2)}` })),
  );
  // Accepted like any draft.
  const stored = (await pageRow(owner.pageId)).draft;
  expect(
    stored.blocks.filter((b) => (b as { featured?: string }).featured === "pulse"),
  ).toHaveLength(5);

  await openEditor(page);
  await publishButton(page).click();
  const alert = page.getByRole("alert").filter({ hasText: "before publishing" });
  await expect(alert).toBeVisible();
  await expect(alert).toContainText("Fix 2 blocks before publishing.");
  await expect(alert).toContainText("Feature up to 3 links. Turn one off to feature another.");

  const after = await pageRow(owner.pageId);
  expect(after.published).toEqual(before.published);
  expect(after.published_at).toBe(before.published_at);
  const html = await (await page.request.get(url(owner.handle))).text();
  expect(html).not.toContain("Lk-feat5");
  expect(html).not.toMatch(/<a\b[^>]*\bdata-featured=/);
});
