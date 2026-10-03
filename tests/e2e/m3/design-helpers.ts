import { expect, type Locator, type Page } from "@playwright/test";
import { adminClient } from "../fixtures/auth";
import { url } from "../helpers";
import { pageRow, waitForEditorHydrated } from "../m2/editor-helpers";

/**
 * Shared setup for the Design screen specs (M3-01 .. M3-10). Every writing spec makes its own user
 * with a copy of mara's published page (`seededUser`): the phone and desktop projects run at the
 * same time and share mara's rows, so mara is only ever read here.
 */

export const DESIGN_URL = url("app", "/design");

/** Waits until the screen's controls have React handlers: the server-rendered markup shows first. */
export async function waitForDesignHydrated(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const button = document.querySelector("button[aria-label='Accent Brass']");
    return !!button && Object.keys(button).some((key) => key.startsWith("__reactProps$"));
  });
}

/** Opens the Design screen and waits until it is interactive. On a phone the Tokens tab is open. */
export async function openDesign(page: Page): Promise<void> {
  await page.goto(DESIGN_URL);
  await expect(page.getByRole("heading", { level: 1, name: "Design" })).toBeVisible();
  await waitForDesignHydrated(page);
}

export async function reloadDesign(page: Page): Promise<void> {
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Design" })).toBeVisible();
  await waitForDesignHydrated(page);
}

export const isPhone = (page: Page): boolean => (page.viewportSize()?.width ?? 1440) < 760;

/** On a phone the preview is a tab: open it. A no-op at 760px and up, where it is always shown. */
export async function showPreview(page: Page): Promise<void> {
  if (isPhone(page)) await page.getByRole("tab", { name: "Preview" }).click();
}

export async function showTokens(page: Page): Promise<void> {
  if (isPhone(page)) await page.getByRole("tab", { name: "Style" }).click();
}

export const previewScreen = (page: Page): Locator => page.getByTestId("preview-screen");
export const previewRoot = (page: Page): Locator => previewScreen(page).locator("[data-page-root]");
export const saveStatus = (page: Page): Locator => page.locator("[data-save-status]");

export const computed = (locator: Locator, property: string): Promise<string> =>
  locator.evaluate((el, prop) => getComputedStyle(el).getPropertyValue(prop), property);

/** Waits until the stored draft's page-level overrides satisfy `check`. */
export async function expectOverrides(
  pageId: string,
  check: (overrides: Record<string, unknown>) => unknown,
  message = "the stored draft overrides",
): Promise<Record<string, unknown>> {
  let last: Record<string, unknown> = {};
  await expect
    .poll(
      async () => {
        const row = await pageRow(pageId);
        last = (row.draft.theme.overrides ?? {}) as Record<string, unknown>;
        try {
          return Boolean(check(last));
        } catch {
          return false;
        }
      },
      { message, timeout: 15_000 },
    )
    .toBe(true);
  return last;
}

/** Sets the draft's page-level overrides directly (secret key, test setup only). */
export async function setOverrides(
  pageId: string,
  overrides: Record<string, unknown>,
): Promise<void> {
  const row = await pageRow(pageId);
  const draft = { ...row.draft, theme: { ...row.draft.theme, overrides } };
  const { error } = await adminClient().from("pages").update({ draft }).eq("id", pageId);
  if (error) throw new Error(`setOverrides failed: ${error.message}`);
}

/** The values of every `--t-*` custom property on `root` that the two token systems share. */
export async function tokenVars(root: Locator): Promise<Record<string, string>> {
  return root.evaluate((el) => {
    const out: Record<string, string> = {};
    const style = (el as HTMLElement).style;
    for (let i = 0; i < style.length; i++) {
      const name = style.item(i);
      if (name.startsWith("--t-")) out[name] = style.getPropertyValue(name).trim();
    }
    return out;
  });
}

/** The editor header's Publish button. */
export const publishButton = (page: Page): Locator =>
  page.locator("main > header").getByRole("button", { name: "Publish", exact: true });

/** Publishes the current draft from the editor and waits for the "Published" chip. */
export async function publishFromEditor(page: Page): Promise<void> {
  await page.goto(url("app", "/editor"));
  await expect(page.getByLabel("Display name", { exact: true })).toBeVisible();
  // Server-rendered markup shows before React attaches; a click before that is swallowed on a loaded machine.
  await waitForEditorHydrated(page);
  await publishButton(page).click();
  await expect(page.locator("[data-publish-status]")).toHaveText("Published", { timeout: 20_000 });
}

/** The live page's HTML for a tenant handle (raw request, no browser cache). */
export async function liveHtml(handle: string): Promise<string> {
  const { rawRequest } = await import("../fixtures/http");
  const response = await rawRequest(`${handle}.localhost:3000`, "/");
  expect(response.status).toBe(200);
  return response.body;
}
