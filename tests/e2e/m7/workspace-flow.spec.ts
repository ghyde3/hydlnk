import { expect, test, type BrowserContext } from "@playwright/test";
import { axeViolations } from "../fixtures/a11y";
import { adminClient } from "../fixtures/auth";
import { addPage, cleanupUsers, desktopOnly, phoneOnly, signedInUser } from "../fixtures/data";
import { NEVER_STORED, appRaw, authCookies, cookieHeader } from "../fixtures/http";
import { expectNoHorizontalScroll, expectTapTargets, url } from "../helpers";
import {
  emptyUser,
  expectDraft,
  mark,
  pageRow,
  saveIndicator,
  setDraft,
} from "../m2/editor-helpers";
import { option } from "../m6/design-helpers";
import { getShare, makeLink, randomIp } from "../m6/pages-helpers";
import {
  DESIGN_URL,
  EDIT_URL,
  SHARE_URL,
  clickTab,
  displayName,
  openTab,
  publishButton,
  tab,
  tablist,
  undoButton,
  type Tab,
} from "./workspace-helpers";

/**
 * M7-02: what the three tabs share. The remount and history checks are workspace-tabs.spec.ts; these
 * are the gate, the failure screens, the one notices area, leaving and coming back, switching pages,
 * a Publish from every tab (and where a refusal takes you), the layout and axe.
 */

// Publish runs a Server Action on a dev server other suites share: allow it time.
test.describe.configure({ timeout: 120_000 });

test.afterAll(cleanupUsers);

const TABS: Tab[] = ["Edit", "Design", "Share"];
const URLS: Record<Tab, string> = { Edit: EDIT_URL, Design: DESIGN_URL, Share: SHARE_URL };
const fault = (context: BrowserContext, name: string) =>
  context.addCookies([{ name: "hl-fault", value: name, url: url("app") }]);

test.describe("M7-02 the gate and the isolation of the three routes", () => {
  test("M7-02 signed out each route answers a redirect to the sign-in page with none of any page's text", async () => {
    for (const path of ["/editor", "/design", "/share"]) {
      const res = await appRaw(path);
      expect([302, 303, 307], path).toContain(res.status);
      expect(new URL(res.location!, "http://app.localhost:3000").pathname, path).toBe("/login");
      for (const text of ["Mara Okafor", "Portrait", "Display name", "Share card", "QR code"]) {
        expect(res.body, `${path} ${text}`).not.toContain(text);
      }
    }
  });

  test("M7-02 a page id of another account in the hl-page cookie shows the user's own page on all three routes", async ({
    page,
    context,
    browser,
  }, info) => {
    test.skip(!desktopOnly(info), "same server logic at both widths");
    const mine = await signedInUser(context, { label: "w7" });
    const otherContext = await browser.newContext();
    const other = await signedInUser(otherContext, { label: "w7o" });
    const secret = `Secret${mark()}`;
    await adminClient()
      .from("pages")
      .update({
        draft: {
          ...(await pageRow(other.pageId)).draft,
          profile: { name: secret, bio: "", photo: null },
        },
      })
      .eq("id", other.pageId);
    await otherContext.close();
    await context.addCookies([{ name: "hl-page", value: other.pageId, url: url("app") }]);
    for (const tabName of TABS) {
      await page.goto(URLS[tabName]);
      await expect(tab(page, tabName)).toHaveAttribute("aria-selected", "true");
      await expect(
        page.locator("main").getByText(`${mine.handle}.hydlnk.com`).first(),
      ).toBeVisible();
      expect(await page.content()).not.toContain(secret);
    }
  });
});

test.describe("M7-02 exactly /share is the Share tab", () => {
  test("M7-02 /share answers 200 with the workspace and is never stored; 70 requests get no 429; /share/{token} is still the private preview", async ({
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "plain HTTP: one project is enough");
    const user = await signedInUser(context, { label: "w7h" });
    const cookie = cookieHeader(await authCookies(context));
    const first = await appRaw("/share", { cookie });
    expect(first.status).toBe(200);
    expect(String(first.headers["cache-control"] ?? "")).toMatch(NEVER_STORED);
    expect(first.body).toContain("Your page address");
    for (let i = 0; i < 70; i++) {
      const res = await appRaw("/share", { cookie });
      expect(res.status, `request ${i + 1}`).not.toBe(429);
    }
    // Signed out: the sign-in page.
    const out = await appRaw("/share");
    expect([302, 303, 307]).toContain(out.status);
    // A token path is the ungated private preview, not the workspace: an unknown token is the 404.
    const token = await appRaw(`/share/${"A".repeat(43)}`);
    expect(token.status).toBe(404);
    expect(token.body).not.toContain("Your page address");
    expect(user.handle).toBeTruthy();
  });
});

test.describe("M7-02 the private preview's internal route is a rewrite target only", () => {
  test("M7-02 /shared-draft asked for directly, even with a real token in a forged header, is the 404 and shows nothing of the draft", async ({
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "plain HTTP: one project is enough");
    const user = await signedInUser(context, { label: "w7x" });
    const link = await makeLink(user.userId, user.pageId);
    // The control: the same token through its public address shows the draft.
    const through = await getShare(link.token, randomIp());
    expect(through.status).toBe(200);
    expect(through.body).toContain(user.handle);
    expect(String(through.headers["x-robots-tag"] ?? "")).toContain("noindex");
    // Directly, on the internal path: the app's plain 404, none of the share treatment, no draft.
    for (const path of ["/shared-draft", "/shared-draft/", `/shared-draft/${link.token}`]) {
      const res = await appRaw(path, {
        headers: { "x-hl-share-token": link.token, "x-forwarded-for": randomIp() },
      });
      // A trailing slash is Next's own redirect to the same path, which is then the 404.
      expect([404, 308], path).toContain(res.status);
      if (res.status === 308) expect(res.location, path).toBe("/shared-draft");
      expect(res.body, path).not.toContain(user.handle);
      expect(res.headers["x-robots-tag"], path).toBeUndefined();
      expect(res.setCookies, path).toEqual([]);
    }
  });
});

test.describe("M7-02 load failures", () => {
  test("M7-02 with the draft unreadable each route is the header, the card and Retry: no toolbar, tabs or preview", async ({
    page,
    context,
  }) => {
    const user = await signedInUser(context, { label: "w7f" });
    await fault(context, "draft-load");
    for (const tabName of TABS) {
      await page.goto(URLS[tabName]);
      await expect(page.getByTestId("load-failure")).toHaveText(
        "We couldn’t load your page. Try again.",
      );
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
      await expect(page.locator("main > header p")).toHaveText(`${user.handle}.hydlnk.com`);
      const retry = page.getByRole("button", { name: "Retry", exact: true });
      expect((await retry.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await expect(tablist(page)).toHaveCount(0);
      await expect(page.getByTestId("preview-bezel")).toHaveCount(0);
      await expect(page.getByTestId("mini-phone")).toHaveCount(0);
      await expect(page.locator("[data-testid='workspace-toolbar']")).toHaveCount(0);
      expect(await page.content()).not.toMatch(/Injected fault/);
    }
    await context.clearCookies({ name: "hl-fault" });
    await page.getByRole("button", { name: "Retry", exact: true }).click();
    await expect(tablist(page)).toBeVisible();
  });

  test("M7-02 with only the themes unreadable the workspace works; the Design tab's Themes card says so with its own Retry", async ({
    page,
    context,
  }) => {
    await signedInUser(context, { label: "w7t" });
    await fault(context, "themes-load");
    await openTab(page, "Edit");
    await expect(
      page.getByTestId("preview-bezel").or(page.getByTestId("mini-phone")),
    ).toBeVisible();
    await clickTab(page, "Share");
    await expect(page.getByTestId("address-card")).toBeVisible();
    await clickTab(page, "Design");
    await expect(page.getByText("We couldn’t load your themes. Try again.")).toBeVisible();
    // The other controls and the preview still work.
    await option(page, "Corner radius", "20px").click();
    await expect(option(page, "Corner radius", "20px")).toHaveAttribute("aria-pressed", "true");
    await context.clearCookies({ name: "hl-fault" });
    await page.getByRole("button", { name: "Retry", exact: true }).click();
    await expect(page.getByText("We couldn’t load your themes. Try again.")).toHaveCount(0);
  });
});

test.describe("M7-02 one notices area", () => {
  test("M7-02 a failing save shows one banner on every tab, never a second copy", async ({
    page,
    context,
  }) => {
    await signedInUser(context, { label: "w7n" });
    await openTab(page, "Edit");
    await page.route("**/rest/v1/pages?*", (route) =>
      route.request().method() === "PATCH" ? route.abort("failed") : route.continue(),
    );
    await displayName(page).fill(`Banner ${mark()}`);
    const banner = page.locator("[data-save-problem]");
    await expect(banner).toHaveCount(1, { timeout: 20_000 });
    await expect(banner).toHaveText(/Couldn’t save\. Your changes stay here and will retry\./);
    for (const tabName of ["Design", "Share", "Edit"] as const) {
      await clickTab(page, tabName);
      await expect(banner).toHaveCount(1);
      await expect(saveIndicator(page)).toHaveCount(1);
    }
    // The banner sits under the toolbar (on a phone, under the pinned row and the tabs) and above the tab's content.
    const note = (await banner.boundingBox())!;
    const panel = (await page.getByRole("tabpanel").boundingBox())!;
    expect(panel.y).toBeGreaterThanOrEqual(note.y + note.height - 1);
    const pinned = await page.evaluate(() =>
      Math.max(
        ...Array.from(document.querySelectorAll("[data-toolbar-pin]")).map((el) => {
          const rect = el.getBoundingClientRect();
          return rect.height > 0 ? rect.bottom : 0;
        }),
      ),
    );
    expect(note.y).toBeGreaterThanOrEqual(pinned - 1);
  });
});

test.describe("M7-02 leaving, coming back and switching pages", () => {
  test("M7-02 an edit typed as you click Analytics is written; the history is gone when you come back", async ({
    page,
    context,
  }, info) => {
    const user = await signedInUser(context, { label: "w7l" });
    await openTab(page, "Edit");
    const before = (await pageRow(user.pageId)).draft.profile.name;
    await displayName(page).click();
    await page.keyboard.press("End");
    await page.keyboard.type(" X");
    const nav = phoneOnly(info)
      ? page.getByRole("navigation", { name: "App sections" })
      : page.getByRole("navigation", { name: "App", exact: true });
    await nav.getByRole("link", { name: /^(Analytics|Stats)$/ }).click();
    await expect(page).toHaveURL(url("app", "/analytics"));
    await expectDraft(user.pageId, (d) => d.profile.name === `${before} X`);
    // Away from the left edge, where Next's dev indicator sits over the first tab on a phone.
    const editor = nav.getByRole("link", { name: "Editor" });
    const box = (await editor.boundingBox())!;
    await editor.click({ position: { x: box.width - 8, y: box.height / 2 } });
    await expect(displayName(page)).toHaveValue(`${before} X`);
    await expect(undoButton(page)).toHaveAttribute("aria-disabled", "true");
    await clickTab(page, "Design");
    if (desktopOnly(info)) {
      await expect(page.getByTestId("preview-screen").locator("h1")).toContainText(" X");
    }
  });

  test("M7-02 choosing another page keeps the tab, flushes the first page, and starts clean", async ({
    page,
    context,
  }) => {
    const user = await signedInUser(context, { label: "w7p", plan: "pro" });
    const secondHandle = `zq-w7p2-${mark().toLowerCase()}`.slice(0, 28);
    const secondId = await addPage(user.userId, secondHandle);
    const admin = adminClient();
    await admin.from("pages").update({ name: "AlphaPage" }).eq("id", user.pageId);
    await admin.from("pages").update({ name: "BetaPage" }).eq("id", secondId);
    await openTab(page, "Design");
    await expect(page.getByRole("heading", { level: 1 }).first()).toHaveText("AlphaPage");
    await option(page, "Corner radius", "20px").click();
    await expect(undoButton(page)).toHaveAttribute("aria-disabled", "false");

    const switcher = page
      .getByRole("button", { name: /^Switch site, current:/ })
      .filter({ visible: true });
    await switcher.click();
    await page.getByRole("menuitemradio", { name: new RegExp(secondHandle) }).click();
    await expect(page).toHaveURL(DESIGN_URL);
    await expect(tab(page, "Design")).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("heading", { level: 1 }).first()).toHaveText("BetaPage");
    await expect(undoButton(page)).toHaveAttribute("aria-disabled", "true");
    // None of the first page's text is on screen (the switcher's list of pages is not the workspace).
    expect(await page.getByTestId("workspace").innerText()).not.toContain("AlphaPage");
    // The first page's edit was written before it was left.
    await expectDraft(user.pageId, (d) => d.theme.overrides.radius === 20);
    await expect(option(page, "Corner radius", "20px")).toHaveAttribute(
      "aria-pressed",
      /^(false)$/,
    );
  });
});

test.describe("M7-02 rename, Publish and the stale-tab guard", () => {
  test("M7-02 typing and renaming at once loses nothing and shows no stale-tab error; the next edit after a Publish is saved", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "the rename button is in the desktop toolbar row");
    const user = await signedInUser(context, { label: "w7r" });
    await openTab(page, "Edit");
    await displayName(page).click();
    await page.keyboard.press("End");
    await page.keyboard.type(" X");
    await page.getByRole("button", { name: "Rename site" }).click();
    await page.getByLabel("Site name").fill("Renamed here");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1 }).first()).toHaveText("Renamed here");
    await expect(saveIndicator(page)).toHaveText("Saved", { timeout: 20_000 });
    await expect(
      page.getByText("This page changed in another tab. Reload to keep editing."),
    ).toHaveCount(0);
    await expect(undoButton(page)).toHaveAttribute("aria-disabled", "false");
    const row = await pageRow(user.pageId);
    expect(row.draft.profile.name.endsWith(" X")).toBe(true);

    await publishButton(page).click();
    await expect(page.locator("[data-publish-status]")).toHaveAttribute(
      "data-publish-status",
      "published",
      {
        timeout: 30_000,
      },
    );
    const text = mark();
    await displayName(page).click();
    await page.keyboard.press("End");
    await page.keyboard.type(text);
    await expect(saveIndicator(page)).toHaveText("Saved", { timeout: 20_000 });
    await expectDraft(user.pageId, (d) => d.profile.name.endsWith(text));
  });

  test("M7-02 Publish works from every tab, with the toast and the chip on that tab", async ({
    page,
    context,
  }) => {
    const user = await signedInUser(context, { label: "w7b" });
    await openTab(page, "Design");
    await option(page, "Corner radius", "20px").click();
    await publishButton(page).click();
    await expect(page.locator("[data-publish-status]")).toHaveAttribute(
      "data-publish-status",
      "published",
      {
        timeout: 30_000,
      },
    );
    await expect(page.getByText("Published.")).toBeVisible();
    expect(
      ((await pageRow(user.pageId)).published as { tokens: { radius: number } }).tokens.radius,
    ).toBe(20);
    await expect(page.getByRole("button", { name: "Done" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Done" })).toHaveCount(0);

    await clickTab(page, "Share");
    await page.getByLabel("Title", { exact: true }).fill("Shared title");
    await publishButton(page).click();
    await expect(page.locator("[data-publish-status]")).toHaveAttribute(
      "data-publish-status",
      "published",
      {
        timeout: 30_000,
      },
    );
    expect((await pageRow(user.pageId)).published).toMatchObject({
      share: { title: "Shared title" },
    });
  });

  test("M7-02 a Publish the gate refuses takes you to the tab that holds what failed", async ({
    page,
    context,
  }) => {
    const user = await emptyUser(context, "w7g");
    const draft = (await pageRow(user.pageId)).draft;
    await setDraft(user.pageId, {
      ...draft,
      blocks: [{ id: "Lk0Empty0001", type: "link", visible: true, label: "Empty", url: "" }],
    });
    await openTab(page, "Design");
    await publishButton(page).click();
    await expect(page).toHaveURL(EDIT_URL);
    await expect(tab(page, "Edit")).toHaveAttribute("aria-selected", "true");
    await expect(
      page.getByRole("alert").filter({ hasText: "Fix 1 block before publishing." }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Dismiss" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Fix 1 block" })).toHaveCount(0);

    // A share title that is too long goes to the Share tab, focused on Title.
    await setDraft(user.pageId, {
      ...draft,
      blocks: [],
      share: { title: "t".repeat(71), description: "", image: null },
    });
    await page.goto(EDIT_URL);
    await publishButton(page).click();
    await expect(page).toHaveURL(SHARE_URL);
    await expect(page.getByLabel("Title", { exact: true })).toBeFocused();
  });
});

test.describe("M7-02 layout", () => {
  test("M7-02 the bezel and the content column are where they should be and the bezel does not move between tabs", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "the preview column is the desktop layout");
    await signedInUser(context, { label: "w7y" });
    await openTab(page, "Edit");
    const bezel = page.getByTestId("preview-bezel");
    const first = (await bezel.boundingBox())!;
    expect([Math.round(first.width), Math.round(first.height)]).toEqual([310, 660]);
    for (const tabName of ["Design", "Share", "Edit"] as const) {
      await clickTab(page, tabName);
      const box = (await bezel.boundingBox())!;
      expect(box).toEqual(first);
      const panel = (await page.getByRole("tabpanel").boundingBox())!;
      expect(panel.width).toBeLessThanOrEqual(720);
      expect((await page.getByTestId("workspace-preview").boundingBox())!.width).toBe(330);
    }
    for (const width of [1000, 800]) {
      await page.setViewportSize({ width, height: 900 });
      for (const tabName of TABS) {
        await clickTab(page, tabName);
        await expectNoHorizontalScroll(page);
      }
    }
  });

  test("M7-02 a theme applied on Design reaches the preview in the same frame", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "the bezel is the desktop layout");
    await signedInUser(context, { label: "w7s" });
    await openTab(page, "Design");
    const before = await page
      .getByTestId("preview-screen")
      .locator("[data-page-root]")
      .evaluate((el) => getComputedStyle(el).getPropertyValue("--t-bg"));
    await page
      .getByRole("button", { name: /^Paper/ })
      .first()
      .click();
    await expect(page.locator("[data-publish-status]")).toHaveAttribute(
      "data-publish-status",
      "unpublished-changes",
    );
    const after = await page
      .getByTestId("preview-screen")
      .locator("[data-page-root]")
      .evaluate((el) => getComputedStyle(el).getPropertyValue("--t-bg"));
    expect(after).not.toBe(before);
  });

  test("M7-02 on a phone the tabs sit under the pinned row, nothing scrolls sideways and every target is 44px", async ({
    page,
    context,
  }, info) => {
    test.skip(!phoneOnly(info), "phone layout");
    await signedInUser(context, { label: "w7m" });
    for (const tabName of TABS) {
      await openTab(page, tabName);
      await expectNoHorizontalScroll(page);
      await expectTapTargets(page, "[data-testid='workspace']");
      for (const link of await tablist(page).getByRole("tab").all()) {
        expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      }
    }
  });
});

test.describe("M7-02 accessibility", () => {
  for (const tabName of TABS) {
    test(`M7-02 axe finds nothing serious on the ${tabName} tab`, async ({ page, context }) => {
      await signedInUser(context, { label: "w7x" });
      await openTab(page, tabName);
      expect(await axeViolations(page)).toEqual([]);
    });
  }

  test("M7-02 focus order follows the visual order and a focused tab shows the brass outline", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "keyboard order is measured on the desktop layout");
    await signedInUser(context, { label: "w7k" });
    await openTab(page, "Edit");
    await page.locator("body").click({ position: { x: 5, y: 5 } });
    const stops: string[] = [];
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press("Tab");
      const where = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el) return "none";
        if (el.closest("[data-testid='workspace-toolbar']")) return "toolbar";
        if (el.closest("[role='tablist']")) return "tabs";
        if (el.closest("[role='tabpanel']")) return "content";
        return "other";
      });
      stops.push(where);
    }
    const order = stops.filter(
      (value, index) => stops.indexOf(value) === index && value !== "other",
    );
    expect(order.indexOf("toolbar")).toBeLessThan(order.indexOf("content"));
    // The tabs are in the toolbar's row (they are reached with the toolbar), before the content.
    expect(stops.indexOf("content")).toBeGreaterThan(stops.indexOf("toolbar"));
    await tab(page, "Edit").focus();
    expect(await tab(page, "Edit").evaluate((el) => getComputedStyle(el).outlineColor)).toBe(
      "rgb(184, 145, 79)",
    );
    expect(await tab(page, "Edit").evaluate((el) => getComputedStyle(el).outlineWidth)).toBe("2px");
  });
});
