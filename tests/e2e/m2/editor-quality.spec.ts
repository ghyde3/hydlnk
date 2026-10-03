import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { cleanupUsers, phoneOnly } from "../fixtures/data";
import { openEditor, rowOf, seededUser } from "./editor-helpers";

/** The editor as a whole: no console errors or hydration warnings, and no serious axe violations. */

test.afterAll(cleanupUsers);

/** Serious and critical axe violations (the Next.js dev overlay is not part of the product). */
async function violations(page: import("@playwright/test").Page): Promise<string[]> {
  const results = await new AxeBuilder({ page }).exclude("nextjs-portal").analyze();
  return results.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => String(n.target)).join(" | ")}`);
}

test("M2-03 the editor loads and works with no console errors or hydration warnings", async ({
  page,
  context,
}, info) => {
  const problems: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" || /hydrat/i.test(message.text())) {
      problems.push(`${message.type()}: ${message.text().slice(0, 200)}`);
    }
  });
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message.slice(0, 200)}`));
  await seededUser(context, "q1");
  await openEditor(page);
  await rowOf(page, "Bt5rJ1fGz6Os").locator("button[aria-expanded]").first().click();
  await page.getByRole("button", { name: "Card", exact: true }).click();
  if (phoneOnly(info)) await page.getByRole("tab", { name: "Preview" }).click();
  await page.waitForTimeout(1500);
  expect(problems).toEqual([]);
});

test("M2-03 axe finds no serious or critical violations in the editor (blocks and preview)", async ({
  page,
  context,
}, info) => {
  await seededUser(context, "q2");
  await openEditor(page);
  await rowOf(page, "Bt5rJ1fGz6Os").locator("button[aria-expanded]").first().click();
  const found = await violations(page);
  if (phoneOnly(info)) {
    await page.getByRole("tab", { name: "Preview" }).click();
    found.push(...(await violations(page)));
  }
  expect(found).toEqual([]);
});
