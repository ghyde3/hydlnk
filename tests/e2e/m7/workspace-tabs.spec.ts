import { expect, test } from "@playwright/test";
import { cleanupUsers, desktopOnly, signedInUser } from "../fixtures/data";
import { pageRow, mark } from "../m2/editor-helpers";
import { option } from "../m6/design-helpers";
import {
  DESIGN_URL,
  EDIT_URL,
  SHARE_URL,
  clickTab,
  displayName,
  openTab,
  redoButton,
  sentinels,
  tab,
  tablist,
  tagNodes,
  undoButton,
} from "./workspace-helpers";

test.afterAll(cleanupUsers);

test.describe("M7-02 one workspace", () => {
  test("M7-02 three routes, one tablist, titles and one h1 each", async ({ page, context }) => {
    await signedInUser(context, { label: "ws" });
    const expected = [
      { url: EDIT_URL, tab: "Edit", title: "Editor — HYDLNK" },
      { url: DESIGN_URL, tab: "Design", title: "Design — HYDLNK" },
      { url: SHARE_URL, tab: "Share", title: "Share — HYDLNK" },
    ] as const;
    for (const route of expected) {
      const response = await page.goto(route.url);
      expect(response?.status()).toBe(200);
      await expect(page).toHaveTitle(route.title);
      await expect(tablist(page)).toBeVisible();
      await expect(tablist(page).getByRole("tab")).toHaveCount(3);
      await expect(tablist(page).locator("[aria-selected='true']")).toHaveCount(1);
      await expect(tab(page, route.tab)).toHaveAttribute("aria-selected", "true");
      // The page's own preview draws a heading and a landmark of its own, inside the frame.
      await expect(page.locator("h1:not([data-page-frame] *)")).toHaveCount(1);
      await expect(page.locator("main:not([data-page-frame] *)")).toHaveCount(1);
      const panel = page.getByRole("tabpanel");
      await expect(panel).toHaveCount(1);
      const controls = await tab(page, route.tab).getAttribute("aria-controls");
      expect(await panel.getAttribute("id")).toBe(controls);
    }
  });

  test("M7-02 tab keys move, wrap and navigate; only the selected tab is in the tab order", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "keyboard model is the same on both; run once");
    await signedInUser(context, { label: "ws" });
    await openTab(page, "Edit");
    await expect(tab(page, "Edit")).toHaveAttribute("tabindex", "0");
    await expect(tab(page, "Design")).toHaveAttribute("tabindex", "-1");
    await tab(page, "Edit").focus();
    await page.keyboard.press("ArrowRight");
    await expect(page).toHaveURL(DESIGN_URL);
    await expect(tab(page, "Design")).toBeFocused();
    await page.keyboard.press("End");
    await expect(page).toHaveURL(SHARE_URL);
    await page.keyboard.press("ArrowRight");
    await expect(page).toHaveURL(EDIT_URL);
    await expect(tab(page, "Edit")).toBeFocused();
    await page.keyboard.press("ArrowLeft");
    await expect(page).toHaveURL(SHARE_URL);
    await page.keyboard.press("Home");
    await expect(page).toHaveURL(EDIT_URL);
    await expect(tab(page, "Edit")).toHaveAttribute("href", "/editor");
  });

  test("M7-02 a tab switch remounts nothing and keeps an unsaved edit", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "the bezel exists from 760px; the phone has the mini phone");
    await signedInUser(context, { label: "ws" });
    await openTab(page, "Edit");
    await tagNodes(page);
    const bezelScreen = page.getByTestId("preview-screen");
    await bezelScreen.evaluate((el) => {
      el.scrollTop = 300;
    });
    const scrolled = await bezelScreen.evaluate((el) => el.scrollTop);
    const requests: string[] = [];
    page.on("request", (request) => {
      const u = request.url();
      if (u.includes("/rest/v1/pages") || u.includes("/storage/v1/")) requests.push(u);
      if (request.resourceType() === "document") requests.push(`document ${u}`);
    });
    const typed = ` ${mark()}`;
    await displayName(page).click();
    await page.keyboard.press("End");
    await page.keyboard.type(typed);
    await clickTab(page, "Design");
    await clickTab(page, "Share");
    await clickTab(page, "Edit");
    expect(await sentinels(page)).toEqual({ window: "alive", shell: "shell", bezel: "bezel" });
    expect(
      Math.abs((await bezelScreen.evaluate((el) => el.scrollTop)) - scrolled),
    ).toBeLessThanOrEqual(1);
    await expect(displayName(page)).toHaveValue(new RegExp(`${typed}$`));
    // The only database traffic is the autosave PATCH of the typed edit, never a read.
    expect(requests.filter((u) => u.startsWith("document"))).toEqual([]);
    expect(requests.filter((u) => u.includes("storage"))).toEqual([]);
  });

  test("M7-02 an edit and a tab switch within 100 ms are one PATCH; Ctrl+Z works in the share Title and the page-name field keeps the browser's undo", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "same logic on both viewports");
    const user = await signedInUser(context, { label: "ws" });
    const patches: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "PATCH" && request.url().includes("/rest/v1/pages")) {
        patches.push(request.postData() ?? "");
      }
    });
    await openTab(page, "Edit");
    const before = (await pageRow(user.pageId)).draft.profile.name;
    await displayName(page).click();
    await page.keyboard.press("End");
    await page.keyboard.type(" Q");
    await tab(page, "Share").click();
    await expect(page.getByLabel("Title", { exact: true })).toBeVisible();
    await expect(page.locator("[data-save-status]")).toHaveText("Saved", { timeout: 20_000 });
    expect(patches).toHaveLength(1);
    expect(JSON.parse(patches[0]!).draft.profile.name).toBe(`${before} Q`);
    await expect(page.getByText("This page changed in another tab")).toHaveCount(0);
    await expect(page.locator("[data-save-status]")).not.toHaveText("Not saved");

    // The app's undo works inside a text field of the draft on another tab (the share Title).
    const title = page.getByLabel("Title", { exact: true });
    await title.fill("Hello");
    await expect(page.locator("[data-save-status]")).toHaveText("Saved", { timeout: 20_000 });
    await title.focus();
    await page.keyboard.press("ControlOrMeta+z");
    await expect(title).toHaveValue("");
    // The page-name field in the toolbar is not part of the draft: the browser's own undo stays.
    await page.getByRole("button", { name: "Rename site" }).click();
    const rename = page.getByLabel("Site name");
    await rename.fill("Typed name");
    await rename.press("ControlOrMeta+z");
    await expect(rename).not.toHaveValue("Typed name");
    expect(await rename.inputValue()).not.toBe("Typed name");
    await rename.press("Escape");
    // The draft was not undone by that: the display name still ends with the edit.
    await tab(page, "Edit").click();
    await expect(displayName(page)).toHaveValue(`${before} Q`);
  });

  test("M7-02 one draft, one history, one save queue across the tabs", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "same logic on both viewports");
    const user = await signedInUser(context, { label: "ws" });
    const patches: { rev: number; keys: string[] }[] = [];
    page.on("request", (request) => {
      if (request.method() === "PATCH" && request.url().includes("/rest/v1/pages")) {
        const body = JSON.parse(request.postData() ?? "{}") as { draft?: { rev?: number } };
        patches.push({ rev: body.draft?.rev ?? -1, keys: Object.keys(body) });
      }
    });
    await openTab(page, "Edit");
    const original = (await pageRow(user.pageId)).draft;
    await displayName(page).click();
    await page.keyboard.press("End");
    await page.keyboard.type(" X");
    await page.waitForTimeout(1500);
    await clickTab(page, "Design");
    // Any control that writes the draft: the Layout card's corner radius.
    await option(page, "Corner radius", "20px").click();
    await page.waitForTimeout(1500);
    await clickTab(page, "Share");
    await page.getByLabel("Title", { exact: true }).fill("Hello");
    await page.waitForTimeout(1500);
    await expect(undoButton(page)).toHaveAttribute("aria-disabled", "false");
    for (let i = 0; i < 3; i++) await undoButton(page).click();
    await expect(page.getByLabel("Title", { exact: true })).toHaveValue("");
    await clickTab(page, "Edit");
    await expect(displayName(page)).toHaveValue(original.profile.name);
    await expect(redoButton(page)).toHaveAttribute("aria-disabled", "false");
    for (let i = 0; i < 3; i++) await redoButton(page).click();
    await expect(displayName(page)).toHaveValue(`${original.profile.name} X`);
    expect(patches.every((p) => p.keys.join() === "draft")).toBe(true);
    const revs = patches.map((p) => p.rev);
    expect(revs).toEqual([...revs].sort((a, b) => a - b));
    expect(new Set(revs).size).toBe(revs.length);
  });
});
