import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { SHOWN_PRICES } from "../fixtures/prices";
import { expectNoHorizontalScroll, url } from "../helpers";
import { pagesPerSiteCell, sitesText } from "@/lib/marketing/plan-limits";
import { monthlyText, perMonthBilledYearlyText, yearlyText } from "@/lib/marketing/prices";

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
const period = (page: Page, name: "Monthly" | "Yearly") =>
  page.getByRole("radio", { name: new RegExp(`^${name}`) });
const label = (page: Page, name: "Monthly" | "Yearly") =>
  page.locator(".bt-option", { hasText: new RegExp(`^${name}`) });

async function expectYearlyView(page: Page) {
  await expect(card(page, "Pro")).toContainText(SHOWN_PRICES.yearlyHeadline("pro"), SHOWN);
  await expect(card(page, "Pro")).toContainText(SHOWN_PRICES.yearlyNote("pro"), SHOWN);
  await expect(card(page, "Pro")).not.toContainText(SHOWN_PRICES.monthlyAmount("pro"), SHOWN);
  await expect(card(page, "Studio")).toContainText(SHOWN_PRICES.yearlyHeadline("studio"), SHOWN);
  await expect(card(page, "Studio")).toContainText(SHOWN_PRICES.yearlyNote("studio"), SHOWN);
  await expect(card(page, "Studio")).not.toContainText(SHOWN_PRICES.monthlyAmount("studio"), SHOWN);
}

async function expectMonthlyView(page: Page) {
  await expect(card(page, "Pro")).toContainText(SHOWN_PRICES.monthlyHeadline("pro"), SHOWN);
  await expect(card(page, "Pro")).toContainText("Billed monthly", SHOWN);
  await expect(card(page, "Pro")).not.toContainText("billed yearly", SHOWN);
  await expect(card(page, "Studio")).toContainText(SHOWN_PRICES.monthlyHeadline("studio"), SHOWN);
  await expect(card(page, "Studio")).toContainText("Billed monthly", SHOWN);
  await expect(card(page, "Studio")).not.toContainText(SHOWN_PRICES.yearlyAmount("studio"), SHOWN);
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
      // The saving is stated on the option, derived from the price table.
      await expect(label(page, "Yearly")).toContainText(SHOWN_PRICES.saveUpTo);
      for (const name of ["Monthly", "Yearly"] as const) {
        const box = await label(page, name).boundingBox();
        expect(box!.height, `${name} option height`).toBeGreaterThanOrEqual(44);
      }
      await expectYearlyView(page);
      // Free is the same in both views and is never part of the toggle.
      await expect(card(page, "Free")).toContainText(SHOWN_PRICES.free, SHOWN);
    });

    test("Monthly shows the monthly prices and Yearly brings the yearly ones back", async ({
      page,
    }) => {
      await page.goto(url(null, path));
      await label(page, "Monthly").click();
      await expect(period(page, "Monthly")).toBeChecked();
      await expectMonthlyView(page);
      await expect(card(page, "Free")).toContainText(SHOWN_PRICES.free, SHOWN);
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

    test("fits the viewport, and the toggle and cards pass an axe scan in both views", async ({
      page,
    }) => {
      await page.goto(url(null, path));
      await expectNoHorizontalScroll(page);
      expect(await plansViolations(page)).toEqual([]);
      await label(page, "Monthly").click();
      await expectNoHorizontalScroll(page);
      expect(await plansViolations(page)).toEqual([]);
    });
  });
}

test("the comparison table lists the monthly and the yearly price side by side", async ({
  page,
}) => {
  await page.goto(url(null, "/pricing"));
  const row = (name: string) => page.getByRole("row", { name: new RegExp(`^${name}`) });
  const yearly = (plan: "pro" | "studio") =>
    `${yearlyText(plan)} (${perMonthBilledYearlyText(plan)})`;
  await expect(row("Price, billed monthly")).toContainText(monthlyText("pro"));
  await expect(row("Price, billed monthly")).toContainText(monthlyText("studio"));
  await expect(row("Price, billed yearly")).toContainText(yearly("pro"));
  await expect(row("Price, billed yearly")).toContainText(yearly("studio"));
  // Whatever the toggle says, the table keeps both rows.
  await label(page, "Monthly").click();
  await expect(row("Price, billed yearly")).toContainText(yearly("pro"));
});

test("domains are connected, never sold: pricing and domains pages say so", async ({ page }) => {
  await page.goto(url(null, "/pricing"));
  const main = page.locator("main");
  await expect(main).toContainText("HYDLNK doesn’t sell or register domains");
  await expect(main).toContainText(
    "Pro includes 1 custom domain and Studio 15, and SSL is automatic",
  );
  await page.goto(url(null, "/custom-domains"));
  await expect(page.locator("main")).toContainText("HYDLNK doesn’t sell or register domains");
  await expect(page.locator("main")).toContainText("domain you already own");
  await expect(page.locator("main")).toContainText(
    `Connect a domain you already own on Pro, ${perMonthBilledYearlyText("pro")}.`,
  );
});

test("M11-11 pricing shows sites per plan and pages per site from the limits table, with no sideways scroll", async ({
  page,
}) => {
  await page.goto(url(null, "/pricing"));
  const row = (name: string) => page.getByRole("row", { name: new RegExp(`^${name}`) });
  for (const [name, plan] of [
    ["Free", "free"],
    ["Pro", "pro"],
    ["Studio", "studio"],
  ] as const) {
    await expect(row("Sites").locator(`[data-plan="${name}"]`)).toHaveText(
      sitesText(plan).split(" ")[0]!,
    );
    await expect(row("Pages per site").locator(`[data-plan="${name}"]`)).toHaveText(
      pagesPerSiteCell(plan),
    );
  }
  // The limits as the cards say them: the same words, from the same table.
  await expect(page.locator("[data-plan-cards]")).toContainText(sitesText("pro"));
  await expect(page.locator("[data-plan-cards]")).toContainText("Unlimited pages per site");
  await expectNoHorizontalScroll(page);
});
