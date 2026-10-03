import { expect, test, type Page } from "@playwright/test";
import { adminClient } from "../fixtures/auth";
import { cleanupUsers, desktopOnly, makeUser, signedInUser } from "../fixtures/data";
import { expectNoHorizontalScroll, expectTapTargets, url } from "../helpers";
import { openEditor, saveIndicator } from "../m2/editor-helpers";
import { insertPage } from "../fixtures/data";
import {
  INACTIVE,
  captureAction,
  getShare,
  hitLimiter,
  linkRows,
  makeLink,
  randomIp,
  replayAction,
} from "./pages-helpers";

/**
 * M6-12 (and the dialog's side of M6-09): the Share preview dialog in the editor. Every spec makes
 * its own user, so nothing touches mara. Phone project = 390x844, desktop = 1440x900.
 */

test.afterAll(cleanupUsers);

const header = (page: Page) => page.locator("main > header");
const shareButton = (page: Page) => header(page).getByRole("button", { name: "Share preview" });
const dialog = (page: Page) => page.getByRole("dialog");
const field = (page: Page) => dialog(page).getByLabel("Preview link");
const ADDRESS = /^http:\/\/app\.localhost:3000\/share\/[A-Za-z0-9_-]{43}$/;

async function openDialog(page: Page): Promise<void> {
  await shareButton(page).click();
  await expect(dialog(page)).toBeVisible();
}

test.describe("M6-12 the dialog", () => {
  test("M6-12 'Share preview' opens a modal dialog with the words, focus stays inside, Escape and Close return focus to the button", async ({
    page,
    context,
  }) => {
    await signedInUser(context, { label: "dlg" });
    await openEditor(page);
    const button = shareButton(page);
    await expect(button).toBeVisible();
    expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);

    await openDialog(page);
    const box = dialog(page);
    await expect(box).toHaveAttribute("aria-modal", "true");
    await expect(box.getByRole("heading", { level: 2, name: "Share a preview" })).toBeVisible();
    await expect(box).toContainText(
      "Anyone with the link can see your unpublished draft for 7 days. They can’t edit it.",
    );
    await expect(box).toContainText("Shows your latest saved draft.");
    // Focus is inside, and Tab keeps it inside.
    const inside = () =>
      page.evaluate(() => Boolean(document.activeElement?.closest("dialog[open]")));
    expect(await inside()).toBe(true);
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press("Tab");
      expect(await inside()).toBe(true);
    }
    await page.keyboard.press("Escape");
    await expect(box).toBeHidden();
    await expect(button).toBeFocused();

    await openDialog(page);
    await box.getByRole("button", { name: "Close" }).click();
    await expect(box).toBeHidden();
    await expect(button).toBeFocused();
  });

  test("M6-12 Create link writes pending edits first, shows the address once, copies it, offers Share..., and lists the link", async ({
    page,
    context,
    browser,
  }, info) => {
    const owner = await signedInUser(context, { label: "mk" });
    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: url("app") });
    await page.addInitScript(() => {
      (window as unknown as { __shared: unknown[] }).__shared = [];
      Object.defineProperty(navigator, "share", {
        configurable: true,
        value: async (data: unknown) => {
          (window as unknown as { __shared: unknown[] }).__shared.push(data);
        },
      });
    });
    await openEditor(page);

    // An edit made a moment before the click is in the link's page.
    const name = page.getByLabel("Display name", { exact: true });
    const original = await name.inputValue();
    await name.fill(`${original} X`);
    await openDialog(page);
    await dialog(page).getByRole("button", { name: "Create link", exact: true }).click();
    const create = dialog(page).getByRole("button", { name: /Creating\.\.\.|Create link/ });
    await expect(field(page)).toBeVisible();
    const address = await field(page).inputValue();
    expect(address).toMatch(ADDRESS);
    await expect(create).toBeEnabled();

    // The field is read-only and 16px; the words explain the one-time address.
    await expect(field(page)).toHaveAttribute("readonly", "");
    expect(await field(page).evaluate((el) => getComputedStyle(el).fontSize)).toBe("16px");
    const expires = new Date(Date.now() + 7 * 24 * 3600 * 1000).toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    });
    await expect(dialog(page)).toContainText(/This link expires [A-Z][a-z]+ \d{1,2}, 20\d\d\./);
    await expect(dialog(page)).toContainText("This link expires " + expires.replace(/ \d{4}$/, ""));
    await expect(dialog(page)).toContainText("Copy it now. You can’t see this link again.");

    // Copy link: "Copied", a polite live region, and the clipboard holds the full address.
    await dialog(page).getByRole("button", { name: "Copy link" }).click();
    await expect(dialog(page).getByRole("button", { name: "Copied" })).toBeVisible();
    await expect(dialog(page).getByRole("status").filter({ hasText: "Link copied." })).toHaveCount(
      1,
    );
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(address);
    await expect(dialog(page).getByRole("button", { name: "Copy link" })).toBeVisible({
      timeout: 4000,
    });

    // Share... exists where navigator.share does, and hands over the address.
    await dialog(page).getByRole("button", { name: "Share..." }).click();
    expect(
      await page.evaluate(
        () => (window as unknown as { __shared: { url: string }[] }).__shared[0]?.url,
      ),
    ).toBe(address);

    // The link lists as "Created ..., expires ..." with Turn off, and carries no address.
    const rows = dialog(page).locator("[data-preview-link]");
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText(
      /^Created [A-Z][a-z]+ \d{1,2}, expires [A-Z][a-z]+ \d{1,2}/,
    );
    expect(await rows.first().innerHTML()).not.toContain(address.slice(-43));
    expect(
      await rows.first().getByRole("button", { name: "Turn off" }).boundingBox(),
    ).not.toBeNull();

    // The link's page shows the edit.
    const visitor = await browser.newContext({
      ...(info.project.use as object),
      extraHTTPHeaders: { "x-forwarded-for": randomIp() },
    });
    const view = await visitor.newPage();
    await view.goto(address);
    await expect(view.locator("h1")).toHaveText(`${original} X`);
    await visitor.close();
    expect((await linkRows(owner.pageId)).length).toBe(1);
  });

  test("M6-12 Turn off acts at once, says 'Turned off.', and the old address then answers the 404; a shown link is not shown again", async ({
    page,
    context,
  }) => {
    const owner = await signedInUser(context, { label: "off" });
    await openEditor(page);
    await openDialog(page);
    await dialog(page).getByRole("button", { name: "Create link", exact: true }).click();
    await expect(field(page)).toBeVisible();
    const address = await field(page).inputValue();
    const token = address.slice(-43);
    expect((await getShare(token, randomIp())).status).toBe(200);

    const row = dialog(page).locator("[data-preview-link]").first();
    await row.getByRole("button", { name: "Turn off" }).click();
    await expect(row.getByRole("status")).toHaveText("Turned off.");
    // No confirm dialog was in the way, and the next request is the 404.
    const after = await getShare(token, randomIp());
    expect(after.status).toBe(404);
    expect(after.body).toContain(INACTIVE);
    expect((await linkRows(owner.pageId))[0]!.revoked_at).not.toBeNull();

    // Reopening shows no address and no row for the link that is off.
    await dialog(page).getByRole("button", { name: "Close" }).click();
    await expect(dialog(page)).toBeHidden();
    await openDialog(page);
    await expect(dialog(page).getByLabel("Preview link")).toHaveCount(0);
    await expect(dialog(page).locator("[data-preview-link]")).toHaveCount(0);
    expect(await page.content()).not.toContain(token);
  });

  test("M6-12 the address and token live in component state only, and closing the dialog clears them", async ({
    page,
    context,
  }) => {
    await signedInUser(context, { label: "mem" });
    await openEditor(page);
    await openDialog(page);
    await dialog(page).getByRole("button", { name: "Create link", exact: true }).click();
    await expect(field(page)).toBeVisible();
    const token = (await field(page).inputValue()).slice(-43);

    const leaks = async () =>
      page.evaluate((needle) => {
        const where: string[] = [];
        for (const [label, store] of [
          ["localStorage", window.localStorage],
          ["sessionStorage", window.sessionStorage],
        ] as const) {
          for (let i = 0; i < store.length; i++) {
            const key = store.key(i)!;
            if (key.includes(needle) || (store.getItem(key) ?? "").includes(needle))
              where.push(`${label}:${key}`);
          }
        }
        if (document.cookie.includes(needle)) where.push("cookie");
        if (location.href.includes(needle)) where.push("url");
        for (const el of Array.from(document.querySelectorAll("*"))) {
          for (const attr of Array.from(el.attributes)) {
            if (
              attr.value.includes(needle) &&
              !(el instanceof HTMLInputElement && attr.name === "value")
            ) {
              where.push(`attribute ${el.tagName.toLowerCase()}[${attr.name}]`);
            }
          }
        }
        return where;
      }, token);
    expect(await leaks()).toEqual([]);
    expect(
      await page.evaluate(() => Object.keys(window).filter((k) => /token|share/i.test(k))),
    ).toEqual([]);

    await dialog(page).getByRole("button", { name: "Close" }).click();
    await expect(dialog(page)).toBeHidden();
    await expect(page.getByLabel("Preview link")).toHaveCount(0);
    expect(await page.content()).not.toContain(token);
    expect(await leaks()).toEqual([]);
  });
});

test.describe("M6-12 what the dialog says when it cannot", () => {
  test("M6-12 at five active links it says so, 'Create link' is disabled, and Turn off brings the button back", async ({
    page,
    context,
  }) => {
    const owner = await signedInUser(context, { label: "cap" });
    const links = [];
    for (let i = 0; i < 5; i++) links.push(await makeLink(owner.userId, owner.pageId));
    await openEditor(page);
    await openDialog(page);
    const create = dialog(page).getByRole("button", { name: "Create link", exact: true });
    await expect(dialog(page).getByRole("alert")).toHaveText(
      "You have 5 active preview links. Turn one off to make another.",
    );
    await expect(create).toBeDisabled();
    await expect(dialog(page).locator("[data-preview-link]")).toHaveCount(5);

    await dialog(page)
      .locator("[data-preview-link]")
      .first()
      .getByRole("button", { name: "Turn off" })
      .click();
    await expect(create).toBeEnabled();
    await expect(dialog(page).getByRole("alert")).toHaveCount(0);
  });

  test("M6-12 rate limited: 'You’ve created a lot of links. Try again in a while.' and the button stays usable", async ({
    page,
    context,
  }) => {
    const owner = await signedInUser(context, { label: "rl" });
    await hitLimiter(`preview-link:${owner.userId}`, 20, 3600, 20);
    await openEditor(page);
    await openDialog(page);
    await dialog(page).getByRole("button", { name: "Create link", exact: true }).click();
    await expect(dialog(page).getByRole("alert")).toHaveText(
      "You’ve created a lot of links. Try again in a while.",
    );
    await expect(
      dialog(page).getByRole("button", { name: "Create link", exact: true }),
    ).toBeEnabled();
    expect(await linkRows(owner.pageId)).toHaveLength(0);
  });

  test("M6-12 a 5xx and a dropped network say 'Couldn’t create the link. Try again.' with the button enabled again", async ({
    page,
    context,
  }) => {
    const owner = await signedInUser(context, { label: "net" });
    await openEditor(page);
    await openDialog(page);
    const create = dialog(page).getByRole("button", { name: "Create link", exact: true });

    let mode: "500" | "abort" | "pass" = "500";
    await page.route("**/editor", async (route) => {
      const request = route.request();
      if (request.method() !== "POST" || !request.headers()["next-action"]) return route.continue();
      if (mode === "abort") return route.abort("failed");
      if (mode === "500") return route.fulfill({ status: 500, body: "Internal Server Error" });
      return route.continue();
    });
    await create.click();
    await expect(dialog(page).getByRole("alert")).toHaveText(
      "Couldn’t create the link. Try again.",
    );
    await expect(create).toBeEnabled();

    mode = "abort";
    await create.click();
    await expect(dialog(page).getByRole("alert")).toHaveText(
      "Couldn’t create the link. Try again.",
    );
    await expect(create).toBeEnabled();
    expect(await linkRows(owner.pageId)).toHaveLength(0);

    // And it works again once the network does.
    mode = "pass";
    await create.click();
    await expect(field(page)).toBeVisible();
    await expect(dialog(page).getByRole("alert")).toHaveCount(0);
  });

  test("M6-12 signed out: 'You’re signed out. Sign in again, then try again.'", async ({
    page,
    context,
  }) => {
    const owner = await signedInUser(context, { label: "so" });
    await openEditor(page);
    await openDialog(page);
    await context.clearCookies();
    await dialog(page).getByRole("button", { name: "Create link", exact: true }).click();
    await expect(dialog(page).getByRole("alert")).toHaveText(
      "You’re signed out. Sign in again, then try again.",
    );
    expect(await linkRows(owner.pageId)).toHaveLength(0);
  });

  test("M6-12 signed out with an edit still waiting to be saved: the save fails first and the dialog still says so", async ({
    page,
    context,
  }) => {
    const owner = await signedInUser(context, { label: "so2" });
    await openEditor(page);
    const name = page.getByLabel("Display name", { exact: true });
    await name.fill(`${await name.inputValue()} Edit`);
    await context.clearCookies();
    await openDialog(page);
    await dialog(page).getByRole("button", { name: "Create link", exact: true }).click();
    await expect(dialog(page).getByRole("alert")).toHaveText(
      "You’re signed out. Sign in again, then try again.",
    );
    expect(await linkRows(owner.pageId)).toHaveLength(0);
  });

  test("M6-12 a suspended owner sees 'Share preview' disabled with the reason", async ({
    page,
    context,
  }) => {
    const owner = await signedInUser(context, { label: "sus" });
    await adminClient()
      .from("accounts")
      .update({ suspended_at: new Date().toISOString() })
      .eq("id", owner.userId);
    await openEditor(page);
    await expect(shareButton(page)).toBeDisabled();
    await expect(shareButton(page)).toHaveAttribute("title", "Your account is suspended.");
  });
});

test.describe("M6-09 / M6-12 replayed requests and other accounts", () => {
  test("M6-12 a create, a list and a turn off replayed with another user's page or link id answer not_found and change nothing", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "same code path at both widths");
    const mine = await signedInUser(context, { label: "rp1" });
    const theirs = await makeUser("rp2");
    const theirPage = await insertPage(
      theirs.id,
      `zq-rp2-${Math.random().toString(36).slice(2, 7)}`,
    );
    const theirLink = await makeLink(theirs.id, theirPage);

    await openEditor(page);
    await openDialog(page);
    const createAction = await captureAction(
      page,
      () => dialog(page).getByRole("button", { name: "Create link", exact: true }).click(),
      (args) => Array.isArray(args) && args[0] === mine.pageId && !String(args[0]).includes("link"),
    );
    await expect(field(page)).toBeVisible();

    const replayedCreate = await replayAction(page, createAction, [theirPage]);
    expect(replayedCreate.result).toMatchObject({ ok: false, reason: "not_found" });
    expect(await linkRows(theirPage)).toHaveLength(1);

    // A random page id and a malformed one.
    for (const bogus of ["00000000-0000-4000-8000-0000000000aa", "nope", ""]) {
      const result = await replayAction(page, createAction, [bogus]);
      expect(result.result, bogus).toMatchObject({ ok: false, reason: "not_found" });
    }

    // Turn off: capture the action from a real click, then replay it with the other user's link.
    const row = dialog(page).locator("[data-preview-link]").first();
    const offAction = await captureAction(page, () =>
      row.getByRole("button", { name: "Turn off" }).click(),
    );
    const replayedOff = await replayAction(page, offAction, [theirLink.id]);
    expect(replayedOff.result).toMatchObject({ ok: false, reason: "not_found" });
    const randomOff = await replayAction(page, offAction, ["00000000-0000-4000-8000-0000000000bb"]);
    expect(randomOff.result).toMatchObject({ ok: false, reason: "not_found" });
    const theirRows = await linkRows(theirPage);
    expect(theirRows).toHaveLength(1);
    expect(theirRows[0]!.revoked_at).toBeNull();
    // Their link still answers 200.
    expect((await getShare(theirLink.token, randomIp())).status).toBe(200);
  });

  test("M6-12 the dialog lists this page's links only, and a Free account can use it", async ({
    page,
    context,
  }) => {
    const owner = await signedInUser(context, { label: "own" });
    const admin = adminClient();
    await admin.from("accounts").update({ plan: "pro" }).eq("id", owner.userId);
    const second = await admin
      .from("pages")
      .insert({
        owner_id: owner.userId,
        handle: `zq-own2-${Math.random().toString(36).slice(2, 7)}`,
        draft: (await admin.from("pages").select("draft").eq("id", owner.pageId).single()).data!
          .draft,
      })
      .select("id")
      .single();
    await makeLink(owner.userId, second.data!.id);
    await makeLink(owner.userId, owner.pageId);
    await admin.from("accounts").update({ plan: "free" }).eq("id", owner.userId);

    await openEditor(page);
    await openDialog(page);
    await expect(dialog(page).locator("[data-preview-link]")).toHaveCount(1);
    await dialog(page).getByRole("button", { name: "Create link", exact: true }).click();
    await expect(field(page)).toBeVisible();
    await expect(dialog(page).locator("[data-preview-link]")).toHaveCount(2);
  });
});

test.describe("M6-12 layout", () => {
  test("M6-12 phone and desktop: the dialog fits, buttons are 44px, a long address scrolls inside its field, and the header button sits where the design puts it", async ({
    page,
    context,
  }, info) => {
    await signedInUser(context, { label: "lay" });
    await openEditor(page);
    const phone = info.project.name === "phone";

    // Header placement: after Preview on desktop; wrapped onto the second row on a phone.
    const share = (await shareButton(page).boundingBox())!;
    expect(share.height).toBeGreaterThanOrEqual(44);
    const title = (await header(page).getByRole("heading", { level: 1 }).boundingBox())!;
    if (phone) {
      expect(share.y).toBeGreaterThan(title.y + title.height - 1);
    } else {
      const preview = (await header(page)
        .getByRole("link", { name: "Preview", exact: true })
        .boundingBox())!;
      expect(share.x).toBeGreaterThan(preview.x + preview.width - 1);
      expect(Math.abs(share.y - preview.y)).toBeLessThan(8);
    }

    await openDialog(page);
    await dialog(page).getByRole("button", { name: "Create link", exact: true }).click();
    await expect(field(page)).toBeVisible();
    // The list of active links fills in after the create: measure once the layout has settled.
    await expect(dialog(page).locator("[data-preview-link]")).toHaveCount(1);
    await expectNoHorizontalScroll(page);
    await expectTapTargets(page, "dialog");

    const viewport = page.viewportSize()!;
    const box = (await dialog(page).boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
    if (phone) {
      expect(box.width).toBeGreaterThanOrEqual(viewport.width - 33);
      const buttons = dialog(page).getByRole("button", { name: /^(Create link|Copy link|Close)$/ });
      const count = await buttons.count();
      const dialogInner = box.width - 34;
      let previousBottom = 0;
      for (let i = 0; i < count; i++) {
        const b = (await buttons.nth(i).boundingBox())!;
        expect(b.width).toBeGreaterThanOrEqual(dialogInner - 2);
        expect(b.height).toBeGreaterThanOrEqual(44);
        expect(b.y).toBeGreaterThanOrEqual(previousBottom - 1);
        previousBottom = b.y + b.height;
      }
      // A long address scrolls inside its field.
      const scrolls = await field(page).evaluate(
        (el) => (el as HTMLInputElement).scrollWidth > el.clientWidth,
      );
      expect(scrolls).toBe(true);
    } else {
      expect(box.width).toBeLessThanOrEqual(480);
      expect(Math.abs(box.x + box.width / 2 - viewport.width / 2)).toBeLessThan(2);
      const backdrop = await dialog(page).evaluate(
        (el) => getComputedStyle(el, "::backdrop").backgroundColor,
      );
      expect(backdrop).not.toBe("rgba(0, 0, 0, 0)");
    }
    await expect(saveIndicator(page)).toBeAttached();
  });
});

test.describe("M6-11 the Preview link", () => {
  test("M6-11 'Preview' opens /preview/{pageId} in a new tab with the newest edits, and 'View live page' still opens the page", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "the Preview link shows from 760px up");
    const owner = await signedInUser(context, { label: "pv" });
    await openEditor(page);
    const link = header(page).getByRole("link", { name: "Preview", exact: true });
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", "noopener");
    await expect(link).toHaveAttribute("href", `/preview/${owner.pageId}`);
    await expect(header(page).getByRole("link", { name: "View live page" })).toHaveAttribute(
      "href",
      `http://${owner.handle}.localhost:3000`,
    );

    const name = page.getByLabel("Display name", { exact: true });
    const original = await name.inputValue();
    await name.fill(`${original} X`);
    const [popup] = await Promise.all([context.waitForEvent("page"), link.click()]);
    await popup.waitForURL(url("app", `/preview/${owner.pageId}`));
    await expect(popup.locator("h1")).toHaveText(`${original} X`);
    await popup.close();
  });
});
