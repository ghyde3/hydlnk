import { expect, test, type Page } from "@playwright/test";
import { emptyDraft, type Block, type DraftDoc } from "@/lib/document";
import { cleanupUsers } from "../fixtures/data";
import { uploadImage } from "../m2/blocks-helpers";
import { emptyUser, openEditor, setDraft } from "../m2/editor-helpers";
import { link, liveUser, publishDraft, SERVER_PORT, tenantUrl } from "./render-helpers";

/**
 * M8-08: the live page and the editor's full-size Preview of the same document look the same. One
 * renderer (PageRenderer), run two ways: React in the browser for the preview, finished HTML built on
 * the server for the live page. For every [data-block-id], [data-item-id] and [data-profile-part] the
 * box (x, y, width, height), measured from the page root, differs by at most 1px at 390x844 and
 * 1440x900, and the computed text and surface styles of the name, the first link, the card title and
 * the badge are equal. The preview's Google stylesheet is answered with the live page's own @font-face
 * rules, so both sides draw the same font bytes (system fonts when the font files are not vendored).
 */

test.afterAll(cleanupUsers);
test.describe.configure({ timeout: 120_000 });

const PREVIEW_HOST = `app.localhost:${SERVER_PORT}`;

const blocks: Block[] = [
  { id: "social-par-0001", type: "social", visible: true, icons: [
    { id: "ic-ig-par-0001", platform: "instagram", url: "https://instagram.com/x" },
    { id: "ic-yt-par-0001", platform: "youtube", url: "https://youtube.com/@x" },
    { id: "ic-em-par-0001", platform: "email", address: "hello@example.com" },
  ] },
  { id: "header-par-0001", type: "header", visible: true, text: "Book a session" },
  { ...link("link-par-0001", "Portrait sessions", "https://example.com/a"), icon: { type: "builtin", name: "camera" }, featured: "pulse" } as Block,
  link("link-par-0002", "Workshops and a very long label that has to wrap inside the button now", "https://example.com/b"),
  { id: "text-par-0001", type: "text", visible: true, text: "Bold, italic and a link inside one text block.", marks: [
    { type: "bold", start: 0, end: 4 }, { type: "italic", start: 6, end: 12 },
    { type: "link", id: "mk-par-0001", start: 27, end: 31, url: "https://example.com/about" },
  ] } as Block,
  { id: "card-par-0001", type: "card", visible: true, title: "Night Market", caption: "View the gallery", url: "https://example.com/c", image: null },
  { id: "embed-par-0001", type: "embed", visible: true, url: "https://www.youtube.com/watch?v=jNQXAC9IVRw", caption: "Behind the lens" },
  { id: "embed-par-0002", type: "embed", visible: true, url: "https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC", caption: "Playlist" },
  { id: "grid-par-0001", type: "grid", visible: true, cells: [
    { id: "cell-par-0001", title: "Prints", subtitle: "Shop", url: "https://example.com/p" },
    { id: "cell-par-0002", title: "Workshops", subtitle: "", url: "https://example.com/w" },
  ] },
  { id: "divider-par-0001", type: "divider", visible: true },
];

async function measure(page: Page) {
  return page.evaluate(() => {
    const root = document.querySelector("[data-page-root]")!.getBoundingClientRect();
    const keyOf = (el: Element) =>
      el.getAttribute("data-block-id") ??
      el.getAttribute("data-item-id") ??
      `profile:${el.getAttribute("data-profile-part")}`;
    const boxes: Record<string, [number, number, number, number]> = {};
    for (const el of document.querySelectorAll("[data-block-id], [data-item-id], [data-profile-part]")) {
      const key = keyOf(el);
      if (key === "profile") continue; // the preview's header wrapper only (editable mode)
      const rect = el.getBoundingClientRect();
      boxes[key] = [rect.x - root.x, rect.y - root.y, rect.width, rect.height];
    }
    const style = (selector: string) => {
      const el = document.querySelector(selector);
      if (!el) return null;
      const s = getComputedStyle(el);
      return {
        fontFamily: s.fontFamily,
        fontSize: s.fontSize,
        color: s.color,
        backgroundColor: s.backgroundColor,
        borderRadius: s.borderRadius,
      };
    };
    return {
      boxes,
      rootWidth: root.width,
      styles: {
        name: style("[data-profile-part='name']"),
        link: style("[data-block-type='link']"),
        card: style(".pg-card-title"),
        badge: style(".pg-footer-link"),
      },
    };
  });
}

test("M8-08 the live page and the full-size Preview agree to within 1px, block by block, at 390 and 1440", async ({ context, page }) => {
  const user = await liveUser(context, "pr1", { blocks, bio: "Portrait & studio photographer" });
  // Fraunces over Inter, so the font files (when vendored) are part of the comparison.
  const draft: DraftDoc = JSON.parse(JSON.stringify(user.draft));
  draft.theme = { ref: null, overrides: { fontHeading: "Fraunces", weightHeading: 700, fontBody: "Inter" } as DraftDoc["theme"]["overrides"] };
  await setDraft(user.pageId, draft);
  await publishDraft(user.pageId, draft);

  const response = await page.goto(tenantUrl(user.handle));
  expect(response?.status()).toBe(200);
  await page.evaluate(() => document.fonts.ready);
  const liveHtml = await page.content();
  const faces = [...liveHtml.matchAll(/@font-face\{[^}]*\}/g)].map((m) => m[0]);
  const live = await measure(page);

  // The preview answers its Google stylesheet with the same faces, read from the files of our own host.
  await page.route(/^https:\/\/fonts\.googleapis\.com\//, (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/css",
      body: faces.join("\n").replaceAll("url(/_t/", `url(http://${PREVIEW_HOST}/_t/`),
    }),
  );
  await page.route(/^https:\/\/fonts\.gstatic\.com\//, (route) => route.abort());
  const preview = await page.goto(`http://${PREVIEW_HOST}/preview/${user.pageId}`);
  expect(preview?.status()).toBe(200);
  await page.evaluate(() => document.fonts.ready);
  const shown = await measure(page);

  // Same width of root: the preview's slim bar is above it, not around it.
  expect(Math.abs(shown.rootWidth - live.rootWidth)).toBeLessThanOrEqual(1);
  const missing = Object.keys(live.boxes).filter((key) => !(key in shown.boxes));
  expect(missing, "elements of the live page the preview lacks").toEqual([]);
  expect(Object.keys(live.boxes).length).toBeGreaterThan(15);
  for (const [key, box] of Object.entries(live.boxes)) {
    const other = shown.boxes[key]!;
    for (let i = 0; i < 4; i++) {
      expect(Math.abs(box[i]! - other[i]!), `${key} [x,y,w,h][${i}]: live ${box[i]} vs preview ${other[i]}`).toBeLessThanOrEqual(1);
    }
  }
  expect(shown.styles).toEqual(live.styles);
  expect(live.styles.name).not.toBeNull();
  expect(live.styles.badge).not.toBeNull();
});

/**
 * A page made in the editor, published with the real Publish button, is the same markup on its live
 * URL as in the full-size Preview of the same account: one renderer, run in the browser for the
 * preview and on the server for the live page. Every embed's poster, tapped on the live page, mounts
 * its iframe under the page's policy with no violation.
 */
test("M8-08 a page published from the editor is byte-identical at its root on the live URL and in the Preview, and every poster mounts its player", async ({ context, page }, info) => {
  test.skip(info.project.name !== "desktop", "the editor flow is one pass");
  const user = await emptyUser(context, "pr2");
  const photo = await uploadImage(user.id, 400, 400);
  const banner = await uploadImage(user.id, 1200, 480);
  const draft = emptyDraft(user.handle) as DraftDoc;
  draft.profile.name = "Zq Parity";
  draft.profile.bio = "Portrait & studio photographer · Orlando";
  draft.profile.photo = photo;
  draft.theme = { ref: null, overrides: { fontHeading: "Fraunces", weightHeading: 700, fontBody: "Inter" } as DraftDoc["theme"]["overrides"] };
  draft.blocks = [
    { id: "social-pub-0001", type: "social", visible: true, icons: [
      { id: "ic-ig-pub-0001", platform: "instagram", url: "https://instagram.com/zq" },
      { id: "ic-em-pub-0001", platform: "email", address: "hello@example.com" },
    ] },
    { ...link("link-pub-0001", "Portrait sessions", "https://example.com/book"), icon: { type: "builtin", name: "camera" } } as Block,
    { id: "text-pub-0001", type: "text", visible: true, text: "Bold, italic and a link.", marks: [
      { type: "bold", start: 0, end: 4 }, { type: "italic", start: 6, end: 12 },
      { type: "link", id: "mk-pub-0001", start: 19, end: 23, url: "https://example.com/about" },
    ] } as Block,
    { id: "card-pub-0001", type: "card", visible: true, title: "Night Market", caption: "View", url: "https://example.com/n", image: banner },
    { id: "embed-pub-0001", type: "embed", visible: true, url: "https://www.youtube.com/watch?v=jNQXAC9IVRw", caption: "Video" },
    { id: "embed-pub-0002", type: "embed", visible: true, url: "https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC", caption: "Song" },
  ];
  await setDraft(user.pageId, draft);

  await openEditor(page);
  await page.getByTestId("workspace-toolbar").getByRole("button", { name: "Publish", exact: true }).click();
  await expect(page.locator("[data-publish-status]")).toHaveText("Published", { timeout: 30_000 });

  const rootOf = () => page.locator("[data-page-root]").evaluate((el) => el.outerHTML);
  await page.goto(`http://${PREVIEW_HOST}/preview/${user.pageId}`);
  const inPreview = await rootOf();
  const violations: string[] = [];
  await page.addInitScript(() =>
    document.addEventListener("securitypolicyviolation", (event) =>
      ((window as unknown as { __v?: string[] }).__v ??= []).push(event.violatedDirective),
    ),
  );
  await page.route(/^https:\/\/(www\.youtube-nocookie|open\.spotify)\./, (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>player</title>" }),
  );
  await page.goto(tenantUrl(user.handle));
  const onLive = await rootOf();
  expect(onLive).toBe(inPreview);

  // Every block of the draft, in its order, with its text, its href and its src.
  const ids = await page.locator("[data-page-root] [data-block-id]").evaluateAll((els) => els.map((el) => el.getAttribute("data-block-id")));
  expect(ids).toEqual(draft.blocks.map((block) => block.id));
  await expect(page.getByRole("link", { name: "Portrait sessions" })).toHaveAttribute("href", `/r/${user.pageId}/link-pub-0001`);
  await expect(page.locator(".pg-card-image")).toHaveAttribute("src", new RegExp(`/media/${banner.path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`));

  // Tapping each poster mounts its iframe, with no policy violation.
  for (let i = 0; i < 2; i++) await page.locator("button.pg-embed-play").first().click();
  await expect(page.locator("iframe")).toHaveCount(2);
  const sources = await page.locator("iframe").evaluateAll((frames) => frames.map((f) => new URL((f as HTMLIFrameElement).src).origin));
  expect(sources.sort()).toEqual(["https://open.spotify.com", "https://www.youtube-nocookie.com"]);
  violations.push(...(await page.evaluate(() => (window as unknown as { __v?: string[] }).__v ?? [])));
  expect(violations).toEqual([]);
});
