import { expect, test } from "@playwright/test";
import { adminClient } from "../fixtures/auth";
import { cleanupUsers, signedInUser } from "../fixtures/data";
import { mark, openEditor, statusChip } from "../m2/editor-helpers";
import {
  HISTORY_URL,
  allRows,
  bioOf,
  changeDraftBio,
  rowFor,
  versionRows,
} from "./versions-helpers";

/**
 * M6-48 in the browser: a Pro user's Publish clicks are what record versions, and a Free user's are
 * not. (The trigger, the numbering under concurrent Publishes and retention are pgTAP 131 and
 * tests/unit/m6-versions-db.test.ts; the read gate is versions-db-api.spec.ts.)
 */

test.afterAll(cleanupUsers);

// Each Publish click takes several seconds on a busy dev server; three of them need room.
test.describe.configure({ timeout: 150_000 });

const publish = (page: import("@playwright/test").Page) =>
  page.getByTestId("workspace-toolbar").getByRole("button", { name: "Publish", exact: true });

/**
 * A different bio in the draft, then one real Publish click. The draft is written the way autosave
 * writes it (a rev one higher), and the editor is opened fresh each time, so what is under test is
 * Publish and the version it records, not the typing.
 */
async function publishWithBio(page: import("@playwright/test").Page, pageId: string, bio: string) {
  await changeDraftBio(pageId, bio);
  await openEditor(page);
  await expect(page.getByLabel("Bio", { exact: true })).toHaveValue(bio);
  await publish(page).click();
  await expect(statusChip(page)).toHaveText("Published");
}

test("M6-48 as a Pro user, three Publish clicks with different bios give three versions, and History lists them", async ({
  page,
  context,
}) => {
  const user = await signedInUser(context, { label: "vrec1", plan: "pro" });
  expect(await versionRows(user.pageId)).toHaveLength(0);
  const bios = [`First ${mark()}`, `Second ${mark()}`, `Third ${mark()}`];
  for (const bio of bios) await publishWithBio(page, user.pageId, bio);

  const rows = await versionRows(user.pageId);
  expect(rows.map((r) => r.version_no)).toEqual([1, 2, 3]);
  expect(rows.map((r) => bioOf(r.document))).toEqual(bios);
  // the newest version is exactly what the page holds
  const { data } = await adminClient()
    .from("pages")
    .select("published, published_at")
    .eq("id", user.pageId)
    .single();
  expect(data!.published).toEqual(rows[2]!.document);
  expect(new Date(data!.published_at).getTime()).toBe(new Date(rows[2]!.published_at).getTime());

  // publishing the same thing again adds nothing
  await openEditor(page);
  await publish(page).click();
  await expect(statusChip(page)).toHaveText("Published");
  expect(await versionRows(user.pageId)).toHaveLength(3);

  await page.goto(HISTORY_URL);
  await expect(allRows(page)).toHaveCount(3);
  await expect(rowFor(page, 3).getByTestId("live-chip")).toBeVisible();
});

test("M6-48 as a Free user, Publish clicks record no versions", async ({ page, context }) => {
  const user = await signedInUser(context, { label: "vrec2", plan: "free" });
  for (const bio of [`One ${mark()}`, `Two ${mark()}`, `Three ${mark()}`]) {
    await publishWithBio(page, user.pageId, bio);
  }
  expect(await versionRows(user.pageId)).toHaveLength(0);
});
