import { expect, test, type Locator, type Page } from "@playwright/test";
import { url } from "../helpers";

/**
 * M11-01 steps 2 to 4 on the home page: the hero's looks advance on their own and hold on hover; a
 * pick, even a click on the checked tab, stops them and the control offers Play; Play resumes;
 * reduced motion never advances. How it works and the carousel counter are checked here too. The
 * six second cycle is shortened by overriding --sp-cycle on the hero.
 */

const hero = (page: Page) => page.locator(".sp-hero");
const radios = (page: Page) => hero(page).locator('input[name="sp-look"]');

async function checkedIndex(page: Page) {
  return radios(page).evaluateAll((els) => els.findIndex((el) => (el as HTMLInputElement).checked));
}

async function open(page: Page) {
  const response = await page.goto(url(null, "/"));
  expect(response?.status()).toBe(200);
}

async function shorten(page: Page) {
  await expect(hero(page)).toHaveAttribute("data-cycle", "on");
  await hero(page).evaluate((el) => el.style.setProperty("--sp-cycle", "400ms"));
}

/** Waits until the checked look differs from `from`. */
async function expectAdvances(page: Page, from: number) {
  await expect.poll(() => checkedIndex(page), { timeout: 5000 }).not.toBe(from);
}

/** The look stays on `at` for well over one shortened cycle. */
async function expectStays(page: Page, at: number) {
  await page.waitForTimeout(1500);
  expect(await checkedIndex(page)).toBe(at);
}

async function awayFromHero(page: Page) {
  await page.mouse.move(2, 2);
}

test.describe("M11-01 hero look cycle", () => {
  test("advances on its own, holds on hover, a pick stops it and Play resumes", async ({
    page,
  }) => {
    await open(page);
    await awayFromHero(page);
    await shorten(page);
    const control = hero(page).locator(".sp-cycle");
    await expect(control).toContainText("Pause");

    await expectAdvances(page, 0);

    // Hover holds.
    await hero(page).hover({ position: { x: 20, y: 120 } });
    await expect(hero(page)).toHaveAttribute("data-held", "");
    await expectStays(page, await checkedIndex(page));
    await awayFromHero(page);
    await expect(hero(page)).not.toHaveAttribute("data-held", "");
    const before = await checkedIndex(page);
    await expectAdvances(page, before);

    // A click on the checked tab is a pick: it stops the cycle and the control offers Play.
    const checked = await checkedIndex(page);
    await hero(page).locator(".sp-tab").nth(checked).click();
    await awayFromHero(page);
    await expect(control).toContainText("Play");
    await expectStays(page, checked);

    // Play resumes, even though the pointer is over the hero and the button has focus.
    await control.click();
    await expect(control).toContainText("Pause");
    await expectAdvances(page, checked);
  });

  test("picking another tab stops it for good", async ({ page }) => {
    await open(page);
    await awayFromHero(page);
    await shorten(page);
    await expect(hero(page).locator(".sp-cycle")).toContainText("Pause");
    await hero(page).locator(".sp-tab").nth(2).click();
    await awayFromHero(page);
    await expect(radios(page).nth(2)).toBeChecked();
    await expect(hero(page).locator(".sp-cycle")).toContainText("Play");
    await expectStays(page, 2);
  });

  test.describe("reduced motion", () => {
    test.use({ reducedMotion: "reduce" });

    test("never advances and shows no control", async ({ page }) => {
      await open(page);
      await awayFromHero(page);
      await expect(hero(page).locator(".sp-cycle")).toBeHidden();
      await expect(hero(page)).not.toHaveAttribute("data-cycle", /.*/);
      await hero(page).evaluate((el) => el.style.setProperty("--sp-cycle", "400ms"));
      await expectStays(page, 0);
    });
  });
});

test.describe("M11-01 how it works and the setups counter", () => {
  test("how it works names the headline and three time cues", async ({ page }) => {
    await open(page);
    const band = page.locator("#how-title").locator("xpath=ancestor::section[1]");
    await expect(
      page.getByRole("heading", { level: 2, name: "From a name to a live page in minutes." }),
    ).toBeVisible();
    for (const cue of ["Takes seconds", "A few minutes", "A minute or two"]) {
      await expect(band.getByText(cue, { exact: true })).toBeVisible();
    }
  });

  test("the carousel counter changes after Next", async ({ page }) => {
    await open(page);
    const section = page.locator("#see-it");
    await section.scrollIntoViewIfNeeded();
    const counter: Locator = section.locator("[aria-live='polite']");
    const shape = /^\d+( to \d+)? of 12$/;
    await expect(counter).toHaveText(shape);
    const first = (await counter.textContent())!;
    await section.getByRole("button", { name: "Next setups" }).click();
    await expect(counter).not.toHaveText(first);
    await expect(counter).toHaveText(shape);
  });
});
