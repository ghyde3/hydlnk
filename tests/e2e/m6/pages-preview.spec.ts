import { expect, test } from "@playwright/test";
import { adminClient } from "../fixtures/auth";
import { cleanupUsers, desktopOnly, makeUser, signIn, signedInUser } from "../fixtures/data";
import { appRaw, cookieHeader } from "../fixtures/http";
import { expectNoHorizontalScroll, expectTapTargets, url } from "../helpers";
import { emptyUser, openEditor } from "../m2/editor-helpers";
import { makeLink, getShare, randomIp, visibleText } from "./pages-helpers";

/**
 * M6-11: the owner's draft preview, /preview/{pageId} on the app host. Every spec makes its own
 * users, so nothing touches mara. Raw HTTP specs run once (desktop project); the browser ones run
 * at both viewports.
 */

test.afterAll(cleanupUsers);

const MARK = "DRAFT-PREVIEW-91c2";

async function setBio(pageId: string, bio: string): Promise<void> {
  const admin = adminClient();
  const row = await admin.from("pages").select("draft").eq("id", pageId).single();
  const draft = row.data!.draft as { profile: { bio: string } };
  draft.profile.bio = bio;
  const { error } = await admin.from("pages").update({ draft }).eq("id", pageId);
  if (error) throw new Error(error.message);
}

const previewUrl = (pageId: string) => url("app", `/preview/${pageId}`);

test.describe("M6-11 who may open it", () => {
  test("M6-11 signed out goes to /login with none of the draft; another account's page id is the app 404 with none of its text; a malformed id is a 404", async ({
    context,
    browser,
  }, info) => {
    test.skip(!desktopOnly(info), "raw HTTP, no UI");
    const owner = await signedInUser(context, { label: "pvo" });
    await setBio(owner.pageId, `${MARK} bio`);

    const signedOut = await appRaw(`/preview/${owner.pageId}`);
    expect([302, 307]).toContain(signedOut.status);
    expect(signedOut.location).toContain("/login");
    expect(signedOut.body).not.toContain(MARK);
    expect(signedOut.body).not.toContain(owner.handle);

    // Another signed-in account, with the owner's page id.
    const other = await browser.newContext();
    const intruder = await signedInUser(other, { label: "pvx" });
    const cookies = cookieHeader(await other.cookies(url("app")));
    const denied = await appRaw(`/preview/${owner.pageId}`, { cookie: cookies });
    expect(denied.status).toBe(404);
    expect(denied.body).not.toContain(MARK);
    expect(denied.body).not.toContain(owner.handle);
    // A page id in the hl-page cookie does not make a page the caller's own.
    const withCookie = await appRaw(`/preview/${owner.pageId}`, {
      cookie: `${cookies}; hl-page=${owner.pageId}`,
    });
    expect(withCookie.status).toBe(404);
    expect(withCookie.body).not.toContain(MARK);

    // A malformed id and an unknown id.
    for (const id of ["not-a-uuid", "123", "00000000-0000-4000-8000-0000000000ee"]) {
      const res = await appRaw(`/preview/${id}`, { cookie: cookies });
      expect(res.status, id).toBe(404);
    }
    // The intruder's own page works for them.
    const own = await appRaw(`/preview/${intruder.pageId}`, { cookie: cookies });
    expect(own.status).toBe(200);
    expect(own.body).not.toContain(MARK);
    await other.close();
  });
});

test.describe("M6-11 what it shows", () => {
  test("M6-11 the saved draft at full width with the DRAFT PREVIEW bar, the status chip and Back to editor; links do nothing; noindex; same theme values as the editor's preview", async ({
    page,
    context,
  }, info) => {
    const owner = await signedInUser(context, { label: "pvc" });
    await setBio(owner.pageId, `${MARK} bio`);

    // The editor's own preview root, for the theme values.
    await openEditor(page);
    const editorVars = await page
      .locator("[data-page-root]")
      .first()
      .evaluate((el) => {
        const style = getComputedStyle(el);
        const names = [
          "--t-bg",
          "--t-surface",
          "--t-text",
          "--t-accent",
          "--t-font-body",
          "--t-radius",
        ];
        return Object.fromEntries(names.map((name) => [name, style.getPropertyValue(name).trim()]));
      });

    const posts: string[] = [];
    const redirects: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "POST" && request.url().includes("/api/e"))
        posts.push(request.url());
      if (request.url().includes("/r/")) redirects.push(request.url());
    });
    const response = await page.goto(previewUrl(owner.pageId));
    expect(response?.status()).toBe(200);
    expect(response?.headers()["cache-control"]).toMatch(/no-store|no-cache/);

    const bar = page.locator("[data-preview-bar]");
    await expect(bar).toContainText("Draft preview");
    await expect(bar.locator("[data-publish-status]")).toHaveText(/Unpublished changes/);
    const back = bar.getByRole("link", { name: "Back to editor" });
    await expect(back).toHaveAttribute("href", "/editor");
    expect((await back.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await expect(page.getByText(`${MARK} bio`)).toBeVisible();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);

    const previewVars = await page.locator("[data-page-root]").evaluate((el) => {
      const style = getComputedStyle(el);
      const names = [
        "--t-bg",
        "--t-surface",
        "--t-text",
        "--t-accent",
        "--t-font-body",
        "--t-radius",
      ];
      return Object.fromEntries(names.map((name) => [name, style.getPropertyValue(name).trim()]));
    });
    expect(previewVars).toEqual(editorVars);
    // No HYDLNK token inside the page's own subtree.
    expect(
      await page.locator("[data-page-root]").evaluate((el) => el.outerHTML.includes("--hl-")),
    ).toBe(false);

    // Links do nothing: the URL stays, nothing is tracked.
    const start = page.url();
    const anchors = page.locator("[data-page-root] main a");
    expect(await anchors.count()).toBeGreaterThan(0);
    for (let i = 0; i < Math.min(await anchors.count(), 4); i++) {
      await anchors.nth(i).click({ force: true });
      expect(page.url()).toBe(start);
    }
    await page.waitForTimeout(400);
    expect(posts).toEqual([]);
    expect(redirects).toEqual([]);

    await expectNoHorizontalScroll(page);
    await expectTapTargets(page, "[data-preview-bar], footer");

    const viewport = page.viewportSize()!;
    if (info.project.name === "desktop") {
      const barBox = (await bar.boundingBox())!;
      expect(barBox.x).toBe(0);
      expect(Math.round(barBox.width)).toBe(viewport.width);
      const column = (await page.locator(".pg-column").boundingBox())!;
      expect(column.width).toBeLessThanOrEqual(480);
      expect(Math.abs(column.x + column.width / 2 - viewport.width / 2)).toBeLessThan(2);
      const root = (await page.locator("[data-page-root]").boundingBox())!;
      expect(Math.round(root.width)).toBe(viewport.width);
      expect(root.height).toBeGreaterThanOrEqual(viewport.height - 1);
    } else {
      const root = (await page.locator("[data-page-root]").boundingBox())!;
      expect(root.width).toBeGreaterThanOrEqual(viewport.width - 2);
      // The bar wraps instead of overflowing.
      const barBox = (await bar.boundingBox())!;
      expect(barBox.x + barBox.width).toBeLessThanOrEqual(viewport.width + 1);
    }
  });

  test("M6-11 draft against live: after Publish a changed bio shows in the preview and the old one stays on the live page", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "same data path at both widths");
    const owner = await signedInUser(context, { label: "pvl" });
    await setBio(owner.pageId, `${MARK} fresh`);
    await page.goto(previewUrl(owner.pageId));
    await expect(page.getByText(`${MARK} fresh`)).toBeVisible();
    await expect(page.locator("[data-preview-bar] [data-publish-status]")).toHaveText(
      /Unpublished changes/,
    );
    const live = await page.request.get(`http://${owner.handle}.localhost:3000/`);
    expect(await live.text()).not.toContain(MARK);
  });

  test("M6-11 a page that was never published previews fine while its address still shows the placeholder", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "same data path at both widths");
    const owner = await emptyUser(context, "pvn");
    await page.goto(previewUrl(owner.pageId));
    await expect(page.locator("[data-preview-bar] [data-publish-status]")).toHaveText(
      /Not published/,
    );
    await expect(page.locator("h1")).toHaveCount(1);
    const live = await page.request.get(`http://${owner.handle}.localhost:3000/`);
    expect(live.status()).toBe(200);
    expect(await live.text()).toContain("Nothing published here yet.");
  });

  test("M6-11 a suspended owner can still preview their own draft, no other account can, and their share links answer 404 until the unsuspend", async ({
    page,
    context,
    browser,
  }, info) => {
    test.skip(!desktopOnly(info), "same data path at both widths");
    const owner = await signedInUser(context, { label: "pvs" });
    await setBio(owner.pageId, `${MARK} suspended`);
    const link = await makeLink(owner.userId, owner.pageId);
    const ip = randomIp();
    expect((await getShare(link.token, ip)).status).toBe(200);

    const admin = adminClient();
    await admin
      .from("accounts")
      .update({ suspended_at: new Date().toISOString() })
      .eq("id", owner.userId);
    const res = await page.goto(previewUrl(owner.pageId));
    expect(res?.status()).toBe(200);
    await expect(page.getByText(`${MARK} suspended`)).toBeVisible();
    expect((await getShare(link.token, ip)).status).toBe(404);

    const other = await browser.newContext();
    await signedInUser(other, { label: "pvs2" });
    const otherPage = await other.newPage();
    const denied = await otherPage.goto(previewUrl(owner.pageId));
    expect(denied?.status()).toBe(404);
    await other.close();

    await admin.from("accounts").update({ suspended_at: null }).eq("id", owner.userId);
    const again = await getShare(link.token, ip);
    expect(again.status).toBe(200);
    expect(visibleText(again.body)).toContain(`${MARK} suspended`);
  });
});

test.describe("M6-11 an account with no session of its own", () => {
  test("M6-11 a user who has not signed in is sent to /login by the browser too", async ({
    page,
  }, info) => {
    test.skip(!desktopOnly(info), "same data path at both widths");
    const user = await makeUser("pvu");
    expect(user.id).toBeTruthy();
    await page.goto(previewUrl("00000000-0000-4000-8000-0000000000ee"));
    await expect(page).toHaveURL(/\/login/);
    void signIn;
  });
});
