import { expect, test, type Page } from "@playwright/test";
import { cleanupUsers, desktopOnly } from "../fixtures/data";
import {
  dialogOf,
  emptyPageUser,
  openDialog,
  openEditor,
  rect,
  startButton,
} from "../m7/templates-helpers";

/**
 * M9-06, the page behind the template dialog: it neither scrolls nor shifts, with classic 15px
 * scrollbars on, so Radix's scroll-lock compensation is the path under test and not the hidden
 * scrollbars of headless Chromium. Its own file because the launch option is the file's.
 */

// Headless Chromium hides scrollbars (`--hide-scrollbars`); this file draws classic ones.
test.use({ launchOptions: { ignoreDefaultArgs: ["--hide-scrollbars"] } });
test.describe.configure({ timeout: 120_000 });
test.afterAll(cleanupUsers);

const closeButton = (page: Page) =>
  dialogOf(page).getByRole("button", { name: "Close", exact: true });

/** Classic scrollbars, as on Windows and Linux: headless Chromium draws none unless it is told to. */
async function forceClassicScrollbars(page: Page): Promise<void> {
  await page.addStyleTag({
    content:
      "::-webkit-scrollbar { width: 15px; height: 15px; } ::-webkit-scrollbar-thumb { background: #888; }",
  });
}

test("M9-06 the page behind does not scroll (wheel, keyboard) and nothing shifts, even with 15px classic scrollbars: scrollY, the toolbar and the column are the same open and closed", async ({
  page,
  context,
}, info) => {
  test.skip(
    !desktopOnly(info),
    "wheel and keyboard are the desktop's inputs; the phone's touch is below",
  );
  await emptyPageUser(context, "td8");
  await openEditor(page);
  await forceClassicScrollbars(page);
  await page.evaluate(() => {
    document.documentElement.style.minHeight = "2600px";
  });
  // Scrolled so that the button that opens the dialog sits mid-screen: Playwright scrolls a button that
  // is near an edge into view before it clicks, which would move the page by itself (and did, once
  // the Edit tab grew taller). Whatever the height of the cards above it, the page is scrolled and
  // the click does not move it.
  const startTop = await startButton(page).evaluate(
    (el) => el.getBoundingClientRect().top + window.scrollY,
  );
  const scrolled = Math.max(300, Math.round(startTop - 450));
  await page.evaluate((y) => window.scrollTo(0, y), scrolled);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(scrolled);
  const column = page.getByRole("main").first();
  const toolbar = page.getByTestId("workspace-toolbar");
  const closed = { toolbar: await rect(toolbar), column: await rect(column), scrollY: scrolled };
  expect(await page.evaluate(() => window.innerWidth - document.documentElement.clientWidth)).toBe(
    15,
  );

  await openDialog(page);
  const open = { toolbar: await rect(toolbar), column: await rect(column) };
  for (const key of ["x", "y", "width", "height"] as const) {
    expect(Math.abs(open.toolbar[key] - closed.toolbar[key]), `toolbar ${key}`).toBeLessThanOrEqual(
      0.5,
    );
    expect(Math.abs(open.column[key] - closed.column[key]), `column ${key}`).toBeLessThanOrEqual(
      0.5,
    );
  }
  expect(await page.evaluate(() => window.scrollY)).toBe(closed.scrollY);

  // Wheel and keyboard over the dialog scroll the dialog, not the page.
  await page.mouse.move(720, 450);
  await page.mouse.wheel(0, 600);
  await page.keyboard.press("End");
  await page.keyboard.press("PageDown");
  expect(await page.evaluate(() => window.scrollY)).toBe(closed.scrollY);
  // Even over the dimmed margin the page does not move.
  await page.mouse.move(8, 8);
  await page.mouse.wheel(0, 600);
  expect(await page.evaluate(() => window.scrollY)).toBe(closed.scrollY);

  await closeButton(page).click();
  await expect(dialogOf(page)).toHaveCount(0);
  const back = { toolbar: await rect(toolbar), column: await rect(column) };
  for (const key of ["x", "y", "width", "height"] as const) {
    expect(
      Math.abs(back.toolbar[key] - closed.toolbar[key]),
      `toolbar ${key} after`,
    ).toBeLessThanOrEqual(0.5);
    expect(
      Math.abs(back.column[key] - closed.column[key]),
      `column ${key} after`,
    ).toBeLessThanOrEqual(0.5);
  }
  expect(await page.evaluate(() => window.scrollY)).toBe(closed.scrollY);
});
