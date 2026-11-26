import { expect, test, type Page } from "@playwright/test";
import type { Block } from "@/lib/document";
import { adminClient } from "../fixtures/auth";
import { cleanupUsers } from "../fixtures/data";
import { expectNoHorizontalScroll, url } from "../helpers";
import { draftOf, openEditor, previewScreen, showView, userWithDraft } from "../m2/blocks-helpers";
import { makeLink } from "../m6/pages-helpers";
import {
  POST_TEST_IDS,
  blogUser,
  expectSaved,
  expectTargets44,
  openPost,
  postRow,
  seedPost,
} from "../m16/posts-helpers";
import {
  SCHEDULE_TEST_IDS,
  fillLocal,
  makeDue,
  minutesFromNow,
  runSchedules,
  schedulesOf,
} from "./scheduling-helpers";

/**
 * Wave E review fixes, in the browser:
 *   - M20-06 step 3: the editor preview draws every block that has not ended (an upcoming one too),
 *     and the private share link draws the draft as a visitor sees it now (the upcoming one hidden);
 *   - M20-10 step 1: a failed schedule shows "Didn't publish" with the reason and "Schedule again",
 *     which schedules it again;
 *   - M20-10 step 3: a schedule that fires while the post editor is open: the editor adopts the new
 *     rev, so the next edit saves (no conflict notice).
 * The browser runs in Europe/London.
 */

test.use({ timezoneId: "Europe/London" });
test.afterAll(cleanupUsers);
test.describe.configure({ timeout: 180_000 });

const chip = (page: Page) => page.getByTestId("post-bar").locator("[data-post-state]");

const link = (id: string, label: string, schedule?: { from?: string; until?: string }): Block =>
  ({
    id,
    type: "link",
    visible: true,
    label,
    url: `https://example.com/${id}`,
    ...(schedule ? { schedule } : {}),
  }) as Block;

test("M20-06 the editor preview hides only ended blocks; the share link shows the draft as a visitor sees it now", async ({
  page,
  context,
}) => {
  const blocks = [
    link("lnkPlainE2E01", "Always"),
    link("lnkSoonE2E001", "Opens later", { from: minutesFromNow(120) }),
    link("lnkOverE2E001", "Already over", {
      from: minutesFromNow(-240),
      until: minutesFromNow(-120),
    }),
  ];
  const user = await userWithDraft(context, "m20prev", (handle) => draftOf(handle, blocks), {
    plan: "pro",
  });
  await openEditor(page);
  await showView(page, "Preview");
  const preview = previewScreen(page);
  await expect(preview.locator('[data-block-id="lnkPlainE2E01"]')).toBeVisible();
  await expect(preview.locator('[data-block-id="lnkSoonE2E001"]')).toBeVisible();
  await expect(preview.locator('[data-block-id="lnkOverE2E001"]')).toHaveCount(0);
  await expectNoHorizontalScroll(page);

  const made = await makeLink(user.userId, user.pageId);
  const share = await page.request.get(url("app", new URL(made.url).pathname));
  expect(share.status()).toBe(200);
  const html = await share.text();
  expect(html).toContain("lnkPlainE2E01");
  expect(html).not.toContain("lnkSoonE2E001");
  expect(html).not.toContain("Opens later");
  expect(html).not.toContain("lnkOverE2E001");
  expect(html).not.toContain("Already over");
});

test("M20-10 a failed schedule shows Didn't publish with the reason and Schedule again, which schedules it again", async ({
  page,
  context,
}) => {
  const user = await blogUser(context, "m20fail", { plan: "pro" });
  const id = await seedPost(user.pageId, {
    title: "Missed launch",
    slug: "missed-launch",
    body: "Late.",
  });
  // A scheduled publish the worker refused (the account was on Free at fire time).
  const { error } = await adminClient()
    .from("content_schedules")
    .insert({
      site_id: user.pageId,
      entry_id: id,
      action: "publish",
      run_at: minutesFromNow(-30),
      status: "failed",
      result_code: "plan",
      finished_at: new Date().toISOString(),
      scheduled_rev: 1,
      source: "editor",
      created_by: user.id,
    } as never);
  expect(error).toBeNull();

  await openPost(page, id);
  await expect(chip(page)).toHaveText("Didn’t publish");
  await expect(page.getByTestId(SCHEDULE_TEST_IDS.failed)).toHaveText(
    "Didn’t publish: Scheduling isn’t part of your plan any more.",
  );
  const again = page.getByTestId(SCHEDULE_TEST_IDS.open);
  await expect(again).toHaveText("Schedule again");
  await expectTargets44(page.getByTestId("post-schedule"));
  await expectNoHorizontalScroll(page);

  await again.click();
  const at = new Date(Date.now() + 86_400_000);
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
  await fillLocal(page, SCHEDULE_TEST_IDS.time, `${day}T09:00`);
  await page.getByTestId(SCHEDULE_TEST_IDS.confirm).click();
  await expect(chip(page)).toHaveText("Scheduled");
  await expect(page.getByTestId(SCHEDULE_TEST_IDS.failed)).toHaveCount(0);
  expect((await schedulesOf(id)).map((row) => row.status)).toEqual(["failed", "pending"]);
});

test("M20-10 a schedule that fires while the post editor is open: the editor takes the new rev and the next edit saves", async ({
  page,
  context,
}, info) => {
  test.skip(info.project.name !== "desktop", "the worker is shared: one viewport runs it");
  const user = await blogUser(context, "m20adopt", { plan: "pro" });
  const id = await seedPost(user.pageId, {
    title: "While open",
    slug: "while-open",
    body: "Before.",
  });
  // The page's clock is ours to move: the editor's watch looks once the scheduled time has passed.
  await page.clock.install();
  await openPost(page, id);
  await page.getByTestId(SCHEDULE_TEST_IDS.open).click();
  const later = new Date(Date.now() + 2 * 3_600_000);
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(later);
  const hour = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    hour: "2-digit",
    hourCycle: "h23",
  }).format(later);
  await fillLocal(page, SCHEDULE_TEST_IDS.time, `${day}T${hour}:00`);
  await page.getByTestId(SCHEDULE_TEST_IDS.confirm).click();
  await expect(chip(page)).toHaveText("Scheduled");

  // The schedule fires (its time moved into the past, the cron route runs): the rev moves on.
  const before = Number((await postRow(id)).rev);
  await makeDue(id);
  expect((await runSchedules()).status).toBe(200);
  const fired = Number((await postRow(id)).rev);
  expect(fired).toBe(before + 1);

  // Time passes in the open tab: the watch reads the post and adopts the fire's rev.
  await page.clock.fastForward("03:00:00");
  await expect(chip(page)).toHaveText("Live", { timeout: 15_000 });

  await page.getByTestId(POST_TEST_IDS.title).fill("While open, edited");
  await expectSaved(page);
  await expect(page.getByText("This was changed somewhere else", { exact: false })).toHaveCount(0);
  const after = await postRow(id);
  expect((after.draft as { title: string }).title).toBe("While open, edited");
  expect(Number(after.rev)).toBe(fired + 1);
});
