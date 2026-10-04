import { expect, type Page } from "@playwright/test";

/**
 * The phone's preview (M7-09): there are no "Blocks | Preview" or "Style | Preview" tabs any more.
 * The mini phone opens a full-size sheet (a modal dialog named "Live preview") and its "Close
 * preview" button or Escape closes it. These two helpers are what the specs that used to click the
 * phone's Preview tab and then the Blocks or Style tab call instead. At 760px and up the preview is
 * always beside the content, so both are no-ops.
 */

const sheet = (page: Page) => page.getByRole("dialog", { name: "Live preview" });

/**
 * Phone or desktop, from the viewport and never from what is in the DOM: the mini phone mounts one
 * render after hydration, so a phone caller that counted it could see it as absent and return early.
 */
const isPhone = (page: Page): boolean => (page.viewportSize()?.width ?? 1440) < 760;

/** Phone: opens the full-size preview sheet. Desktop: nothing to do. */
export async function showPreviewSheet(page: Page): Promise<void> {
  if (!isPhone(page)) return;
  const phone = page.getByTestId("mini-phone");
  if (!(await sheet(page).isVisible())) {
    await expect(phone).toBeVisible();
    await phone.click();
  }
  await expect(sheet(page)).toBeVisible();
}

/** Phone: closes the sheet if it is open. Desktop: nothing to do. */
export async function hidePreviewSheet(page: Page): Promise<void> {
  if (!isPhone(page)) return;
  if (await sheet(page).isVisible()) {
    await page.getByRole("button", { name: "Close preview" }).click();
    await expect(sheet(page)).toHaveCount(0);
  }
}

/**
 * Runs `read` with the preview showing: on a phone the sheet is opened for it and closed again, so
 * the controls behind the sheet can be used afterwards; from 760px the preview is always there.
 */
export async function inPreviewSheet<T>(page: Page, read: () => Promise<T>): Promise<T> {
  await showPreviewSheet(page);
  try {
    return await read();
  } finally {
    await hidePreviewSheet(page);
  }
}
