import { expect, test } from "@playwright/test";
import { cleanupUsers, signedInUser } from "../fixtures/data";
import { expectNoHorizontalScroll, url } from "../helpers";

/**
 * M9-14 changes documentation and tests only, so the product must look and behave as before: the
 * editor on the app host and the demo tenant page open, draw their content and fit the screen, at
 * 390x844 and at 1440x900.
 */

test.afterAll(cleanupUsers);
test.describe.configure({ timeout: 90_000 });

test("M9-14 the editor opens and fits the screen", async ({ page, context }) => {
  await signedInUser(context, { label: "dp" });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(url("app", "/editor"), { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
  await expectNoHorizontalScroll(page);
  expect(errors).toEqual([]);
});

test("M9-14 the demo tenant page opens, draws its name and fits the screen", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const response = await page.goto(url("mara"), { waitUntil: "networkidle" });
  expect(response?.status()).toBe(200);
  await expect(page.locator("main, [role=main], body").first()).toContainText(/mara/i);
  await expectNoHorizontalScroll(page);
  expect(errors).toEqual([]);
});
