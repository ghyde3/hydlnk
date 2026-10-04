import { expect, test, type Locator, type Page } from "@playwright/test";
import { adminClient } from "../fixtures/auth";
import { cleanupUsers, setPlan } from "../fixtures/data";
import { expectNoHorizontalScroll, url } from "../helpers";
import { uploadImage } from "../m2/blocks-helpers";
import { makeLink } from "../m6/pages-helpers";
import { makeVersions } from "../m6/versions-helpers";
import { removeFolders } from "../m5/images-helpers";
import { showPreviewSheet } from "./phone-preview";
import { MEDIA, STORAGE_ORIGIN, allLoaded, owners, seed, watch, type Seed } from "./media-helpers";

/**
 * M7-15 steps 2, 5 and 6 on the surfaces media-pages.spec.ts does not load: the Edit tab's own
 * controls (the profile photo, a card and an image block's picture and focus picker, a link's
 * thumbnail), 'Adjust photo' reading the photo from the page's own address, the Share tab's card
 * preview, the version preview of /editor/history, and no Content Security Policy violation on a
 * tenant page, the editor, the Share tab, a private link and the sign-in page. Every one of them draws
 * `/media/...` addresses that load and sends nothing to the Storage origin.
 */

test.describe.configure({ timeout: 180_000 });

test.afterAll(async () => {
  await removeFolders(owners.splice(0));
  await cleanupUsers();
});

/** Every uploaded-media `<img>` in `scope`: an address on the root origin's /media that decoded. */
async function expectOnlyMediaImages(scope: Locator, label: string): Promise<number> {
  const images = scope.locator("img");
  const found = await images.evaluateAll((els) =>
    els.map((el) => ({
      src: el.getAttribute("src") ?? "",
      loaded: (el as HTMLImageElement).complete && (el as HTMLImageElement).naturalWidth > 0,
    })),
  );
  for (const image of found) {
    expect(image.src, label).not.toContain("/storage/v1/");
    expect(image.src, label).not.toContain(STORAGE_ORIGIN);
  }
  return found.filter((image) => image.src.startsWith(`${MEDIA}/media/`)).length;
}

const noStorageRequests = (requests: string[]): string[] =>
  requests.filter((request) => request.startsWith(`${STORAGE_ORIGIN}/storage/`));

async function seedWithShare(
  context: Parameters<typeof seed>[0],
  label: string,
): Promise<Seed & { share: { path: string } }> {
  const s = await seed(context, label);
  const share = await uploadImage(s.userId, 1200, 630, [200, 100, 50]);
  const admin = adminClient();
  const { data, error } = await admin.from("pages").select("draft").eq("id", s.pageId).single();
  if (error) throw new Error(error.message);
  const draft = data.draft as Record<string, unknown>;
  const { error: updateError } = await admin
    .from("pages")
    .update({ draft: { ...draft, share: { title: "Shared", description: "", image: share } } })
    .eq("id", s.pageId);
  if (updateError) throw new Error(updateError.message);
  return { ...s, share };
}

test.describe("M7-15 the Edit tab's own controls draw from /media", () => {
  test("M7-15 the profile photo, a card's and an image block's picture with its focus picker, and a link's thumbnail are /media addresses that load", async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const s = await seed(context, "msx");
    const page = await context.newPage();
    const w = watch(page);
    await page.goto(url("app", "/editor"));
    await expect(page.getByLabel("Display name", { exact: true })).toBeVisible();

    // The profile photo's preview in the Profile card.
    const profile = page.getByRole("region", { name: "Profile", exact: true });
    await expect(profile.locator(`img[src="${MEDIA}/media/${s.photo.path}"]`)).toBeVisible();
    expect(await expectOnlyMediaImages(profile, "profile photo")).toBeGreaterThan(0);

    // Each block with a picture, opened in turn: the image block (picture and focus picker), the
    // card (picture and focus picker) and the link (its thumbnail).
    const rows = page.locator("li[data-block-id]");
    const expected = [
      { index: 1, path: s.image.path, label: "image block" },
      { index: 2, path: s.card.path, label: "card" },
      { index: 3, path: s.thumb.path, label: "link thumbnail" },
    ];
    for (const { index, path, label } of expected) {
      const toggle = rows.nth(index).locator("button[aria-expanded]").first();
      await toggle.click();
      const panel = page.locator("[id^='block-panel-']");
      await expect(panel).toBeVisible();
      await expect(panel.locator(`img[src="${MEDIA}/media/${path}"]`).first()).toBeAttached();
      expect(await expectOnlyMediaImages(panel, label), label).toBeGreaterThan(0);
      await toggle.click();
      await expect(page.locator("[id^='block-panel-']")).toHaveCount(0);
    }

    // Everything on the page that decoded did so from the page's own address.
    await allLoaded(page, "main");
    expect(noStorageRequests(w.requests)).toEqual([]);
    expect(w.violations).toEqual([]);
    await expectNoHorizontalScroll(page);
    await context.close();
  });

  test("M7-15 'Adjust photo' reads the existing photo from the page's own address and still opens the dialog", async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const s = await seed(context, "msa");
    const page = await context.newPage();
    const requests: string[] = [];
    page.on("request", (request) => requests.push(request.url()));
    await page.goto(url("app", "/editor"));
    await expect(page.getByLabel("Display name", { exact: true })).toBeVisible();
    // The photo's own address, the one the dialog must read: not the Storage origin (no CORS).
    const own = `${MEDIA}/media/${s.photo.path}`;
    requests.length = 0;
    await page.getByRole("button", { name: "Adjust photo", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Position your photo" })).toBeVisible();
    await expect.poll(() => requests.includes(own)).toBe(true);
    expect(noStorageRequests(requests)).toEqual([]);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Position your photo" })).toHaveCount(0);
    await context.close();
  });
});

test.describe("M7-15 the Share tab and the version preview draw from /media", () => {
  test("M7-15 the Share tab's card preview draws the share image from /media", async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const s = await seedWithShare(context, "mss");
    const page = await context.newPage();
    const w = watch(page);
    await page.goto(url("app", "/share"));
    const image = page.getByTestId("share-preview-image");
    await expect(image).toHaveAttribute("src", `${MEDIA}/media/${s.share.path}`);
    await expect
      .poll(() => image.evaluate((el) => (el as HTMLImageElement).naturalWidth))
      .toBeGreaterThan(0);
    expect(noStorageRequests(w.requests)).toEqual([]);
    expect(w.violations).toEqual([]);
    await context.close();
  });

  test("M7-15 the version preview of /editor/history draws the page's pictures from /media", async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const s = await seed(context, "msv");
    await setPlan(s.userId, "pro"); // version history is a Pro and Studio feature
    await makeVersions(s.pageId, 1); // a version is recorded when the plan keeps them: record one now
    const page = await context.newPage();
    const w = watch(page);
    await page.goto(url("app", "/editor/history"));
    await page
      .getByRole("button", { name: /^Preview version \d+/ })
      .first()
      .click();
    // The preview is in the bezel on a wide screen and in the full-screen sheet on a phone.
    const version = page.locator("[data-testid='version-page'] [data-page-root]");
    await expect(version).toBeVisible();
    await expect(version.locator("img").first()).toBeAttached({ timeout: 20_000 });
    const loaded = await allLoaded(page, "[data-testid='version-page']");
    expect(loaded.srcs.length).toBeGreaterThan(0);
    for (const src of loaded.srcs) expect(src.startsWith(`${MEDIA}/media/`)).toBe(true);
    expect(loaded.srcs).toContain(`${MEDIA}/media/${s.image.path}`);
    expect(noStorageRequests(w.requests)).toEqual([]);
    expect(w.violations).toEqual([]);
    await context.close();
  });
});

test.describe("M7-15 no Content Security Policy violation from the /media addresses", () => {
  test("M7-15 a tenant page, the editor with its preview, the Share tab, a private link and the sign-in page log no CSP violation", async ({
    browser,
  }, info) => {
    const context = await browser.newContext();
    const s = await seed(context, "msc");
    const page = await context.newPage();
    const w = watch(page);
    const visit = async (target: string, ready: Locator | ((p: Page) => Locator)) => {
      await page.goto(target);
      const locator = typeof ready === "function" ? ready(page) : ready;
      await expect(locator.first()).toBeVisible();
      await page.waitForTimeout(500);
    };
    await visit(url(s.handle), (p) => p.locator("[data-page-root] img"));
    await visit(url("app", "/editor"), (p) => p.getByLabel("Display name", { exact: true }));
    // A phone draws the preview in the sheet; from 760px it is beside the blocks.
    if (info.project.name === "phone") await showPreviewSheet(page);
    await expect(page.locator("[data-page-root] img").first()).toBeAttached({ timeout: 20_000 });
    await visit(url("app", "/share"), (p) => p.getByTestId("share-preview-card"));

    const link = await makeLink(s.userId, s.pageId);
    const guest = await browser.newContext();
    const guestPage = await guest.newPage();
    const guestWatch = watch(guestPage);
    await guestPage.goto(link.url);
    await expect(guestPage.locator("[data-page-root] img").first()).toBeAttached();
    await allLoaded(guestPage, "[data-page-root]");
    expect(guestWatch.violations).toEqual([]);

    // The sign-in page (no session): its own policy, with no image from the Supabase origin.
    const signedOut = await browser.newContext();
    const loginPage = await signedOut.newPage();
    const loginWatch = watch(loginPage);
    await loginPage.goto(url("app", "/login"));
    await expect(loginPage.getByRole("button").first()).toBeVisible();
    await loginPage.waitForTimeout(500);
    expect(loginWatch.violations).toEqual([]);
    expect(noStorageRequests(loginWatch.requests)).toEqual([]);

    expect(w.violations).toEqual([]);
    await guest.close();
    await signedOut.close();
    await context.close();
  });
});
