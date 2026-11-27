import { expect, test } from "@playwright/test";
import type { Block } from "@/lib/document";
import { cleanupUsers } from "../fixtures/data";
import { expectNoHorizontalScroll } from "../helpers";
import { publishDocOf, publishedPage } from "../m2/blocks-helpers";
import { minutesFromNow } from "./scheduling-helpers";

/**
 * M20-03 at 390x844 and 1440x900: a live Home with one link that started an hour ago and one that
 * ended an hour ago shows only the first, on the handle host; nothing hides the second (it is not
 * in the HTML at all).
 */

test.afterAll(cleanupUsers);

test("M20-03 only the link inside its window is on the live page", async ({ page }) => {
  const started: Block = {
    id: "lnkStartedE2E",
    type: "link",
    visible: true,
    label: "Doors are open",
    url: "https://example.com/open",
    schedule: { from: minutesFromNow(-60) },
  } as Block;
  const ended: Block = {
    id: "lnkEndedE2E1",
    type: "link",
    visible: true,
    label: "Early bird tickets",
    url: "https://example.com/early",
    schedule: { from: minutesFromNow(-180), until: minutesFromNow(-60) },
  } as Block;
  const site = await publishedPage("m20win", publishDocOf([started, ended]), { plan: "pro" });

  const response = await page.goto(site.url);
  expect(response?.status()).toBe(200);
  const html = await response!.text();
  expect(html).toContain("lnkStartedE2E");
  expect(html).not.toContain("lnkEndedE2E1");
  expect(html).not.toContain("Early bird tickets");
  await expect(page.getByRole("link", { name: "Doors are open" })).toBeVisible();
  await expect(page.getByText("Early bird tickets")).toHaveCount(0);
  await expectNoHorizontalScroll(page);
});
