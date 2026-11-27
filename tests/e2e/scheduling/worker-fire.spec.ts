import { expect, test } from "@playwright/test";
import { adminClient, signInAs } from "../fixtures/auth";
import { cleanupUsers } from "../fixtures/data";
import { url } from "../helpers";
import { publishDocOf, publishedPage } from "../m2/blocks-helpers";
import { POST_TEST_IDS, enableBlog, openPost, seedPost } from "../m16/posts-helpers";
import { SCHEDULE_TEST_IDS, fillLocal, makeDue, runSchedules, schedulesOf } from "./scheduling-helpers";

/**
 * M20-08 at 1440x900: schedule a post in the editor, move its time into the past in the database,
 * POST the cron route with the local secret, and the post is on `{handle}.localhost/blog/{slug}`.
 * A second POST does nothing more (one publish, one rev).
 */

test.afterAll(cleanupUsers);
test.describe.configure({ timeout: 180_000 });

test("M20-08 a due scheduled post goes live when the cron route runs", async ({ page, context }, info) => {
  test.skip(info.project.name !== "desktop", "the worker is shared: one viewport runs it");
  const site = await publishedPage("m20fire", publishDocOf([]), { plan: "pro" });
  await enableBlog(site.pageId);
  await signInAs(context, site.email);
  const id = await seedPost(site.pageId, { title: "Launch day", slug: "launch-day", body: "We are live." });

  await openPost(page, id);
  await page.getByTestId(SCHEDULE_TEST_IDS.open).click();
  const later = new Date(Date.now() + 2 * 3_600_000);
  const local = `${later.getFullYear()}-${String(later.getMonth() + 1).padStart(2, "0")}-${String(later.getDate()).padStart(2, "0")}T${String(later.getHours()).padStart(2, "0")}:00`;
  await fillLocal(page, SCHEDULE_TEST_IDS.time, local);
  await page.getByTestId(SCHEDULE_TEST_IDS.confirm).click();
  await expect(page.getByTestId("post-bar").locator("[data-post-state]")).toHaveText("Scheduled");

  const postUrl = url(site.handle, "/blog/launch-day");
  expect((await page.request.get(postUrl)).status()).toBe(404);

  await makeDue(id);
  const tick = await runSchedules();
  expect(tick.status).toBe(200);
  expect(Number(tick.body.published)).toBeGreaterThanOrEqual(1);
  expect((await schedulesOf(id)).map((row) => row.status)).toEqual(["done"]);

  const live = await page.request.get(postUrl);
  expect(live.status()).toBe(200);
  expect(await live.text()).toContain("We are live.");
  const row = await adminClient().from("content_entries").select("rev").eq("id", id).single();
  const rev = Number(row.data!.rev);
  await runSchedules();
  const again = await adminClient().from("content_entries").select("rev").eq("id", id).single();
  expect(Number(again.data!.rev)).toBe(rev);
  void POST_TEST_IDS;
});
