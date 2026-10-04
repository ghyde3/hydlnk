import { expect, type Locator, type Page } from "@playwright/test";
import { newBlockId, type Block } from "@/lib/document";
import { url } from "../helpers";

/**
 * Shared setup for the toolbar and mini phone specs (M7-05, M7-09). Every test makes its own user
 * (the phone and desktop projects run at once); nothing here touches mara's rows.
 */

export type Tab = "Edit" | "Design" | "Share";
export const ROUTES: Record<Tab, string> = {
  Edit: url("app", "/editor"),
  Design: url("app", "/design"),
  Share: url("app", "/share"),
};
export const TABS: readonly Tab[] = ["Edit", "Design", "Share"];

/** The bar the workspace keeps in place across tabs: a 56px sticky box from 760px up, `display: contents` below. */
export const toolbar = (page: Page): Locator => page.getByTestId("workspace-toolbar");
/** The controls row: the 52px sticky row on a phone, the right part of the bar from 760px up. */
export const toolbarRow = (page: Page): Locator => page.getByTestId("workspace-toolbar-row");
export const tabsPin = (page: Page): Locator => page.getByTestId("workspace-tabs-pin");
export const tablist = (page: Page): Locator => page.getByRole("tablist", { name: "Workspace" });
export const tabLink = (page: Page, name: Tab): Locator =>
  tablist(page).getByRole("tab", { name, exact: true });
export const publishButton = (page: Page): Locator =>
  page.getByRole("button", { name: /^Publish(ing\.\.\.)?$/ });
export const undoButton = (page: Page): Locator => page.locator("[data-history-button='undo']");
export const redoButton = (page: Page): Locator => page.locator("[data-history-button='redo']");
export const chip = (page: Page): Locator => page.locator("[data-publish-status]");
export const saveStatus = (page: Page): Locator => page.locator("[data-save-status]");
export const displayName = (page: Page): Locator =>
  page.getByLabel("Display name", { exact: true });
export const miniPhone = (page: Page): Locator => page.getByTestId("mini-phone");
export const sheet = (page: Page): Locator => page.getByRole("dialog", { name: "Live preview" });
export const closePreview = (page: Page): Locator =>
  page.getByRole("button", { name: "Close preview" });

/** Opens a workspace tab and waits until the toolbar is interactive (hydrated). */
export async function openTab(page: Page, name: Tab): Promise<void> {
  await page.goto(ROUTES[name]);
  await expect(tabLink(page, name)).toHaveAttribute("aria-selected", "true");
  await page.waitForFunction(() => {
    const button = document.querySelector("[data-history-button]");
    return !!button && Object.keys(button).some((key) => key.startsWith("__reactProps$"));
  });
  if (name === "Edit") await expect(displayName(page)).toBeVisible();
}

/** A soft navigation to another tab: nothing reloads. */
export async function clickTab(page: Page, name: Tab): Promise<void> {
  await tabLink(page, name).click();
  await expect(tabLink(page, name)).toHaveAttribute("aria-selected", "true");
}

export async function box(locator: Locator) {
  const b = await locator.boundingBox();
  if (!b) throw new Error("element has no box");
  return b;
}

export const css = (locator: Locator, property: string) =>
  locator.evaluate((el, prop) => getComputedStyle(el).getPropertyValue(prop), property);

/** `n` text blocks with ids, for the scroll tests. */
export function textBlocks(n: number): Block[] {
  return Array.from({ length: n }, (_, i) => ({
    id: newBlockId(),
    type: "text",
    visible: true,
    text: `Line ${i + 1} of the long page`,
  })) as Block[];
}

/** The page cannot be scrolled sideways. */
export async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({
    scrollWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
    innerWidth: window.innerWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(innerWidth);
}

/** Every button, input and link inside `scope` that is drawn: at least 44px tall (icon-only ones 44px wide too). */
export async function expectTouchTargets(scope: Locator): Promise<void> {
  const offenders = await scope.evaluate((root) => {
    const bad: string[] = [];
    for (const el of root.querySelectorAll<HTMLElement>(
      "button, a[href], input, select, textarea",
    )) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      const label = el.getAttribute("aria-label") ?? el.textContent?.trim() ?? el.tagName;
      if (rect.height < 43.5) bad.push(`${label}: ${Math.round(rect.height)}px tall`);
      const icon = (el.textContent ?? "").trim() === "";
      if (icon && rect.width < 43.5) bad.push(`${label}: ${Math.round(rect.width)}px wide`);
    }
    return bad;
  });
  expect(offenders).toEqual([]);
}

/** Records the PATCH requests to the pages table (the autosave write). */
export function countSaves(page: Page): { count: () => number } {
  let n = 0;
  page.on("request", (request) => {
    if (request.method() === "PATCH" && /\/rest\/v1\/pages/.test(request.url())) n += 1;
  });
  return { count: () => n };
}
