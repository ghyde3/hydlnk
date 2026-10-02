import { expect, test, type Page } from "@playwright/test";
import { adminClient, publishableKey, supabaseUrl } from "../fixtures/auth";
import { cleanupUsers, desktopOnly, uniq } from "../fixtures/data";
import { appRaw, sessionOf } from "../fixtures/http";
import { expectNoHorizontalScroll, expectTapTargets, url } from "../helpers";
import { openEditor, pageRow } from "../m2/editor-helpers";
import {
  APP_ORIGIN,
  json,
  postApp,
  sessionCookie,
  setSuspended,
  signInAsUser,
} from "./admin-helpers";

/**
 * M5-09: a suspended owner's writes are blocked (the database refuses draft and theme writes with
 * the publishable key, the secret-key doors answer 403 account_suspended) and a banner shows on
 * every app screen. Reads and sign-in still work, and an unsuspend restores everything.
 *
 * "Add domain" has no route yet (Milestone 4's domain flow is not built), so its 403 is not tested;
 * the same `isAccountSuspended` helper (src/lib/admin/suspension.ts) is what it must call.
 */

test.describe.configure({ timeout: 120_000 });
test.afterAll(cleanupUsers);

const BANNER = "[data-suspended-banner]";
const BANNER_TEXT =
  /Your account is suspended\. Your pages are offline\. Contact \S+@\S+ to appeal\./;

async function restWith(token: string, path: string, init: RequestInit = {}) {
  return fetch(`${supabaseUrl()}/rest/v1${path}`, {
    ...init,
    headers: {
      apikey: publishableKey(),
      Authorization: `Bearer ${token}`,
      "content-type": "application/json",
      Prefer: "return=representation",
      ...(init.headers as Record<string, string> | undefined),
    },
  });
}

const rows = async (res: Response): Promise<unknown[]> => {
  const text = await res.text();
  try {
    const parsed = JSON.parse(text) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

test.describe("M5-09 writes are blocked for a suspended owner", () => {
  test("M5-09 direct API: the suspended owner's draft PATCH leaves the draft unchanged, a theme insert is rejected, reads still work, and an unsuspend restores both", async ({
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "no UI involved");
    const owner = await signInAsUser(context, "wdb", { plan: "pro" });
    const { access_token: token } = await sessionOf(context);
    const before = await pageRow(owner.pageId!);
    await setSuspended(owner.userId, true);

    const edited = {
      ...before.draft,
      rev: 77,
      profile: { ...before.draft.profile, bio: "HACKED" },
    };
    const patch = await restWith(token, `/pages?id=eq.${owner.pageId}`, {
      method: "PATCH",
      body: JSON.stringify({ draft: edited }),
    });
    // RLS matches no row: a 2xx with nothing returned, or an error. Never a changed draft.
    expect(await rows(patch)).toEqual([]);
    expect((await pageRow(owner.pageId!)).draft).toEqual(before.draft);

    const themesBefore = (
      await adminClient().from("themes").select("id").eq("owner_id", owner.userId)
    ).data!.length;
    const insert = await restWith(token, "/themes", {
      method: "POST",
      body: JSON.stringify({
        owner_id: owner.userId,
        name: "Sneaky",
        tokens: { accent: "#112233" },
      }),
    });
    expect(insert.status).toBeGreaterThanOrEqual(400);
    expect(
      (await adminClient().from("themes").select("id").eq("owner_id", owner.userId)).data,
    ).toHaveLength(themesBefore);

    // Reads of their own rows still work.
    const read = await restWith(token, `/pages?id=eq.${owner.pageId}&select=id,handle`);
    expect(read.status).toBe(200);
    expect(await rows(read)).toHaveLength(1);
    const account = await restWith(token, `/accounts?id=eq.${owner.userId}&select=suspended_at`);
    expect((await rows(account))[0]).toMatchObject({ suspended_at: expect.any(String) });
    // They cannot lift it themselves.
    const lift = await restWith(token, `/accounts?id=eq.${owner.userId}`, {
      method: "PATCH",
      body: JSON.stringify({ suspended_at: null }),
    });
    expect(lift.status).toBeGreaterThanOrEqual(400);
    expect(
      (await adminClient().from("accounts").select("suspended_at").eq("id", owner.userId).single())
        .data!.suspended_at,
    ).not.toBeNull();

    // Unsuspended: the same two writes work.
    await setSuspended(owner.userId, false);
    const again = await restWith(token, `/pages?id=eq.${owner.pageId}`, {
      method: "PATCH",
      body: JSON.stringify({ draft: edited }),
    });
    expect(await rows(again)).toHaveLength(1);
    expect((await pageRow(owner.pageId!)).draft.profile.bio).toBe("HACKED");
    const themeOk = await restWith(token, "/themes", {
      method: "POST",
      body: JSON.stringify({ owner_id: owner.userId, name: "Fine", tokens: { accent: "#112233" } }),
    });
    expect(themeOk.status).toBe(201);
  });

  test("M5-09 direct API: create page, claim and upload each return 403 account_suspended with the owner's session cookie, and write nothing", async ({
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "no UI involved");
    const owner = await signInAsUser(context, "wapi", { plan: "studio", suspended: true });
    const cookie = await sessionCookie(context);
    const admin = adminClient();
    const pageCount = async () =>
      (
        await admin
          .from("pages")
          .select("id", { count: "exact", head: true })
          .eq("owner_id", owner.userId)
      ).count;
    const startPages = await pageCount();

    for (const path of ["/api/pages", "/api/handles/claim"]) {
      const handle = uniq("wx").slice(0, 28);
      const res = await postApp(path, { cookie, body: JSON.stringify({ handle }) });
      expect(res.status, path).toBe(403);
      expect(json(res), path).toMatchObject({ code: "account_suspended" });
      expect((await admin.from("pages").select("id").eq("handle", handle)).data, path).toHaveLength(
        0,
      );
    }
    expect(await pageCount()).toBe(startPages);

    const boundary = "----zqboundary";
    const multipart =
      `--${boundary}\r\nContent-Disposition: form-data; name="kind"\r\n\r\ncontent\r\n` +
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.png"\r\nContent-Type: image/png\r\n\r\nnot really a png\r\n--${boundary}--\r\n`;
    const upload = await postApp("/api/media", {
      cookie,
      contentType: `multipart/form-data; boundary=${boundary}`,
      body: multipart,
    });
    expect(upload.status).toBe(403);
    expect(json(upload)).toMatchObject({ code: "account_suspended" });
    const stored = await admin.storage.from("page-media").list(owner.userId);
    expect(stored.data ?? []).toHaveLength(0);

    // Unsuspended, the same create works (the account is on Studio).
    await setSuspended(owner.userId, false);
    const handle = uniq("wok").slice(0, 28);
    const ok = await postApp("/api/pages", { cookie, body: JSON.stringify({ handle }) });
    expect(ok.status, ok.body).toBe(201);
  });
});

test.describe("M5-09 a suspended owner cannot delete what an admin has to review", () => {
  test("M5-09 DELETE /api/pages/{id} answers 403 account_suspended and removes nothing; Delete account says why and removes nothing; unsuspended, the page delete works", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "one project is enough");
    const owner = await signInAsUser(context, "wdel", { plan: "studio", suspended: true });
    const cookie = await sessionCookie(context);
    const admin = adminClient();
    const exists = async () =>
      (await admin.from("pages").select("id").eq("id", owner.pageId!)).data!.length === 1;
    const del = (confirm: string) =>
      appRaw(`/api/pages/${owner.pageId}`, {
        method: "DELETE",
        cookie,
        headers: { "content-type": "application/json", origin: APP_ORIGIN },
        body: JSON.stringify({ confirm }),
      });

    // Right confirmation, wrong confirmation, no body worth reading: the suspension answers first.
    for (const confirm of [owner.handle!, "nope"]) {
      const refused = await del(confirm);
      expect(refused.status, confirm).toBe(403);
      expect(json(refused), confirm).toMatchObject({
        error: "account_suspended",
        code: "account_suspended",
      });
      expect(await exists()).toBe(true);
    }

    // The account: the Settings dialog refuses with the reason, the user and the page stay.
    await page.goto(url("app", "/settings"));
    await page.locator("main").getByRole("button", { name: "Delete account" }).click();
    const dialog = page.locator("dialog[open]");
    await dialog.getByLabel("Type your handle to confirm").fill(owner.handle!);
    await dialog.getByRole("button", { name: "Delete account" }).click();
    await expect(
      dialog.getByText("Your account is suspended, so it can’t be deleted."),
    ).toBeVisible();
    expect((await admin.auth.admin.getUserById(owner.userId)).data.user).not.toBeNull();
    expect(await exists()).toBe(true);
    expect(
      (await admin.from("accounts").select("suspended_at").eq("id", owner.userId).single()).data!
        .suspended_at,
    ).not.toBeNull();

    // Unsuspended, the same page delete goes through (it is one of two pages of a Studio account).
    await setSuspended(owner.userId, false);
    const second = await postApp("/api/pages", {
      cookie,
      body: JSON.stringify({ handle: uniq("wdx").slice(0, 28) }),
    });
    expect(second.status, second.body).toBe(201);
    const secondId = (json(second).page as { id: string } | undefined)?.id;
    if (secondId) {
      await setSuspended(owner.userId, true);
      const stillRefused = await appRaw(`/api/pages/${secondId}`, {
        method: "DELETE",
        cookie,
        headers: { "content-type": "application/json", origin: APP_ORIGIN },
        body: JSON.stringify({ confirm: "x" }),
      });
      expect(stillRefused.status).toBe(403);
      await setSuspended(owner.userId, false);
    }
    const allowed = await del(owner.handle!);
    expect(allowed.status, allowed.body).toBe(200);
    expect(await exists()).toBe(false);
  });
});

async function bannerOn(page: Page, path: string) {
  await page.goto(url("app", path));
  const banner = page.locator(BANNER);
  await expect(banner, path).toBeVisible();
  await expect(banner, path).toHaveText(BANNER_TEXT);
  await expect(banner.getByRole("link"), path).toHaveAttribute("href", /^mailto:\S+@\S+$/);
}

test.describe("M5-09 the banner and the disabled controls", () => {
  test("M5-09 a suspended user signs in, sees every app screen with the banner, and Publish, Upload photo and New page are disabled with the reason; Sign out still works; an unsuspend lifts it all", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "desktop layout");
    const owner = await signInAsUser(context, "wui", { plan: "pro", suspended: true });

    for (const path of ["/editor", "/design", "/analytics", "/domains", "/settings"]) {
      await bannerOn(page, path);
    }

    await openEditor(page);
    const publish = page.getByRole("button", { name: /^Publish/ });
    await expect(publish).toBeDisabled();
    await expect(publish).toHaveAttribute("title", "Your account is suspended.");
    const upload = page.getByRole("button", { name: /^(Upload|Replace) photo/ });
    await expect(upload).toBeDisabled();
    await expect(upload).toHaveAttribute("title", "Your account is suspended.");

    // New page: in the page switcher menu, disabled with the reason and no plans link.
    await page
      .locator("aside")
      .getByRole("button", { name: /^Switch page/ })
      .click();
    const menu = page.getByRole("menu", { name: "Pages" });
    const newPage = menu.getByRole("menuitem", { name: "New page" });
    await expect(newPage).toHaveAttribute("aria-disabled", "true");
    await expect(menu).toContainText("Your account is suspended.");
    await expect(menu.getByRole("menuitem", { name: "See plans" })).toHaveCount(0);
    await page.keyboard.press("Escape");

    // /pages/new shows the reason and a disabled button.
    await page.goto(url("app", "/pages/new"));
    await expect(page.locator(BANNER)).toBeVisible();
    await expect(page.getByRole("button", { name: "Create page" })).toBeDisabled();
    await expect(
      page.getByText("Your account is suspended.", { exact: true }).first(),
    ).toBeVisible();

    // The Unsuspend: the banner is gone on the next navigation and Publish works again.
    await setSuspended(owner.userId, false);
    await page.goto(url("app", "/editor"));
    await expect(page.locator(BANNER)).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Publish/ })).toBeEnabled();
    await page.getByRole("button", { name: /^Publish/ }).click();
    await expect(page.getByRole("status").filter({ hasText: "Published." })).toBeVisible({
      timeout: 20_000,
    });
  });

  test("M5-09 Sign out still works for a suspended user", async ({ page, context }, info) => {
    test.skip(!desktopOnly(info), "desktop layout");
    await signInAsUser(context, "wso", { suspended: true });
    await page.goto(url("app", "/settings"));
    await expect(page.locator(BANNER)).toBeVisible();
    const signOut = page.getByRole("button", { name: "Sign out" }).first();
    await expect(signOut).toBeEnabled();
    await signOut.click();
    await expect(page).toHaveURL(url("app", "/login"));
    await page.goto(url("app", "/editor"));
    await expect(page).toHaveURL(url("app", "/login"));
  });

  test("M5-09 at 390x844 the banner does not overlap the top bar or the tab bar, nothing scrolls sideways and every target is 44px", async ({
    page,
    context,
  }, info) => {
    test.skip(info.project.name !== "phone", "phone layout");
    await signInAsUser(context, "wph", { suspended: true });
    await openEditor(page);
    const banner = page.locator(BANNER);
    await expect(banner).toBeVisible();
    const topBar = await page.locator("body > div > header").first().boundingBox();
    const tabBar = await page.getByRole("navigation", { name: "App sections" }).boundingBox();
    const box = (await banner.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(topBar!.y + topBar!.height - 0.5);
    expect(box.y + box.height).toBeLessThanOrEqual(tabBar!.y + 0.5);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390.5);
    await expectNoHorizontalScroll(page);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await expectTapTargets(page);
    const mail = await banner.getByRole("link").boundingBox();
    expect(mail!.height).toBeGreaterThanOrEqual(44);
    // The tab bar is still usable under the banner: scroll to the bottom, nothing covers the page.
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await expectNoHorizontalScroll(page);
  });

  test("M5-09 at 1440x900 the banner sits above the page header inside the main column", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "desktop layout");
    await signInAsUser(context, "wdt", { suspended: true });
    await openEditor(page);
    const banner = page.locator(BANNER);
    const main = (await page.locator("main").filter({ has: banner }).first().boundingBox())!;
    const header = (await page.locator("main > header").first().boundingBox())!;
    const box = (await banner.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(main.y - 0.5);
    expect(box.y + box.height).toBeLessThanOrEqual(header.y + 0.5);
    expect(box.x).toBeGreaterThanOrEqual(main.x - 0.5);
    expect(box.x + box.width).toBeLessThanOrEqual(main.x + main.width + 0.5);
    expect(await banner.evaluate((el) => getComputedStyle(el).color)).toBe("rgb(178, 58, 43)");
    expect(await banner.evaluate((el) => getComputedStyle(el).borderBottomColor)).toBe(
      "rgb(232, 196, 189)",
    );
    await expectNoHorizontalScroll(page);
  });
});
