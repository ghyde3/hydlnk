import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { expectNoHorizontalScroll, expectTapTargets, url } from "../helpers";
import { cleanupUsers, desktopOnly, phoneOnly } from "../fixtures/data";
import { rawRequest } from "../fixtures/http";
import {
  draftWith,
  emptyUser,
  expectDraft,
  mark,
  openEditor,
  pageRow,
  saveIndicator,
  seededUser,
  setDraft,
  statusChip,
} from "../m2/editor-helpers";
import { hidePreviewSheet, showPreviewSheet } from "../m7/phone-preview";

/**
 * M5-15: the Editor's empty, load-failure, signed-out and publish-failure states. Phone project =
 * 390x844, desktop = 1440x900. Every spec makes its own users (nothing here touches mara's rows).
 *
 * The draft is read by the Next.js server, so a Playwright route cannot abort that read. The load
 * failure is switched on with the `hl-fault` cookie (src/lib/testing/faults.ts), which the dev
 * server honours and a production build never does; those specs skip themselves against a
 * production build. The 401 and the publish failure are browser requests (the autosave PATCH to
 * Supabase and the Server Action POST), so they are routed here exactly as the acceptance says.
 */

test.afterAll(cleanupUsers);

const PROD_BUILD = process.env.E2E_PROD_BUILD === "1" || Boolean(process.env.HL_PROD_PORT);
const NAME = (page: Page) => page.getByLabel("Display name", { exact: true });
const publishButton = (page: Page) =>
  page.getByTestId("workspace-toolbar").getByRole("button", { name: "Publish", exact: true });

const LOAD_FAILED = "We couldn’t load your page. Try again.";
const SIGNED_OUT = "You’ve been signed out. Sign in to keep editing.";
const PUBLISH_FAILED = "Couldn’t publish. Your draft is safe. Try again.";

const setFault = (context: BrowserContext, name: string) =>
  context.addCookies([{ name: "hl-fault", value: name, url: url("app") }]);
const clearFault = (context: BrowserContext) => context.clearCookies({ name: "hl-fault" });

/** The banner copy rules from the acceptance: no please, no exclamation marks, no "successfully". */
const expectPlainCopy = (text: string) => {
  expect(text).not.toMatch(/please/i);
  expect(text).not.toContain("!");
  expect(text).not.toMatch(/successfully/i);
};

const hiddenLink = (id: string, label: string) => ({
  id,
  type: "link",
  visible: false,
  label,
  url: "https://example.com/hidden",
});

test.describe("M5-15 a page with nothing to show", () => {
  test("M5-15 all blocks hidden: the list says so, the preview is profile-only, and Publish serves a 200 profile-only page", async ({
    page,
    context,
  }) => {
    const user = await emptyUser(context, "ah");
    const label = `Hidden${mark()}`;
    await setDraft(
      user.pageId,
      draftWith(user.handle, [
        hiddenLink("hid000000001", label),
        hiddenLink("hid000000002", `${label}b`),
      ]),
    );
    await openEditor(page);
    await expect(page.getByTestId("all-hidden")).toHaveText(
      "All blocks are hidden. Turn one on to show it.",
    );
    // Both rows are still in the list (hidden, not deleted).
    await expect(page.locator("li[data-block-id]")).toHaveCount(2);

    // The preview shows the profile and none of the hidden blocks.
    const phone = phoneOnly(test.info());
    if (phone) await showPreviewSheet(page);
    const preview = page.getByTestId("preview-screen");
    await expect(preview).toContainText(user.handle);
    await expect(preview).not.toContainText(label);
    if (phone) await hidePreviewSheet(page);

    await publishButton(page).click();
    await expect(statusChip(page)).toHaveAttribute("data-publish-status", "published", {
      timeout: 20_000,
    });
    const live = await rawRequest(`${user.handle}.localhost:3000`, "/");
    expect(live.status).toBe(200);
    expect(live.body).toContain(user.handle);
    expect(live.body).not.toContain(label);
    // Stored with no blocks at all: hidden ones are not part of the published form.
    expect(((await pageRow(user.pageId)).published as { blocks: unknown[] }).blocks).toEqual([]);
  });

  test("M5-15 a page with zero blocks still publishes and serves a 200 profile-only page", async ({
    page,
    context,
  }) => {
    const user = await emptyUser(context, "zb");
    await openEditor(page);
    await expect(page.getByText("No blocks yet. Add your first block above.")).toBeVisible();
    await expect(page.getByTestId("all-hidden")).toHaveCount(0);
    await publishButton(page).click();
    await expect(statusChip(page)).toHaveAttribute("data-publish-status", "published", {
      timeout: 20_000,
    });
    const live = await rawRequest(`${user.handle}.localhost:3000`, "/");
    expect(live.status).toBe(200);
    expect(live.body).toContain(user.handle);
  });
});

test.describe("M5-15 the draft cannot be loaded", () => {
  test.skip(PROD_BUILD, "the fault cookie is honoured by the dev server only");

  test("M5-15 an error card with Retry, never a blank screen or error text; Retry loads the editor once the fault is gone", async ({
    page,
    context,
  }) => {
    await emptyUser(context, "lf");
    await setFault(context, "draft-load");
    const response = await page.goto(url("app", "/editor"));
    expect(response?.status()).toBe(200);

    const card = page.getByTestId("load-failure");
    await expect(card).toHaveText(LOAD_FAILED);
    await expect(card).toHaveAttribute("role", "alert");
    await expect(page.getByRole("button", { name: "Retry", exact: true })).toBeVisible();
    // The app shell is still there; the page is not blank, and nothing of the error shows.
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Main page");
    await expect(page.getByRole("navigation", { name: /App/ }).first()).toBeAttached();
    const text = await page.locator("body").innerText();
    expect(text).not.toMatch(/Injected fault|Error:|at \w+ \(|digest|stack/i);
    expectPlainCopy(LOAD_FAILED);

    // Retry while the fault is still on: the same card, no crash.
    await page.getByRole("button", { name: "Retry", exact: true }).click();
    await expect(card).toHaveText(LOAD_FAILED);

    // The fault is lifted: Retry loads the editor.
    await clearFault(context);
    await page.getByRole("button", { name: "Retry", exact: true }).click();
    await expect(NAME(page)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("load-failure")).toHaveCount(0);
  });

  test("M5-15 the load-failure card: no sideways scroll, 44px targets, error colours", async ({
    page,
    context,
  }) => {
    await emptyUser(context, "lfl");
    await setFault(context, "draft-load");
    await page.goto(url("app", "/editor"));
    const card = page.getByTestId("load-failure");
    await expect(card).toBeVisible();
    await expectNoHorizontalScroll(page);
    await expectTapTargets(page);
    // --hl-bad #B23A2B on the text, #E8C4BD on the card's border (DESIGN.md error style).
    expect(await card.evaluate((el) => getComputedStyle(el).color)).toBe("rgb(178, 58, 43)");
    const border = await card.evaluate(
      (el) => getComputedStyle(el.closest("section")!).borderTopColor,
    );
    expect(border).toBe("rgb(232, 196, 189)");
  });
});

test.describe("M5-15 the session ends while editing (the autosave PATCH is refused with 401)", () => {
  /** Answers every autosave PATCH with 401 until `lift()` is called, counting them. */
  async function refuseSaves(page: Page) {
    const state = { patches: 0, refusing: true };
    await page.route("**/rest/v1/pages**", async (route) => {
      if (route.request().method() === "PATCH" && state.refusing) {
        state.patches += 1;
        await route.fulfill({
          status: 401,
          contentType: "application/json",
          body: JSON.stringify({
            code: "PGRST301",
            message: "JWT expired",
            details: null,
            hint: null,
          }),
        });
        return;
      }
      await route.continue();
    });
    return state;
  }

  test("M5-15 the banner says so with a Sign in link, retries stop, the unsaved text stays, and signing in elsewhere saves it", async ({
    page,
    context,
  }) => {
    const user = await emptyUser(context, "so");
    await openEditor(page);
    const state = await refuseSaves(page);

    const text = mark();
    await NAME(page).fill(text);
    const banner = page.locator('[data-save-problem="signed-out"]');
    await expect(banner).toContainText(SIGNED_OUT, { timeout: 15_000 });
    await expect(banner).toHaveAttribute("role", "alert");
    const link = banner.getByRole("link", { name: "Sign in" });
    await expect(link).toHaveAttribute("href", "/login");
    // A new tab, so the text on this screen is not lost to the navigation.
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(saveIndicator(page)).toHaveText("Not saved");
    expectPlainCopy(SIGNED_OUT);

    // No loop: the backoff would have retried at 1 s, 3 s and 7 s. One request, and still one.
    await page.waitForTimeout(4_500);
    expect(state.patches).toBe(1);
    // The text is still on the screen and was never stored.
    await expect(NAME(page)).toHaveValue(text);
    expect((await pageRow(user.pageId)).draft.profile.name).not.toBe(text);

    // More typing while signed out: still no request.
    await NAME(page).fill(`${text}x`);
    await page.waitForTimeout(1_500);
    expect(state.patches).toBe(1);
    await expect(NAME(page)).toHaveValue(`${text}x`);

    // The person signs in again in the other tab and comes back: the tab being visible again tries
    // once more, the edits are stored and the banner goes.
    state.refusing = false;
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await expect(saveIndicator(page)).toHaveText("Saved", { timeout: 20_000 });
    await expect(banner).toHaveCount(0);
    await expectDraft(user.pageId, (draft) => draft.profile.name === `${text}x`);
  });

  test("M5-15 the banner: error colours, a 44px link, no sideways scroll, and the screen still works", async ({
    page,
    context,
  }) => {
    await emptyUser(context, "sol");
    await openEditor(page);
    await refuseSaves(page);
    await NAME(page).fill(mark());
    const banner = page.locator('[data-save-problem="signed-out"]');
    await expect(banner).toBeVisible({ timeout: 15_000 });
    expect(await banner.evaluate((el) => getComputedStyle(el).color)).toBe("rgb(178, 58, 43)");
    expect(await banner.evaluate((el) => getComputedStyle(el).borderTopColor)).toBe(
      "rgb(232, 196, 189)",
    );
    await expectNoHorizontalScroll(page);
    await expectTapTargets(page, "[data-save-problem]");
    const link = (await banner.getByRole("link", { name: "Sign in" }).boundingBox())!;
    expect(link.height).toBeGreaterThanOrEqual(44);

    if (phoneOnly(test.info())) {
      // The banner sits in the page flow above the fixed tab bar and does not cover Publish.
      const bar = (await page.getByRole("navigation", { name: "App sections" }).boundingBox())!;
      const box = (await banner.boundingBox())!;
      expect(box.y + box.height).toBeLessThanOrEqual(bar.y);
      const publish = (await publishButton(page).boundingBox())!;
      const covered = await page.evaluate(
        ({ x, y }) => document.elementFromPoint(x, y)?.textContent ?? "",
        { x: publish.x + publish.width / 2, y: publish.y + publish.height / 2 },
      );
      expect(covered).toContain("Publish");
      // The Blocks | Preview control still works with the banner up.
      await showPreviewSheet(page);
      await expect(page.getByTestId("preview-screen")).toBeVisible();
      await hidePreviewSheet(page);
      await expect(NAME(page)).toBeVisible();
    }
  });
});

test.describe("M5-15 Publish fails on the way (the Server Action answers 500 or the network drops)", () => {
  /** Fails every Server Action POST (after `holdMs`) until `lift()`; counts the POSTs. */
  async function failActions(page: Page, mode: "500" | "abort", holdMs = 0) {
    const state = { actions: 0, failing: true };
    await page.route("**/*", async (route) => {
      const request = route.request();
      if (request.method() === "POST" && request.headers()["next-action"]) {
        state.actions += 1;
        if (state.failing) {
          if (holdMs > 0) await new Promise((r) => setTimeout(r, holdMs));
          if (mode === "abort") await route.abort("connectionreset");
          else
            await route.fulfill({
              status: 500,
              contentType: "text/plain",
              body: "Internal Server Error",
            });
          return;
        }
      }
      await route.continue();
    });
    return state;
  }

  for (const mode of ["500", "abort"] as const) {
    test(`M5-15 ${mode === "500" ? "a 500" : "a dropped connection"}: the inline error with Retry, the chip keeps saying Unpublished changes, the live page is unchanged, Retry publishes`, async ({
      page,
      context,
    }) => {
      const user = await seededUser(context, `pf${mode}`);
      await openEditor(page);
      const before = (await pageRow(user.pageId)).published;
      const liveBefore = await rawRequest(`${user.handle}.localhost:3000`, "/");
      expect(liveBefore.status).toBe(200);

      const edited = `Pf${mark()}`;
      await NAME(page).fill(edited);
      await expect(saveIndicator(page)).toHaveText("Saved", { timeout: 15_000 });
      await expect(statusChip(page)).toHaveAttribute("data-publish-status", "unpublished-changes");

      const state = await failActions(page, mode);
      await publishButton(page).click();
      const notice = page.locator('[data-inline-notice="publish"]');
      await expect(notice).toContainText(PUBLISH_FAILED, { timeout: 20_000 });
      await expect(notice).toHaveAttribute("role", "alert");
      expectPlainCopy(PUBLISH_FAILED);
      const retry = notice.getByRole("button", { name: "Retry", exact: true });
      await expect(retry).toBeVisible();
      expect((await retry.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      // No raw error text, no status code, nothing from the server.
      await expect(notice).not.toContainText(/500|Internal|error/i);

      // The draft is safe, the chip is as it was, the live page is unchanged.
      await expect(statusChip(page)).toHaveAttribute("data-publish-status", "unpublished-changes");
      await expect(publishButton(page)).toBeEnabled();
      expect((await pageRow(user.pageId)).published).toEqual(before);
      expect((await pageRow(user.pageId)).draft.profile.name).toBe(edited);
      const liveDuring = await rawRequest(`${user.handle}.localhost:3000`, "/");
      expect(liveDuring.body).not.toContain(edited);

      // Retry once the failure is gone.
      state.failing = false;
      await retry.click();
      await expect(statusChip(page)).toHaveAttribute("data-publish-status", "published", {
        timeout: 20_000,
      });
      await expect(notice).toHaveCount(0);
      const liveAfter = await rawRequest(`${user.handle}.localhost:3000`, "/");
      expect(liveAfter.body).toContain(edited);
    });
  }

  test("M5-15 a double click while the request is out publishes (and fails) once, not twice", async ({
    page,
    context,
  }) => {
    await seededUser(context, "pfdc");
    await openEditor(page);
    await NAME(page).fill(`Dc${mark()}`);
    await expect(saveIndicator(page)).toHaveText("Saved", { timeout: 15_000 });
    const state = await failActions(page, "500", 700);
    await publishButton(page).dblclick();
    await expect(page.locator('[data-inline-notice="publish"]')).toContainText(PUBLISH_FAILED, {
      timeout: 20_000,
    });
    expect(state.actions).toBe(1);
  });

  test("M5-15 while Retry is publishing it is disabled, so a second press sends nothing", async ({
    page,
    context,
  }) => {
    await seededUser(context, "pfrt");
    await openEditor(page);
    await NAME(page).fill(`Rt${mark()}`);
    await expect(saveIndicator(page)).toHaveText("Saved", { timeout: 15_000 });
    const state = await failActions(page, "500");
    await publishButton(page).click();
    const retry = page
      .locator('[data-inline-notice="publish"]')
      .getByRole("button", { name: "Retry", exact: true });
    await expect(retry).toBeVisible({ timeout: 20_000 });
    expect(state.actions).toBe(1);
    state.failing = false;
    await retry.dblclick();
    await expect(statusChip(page)).toHaveAttribute("data-publish-status", "published", {
      timeout: 20_000,
    });
    expect(state.actions).toBe(2);
  });

  test("M5-15 the publish error: no sideways scroll, 44px targets, and (phone) above the tab bar without covering Publish", async ({
    page,
    context,
  }) => {
    await seededUser(context, "pfl");
    await openEditor(page);
    await NAME(page).fill(`Ly${mark()}`);
    await expect(saveIndicator(page)).toHaveText("Saved", { timeout: 15_000 });
    await failActions(page, "500");
    await publishButton(page).click();
    const notice = page.locator('[data-inline-notice="publish"]');
    await expect(notice).toBeVisible({ timeout: 20_000 });
    await expectNoHorizontalScroll(page);
    await expectTapTargets(page, "[data-inline-notice], [data-testid='workspace-toolbar']");
    expect(await notice.evaluate((el) => getComputedStyle(el).color)).toBe("rgb(178, 58, 43)");
    expect(await notice.evaluate((el) => getComputedStyle(el).borderTopColor)).toBe(
      "rgb(232, 196, 189)",
    );
    if (phoneOnly(test.info())) {
      const bar = (await page.getByRole("navigation", { name: "App sections" }).boundingBox())!;
      const box = (await notice.boundingBox())!;
      expect(box.y + box.height).toBeLessThanOrEqual(bar.y);
      const publish = (await publishButton(page).boundingBox())!;
      const top = await page.evaluate(
        ({ x, y }) => document.elementFromPoint(x, y)?.textContent ?? "",
        { x: publish.x + publish.width / 2, y: publish.y + publish.height / 2 },
      );
      expect(top).toContain("Publish");
      await showPreviewSheet(page);
      await expect(page.getByTestId("preview-screen")).toBeVisible();
      await hidePreviewSheet(page);
    }
    if (desktopOnly(test.info())) {
      // Desktop: the banner is a column no wider than the editing column (720px), left aligned with it.
      expect((await notice.boundingBox())!.width).toBeLessThanOrEqual(720);
    }
  });
});
