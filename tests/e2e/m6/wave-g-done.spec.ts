import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { adminClient, userClient } from "../fixtures/auth";
import {
  cleanupUsers,
  desktopOnly,
  phoneOnly,
  rand,
  signedInUser,
  type SignedInUser,
} from "../fixtures/data";
import { expectNoHorizontalScroll, expectTapTargets, url } from "../helpers";
import { addBlock, showView } from "../m2/blocks-helpers";
import { accessToken, emptyUser, openEditor, pageRow } from "../m2/editor-helpers";
import { pngSizeOf, rawBuffer } from "../m2/publish-helpers";
import { collectPublishErrors } from "@/lib/document";
import { embedOf, stubThirdParties, tapAndGetSrc, watchCsp } from "./embeds-helpers";
import { css } from "./links-helpers";
import { expectQrOf, readDownload } from "./qr-helpers";
import {
  BLUE,
  RED,
  near,
  pixelAt,
  publishNow,
  removeObjects,
  shareCard,
  shareDescription,
  sharePreview,
  shareTitle,
  socialTags,
  splitImage,
  waitDraft,
} from "./share-helpers";

/** The tenant CSP as the proxy sends it (src/lib/routing/tenant-headers.ts; not imported: it reads the env). */
const TENANT_CONTENT_SECURITY_POLICY =
  "frame-src https://www.youtube-nocookie.com https://open.spotify.com https://player.vimeo.com https://www.tiktok.com https://www.instagram.com https://w.soundcloud.com https://embed.music.apple.com https://player.twitch.tv https://clips.twitch.tv; img-src 'self' http://localhost:3000; object-src 'none'; base-uri 'none'; frame-ancestors 'none'";

/**
 * M6-34, "Done when" for Wave G: a page that uses every Wave G feature, built from nothing but the
 * editor, looks the same in the editor's preview and on the live page at 390px and 1440px, its
 * links, its Vimeo player and its text link behave, its share card says what the Share preview card
 * said, and its QR code opens it. A second test throws the crafted drafts of the security sweep at
 * Publish with another user's JWT, and a third runs the static scans.
 *
 * It exercises the controls of M6-20 to M6-30 by their visible words, so it passes once those land.
 * The regression guard of the spec's step 6 is the existing specs it names (M2-05, M2-09, M2-15,
 * M2-16, M2-19, M2-20, M2-21, M2-22, M2-30, M4-22, M5-03, M5-11, M5-13) run as they are, with the
 * updated assertions PROGRESS.md lists.
 */

// A long flow on a dev server other suites share: allow it time.
test.describe.configure({ timeout: 300_000 });

const stored: string[] = [];
test.afterAll(async () => {
  await removeObjects(stored.splice(0));
  await cleanupUsers();
});

const OBJECT_PATH = /^[0-9a-f-]{36}\/(avatar|bg|img)-[0-9a-f]{12,}[.]webp$/;
const png = (name: string, buffer: Buffer) => ({ name, mimeType: "image/png", buffer });

// Blocks ---------------------------------------------------------------------------------------

/** What the page is built from: the ids come from the editor's own "Add a block" chips. */
interface Built {
  profileName: string;
  bio: string;
  icon: string;
  thumb: string;
  featured: string;
  wide: string;
  card: string;
  embed: string;
  text: string;
}

const waitSaved = async (page: Page) =>
  expect(page.locator('[data-save-status="saved"]')).toBeVisible({ timeout: 20_000 });

/**
 * Selects characters `start` to `end` of a textarea: the caret is put at `start`, then Shift+Right
 * extends the selection key by key, so the browser sends every selection and key event a person
 * with a keyboard would (the toolbar listens to them).
 */
async function select(page: Page, textarea: Locator, start: number, end: number): Promise<void> {
  await textarea.focus();
  await textarea.evaluate((el, at) => (el as HTMLTextAreaElement).setSelectionRange(at, at), start);
  for (let i = start; i < end; i += 1) await page.keyboard.press("Shift+ArrowRight");
}

/** Pick a point on a focus picker's picture. */
async function pressFocus(panel: Locator, x: number, y: number): Promise<void> {
  const picture = panel.getByTestId("focus-picture");
  await picture.scrollIntoViewIfNeeded();
  const box = (await picture.boundingBox())!;
  await picture.click({ position: { x: box.width * x, y: box.height * y } });
}

async function buildPage(page: Page, user: SignedInUser): Promise<Built> {
  const built: Built = {
    profileName: "Wave G Studio",
    bio: "Every feature of Wave G, on one page.",
    icon: "",
    thumb: "",
    featured: "",
    wide: "",
    card: "",
    embed: "",
    text: "",
  };
  const draftHas = (check: Parameters<typeof waitDraft>[1]) => waitDraft(user.pageId, check);

  await test.step("profile: name, bio and a photo set through the position dialog", async () => {
    await page.getByLabel("Display name", { exact: true }).fill(built.profileName);
    await page.getByLabel("Bio", { exact: true }).fill(built.bio);
    const card = page.getByTestId("profile-card");
    await card
      .locator('input[type="file"]')
      .setInputFiles(png("photo.png", await splitImage(800, 800, "png")));
    const dialog = page.getByRole("dialog", { name: "Position your photo" });
    await expect(dialog).toBeVisible({ timeout: 60_000 });
    await dialog.getByRole("button", { name: "Use photo", exact: true }).click();
    const draft = await draftHas((d) => d.profile.photo !== null);
    expect(draft.profile.photo!.path).toMatch(OBJECT_PATH);
    expect(draft.profile.photo!.path).toMatch(/\/avatar-/);
    stored.push(draft.profile.photo!.path);
  });

  await test.step("share card: title, description and an image with a focus", async () => {
    // The share card is on the Share tab (M7-04); the draft is the workspace's, shared by the tabs.
    await page.getByRole("tab", { name: "Share", exact: true }).click();
    await shareTitle(page).fill("Everything in Wave G");
    await shareDescription(page).fill(
      "One page with an icon, a thumbnail, a pulse, a Vimeo reel and a text link.",
    );
    await shareCard(page)
      .locator('input[type="file"]')
      .setInputFiles(png("share.png", await splitImage(1600, 800, "png")));
    const draft = await draftHas((d) => Boolean(d.share?.image?.path));
    expect(draft.share!.image!.path).toMatch(OBJECT_PATH);
    expect(draft.share!.image!.path).toMatch(/\/img-/);
    stored.push(draft.share!.image!.path);
    await pressFocus(shareCard(page), 0.8, 0.5);
    await draftHas((d) => d.share?.image?.focus !== undefined);
    await page.getByRole("tab", { name: "Edit", exact: true }).click();
  });

  await test.step("a link with a built-in icon", async () => {
    const block = await addBlock(page, "link");
    built.icon = block.id;
    await block.panel.getByLabel("Label", { exact: true }).fill("Listen now");
    await block.panel.getByLabel("Link", { exact: true }).fill("https://example.com/listen");
    await block.panel.getByRole("button", { name: "Choose icon", exact: true }).click();
    await block.panel.getByRole("button", { name: "Music", exact: true }).click();
    await draftHas((d) =>
      d.blocks.some(
        (b) =>
          b.id === built.icon &&
          b.type === "link" &&
          b.icon?.type === "builtin" &&
          b.icon.name === "music",
      ),
    );
  });

  await test.step("a link with an uploaded thumbnail", async () => {
    const block = await addBlock(page, "link");
    built.thumb = block.id;
    await block.panel.getByLabel("Label", { exact: true }).fill("Merch table");
    await block.panel.getByLabel("Link", { exact: true }).fill("https://example.com/merch");
    await block.panel.getByRole("button", { name: "Choose icon", exact: true }).click();
    await block.panel.getByRole("button", { name: "Your image", exact: true }).click();
    await block.panel
      .locator('input[type="file"]')
      .setInputFiles(png("thumb.png", await splitImage(600, 600, "png")));
    const dialog = page.getByRole("dialog", { name: "Position your image" });
    await expect(dialog).toBeVisible({ timeout: 60_000 });
    await dialog.getByRole("button", { name: "Use image", exact: true }).click();
    const draft = await draftHas((d) =>
      d.blocks.some((b) => b.id === built.thumb && b.type === "link" && b.icon?.type === "image"),
    );
    const link = draft.blocks.find((b) => b.id === built.thumb)!;
    const path = link.type === "link" && link.icon?.type === "image" ? link.icon.image.path : "";
    expect(path).toMatch(OBJECT_PATH);
    expect(path).toMatch(/\/avatar-/);
    stored.push(path);
  });

  await test.step("a featured link with Gentle pulse", async () => {
    const block = await addBlock(page, "link");
    built.featured = block.id;
    await block.panel.getByLabel("Label", { exact: true }).fill("Tickets on sale");
    await block.panel.getByLabel("Link", { exact: true }).fill("https://example.com/tickets");
    await block.panel.getByRole("button", { name: "Feature this link", exact: true }).click();
    await block.panel.getByLabel("Motion", { exact: true }).selectOption({ label: "Gentle pulse" });
    await draftHas((d) =>
      d.blocks.some((b) => b.id === built.featured && b.type === "link" && b.featured === "pulse"),
    );
  });

  await test.step("a wide image block with a focus", async () => {
    const block = await addBlock(page, "image");
    built.wide = block.id;
    await block.panel
      .locator('input[type="file"]')
      .setInputFiles(png("wide.png", await splitImage(1600, 800, "png")));
    await expect(
      block.panel.getByRole("button", { name: "Replace image", exact: true }),
    ).toBeVisible({ timeout: 90_000 });
    await block.panel.getByLabel("Shape", { exact: true }).selectOption({ label: "Wide" });
    await pressFocus(block.panel, 0.8, 0.5);
    await block.panel
      .getByLabel("Alt text", { exact: true })
      .fill("A wide picture, red on the left and blue on the right");
    const draft = await draftHas((d) =>
      d.blocks.some(
        (b) =>
          b.id === built.wide &&
          b.type === "image" &&
          b.shape === "wide" &&
          b.image?.focus !== undefined,
      ),
    );
    const image = draft.blocks.find((b) => b.id === built.wide)!;
    if (image.type === "image" && image.image) stored.push(image.image.path);
  });

  await test.step("a card with a focus", async () => {
    const block = await addBlock(page, "card");
    built.card = block.id;
    await block.panel.getByLabel("Title", { exact: true }).fill("Night market");
    await block.panel.getByLabel("Link", { exact: true }).fill("https://example.com/night-market");
    await block.panel
      .locator('input[type="file"]')
      .setInputFiles(png("banner.png", await splitImage(1600, 640, "png")));
    await expect(
      block.panel.getByRole("button", { name: "Replace image", exact: true }),
    ).toBeVisible({ timeout: 90_000 });
    await pressFocus(block.panel, 0.2, 0.5);
    const draft = await draftHas((d) =>
      d.blocks.some(
        (b) => b.id === built.card && b.type === "card" && b.image?.focus !== undefined,
      ),
    );
    const card = draft.blocks.find((b) => b.id === built.card)!;
    if (card.type === "card" && card.image) stored.push(card.image.path);
  });

  await test.step("a Vimeo embed", async () => {
    const block = await addBlock(page, "embed");
    built.embed = block.id;
    await block.panel.getByLabel("Caption", { exact: true }).fill("Studio reel");
    await block.panel.getByLabel("Link", { exact: true }).fill("https://vimeo.com/76979871");
    await expect(block.panel.getByText("Vimeo video", { exact: true })).toBeVisible();
    await draftHas((d) =>
      d.blocks.some(
        (b) => b.id === built.embed && b.type === "embed" && b.url.includes("vimeo.com"),
      ),
    );
  });

  await test.step("a text block with bold, italic and a link", async () => {
    const block = await addBlock(page, "text");
    built.text = block.id;
    const textarea = block.panel.getByLabel("Text", { exact: true });
    await textarea.fill("Make it bold, make it italic, or open the link here.");
    const toolbar = block.panel.getByRole("toolbar", { name: "Text formatting" });
    // "bold" is characters 8 to 12, "italic" 22 to 28, "the link here" 38 to 51.
    await select(page, textarea, 8, 12);
    await toolbar.getByRole("button", { name: "Bold", exact: true }).click();
    await select(page, textarea, 22, 28);
    await toolbar.getByRole("button", { name: "Italic", exact: true }).click();
    await select(page, textarea, 38, 51);
    await toolbar.getByRole("button", { name: "Link", exact: true }).click();
    const panel = block.panel.getByRole("group", { name: "Add link" });
    await panel.getByLabel("Link address", { exact: true }).fill("example.com/open");
    await panel.getByRole("button", { name: "Add link", exact: true }).click();
    const draft = await draftHas((d) => {
      const b = d.blocks.find((x) => x.id === built.text);
      return b?.type === "text" && (b.marks ?? []).length === 3;
    });
    const marks = (draft.blocks.find((b) => b.id === built.text) as { marks: { type: string }[] })
      .marks;
    expect(marks.map((m) => m.type).sort()).toEqual(["bold", "italic", "link"]);
  });

  await waitSaved(page);
  return built;
}

/**
 * Every block of the page (and the profile parts) under `rootSelector`, by id, as markup with the
 * attributes in alphabetical order. A browser keeps attributes in the order they were first set, so
 * an element React updated in place (an icon chosen after the link was added) lists them differently
 * from one rendered fresh, and an inline style is written differently by the server and by React's
 * update; the content is the same, and that is what is compared.
 */
async function markupOf(
  page: Page,
  rootSelector: string,
  ids: string[],
): Promise<Record<string, string | null>> {
  return page.evaluate(
    ({ root, blockIds }) => {
      const escape = (text: string) =>
        text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      const serialize = (node: Node): string => {
        if (node.nodeType === Node.TEXT_NODE) return escape(node.textContent ?? "");
        if (!(node instanceof Element)) return "";
        const attributes = Array.from(node.attributes)
          .map((attr) => {
            // The style attribute as the browser serializes it: the server writes
            // "object-position:80% 50%", React's in-place update leaves "object-position: 80% 50%;".
            const value =
              attr.name === "style" && node instanceof HTMLElement
                ? node.style.cssText
                : attr.value;
            return `${attr.name}="${value.replace(/"/g, "&quot;")}"`;
          })
          .sort()
          .join(" ");
        const tag = node.tagName.toLowerCase();
        return `<${tag}${attributes ? ` ${attributes}` : ""}>${Array.from(node.childNodes).map(serialize).join("")}</${tag}>`;
      };
      const scope = document.querySelector(root);
      const out: Record<string, string | null> = {};
      for (const id of blockIds) {
        const el = scope?.querySelector(`[data-block-id="${id}"]`);
        out[id] = el ? serialize(el) : null;
      }
      scope?.querySelectorAll("[data-profile-part]").forEach((el) => {
        out[`profile:${el.getAttribute("data-profile-part")}`] = serialize(el);
      });
      return out;
    },
    { root: rootSelector, blockIds: ids },
  );
}

const HOSTS_ALLOWED_TO_BE_REQUESTED = (own: string) =>
  new Set([
    own,
    // (M7-15 supersedes M6-34 step 3: the uploaded images load from /media on the root origin, not
    // from the Supabase Storage origin and not same-origin, to keep one CDN cache key per image.)
    "localhost",
    // Google Fonts for the page's font token: an existing request (see PROGRESS.md), not a Wave G one.
    "fonts.googleapis.com",
    "fonts.gstatic.com",
  ]);

test.describe("M6-34 a page using every Wave G feature", () => {
  test("M6-34 builds in the editor, publishes, and the preview, the live page and the QR code agree", async ({
    page,
    context,
  }, info) => {
    const phone = phoneOnly(info);
    const user = await emptyUser(context, phone ? "wgp" : "wgd");
    const owner: SignedInUser = {
      userId: user.id,
      email: user.email,
      handle: user.handle,
      pageId: user.pageId,
    };
    // Nothing third-party is reached from this run: stand-ins answer every embed host and font host.
    const reached = await stubThirdParties(context);
    await context.route(
      (u) => /^fonts\.(googleapis|gstatic)\.com$/.test(u.hostname),
      (route) => route.fulfill({ status: 200, contentType: "text/css", body: "" }),
    );
    await context.route(
      (u) => u.hostname === "example.com",
      (route) =>
        route.fulfill({
          status: 200,
          contentType: "text/html",
          body: "<!doctype html><title>stub</title><p>destination</p>",
        }),
    );

    await openEditor(page);
    const built = await buildPage(page, owner);
    const blockIds = [
      built.icon,
      built.thumb,
      built.featured,
      built.wide,
      built.card,
      built.embed,
      built.text,
    ];

    // Step 1: publish and wait for "Published".
    await publishNow(page);

    // The Share preview card's words, read before they could change (it is on the Share tab).
    await page.getByRole("tab", { name: "Share", exact: true }).click();
    const shownTitle = await sharePreview(page).getByTestId("share-preview-title").innerText();
    const shownDescription = await sharePreview(page)
      .getByTestId("share-preview-description")
      .innerText();
    expect(shownTitle).toBe("Everything in Wave G");

    // Step 2: parity of the markup, block by block, preview against live.
    const liveUrl = url(owner.handle);
    const livePage = await context.newPage();
    const watcher = await watchCsp(livePage);
    const requested: string[] = [];
    livePage.on("request", (request) => {
      if (!/^(blob|data):/.test(request.url())) requested.push(new URL(request.url()).hostname);
    });
    const response = await livePage.goto(liveUrl);
    expect(response!.status()).toBe(200);
    await expect(livePage.getByRole("heading", { level: 1 })).toHaveText(built.profileName);

    await showView(page, "Preview");
    const previewHtml = await markupOf(page, '[data-testid="preview-screen"]', blockIds);
    const liveHtml = await markupOf(livePage, "[data-page-root]", blockIds);
    for (const id of blockIds) {
      expect(liveHtml[id], `block ${id} is on the live page`).not.toBeNull();
      expect(previewHtml[id], `block ${id} is in the preview`).toBe(liveHtml[id]);
    }
    for (const key of Object.keys(liveHtml).filter((k) => k.startsWith("profile:"))) {
      expect(previewHtml[key], key).toBe(liveHtml[key]);
    }
    // The hrefs are the same relative /r/<pageId>/<id> paths in both.
    for (const id of [built.icon, built.thumb, built.featured]) {
      expect(liveHtml[id]).toContain(`href="/r/${owner.pageId}/${id}"`);
    }

    // The two screenshots the integration agent reads (the preview frame and the live page).
    await page.getByTestId("preview-screen").screenshot({
      path: `tmp/screens/m6-wave-g-preview-${info.project.name}.png`,
    });
    await livePage.screenshot({
      path: `tmp/screens/m6-wave-g-live-${info.project.name}.png`,
      fullPage: true,
    });

    // Step 3: what the live page does. Nothing leaves its own host but the fonts (the uploaded images come from /media).
    const allowed = HOSTS_ALLOWED_TO_BE_REQUESTED(`${owner.handle}.localhost`);
    for (const host of requested) expect(allowed.has(host), `a request to ${host}`).toBe(true);
    expect(reached.filter((host) => !/^fonts\./.test(host))).toEqual([]);

    // Tapping the Vimeo facade mounts a player.vimeo.com iframe with no CSP violation.
    const src = await tapAndGetSrc(livePage, built.embed);
    expect(new URL(src).hostname).toBe("player.vimeo.com");
    expect(src).toContain("/video/76979871");
    await expect(embedOf(livePage, built.embed).locator("iframe")).toHaveAttribute(
      "title",
      /Studio reel/,
    );
    expect(await watcher.violations()).toEqual([]);
    expect(watcher.messages).toEqual([]);

    // Reduced motion stops the featured motion; otherwise it runs.
    const featured = livePage.locator(`.pg-link[data-block-id="${built.featured}"]`);
    await livePage.emulateMedia({ reducedMotion: "reduce" });
    expect(await css(featured, "animation-name")).toBe("none");
    expect(await css(featured, "animation-name", "::after")).toBe("none");
    await livePage.emulateMedia({ reducedMotion: "no-preference" });
    const moving =
      (await css(featured, "animation-name")) !== "none" ||
      (await css(featured, "animation-name", "::after")) !== "none";
    expect(moving).toBe(true);

    // Layout of the live page.
    if (phone) {
      await expectNoHorizontalScroll(livePage);
      await expectTapTargets(livePage, "[data-page-root]");
    } else {
      const geometry = await livePage.evaluate(() => {
        const column = document.querySelector(".pg-column")!.getBoundingClientRect();
        const root = document.querySelector("[data-page-root]")!.getBoundingClientRect();
        return {
          width: column.width,
          center: column.left + column.width / 2,
          rootWidth: root.width,
          rootHeight: root.height,
          view: window.innerWidth,
          viewHeight: window.innerHeight,
        };
      });
      expect(geometry.width).toBeLessThanOrEqual(480);
      expect(Math.abs(geometry.center - geometry.view / 2)).toBeLessThanOrEqual(2);
      expect(geometry.rootWidth).toBeGreaterThanOrEqual(geometry.view - 1);
      expect(geometry.rootHeight).toBeGreaterThanOrEqual(geometry.viewHeight - 1);
      await expectNoHorizontalScroll(livePage);
    }

    // The tenant CSP is exactly the M6-26 string, on the response itself.
    expect(response!.headers()["content-security-policy"]).toBe(TENANT_CONTENT_SECURITY_POLICY);
    expect(TENANT_CONTENT_SECURITY_POLICY).toBe(
      "frame-src https://www.youtube-nocookie.com https://open.spotify.com https://player.vimeo.com https://www.tiktok.com https://www.instagram.com https://w.soundcloud.com https://embed.music.apple.com https://player.twitch.tv https://clips.twitch.tv; img-src 'self' http://localhost:3000; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    );

    // Clicking the featured link and the text link follows /r/ to their destinations and writes events.
    const published = (await pageRow(owner.pageId)).published as {
      blocks: { id: string; type: string; marks?: { type: string; id?: string; url?: string }[] }[];
    };
    const textBlock = published.blocks.find((b) => b.id === built.text)!;
    const linkMark = textBlock.marks!.find((m) => m.type === "link")!;
    const featuredHref = `/r/${owner.pageId}/${built.featured}`;
    await livePage.goto(liveUrl);
    const [featuredRequest] = await Promise.all([
      livePage.waitForRequest((r) => r.url().includes(featuredHref)),
      livePage.locator(`.pg-link[data-block-id="${built.featured}"]`).click(),
    ]);
    expect(featuredRequest.url()).toContain(featuredHref);
    await livePage.waitForURL(/example\.com\/tickets/);
    await livePage.goto(liveUrl);
    const textLink = livePage.locator(`[data-block-id="${built.text}"] a`).first();
    await expect(textLink).toHaveAttribute("href", `/r/${owner.pageId}/${linkMark.id}`);
    await Promise.all([livePage.waitForURL(/example\.com\/open/), textLink.click()]);
    await expect
      .poll(
        async () => {
          const { data } = await adminClient()
            .from("events")
            .select("block_id")
            .eq("page_id", owner.pageId)
            .eq("type", "click");
          return (data ?? []).map((row) => row.block_id as string).sort();
        },
        { timeout: 20_000 },
      )
      .toEqual([built.featured, linkMark.id!].sort());

    // The analytics screen names both.
    await page.goto(url("app", "/analytics"));
    const links = page.getByTestId("links-card");
    await expect(links.getByRole("heading", { name: "Clicks by link" })).toBeVisible();
    await expect(links).toContainText("Tickets on sale");
    await expect(links).toContainText("the link here");

    // Step 4: sharing. The tags equal the preview card's words; /og is the uploaded picture at 1200x630.
    const html = await (await page.request.get(liveUrl)).text();
    const tags = socialTags(html);
    expect(tags.ogTitle).toBe(shownTitle);
    expect(tags.twitterTitle).toBe(shownTitle);
    expect(tags.ogDescription).toBe(shownDescription);
    expect(tags.twitterDescription).toBe(shownDescription);
    expect(tags.title).toBe(`${built.profileName} - links`);
    const og = await page.request.get(tags.ogImage!);
    expect(og.status()).toBe(200);
    expect(og.headers()["content-type"]).toBe("image/png");
    const ogPng = Buffer.from(await og.body());
    expect(pngSizeOf(ogPng)).toEqual({ width: 1200, height: 630 });
    // The 1600x800 picture, red left and blue right, shows with its focus at 80 percent: red at the
    // left edge of the frame and blue in the middle.
    expect(near(await pixelAt(ogPng, 40, 315), RED)).toBe(true);
    expect(near(await pixelAt(ogPng, 600, 315), BLUE)).toBe(true);

    // The QR code downloaded from the editor decodes to exactly the live address, which answers 200 with the h1.
    await page.goto(url("app", "/share"));
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page
        .getByTestId("qr-card")
        .getByRole("button", { name: "Download PNG", exact: true })
        .click(),
    ]);
    expect(download.suggestedFilename()).toBe(`${owner.handle}-qr.png`);
    await expectQrOf(await readDownload(download), liveUrl);
    const opened = await livePage.goto(liveUrl);
    expect(opened!.status()).toBe(200);
    await expect(livePage.getByRole("heading", { level: 1 })).toHaveText(built.profileName);

    // The same page in the editor preview matches the live page at this viewport too: the numbers.
    if (!phone) {
      const previewColumn = await page.evaluate(() => {
        const column = document.querySelector('[data-testid="preview-screen"] .pg-column');
        return column ? column.getBoundingClientRect().width : null;
      });
      expect(previewColumn).not.toBeNull();
    }
  });
});

// The security sweep -----------------------------------------------------------------------------

const IMG_PATH = (uid: string) => `${uid}/img-0123456789ab.webp`;

test.describe("M6-34 crafted drafts are refused at Publish", () => {
  test("M6-34 with the publishable key and another user's JWT, each crafted draft leaves the live page unchanged", async ({
    browser,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "the sweep is the same on both projects: one is enough");
    test.setTimeout(900_000);
    const a = await signedInUser(context, { label: "wsa" });
    const contextB: BrowserContext = await browser.newContext({
      baseURL: info.project.use.baseURL,
    });
    const b = await signedInUser(contextB, { label: "wsb" });
    const pageB = await contextB.newPage();
    await openEditor(pageB);
    const token = await accessToken(contextB);
    const before = await pageRow(b.pageId);
    const html = async () => (await rawBuffer(`${b.handle}.localhost:3000`, "/")).text;
    const liveBefore = await html();

    const mine = IMG_PATH(b.userId);
    const link = (id: string, extra: Record<string, unknown> = {}) => ({
      id,
      type: "link",
      visible: true,
      label: `Link ${id}`,
      url: "https://example.com/x",
      ...extra,
    });
    const textBlock = (id: string, text: string, marks: unknown[]) => ({
      id,
      type: "text",
      visible: true,
      text,
      marks,
    });
    const crafted: {
      name: string;
      /** The sentence the schema gives for it (the media checks of the gate are covered by tests/unit/m6-share-publish.test.ts). */
      message?: RegExp;
      draft: (base: Record<string, unknown>) => Record<string, unknown>;
    }[] = [
      {
        name: "a link icon in user A's folder",
        draft: (base) => ({
          ...base,
          blocks: [
            link("sw-icon-0001", {
              icon: {
                type: "image",
                image: { path: `${a.userId}/avatar-0123456789ab.webp`, width: 400, height: 400 },
              },
            }),
          ],
        }),
      },
      {
        name: "a share image in user A's folder",
        draft: (base) => ({
          ...base,
          blocks: [link("sw-lnk-00001")],
          share: {
            title: "",
            description: "",
            image: { path: IMG_PATH(a.userId), width: 1200, height: 630 },
          },
        }),
      },
      {
        name: "an unknown icon name",
        message: /Pick an icon from the list\./,
        draft: (base) => ({
          ...base,
          blocks: [link("sw-name-0001", { icon: { type: "builtin", name: 'x"onload="alert(1)' } })],
        }),
      },
      {
        name: "a focus of 5",
        message: /Choose a focus point inside the image\./,
        draft: (base) => ({
          ...base,
          blocks: [
            {
              id: "sw-focus-0001",
              type: "image",
              visible: true,
              alt: "x",
              image: { path: mine, width: 1200, height: 630, focus: { x: 5, y: 0.5 } },
            },
          ],
        }),
      },
      {
        name: "an image shape of x",
        message: /Pick a shape from the list\./,
        draft: (base) => ({
          ...base,
          blocks: [
            {
              id: "sw-shape-0001",
              type: "image",
              visible: true,
              alt: "x",
              shape: "x",
              image: { path: mine, width: 1200, height: 630 },
            },
          ],
        }),
      },
      {
        name: "featured blink",
        draft: (base) => ({ ...base, blocks: [link("sw-blink-0001", { featured: "blink" })] }),
      },
      {
        name: "a fourth featured link",
        message: /Feature up to 3 links\. Turn one off to feature another\./,
        draft: (base) => ({
          ...base,
          blocks: [1, 2, 3, 4].map((n) => link(`sw-feat-000${n}`, { featured: "bold" })),
        }),
      },
      {
        name: "a Vimeo look-alike host",
        draft: (base) => ({
          ...base,
          blocks: [
            {
              id: "sw-vimeo-0001",
              type: "embed",
              visible: true,
              caption: "x",
              url: "https://vimeo.com.evil.example/123456",
            },
          ],
        }),
      },
      {
        name: "a text link with a javascript: address",
        draft: (base) => ({
          ...base,
          blocks: [
            textBlock("sw-text-0001", "Open the link", [
              { type: "link", start: 0, end: 4, id: "sw-mark-0001", url: "javascript:alert(1)" },
            ]),
          ],
        }),
      },
      {
        name: "overlapping link marks",
        message: /Links can’t overlap\. Remove the other link first\./,
        draft: (base) => ({
          ...base,
          blocks: [
            textBlock("sw-text-0002", "Open the link", [
              { type: "link", start: 0, end: 8, id: "sw-mark-0002", url: "https://example.com/a" },
              { type: "link", start: 5, end: 12, id: "sw-mark-0003", url: "https://example.com/b" },
            ]),
          ],
        }),
      },
      {
        name: "a duplicate link id",
        message: /Ids must be unique within a page\./,
        draft: (base) => ({
          ...base,
          blocks: [
            textBlock("sw-text-0003", "Open the link", [
              { type: "link", start: 0, end: 4, id: "sw-mark-0004", url: "https://example.com/a" },
              { type: "link", start: 6, end: 9, id: "sw-mark-0004", url: "https://example.com/b" },
            ]),
          ],
        }),
      },
    ];

    /** Clicks Publish and waits until the Server Action has answered, so what is read next is its result. */
    const publishAndWait = async () => {
      const answered = pageB.waitForResponse(
        (response) =>
          response.request().method() === "POST" && !!response.request().headers()["next-action"],
        { timeout: 120_000 },
      );
      await pageB.getByRole("button", { name: "Publish", exact: true }).click();
      await answered;
    };
    const dismiss = async () => {
      const button = pageB.getByRole("button", { name: "Dismiss", exact: true });
      if (await button.isVisible()) await button.click();
    };

    for (const { name, draft, message } of crafted) {
      const write = await userClient(token)
        .from("pages")
        .update({ draft: draft(before.draft as unknown as Record<string, unknown>) })
        .eq("id", b.pageId)
        .select("id");
      expect(write.error, `${name}: the draft itself is accepted like any draft`).toBeNull();
      await dismiss();
      await publishAndWait();
      const alert = pageB.getByRole("alert").first();
      await expect(alert, name).toBeVisible({ timeout: 60_000 });
      if (message) {
        // The editor lists an error under a block it knows; this draft's blocks are the crafted ones,
        // so the sentence is read from the same validator the gate runs.
        expect(
          collectPublishErrors(
            crafted.find((c) => c.name === name)!.draft(before.draft as never),
          ).map((error) => error.message),
          name,
        ).toEqual(expect.arrayContaining([expect.stringMatching(message)]));
      }
      const row = await pageRow(b.pageId);
      expect(row.published, `${name}: pages.published is unchanged`).toEqual(before.published);
      expect(row.published_at, `${name}: published_at is unchanged`).toEqual(before.published_at);
    }

    // A text link to a blocklisted host: refused at draft save, and, listed after the save, at Publish.
    const host = `blk-${rand(8)}.example`;
    const { error: listError } = await adminClient()
      .from("blocked_domains")
      .insert({ domain: host, reason: "e2e" });
    expect(listError).toBeNull();
    try {
      const blockedDraft = {
        ...before.draft,
        blocks: [
          textBlock("sw-text-0004", "Open the link", [
            { type: "link", start: 0, end: 4, id: "sw-mark-0005", url: `https://${host}/x` },
          ]),
        ],
      };
      const refused = await userClient(token)
        .from("pages")
        .update({ draft: blockedDraft as never })
        .eq("id", b.pageId)
        .select("id");
      expect(refused.error?.message ?? "").toContain("blocked_link");
      expect(refused.error?.code).toBe("HL005");
      const stored = (await pageRow(b.pageId)).draft as { blocks: { id: string }[] };
      expect(stored.blocks.some((blk) => blk.id === "sw-text-0004")).toBe(false);
    } finally {
      await adminClient().from("blocked_domains").delete().eq("domain", host);
    }
    const late = `blk-${rand(8)}.example`;
    const lateDraft = {
      ...before.draft,
      blocks: [
        textBlock("sw-text-0005", "Open the link", [
          { type: "link", start: 0, end: 4, id: "sw-mark-0006", url: `https://${late}/x` },
        ]),
      ],
    };
    const saved = await userClient(token)
      .from("pages")
      .update({ draft: lateDraft as never })
      .eq("id", b.pageId)
      .select("id");
    expect(saved.error).toBeNull();
    await adminClient().from("blocked_domains").insert({ domain: late, reason: "e2e" });
    try {
      await dismiss();
      await publishAndWait();
      await expect(pageB.getByRole("alert").first(), "blocked at Publish").toBeVisible({
        timeout: 60_000,
      });
      const row = await pageRow(b.pageId);
      expect(row.published).toEqual(before.published);
      expect(row.published_at).toEqual(before.published_at);
    } finally {
      await adminClient().from("blocked_domains").delete().eq("domain", late);
    }

    // The live page of B never showed any of it.
    const liveAfter = await html();
    for (const needle of ["evil.example", "javascript:alert", "blink", late]) {
      expect(liveAfter, needle).not.toContain(needle);
    }
    const blocksOf = (markup: string) =>
      /<main class="pg-blocks">[\s\S]*?<\/main>/.exec(markup)?.[0];
    expect(blocksOf(liveAfter)).toBeDefined();
    expect(blocksOf(liveAfter)).toBe(blocksOf(liveBefore));
    await contextB.close();
  });
});

// Static scans -----------------------------------------------------------------------------------

const filesIn = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesIn(path) : [path];
  });
const stripComments = (text: string) =>
  text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

test.describe("M6-34 static scans", () => {
  test("M6-34 no dangerouslySetInnerHTML in src/components/page", async ({}, info) => {
    test.skip(!desktopOnly(info), "reads files: one project is enough");
    for (const file of filesIn("src/components/page").filter((f) => /\.(tsx?|jsx?)$/.test(f))) {
      expect(stripComments(readFileSync(file, "utf8")), file).not.toContain(
        "dangerouslySetInnerHTML",
      );
    }
  });

  test("M6-34 the only @media in the renderer CSS is prefers-reduced-motion, and it holds no color literal or --hl- reference", async ({}, info) => {
    test.skip(!desktopOnly(info), "reads files: one project is enough");
    for (const file of filesIn("src/components/page").filter((f) => f.endsWith(".css"))) {
      const css = stripComments(readFileSync(file, "utf8"));
      for (const media of css.match(/@media[^{]*\{/g) ?? []) {
        expect(media, `${file}: ${media}`).toMatch(/prefers-reduced-motion/);
      }
      expect(css, file).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      // Hex and rgb() literals, as tests/unit/renderer-static.test.ts defines them: the embed facade's
      // fixed near-black poster is written in hsl() on purpose and stays allowed.
      expect(css, file).not.toMatch(/\brgba?\s*\(/i);
      expect(css, file).not.toContain("--hl-");
    }
  });

  test("M6-34 the upload route's kinds are still avatar, background and content, and every stored name matches the pattern", async ({}, info) => {
    test.skip(!desktopOnly(info), "reads files: one project is enough");
    const limits = readFileSync("src/lib/media/limits.ts", "utf8");
    expect(limits).toMatch(/UPLOAD_KINDS\s*=\s*\[\s*"avatar",\s*"background",\s*"content"\s*\]/);
    expect(
      OBJECT_PATH.test(`${"6f1c2a52-3a1e-4c0b-9d57-0b8f2f7a1e01"}/avatar-0123456789ab.webp`),
    ).toBe(true);
    expect(
      OBJECT_PATH.test(`${"6f1c2a52-3a1e-4c0b-9d57-0b8f2f7a1e01"}/icon-0123456789ab.webp`),
    ).toBe(false);
  });
});
