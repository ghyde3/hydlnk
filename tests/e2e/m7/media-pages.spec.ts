import { expect, test } from "@playwright/test";
import sharp from "sharp";
import { adminClient } from "../fixtures/auth";
import { cleanupUsers, setPlan } from "../fixtures/data";
import { expectNoHorizontalScroll, url } from "../helpers";
import { addDomainRow, hostnameFor } from "../m4/domains-core-helpers";
import { draftOf, userWithDraft } from "../m2/blocks-helpers";
import { SERVER_PORT, rawBuffer } from "../m2/publish-helpers";
import { makeLink } from "../m6/pages-helpers";
import { removeFolders, sessionCookie, uploadMedia, uploaded } from "../m5/images-helpers";
import { openEditor } from "../m2/editor-helpers";
import { UNDO_IMAGE_GONE } from "@/lib/editor/history";
import {
  FONT_HOSTS,
  MEDIA,
  STORAGE_ORIGIN,
  allLoaded,
  expectOwnAddresses,
  mediaPaths,
  owners,
  seed,
  watch,
} from "./media-helpers";

/**
 * M7-15: every image and background loads through /media, and the stored form is unchanged. One
 * page with a profile photo, an image block, a card image, a link thumbnail and a background image
 * is loaded on every surface that draws uploaded media: the live page, a verified custom domain's
 * markup, the editor's preview, the owner's /preview/{pageId}, a private link, the Design screen's
 * background thumbnail and the OG image. On each, no request goes to the Storage origin and every
 * image is an address on the root origin's /media that loads (one CDN cache key per image). Phone (390x844) and desktop (1440x900).
 */

test.describe.configure({ timeout: 180_000 });

test.afterAll(async () => {
  await removeFolders(owners.splice(0));
  await cleanupUsers();
});

test.describe("M7-15 images load through /media", () => {
  test("M7-15 the live page draws the photo, the image, the card, the thumbnail and the background from its own address, twice, and only fonts leave the host", async ({
    browser,
    page,
  }) => {
    const context = await browser.newContext();
    const s = await seed(context, "mpl");
    const w = watch(page);

    for (const round of ["first load", "second load"]) {
      w.requests.length = 0;
      w.media.length = 0;
      await page.goto(url(s.handle));
      await expect(page.locator("[data-page-root]")).toBeVisible();
      const { srcs } = await allLoaded(page, "[data-page-root]");
      expectOwnAddresses(s, srcs, w, round);

      // The background: a CSS variable holding a /media address, which the browser fetched.
      const bgVar = await page
        .locator("[data-page-root]")
        .evaluate((el) => (el as HTMLElement).style.getPropertyValue("--t-bg-image"));
      expect(bgVar).toBe(`url("${MEDIA}/media/${s.bg.path}")`);
      await expect
        .poll(() => w.media.some((r) => r.url.endsWith(`/media/${s.bg.path}`)))
        .toBe(true);
      expect(w.media.length).toBeGreaterThanOrEqual(5);

      // Only the page's own host, the root origin (images) and the two Google Fonts hosts, are ever contacted.
      const hosts = new Set(
        w.requests
          .map((request) => new URL(request))
          .filter((u) => u.protocol === "http:" || u.protocol === "https:")
          .map((u) => u.host),
      );
      for (const host of hosts) {
        expect(
          host === new URL(url(s.handle)).host ||
            host === new URL(MEDIA).host ||
            FONT_HOSTS.has(host),
          `${round}: ${host}`,
        ).toBe(true);
      }
      await expectNoHorizontalScroll(page);
    }
    await context.close();
  });

  test("M7-15 the published document still holds the Storage URL for the background, and the OG image still draws", async ({
    browser,
    request,
  }) => {
    const context = await browser.newContext();
    const s = await seed(context, "mps");
    const admin = adminClient();
    const { data, error } = await admin
      .from("pages")
      .select("draft, published")
      .eq("id", s.pageId)
      .single();
    expect(error).toBeNull();
    for (const doc of [data!.draft, data!.published] as Record<string, unknown>[]) {
      const json = JSON.stringify(doc);
      expect(json).toContain(s.bgStored); // the stored form, untouched
      expect(json).not.toContain("/media/"); // nothing relative is ever stored
    }

    // GET /og: the server fetches the avatar from Storage itself (never through /media) and
    // still returns the 1200x630 PNG.
    const og = await request.get(url(s.handle, "/og"));
    expect(og.status()).toBe(200);
    expect(og.headers()["content-type"]).toContain("image/png");
    const meta = await sharp(await og.body()).metadata();
    expect([meta.width, meta.height]).toEqual([1200, 630]);
    // The avatar is drawn (the photo is a solid red square; without it initials are drawn instead).
    const { data: pixels, info } = await sharp(await og.body())
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    let red = 0;
    for (let i = 0; i < pixels.length; i += info.channels) {
      if (pixels[i]! > 170 && pixels[i + 1]! < 100 && pixels[i + 2]! < 100) red += 1;
    }
    expect(red, "red avatar pixels in the OG image").toBeGreaterThan(2000);

    await context.close();
  });

  test("M7-15 a verified custom domain's page draws /media addresses too", async ({ browser }) => {
    const context = await browser.newContext();
    const s = await seed(context, "mpc");
    const host = hostnameFor("mpc");
    await setPlan(s.userId, "studio"); // a custom domain is a paid-plan feature
    await addDomainRow({ pageId: s.pageId, hostname: host, status: "verified" });

    const res = await rawBuffer(host, "/");
    expect(res.status).toBe(200);
    const html = res.text;
    for (const path of mediaPaths(s)) expect(html).toContain(`${MEDIA}/media/${path}`);
    expect(html).toContain(`url(&quot;${MEDIA}/media/${s.bg.path}&quot;)`);
    expect(html).not.toContain(STORAGE_ORIGIN);
    expect(html).not.toContain("/storage/v1/");
    // The custom host does not serve images itself (one CDN cache key per image): the root host does.
    expect((await rawBuffer(host, `/media/${s.image.path}`)).status).toBe(404);
    const image = await rawBuffer(`localhost:${SERVER_PORT}`, `/media/${s.image.path}`);
    expect(image.status).toBe(200);
    expect(image.headers["content-type"]).toBe("image/png");
    await context.close();
  });

  test("M7-15 the editor's preview, the owner's /preview and a private link draw from /media", async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const s = await seed(context, "mpe");
    const page = await context.newPage();

    // The owner's preview of the draft (the app host).
    let w = watch(page);
    await page.goto(url("app", `/preview/${s.pageId}`));
    await expect(page.locator("[data-page-root]")).toBeVisible();
    let loaded = await allLoaded(page, "[data-page-root]");
    expectOwnAddresses(s, loaded.srcs, w, "/preview");
    expect(
      await page
        .locator("[data-page-root]")
        .evaluate((el) => (el as HTMLElement).style.getPropertyValue("--t-bg-image")),
    ).toBe(`url("${MEDIA}/media/${s.bg.path}")`);

    // A private preview link, opened with no session at all.
    const link = await makeLink(s.userId, s.pageId);
    const guest = await browser.newContext();
    const guestPage = await guest.newPage();
    w = watch(guestPage);
    await guestPage.goto(link.url);
    await expect(guestPage.locator("[data-page-root]")).toBeVisible();
    loaded = await allLoaded(guestPage, "[data-page-root]");
    expectOwnAddresses(s, loaded.srcs, w, "/share link");
    await guest.close();

    // The editor's own preview: beside the blocks on a wide screen, the small phone preview on a
    // phone (older builds had a Preview tab for it). Either way it is the shared renderer, so its
    // images are /media addresses that load; the small one shows the top of the page only.
    w = watch(page);
    await page.goto(url("app", "/editor"));
    await expect(page.getByLabel("Display name", { exact: true })).toBeVisible();
    const tablist = page.getByRole("tablist", { name: "Editor view" });
    if (await tablist.isVisible()) await tablist.getByRole("tab", { name: "Preview" }).click();
    await expect(page.locator("[data-page-root] img").first()).toBeAttached({ timeout: 20_000 });
    loaded = await allLoaded(page, "[data-page-root]");
    expect(loaded.srcs.length).toBeGreaterThan(0);
    expectOwnAddresses(s, loaded.srcs, w, "editor preview", { all: false });
    expect(loaded.srcs.some((src) => src.includes(s.userId))).toBe(true);

    // The profile photo's thumbnail in the editor is the same address.
    const thumbs = await page
      .locator(`main img[src^="${MEDIA}/media/"], form img[src^="${MEDIA}/media/"]`)
      .evaluateAll((els) => els.map((el) => el.getAttribute("src")));
    for (const src of thumbs) expect(src?.startsWith(`${MEDIA}/media/`)).toBe(true);
    await context.close();
  });

  test("M7-15 Undo checks Storage itself, never /media: the HEAD goes to the Supabase origin, and a deleted image is still reported gone", async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const user = await userWithDraft(context, "mpu", (handle) => draftOf(handle, []));
    owners.push(user.userId);
    const made = uploaded(
      await uploadMedia(
        await sharp({
          create: { width: 300, height: 300, channels: 3, background: { r: 30, g: 120, b: 200 } },
        })
          .png()
          .toBuffer(),
        {
          kind: "avatar",
          filename: "me.png",
          contentType: "image/png",
          cookie: await sessionCookie(context),
        },
      ),
    );
    const admin = adminClient();
    const draftNow = async () => {
      const { data, error } = await admin
        .from("pages")
        .select("draft")
        .eq("id", user.pageId)
        .single();
      if (error) throw new Error(error.message);
      return data.draft as { profile: { photo: { path: string } | null } };
    };
    const first = await draftNow();
    const { error } = await admin
      .from("pages")
      .update({
        draft: {
          ...first,
          profile: {
            ...first.profile,
            photo: { path: made.path, width: made.width, height: made.height },
          },
        },
      })
      .eq("id", user.pageId);
    expect(error).toBeNull();

    const page = await context.newPage();
    const calls: { method: string; url: string }[] = [];
    page.on("request", (request) => calls.push({ method: request.method(), url: request.url() }));
    await openEditor(page);
    const remove = page.getByRole("button", { name: "Remove", exact: true });

    // Remove the photo, then Undo with the keyboard: the editor asks Storage whether the file is
    // still there (a HEAD) before it restores the reference.
    await remove.click();
    await expect.poll(async () => (await draftNow()).profile.photo, { timeout: 20_000 }).toBeNull();
    calls.length = 0;
    await page.keyboard.press("Control+z");
    await expect
      .poll(async () => (await draftNow()).profile.photo?.path ?? null, { timeout: 20_000 })
      .toBe(made.path);
    const heads = calls.filter((call) => call.method === "HEAD");
    expect(heads.map((call) => call.url)).toEqual([
      `${STORAGE_ORIGIN}/storage/v1/object/public/page-media/${made.path}`,
    ]);
    // A CDN's copy of /media/... can never stand in for the object: no HEAD went there.
    expect(heads.filter((call) => new URL(call.url).pathname.startsWith("/media/"))).toEqual([]);

    // Remove again, delete the object with the secret key, and Undo: refused, with the message.
    await remove.click();
    await expect.poll(async () => (await draftNow()).profile.photo, { timeout: 20_000 }).toBeNull();
    const gone = await admin.storage.from("page-media").remove([made.path]);
    expect(gone.error).toBeNull();
    // /media may still hold a copy on a CDN for days; the check must not be fooled by it.
    await page.keyboard.press("Control+z");
    await expect(page.locator("[data-history-notice]")).toHaveText(UNDO_IMAGE_GONE);
    expect((await draftNow()).profile.photo).toBeNull();
    await context.close();
  });

  test("M7-15 the Design screen's background thumbnail is a /media address; the stored token stays the Storage URL", async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const s = await seed(context, "mpd");
    const page = await context.newPage();
    const w = watch(page);
    await page.goto(url("app", "/design"));
    const thumb = page.locator('[role="img"][aria-label="Current background image"] img');
    await expect(thumb).toBeVisible();
    await expect(thumb).toHaveAttribute("src", `${MEDIA}/media/${s.bg.path}`);
    await expect
      .poll(() => thumb.evaluate((el) => (el as HTMLImageElement).naturalWidth))
      .toBeGreaterThan(0);
    expect(
      w.requests.filter((request) => request.startsWith(`${STORAGE_ORIGIN}/storage/`)),
    ).toEqual([]);
    expect(w.violations).toEqual([]);
    await context.close();
  });
});
