import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { expectNoHorizontalScroll, url } from "../helpers";

/**
 * The Monthly | Yearly toggle on the plan cards (home page and /pricing), at both projects (phone
 * 390x844, desktop 1440x900). It is two radio buttons and CSS, so every behaviour here is also
 * checked with JavaScript turned off. Yearly is the default view.
 */

const SHOWN = { useInnerText: true };

/** Serious and critical axe violations inside the toggle and the plan cards. */
async function plansViolations(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page }).include("[data-billing-root]").analyze();
  return results.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => String(n.target)).join(" | ")}`);
}

const cards = (page: Page) => page.locator("[data-plan-cards]");
const card = (page: Page, name: string) =>
  cards(page).getByRole("heading", { level: 3, name, exact: true }).locator("xpath=../../..");
const period = (page: Page, name: "Monthly" | "Yearly") => page.getByRole("radio", { name: new RegExp(`^${name}`) });
const label = (page: Page, name: "Monthly" | "Yearly") => page.locator(".bt-option", { hasText: new RegExp(`^${name}`) });

async function expectYearlyView(page: Page) {
  await expect(card(page, "Pro")).toContainText("$5 / month, billed yearly", SHOWN);
  await expect(card(page, "Pro")).toContainText("$60 a year, save $48", SHOWN);
  await expect(card(page, "Pro")).not.toContainText("$9", SHOWN);
  await expect(card(page, "Studio")).toContainText("$15 / month, billed yearly", SHOWN);
  await expect(card(page, "Studio")).toContainText("$180 a year, save $60", SHOWN);
  await expect(card(page, "Studio")).not.toContainText("$20", SHOWN);
}

async function expectMonthlyView(page: Page) {
  await expect(card(page, "Pro")).toContainText("$9 / month", SHOWN);
  await expect(card(page, "Pro")).toContainText("Billed monthly", SHOWN);
  await expect(card(page, "Pro")).not.toContainText("billed yearly", SHOWN);
  await expect(card(page, "Studio")).toContainText("$20 / month", SHOWN);
  await expect(card(page, "Studio")).toContainText("Billed monthly", SHOWN);
  await expect(card(page, "Studio")).not.toContainText("$180", SHOWN);
}

for (const path of ["/", "/pricing"]) {
  test.describe(`billing toggle on ${path}`, () => {
    test("is a labelled radio group, yearly by default, with 44px options", async ({ page }) => {
      await page.goto(url(null, path));
      const group = page.getByRole("group", { name: "Billing period" });
      await expect(group).toHaveCount(1);
      await expect(group.getByRole("radio")).toHaveCount(2);
      await expect(period(page, "Yearly")).toBeChecked();
      await expect(period(page, "Monthly")).not.toBeChecked();
      // The saving is stated on the option, from the numbers in src/lib/marketing/prices.ts.
      await expect(label(page, "Yearly")).toContainText("Save up to 44%");
      for (const name of ["Monthly", "Yearly"] as const) {
        const box = await label(page, name).boundingBox();
        expect(box!.height, `${name} option height`).toBeGreaterThanOrEqual(44);
      }
      await expectYearlyView(page);
      // Free is the same in both views and is never part of the toggle.
      await expect(card(page, "Free")).toContainText("$0", SHOWN);
    });

    test("Monthly shows the monthly prices and Yearly brings the yearly ones back", async ({ page }) => {
      await page.goto(url(null, path));
      await label(page, "Monthly").click();
      await expect(period(page, "Monthly")).toBeChecked();
      await expectMonthlyView(page);
      await expect(card(page, "Free")).toContainText("$0", SHOWN);
      await label(page, "Yearly").click();
      await expect(period(page, "Yearly")).toBeChecked();
      await expectYearlyView(page);
    });

    test("works without JavaScript, by mouse and by keyboard", async ({ browser, isMobile }) => {
      const context = await browser.newContext({
        javaScriptEnabled: false,
        viewport: isMobile ? { width: 390, height: 844 } : { width: 1440, height: 900 },
        isMobile,
        hasTouch: isMobile,
      });
      const page = await context.newPage();
      await page.goto(url(null, path));
      await expectYearlyView(page);

      await label(page, "Monthly").click();
      await expectMonthlyView(page);

      // Arrow keys move between the two radio buttons, as in any radio group.
      await period(page, "Monthly").focus();
      await page.keyboard.press("ArrowRight");
      await expect(period(page, "Yearly")).toBeChecked();
      await expectYearlyView(page);
      await page.keyboard.press("ArrowLeft");
      await expect(period(page, "Monthly")).toBeChecked();
      await expectMonthlyView(page);
      await context.close();
    });

    test("shows a focus ring on the keyboard-focused option", async ({ page }) => {
      await page.goto(url(null, path));
      await period(page, "Yearly").focus();
      await page.keyboard.press("ArrowLeft");
      const focused: Locator = label(page, "Monthly");
      await expect(focused).toHaveCSS("outline-style", "solid");
      await expect(focused).toHaveCSS("outline-width", "2px");
    });

    test("fits the viewport, and the toggle and cards pass an axe scan in both views", async ({ page }) => {
      await page.goto(url(null, path));
      await expectNoHorizontalScroll(page);
      expect(await plansViolations(page)).toEqual([]);
      await label(page, "Monthly").click();
      await expectNoHorizontalScroll(page);
      expect(await plansViolations(page)).toEqual([]);
    });
  });
}

test("the comparison table lists the monthly and the yearly price side by side", async ({ page }) => {
  await page.goto(url(null, "/pricing"));
  const row = (name: string) => page.getByRole("row", { name: new RegExp(`^${name}`) });
  await expect(row("Price, billed monthly")).toContainText("$9 a month");
  await expect(row("Price, billed monthly")).toContainText("$20 a month");
  await expect(row("Price, billed yearly")).toContainText("$60 a year ($5/mo, billed yearly)");
  await expect(row("Price, billed yearly")).toContainText("$180 a year ($15/mo, billed yearly)");
  // Whatever the toggle says, the table keeps both rows.
  await label(page, "Monthly").click();
  await expect(row("Price, billed yearly")).toContainText("$60 a year ($5/mo, billed yearly)");
});

test("domains are connected, never sold: pricing and domains pages say so", async ({ page }) => {
  await page.goto(url(null, "/pricing"));
  const main = page.locator("main");
  await expect(main).toContainText("HYDLNK doesn’t sell or register domains");
  await expect(main).toContainText("Pro includes 1 custom domain and Studio 15, and SSL is automatic");
  await page.goto(url(null, "/custom-domains"));
  await expect(page.locator("main")).toContainText("HYDLNK doesn’t sell or register domains");
  await expect(page.locator("main")).toContainText("domain you already own");
  await expect(page.locator("main")).toContainText(
    "Connect a domain you already own on Pro, $5/mo, billed yearly.",
  );
});
