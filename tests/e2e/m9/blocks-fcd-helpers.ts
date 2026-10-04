import { expect, type Locator, type Page } from "@playwright/test";
import { adminClient } from "../fixtures/auth";

/**
 * Shared bits of the FAQ, contact and discount-code specs (M9-16, M9-17, M9-18, M9-19): dialogs
 * and policy violations a page raises, the wait for a Publish, and a block's own markup.
 */

/** Messages of every dialog the page opens (they are dismissed, so a page cannot stall on one). */
export function trackDialogs(page: Page): string[] {
  const dialogs: string[] = [];
  page.on("dialog", (dialog) => {
    dialogs.push(dialog.message());
    void dialog.dismiss();
  });
  return dialogs;
}

/** Starts collecting `securitypolicyviolation` events in every document the page loads. */
export async function trackViolations(page: Page): Promise<() => Promise<string[]>> {
  await page.addInitScript(() => {
    (window as unknown as { __violations: string[] }).__violations = [];
    document.addEventListener("securitypolicyviolation", (event) => {
      (window as unknown as { __violations: string[] }).__violations.push(
        `${event.violatedDirective} ${event.blockedURI}`,
      );
    });
  });
  return () =>
    page.evaluate(() => (window as unknown as { __violations?: string[] }).__violations ?? []);
}

/** The page is drawn and quiet. */
export async function settled(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle");
  await expect(page.locator("[data-page-root]")).toBeVisible();
}

/** Presses Publish and waits until the page row says it was published. */
export async function publishFromEditor(page: Page, pageId: string): Promise<void> {
  await page.getByRole("button", { name: "Publish", exact: true }).first().click();
  await expect
    .poll(
      async () =>
        (await adminClient().from("pages").select("published_at").eq("id", pageId).single()).data
          ?.published_at,
      { timeout: 20_000 },
    )
    .not.toBeNull();
}

/** The `outerHTML` of the element with `data-block-id` inside `scope`. */
export const outerOf = (scope: Locator, id: string): Promise<string> =>
  scope.locator(`[data-block-id="${id}"]`).evaluate((el) => el.outerHTML);

export async function publishedOf(pageId: string): Promise<{
  published: Record<string, unknown> | null;
  published_at: string | null;
}> {
  const { data, error } = await adminClient()
    .from("pages")
    .select("published, published_at")
    .eq("id", pageId)
    .single();
  if (error) throw new Error(error.message);
  return data as never;
}

/** Heights of every element the locator matches. */
export const heightsOf = (locator: Locator): Promise<number[]> =>
  locator.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height));
