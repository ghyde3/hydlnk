import { expect, type Locator, type Page } from "@playwright/test";
import { url } from "../helpers";
import { waitForEditorHydrated } from "../m2/editor-helpers";

/** The three workspace routes (M7-02) on the app host. */
export const EDIT_URL = url("app", "/editor");
export const DESIGN_URL = url("app", "/design");
export const SHARE_URL = url("app", "/share");

export type Tab = "Edit" | "Design" | "Share";
const URLS: Record<Tab, string> = { Edit: EDIT_URL, Design: DESIGN_URL, Share: SHARE_URL };

export const tablist = (page: Page): Locator => page.getByRole("tablist", { name: "Workspace" });
export const tab = (page: Page, name: Tab): Locator =>
  tablist(page).getByRole("tab", { name, exact: true });

/** Opens a workspace tab and waits until it is interactive (rendered and hydrated). */
export async function openTab(page: Page, name: Tab): Promise<void> {
  await page.goto(URLS[name]);
  await expect(tab(page, name)).toHaveAttribute("aria-selected", "true");
  if (name === "Edit") {
    await expect(page.getByLabel("Display name", { exact: true })).toBeVisible();
    await waitForEditorHydrated(page);
  }
  await page.waitForFunction(() => {
    const button = document.querySelector("[data-history-button]");
    return !!button && Object.keys(button).some((key) => key.startsWith("__reactProps$"));
  });
  // The preview is drawn once the viewport is known (just after hydration): the bezel from 760px up.
  if ((page.viewportSize()?.width ?? 1440) >= 760) {
    await expect(page.getByTestId("preview-bezel")).toBeVisible();
  }
}

/** Goes to another tab with a click (a soft navigation: nothing reloads). */
export async function clickTab(page: Page, name: Tab): Promise<void> {
  await tab(page, name).click();
  await expect(tab(page, name)).toHaveAttribute("aria-selected", "true");
}

/** Tags the page's window and two workspace nodes so a test can tell a remount from a soft navigation. */
export async function tagNodes(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as Record<string, unknown>).__sentinel = "alive";
    document.querySelector("[data-testid='workspace']")?.setAttribute("data-sentinel", "shell");
    document.querySelector("[data-testid='preview-bezel']")?.setAttribute("data-sentinel", "bezel");
  });
}

export async function sentinels(page: Page) {
  return page.evaluate(() => ({
    window: (window as unknown as Record<string, unknown>).__sentinel ?? null,
    shell:
      document.querySelector("[data-testid='workspace']")?.getAttribute("data-sentinel") ?? null,
    bezel:
      document.querySelector("[data-testid='preview-bezel']")?.getAttribute("data-sentinel") ??
      null,
  }));
}

export const displayName = (page: Page): Locator =>
  page.getByLabel("Display name", { exact: true });
export const undoButton = (page: Page): Locator => page.locator("[data-history-button='undo']");
export const redoButton = (page: Page): Locator => page.locator("[data-history-button='redo']");
export const publishButton = (page: Page): Locator =>
  page.getByRole("button", { name: /^Publish(ing\.\.\.)?$/ });
