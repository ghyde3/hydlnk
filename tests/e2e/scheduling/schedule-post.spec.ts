import { expect, test, type Page } from "@playwright/test";
import { cleanupUsers } from "../fixtures/data";
import { expectNoHorizontalScroll } from "../helpers";
import {
  POSTS_URL,
  POST_TEST_IDS,
  blogUser,
  expectSaved,
  expectTargets44,
  openPost,
  postRow,
  seedPost,
} from "../m16/posts-helpers";
import { SCHEDULE_TEST_IDS, fillLocal, schedulesOf } from "./scheduling-helpers";

/**
 * M20-07 and M20-10 at 390x844 and 1440x900: schedule a post for tomorrow, see "Scheduled" in the
 * editor bar and the Posts list (and its Scheduled filter), cancel it; schedule, edit, see the note,
 * update the scheduled version. The browser runs in Europe/London.
 */

test.use({ timezoneId: "Europe/London" });
test.afterAll(cleanupUsers);
test.describe.configure({ timeout: 180_000 });

const chip = (page: Page) => page.getByTestId("post-bar").locator("[data-post-state]");

/** Tomorrow at 09:00, London wall time, as the control takes it. */
function tomorrowLocal(): string {
  const at = new Date(Date.now() + 86_400_000);
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
  return `${day}T09:00`;
}

async function scheduleFromDialog(page: Page, local: string) {
  await page.getByTestId(SCHEDULE_TEST_IDS.open).click();
  await expect(page.getByTestId("schedule-dialog")).toBeVisible();
  await fillLocal(page, SCHEDULE_TEST_IDS.time, local);
  await page.getByTestId(SCHEDULE_TEST_IDS.confirm).click();
  await expect(page.getByTestId("schedule-dialog")).toBeHidden();
}

test("M20-07 schedule a post for tomorrow, see Scheduled, cancel it", async ({ page, context }) => {
  const user = await blogUser(context, "m20post", { plan: "pro" });
  const id = await seedPost(user.pageId, { title: "Tomorrow's news", slug: "tomorrow", body: "Soon." });
  await openPost(page, id);
  await expect(chip(page)).toHaveAttribute("data-post-state", "draft");

  await scheduleFromDialog(page, tomorrowLocal());
  await expect(chip(page)).toHaveAttribute("data-post-state", "scheduled");
  await expect(chip(page)).toHaveText("Scheduled");
  await expect(page.getByTestId("schedule-state")).toContainText("09:00 (Europe/London, GMT");
  expect((await schedulesOf(id)).map((row) => row.status)).toEqual(["pending"]);
  // Nothing went live.
  expect((await postRow(id)).published).toBeNull();
  await expectTargets44(page.getByTestId("post-schedule"));
  await expectNoHorizontalScroll(page);

  // The Posts list says it too, and its Scheduled filter finds it.
  await page.goto(POSTS_URL);
  const row = page.locator(`[data-post-id="${id}"]`);
  await expect(row.locator("[data-post-state]")).toHaveText("Scheduled");
  // The local time and zone (M20-10 step 1), as in the editor bar.
  await expect(row.getByTestId("posts-row-scheduled")).toContainText("Publishes");
  await expect(row.getByTestId("posts-row-scheduled")).toContainText("09:00 (Europe/London, GMT");
  await page.getByTestId("posts-filter-status").selectOption("scheduled");
  await expect(page.locator(`[data-post-id="${id}"]`)).toBeVisible();

  await openPost(page, id);
  await page.getByTestId(SCHEDULE_TEST_IDS.cancel).click();
  await expect(chip(page)).toHaveAttribute("data-post-state", "draft");
  await expect(page.getByTestId("schedule-state")).toHaveCount(0);
  expect((await schedulesOf(id)).map((row) => row.status)).toEqual(["canceled"]);
});

test("M20-10 schedule, edit, see the note, update the scheduled version", async ({ page, context }) => {
  const user = await blogUser(context, "m20edit", { plan: "pro" });
  const id = await seedPost(user.pageId, { title: "Version one", slug: "versions", body: "First." });
  await openPost(page, id);
  await scheduleFromDialog(page, tomorrowLocal());
  await expect(page.getByTestId(SCHEDULE_TEST_IDS.note)).toHaveCount(0);

  await page.getByTestId(POST_TEST_IDS.title).fill("Version two");
  await expectSaved(page);
  const note = page.getByTestId(SCHEDULE_TEST_IDS.note);
  await expect(note).toContainText("Your scheduled version is from");
  await expect(note).toContainText("Newer edits are not scheduled.");
  await expectTargets44(page.getByTestId("post-schedule"));

  const before = (await schedulesOf(id)).find((row) => row.status === "pending")!;
  await page.getByTestId(SCHEDULE_TEST_IDS.update).click();
  await expect(note).toHaveCount(0);
  const rows = await schedulesOf(id);
  const pending = rows.find((row) => row.status === "pending")!;
  expect(pending.run_at).toBe(before.run_at);
  expect(rows.filter((row) => row.status === "canceled" && row.result_code === "replaced")).toHaveLength(1);
  await expectNoHorizontalScroll(page);
});
