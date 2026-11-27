import { expect, test, type Page } from "@playwright/test";
import { cleanupUsers } from "../fixtures/data";
import { expectNoHorizontalScroll } from "../helpers";
import { emptyUser, openEditor, statusChip } from "../m2/editor-helpers";
import { seedEntries } from "../m15/entry-helpers";
import { expectTargets44 } from "../m16/posts-helpers";
import { SCHEDULE_TEST_IDS, fillLocal, schedulesOf } from "./scheduling-helpers";

/**
 * M20-07, M20-09, M20-10 at 390x844 and 1440x900: a page row of the publish bar schedules the page
 * (its row reads "Scheduled"), offers "Unpublish at" for a sub-page and not for Home, and cancels.
 */

test.use({ timezoneId: "Europe/London" });
test.afterAll(cleanupUsers);
test.describe.configure({ timeout: 240_000 });

const bar = (page: Page) => page.getByTestId("publish-bar");
const row = (page: Page, key: string) => page.getByTestId(`publish-row-${key}`);

async function openBar(page: Page): Promise<void> {
  if (await bar(page).isVisible()) return;
  await page.getByTestId("publish-bar-toggle").click();
  await expect(bar(page)).toBeVisible();
}

test("M20-07 schedule a sub-page from the publish bar, see Scheduled, cancel it", async ({ page, context }) => {
  const user = await emptyUser(context, "m20page", { plan: "pro" });
  const { subId } = await seedEntries(user.pageId);
  await openEditor(page);
  // The site goes live once; a page can be scheduled after that.
  await page.getByTestId("workspace-toolbar").getByRole("button", { name: "Publish", exact: true }).click();
  await expect(statusChip(page)).toHaveText("Published", { timeout: 30_000 });

  await openBar(page);
  await page.getByTestId(`publish-row-schedule-home`).click();
  await page.getByTestId(SCHEDULE_TEST_IDS.open).click();
  // Home cannot be scheduled to unpublish.
  await expect(page.getByTestId(SCHEDULE_TEST_IDS.unpublishTime)).toHaveCount(0);
  await page.getByRole("button", { name: "Close" }).click();
  await page.getByRole("button", { name: "Back" }).click();

  await page.getByTestId(`publish-row-schedule-${subId}`).click();
  const panel = page.getByTestId(`page-schedule-${subId}`);
  await expect(panel).toBeVisible();
  await page.getByTestId(SCHEDULE_TEST_IDS.open).click();
  const year = new Date().getUTCFullYear() + 1;
  await fillLocal(page, SCHEDULE_TEST_IDS.time, `${year}-01-10T09:00`);
  await fillLocal(page, SCHEDULE_TEST_IDS.unpublishTime, `${year}-01-20T09:00`);
  await page.getByTestId(SCHEDULE_TEST_IDS.confirm).click();
  await expect(panel.getByTestId("schedule-state")).toContainText("10 Jan");
  await expect(panel.getByTestId("schedule-unpublish-state")).toContainText("20 Jan");
  await expectTargets44(panel);
  expect((await schedulesOf(subId)).filter((r) => r.status === "pending").map((r) => r.action).sort()).toEqual([
    "publish",
    "unpublish",
  ]);

  await page.getByRole("button", { name: "Back" }).click();
  await expect(row(page, subId).locator("[data-item-state]")).toHaveText("Scheduled");
  // The row says when, in the browser's zone (M20-10 step 1).
  await expect(page.getByTestId(`publish-row-scheduled-${subId}`)).toContainText(
    `Publishes 10 Jan ${year}, 09:00 (Europe/London, GMT`,
  );
  await expectNoHorizontalScroll(page);

  await page.getByTestId(`publish-row-schedule-${subId}`).click();
  await page.getByTestId(SCHEDULE_TEST_IDS.cancel).click();
  await expect(panel.getByTestId("schedule-state")).toHaveCount(0);
  await page.getByTestId("schedule-cancel-unpublish").click();
  await expect(panel.getByTestId("schedule-unpublish-state")).toHaveCount(0);
  expect((await schedulesOf(subId)).every((r) => r.status === "canceled")).toBe(true);
});
