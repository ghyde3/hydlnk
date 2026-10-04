import { expect, test, type Locator, type Page } from "@playwright/test";
import { axeViolations } from "../fixtures/a11y";
import { cleanupUsers, desktopOnly } from "../fixtures/data";
import { expectNoHorizontalScroll, expectTapTargets } from "../helpers";
import {
  emptyUser,
  expectDraft,
  openEditor,
  pageRow,
  previewScreen,
  seededUser,
} from "../m2/editor-helpers";
import { undoButton } from "./workspace-helpers";

/**
 * M7-03: the Profile card is short. The photo row, the display name and the bio stay in view; the
 * photo's shape, size and border and the three show switches are under one collapsed button,
 * 'Photo and header options'.
 */

test.afterAll(cleanupUsers);

const card = (page: Page): Locator => page.getByTestId("profile-card");
const toggle = (page: Page): Locator =>
  card(page).getByRole("button", { name: /^Photo and header options/ });
const region = (page: Page): Locator =>
  card(page).getByRole("region", { name: "Photo and header options" });
const control = (page: Page, name: string): Locator =>
  card(page).getByRole("button", { name, exact: true });

const SIX = ["Show photo on page", "Show display name on page", "Show bio on page"] as const;
const GROUPS = ["Photo shape", "Photo size", "Photo border"] as const;

test.describe("M7-03 Profile card with a collapsed options section", () => {
  test("M7-03 collapsed on load: only the photo row, name, bio and one button; the six controls are out of the tree", async ({
    page,
    context,
  }) => {
    await seededUser(context, "pf");
    await openEditor(page);
    await expect(card(page).getByRole("heading", { level: 2, name: "Profile" })).toBeVisible();
    await expect(card(page).getByText("Shown at the top of your page")).toBeVisible();
    await expect(card(page).getByRole("button", { name: /^(Upload|Replace) photo/ })).toBeVisible();
    await expect(page.getByLabel("Display name", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Bio", { exact: true })).toBeVisible();

    const button = toggle(page);
    await expect(button).toHaveAttribute("aria-expanded", "false");
    expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    const controls = await button.getAttribute("aria-controls");
    expect(controls).toBeTruthy();
    expect(await page.locator(`[id="${controls!}"]`).count()).toBe(1);
    expect(await button.locator("svg").getAttribute("aria-hidden")).toBe("true");
    await expect(page.locator(`[id="${controls!}"]`)).toHaveAttribute("hidden", "");

    for (const name of SIX) await expect(control(page, name)).toBeHidden();
    for (const name of GROUPS) {
      await expect(card(page).getByRole("group", { name, exact: true })).toBeHidden();
    }
    // Not focusable either: tabbing from the bio goes to the logo's button (M9-24 put the logo between
    // the bio and the options button; its placement control is disabled without a logo), then to
    // the options button, then past the card.
    await page.getByLabel("Bio", { exact: true }).focus();
    await page.keyboard.press("Tab");
    await expect(
      card(page)
        .getByTestId("profile-logo")
        .getByRole("button", { name: /^(Upload|Replace) logo/ }),
    ).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(button).toBeFocused();
  });

  test("M7-03 click, Enter and Space open and close it; focus stays on the button; the six controls show in order", async ({
    page,
    context,
  }) => {
    await seededUser(context, "pf");
    await openEditor(page);
    const button = toggle(page);
    await button.click();
    await expect(button).toHaveAttribute("aria-expanded", "true");
    await expect(region(page)).toBeVisible();
    // The switch, the three groups, then the two switches, in this order.
    const order = await region(page).evaluate((root) =>
      [
        ...root.querySelectorAll("[role='group'], button[aria-pressed]:not([role='group'] button)"),
      ].map((el) =>
        el.getAttribute("role") === "group"
          ? el.getAttribute("aria-label")!
          : el.textContent!.trim(),
      ),
    );
    expect(order).toEqual([
      "Show photo on page",
      "Photo shape",
      "Photo size",
      "Photo border",
      "Show display name on page",
      "Show bio on page",
    ]);
    for (const name of GROUPS) {
      await expect(region(page).getByRole("group", { name, exact: true })).toBeVisible();
    }
    await expect(button).toBeFocused();

    await page.keyboard.press("Enter");
    await expect(button).toHaveAttribute("aria-expanded", "false");
    await expect(button).toBeFocused();
    await page.keyboard.press("Space");
    await expect(button).toHaveAttribute("aria-expanded", "true");
    await expect(button).toBeFocused();
    await page.keyboard.press("Space");
    await expect(button).toHaveAttribute("aria-expanded", "false");
    // Not remembered: a reload is collapsed again.
    await button.click();
    await page.reload();
    await expect(toggle(page)).toHaveAttribute("aria-expanded", "false");
  });

  test("M7-03 nothing is hidden without saying so: the second line follows every switch, undo and redo", async ({
    page,
    context,
  }) => {
    const user = await seededUser(context, "pf");
    await openEditor(page);
    const button = toggle(page);
    await expect(button).toHaveAccessibleName("Photo and header options");
    await expect(button.getByText(/Hidden on your page/)).toHaveCount(0);

    await button.click();
    await control(page, "Show display name on page").click();
    await control(page, "Show photo on page").click();
    await button.click();
    await expect(
      button.getByText("Hidden on your page: photo, name", { exact: true }),
    ).toBeVisible();
    await expect(button).toHaveAccessibleName(
      "Photo and header options Hidden on your page: photo, name",
    );
    await button.click();
    await control(page, "Show bio on page").click();
    await control(page, "Show photo on page").click();
    await button.click();
    await expect(button.getByText("Hidden on your page: name, bio", { exact: true })).toBeVisible();

    // An undo takes the last step back at once (bio, then the photo switch).
    await undoButton(page).click();
    await undoButton(page).click();
    await expect(
      button.getByText("Hidden on your page: photo, name", { exact: true }),
    ).toBeVisible();
    await undoButton(page).click();
    await undoButton(page).click();
    await expect(button.getByText(/Hidden on your page/)).toHaveCount(0);
    await page.keyboard.press("ControlOrMeta+Shift+Z");
    await expect(button.getByText("Hidden on your page: name", { exact: true })).toBeVisible();
    await expectDraft(user.pageId, (draft) => draft.profile.showName === false);
    // One part reads 'bio'.
    await button.click();
    await control(page, "Show display name on page").click();
    await control(page, "Show bio on page").click();
    await button.click();
    await expect(button.getByText("Hidden on your page: bio", { exact: true })).toBeVisible();
  });

  test("M7-03 the collapsed card is much shorter than the open one", async ({ page, context }) => {
    await seededUser(context, "pf");
    await openEditor(page);
    const collapsed = (await card(page).boundingBox())!.height;
    await toggle(page).click();
    const open = (await card(page).boundingBox())!.height;
    expect(open - collapsed).toBeGreaterThanOrEqual(200);
    expect(collapsed / open).toBeLessThanOrEqual(0.65);
    await expectNoHorizontalScroll(page);
    await expectTapTargets(page, '[data-testid="profile-card"]');
    // No label is clipped with the section open.
    const clipped = await card(page)
      .locator("button")
      .evaluateAll(
        (buttons) =>
          buttons.filter((b) => (b as HTMLElement).scrollWidth > (b as HTMLElement).clientWidth + 1)
            .length,
      );
    expect(clipped).toBe(0);
  });

  test("M7-03 opening and closing sends no request, adds no undo step and leaves rev alone", async ({
    page,
    context,
  }) => {
    const user = await seededUser(context, "pf");
    await openEditor(page);
    const before = (await pageRow(user.pageId)).draft;
    const requests: string[] = [];
    page.on("request", (request) => {
      if (
        !/\/_next\/|fonts\.googleapis|fonts\.gstatic|\.(css|js|woff2?|png|svg)(\?|$)/.test(
          request.url(),
        )
      ) {
        requests.push(`${request.method()} ${request.url()}`);
      }
    });
    await expect(undoButton(page)).toHaveAttribute("aria-disabled", "true");
    for (let i = 0; i < 5; i++) {
      await toggle(page).click();
      await toggle(page).click();
    }
    await expect(undoButton(page)).toHaveAttribute("aria-disabled", "true");
    await expect(page.locator("[data-publish-status]")).toHaveAttribute(
      "data-publish-status",
      "published",
    );
    expect(requests.filter((r) => !r.includes("_rsc"))).toEqual([]);
    expect((await pageRow(user.pageId)).draft.rev).toBe(before.rev);
    // Open, change a switch, close, Undo: the change is undone as usual.
    await toggle(page).click();
    await control(page, "Show bio on page").click();
    await toggle(page).click();
    await undoButton(page).click();
    await expect(toggle(page).getByText(/Hidden on your page/)).toHaveCount(0);
  });

  test("M7-03 a tap on the avatar, name or bio in the preview still works with the section collapsed", async ({
    page,
    context,
  }, info) => {
    test.skip(
      !desktopOnly(info),
      "the preview column is the desktop layout; the phone's sheet is M7-09",
    );
    await seededUser(context, "pf");
    await openEditor(page);
    await expect(toggle(page)).toHaveAttribute("aria-expanded", "false");
    const screen = previewScreen(page);
    await screen.locator("[data-profile-part='name']").click();
    await expect(page.getByLabel("Display name", { exact: true })).toBeFocused();
    await screen.locator("[data-profile-part='bio']").click();
    await expect(page.getByLabel("Bio", { exact: true })).toBeFocused();
    await screen.locator("[data-profile-part='avatar']").click();
    await expect(card(page).getByRole("button", { name: /^(Upload|Replace) photo/ })).toBeFocused();
    await expect(toggle(page)).toHaveAttribute("aria-expanded", "false");
  });

  test("M7-03 a draft with bad values opens with the defaults, the notice, collapsed and with no summary", async ({
    page,
    context,
  }) => {
    await emptyUser(context, "pf", {
      draft: {
        v: 1,
        rev: 1,
        profile: { name: "Zed", bio: "", photo: null, showName: "false", photoShape: "blob" },
        theme: { ref: null, overrides: {} },
        blocks: [],
      },
    });
    await openEditor(page);
    await expect(page.getByText(/Some content couldn’t be read/)).toBeVisible();
    await expect(toggle(page)).toHaveAttribute("aria-expanded", "false");
    await expect(toggle(page).getByText(/Hidden on your page/)).toHaveCount(0);
    await toggle(page).click();
    await expect(control(page, "Show display name on page")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(
      card(page)
        .getByRole("group", { name: "Photo shape", exact: true })
        .getByRole("button", { name: "Circle" }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  test("M7-03 axe finds nothing serious with the section collapsed and with it open", async ({
    page,
    context,
  }) => {
    await seededUser(context, "pf");
    await openEditor(page);
    expect(await axeViolations(page)).toEqual([]);
    await toggle(page).click();
    await expect(region(page)).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);
  });

  test("M7-03 the inputs above do not move when the section opens", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "measured at 1440px");
    await seededUser(context, "pf");
    await openEditor(page);
    const name = page.getByLabel("Display name", { exact: true });
    const bio = page.getByLabel("Bio", { exact: true });
    const before = [(await name.boundingBox())!, (await bio.boundingBox())!];
    await toggle(page).click();
    const after = [(await name.boundingBox())!, (await bio.boundingBox())!];
    expect(after).toEqual(before);
    const column = (await card(page).boundingBox())!;
    expect(column.width).toBeLessThanOrEqual(720);
    for (const group of GROUPS) {
      const box = (await region(page)
        .getByRole("group", { name: group, exact: true })
        .boundingBox())!;
      expect(box.x + box.width).toBeLessThanOrEqual(column.x + column.width);
    }
  });
});
