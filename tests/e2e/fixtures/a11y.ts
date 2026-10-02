import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";

/**
 * Runs axe-core on the page and returns the serious and critical violations as readable strings
 * (an empty array means the page passes). The Next.js dev overlay (nextjs-portal) is not part of
 * the product, so it is excluded.
 */
export async function axeViolations(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page }).exclude("nextjs-portal").analyze();
  return results.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => String(n.target)).join(" | ")}`);
}
