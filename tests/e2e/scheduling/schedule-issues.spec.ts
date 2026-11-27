import { expect, test, type Page } from "@playwright/test";
import { cleanupUsers } from "../fixtures/data";
import { expectNoHorizontalScroll } from "../helpers";
import { emptyUser, openEditor, pageRow, reloadEditor, setDraft, statusChip } from "../m2/editor-helpers";
import { POST_TEST_IDS, blogUser, openPost, postRow, seedPost } from "../m16/posts-helpers";
import { SCHEDULE_TEST_IDS, fillLocal, homeEntry, schedulesOf } from "./scheduling-helpers";

/**
 * M20-07 step 1 at 390x844 and 1440x900: Schedule validates the draft exactly as Publish does. A post
 * that cannot be published (no title, no slug) is refused at Schedule with the same issues list,
 * field by field and word for word, that Publish shows; nothing is scheduled and nothing goes live.
 * A page row of the publish bar does the same: Home with two blocking errors lists, under Schedule,
 * the rows of the alert Publish shows (one `PublishAlert`).
 */

test.use({ timezoneId: "Europe/London" });
test.afterAll(cleanupUsers);
test.describe.configure({ timeout: 180_000 });

/** The issues list as the editor shows it: one "field: message" per row, in order. */
async function issuesShown(page: Page): Promise<string[]> {
  const issues = page.getByTestId("post-issues");
  await expect(issues).toBeVisible();
  const rows = issues.locator("[data-issue-field]");
  const out: string[] = [];
  for (let i = 0; i < (await rows.count()); i++) {
    const row = rows.nth(i);
    out.push(`${await row.getAttribute("data-issue-field")}|${(await row.innerText()).trim()}`);
  }
  return out;
}

test("M20-07 scheduling a post with publish issues shows the same issues list as Publish", async ({
  page,
  context,
}) => {
  const user = await blogUser(context, "m20issues", { plan: "pro" });
  const id = await seedPost(user.pageId, { title: "", slug: "", body: "Text." });

  await openPost(page, id);
  await page.getByTestId(POST_TEST_IDS.publish).click();
  const fromPublish = await issuesShown(page);
  expect(fromPublish.map((row) => row.split("|")[0])).toEqual(
    expect.arrayContaining(["title", "slug"]),
  );
  expect((await postRow(id)).published).toBeNull();

  // A fresh editor (no issues on screen), then Schedule for tomorrow.
  await openPost(page, id);
  await expect(page.getByTestId("post-issues")).toHaveCount(0);
  const at = new Date(Date.now() + 86_400_000);
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
  await page.getByTestId(SCHEDULE_TEST_IDS.open).click();
  await expect(page.getByTestId("schedule-dialog")).toBeVisible();
  await fillLocal(page, SCHEDULE_TEST_IDS.time, `${day}T09:00`);
  await page.getByTestId(SCHEDULE_TEST_IDS.confirm).click();
  await expect(page.getByTestId("schedule-dialog-error")).toHaveText("Fix these to schedule.");
  expect(await issuesShown(page)).toEqual(fromPublish);

  // Nothing was scheduled and nothing went live.
  expect(await schedulesOf(id)).toEqual([]);
  expect((await postRow(id)).published).toBeNull();
  await page.getByRole("button", { name: "Close" }).click();
  await expectNoHorizontalScroll(page);
});

/** The Publish alert's rows (heading first, then one line per failing block or field), as shown. */
async function alertRows(alert: import("@playwright/test").Locator): Promise<string[]> {
  await expect(alert).toBeVisible();
  const heading = (await alert.locator("span").first().innerText()).trim();
  const rows = (await alert.locator("li").allInnerTexts()).map((text) => text.trim());
  return [heading, ...rows];
}

test("M20-07 scheduling a page with two blocking errors shows the same Publish alert rows as Publish", async ({
  page,
  context,
}) => {
  const user = await emptyUser(context, "m20pgiss", { plan: "pro" });
  await openEditor(page);
  // The site goes live once (a page can be scheduled after that), then its draft breaks twice.
  const toolbarPublish = page
    .getByTestId("workspace-toolbar")
    .getByRole("button", { name: "Publish", exact: true });
  await toolbarPublish.click();
  await expect(statusChip(page)).toHaveText("Published", { timeout: 30_000 });
  const live = (await pageRow(user.pageId)).published;
  const draft = (await pageRow(user.pageId)).draft;
  await setDraft(user.pageId, {
    ...draft,
    blocks: [
      { id: "lnkIss0001", type: "link", visible: true, label: "Broken link", url: "" },
      { id: "embIss0001", type: "embed", visible: true, url: "https://example.com/not-a-video", caption: "Bad embed" },
    ],
  });
  await reloadEditor(page);

  await toolbarPublish.click();
  const fromPublish = await alertRows(
    page.getByTestId("workspace-notices").getByRole("alert").filter({ hasText: "before publishing" }),
  );
  expect(fromPublish[0]).toBe("Fix 2 blocks before publishing.");
  expect(fromPublish).toHaveLength(3);

  // Home's row of the publish bar: Schedule for tomorrow.
  if (!(await page.getByTestId("publish-bar").isVisible())) {
    await page.getByTestId("publish-bar-toggle").click();
  }
  await page.getByTestId("publish-row-schedule-home").click();
  const panel = page.getByTestId("page-schedule-home");
  await expect(panel).toBeVisible();
  const at = new Date(Date.now() + 86_400_000);
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
  await panel.getByTestId(SCHEDULE_TEST_IDS.open).click();
  await expect(page.getByTestId("schedule-dialog")).toBeVisible();
  await fillLocal(page, SCHEDULE_TEST_IDS.time, `${day}T09:00`);
  await page.getByTestId(SCHEDULE_TEST_IDS.confirm).click();
  await expect(page.getByTestId("schedule-dialog-error")).toHaveText("Fix these to schedule.");
  await page.getByRole("button", { name: "Close" }).click();
  expect(await alertRows(panel.getByRole("alert"))).toEqual(fromPublish);

  // Nothing was scheduled and nothing went live.
  const home = await homeEntry(user.pageId);
  expect(await schedulesOf(home.id)).toEqual([]);
  expect((await pageRow(user.pageId)).published).toEqual(live);
  await expectNoHorizontalScroll(page);
});
