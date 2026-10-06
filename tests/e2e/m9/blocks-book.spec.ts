import { expect, test } from "@playwright/test";
import { adminClient, userClient } from "../fixtures/auth";
import { expireOwnerPages } from "../fixtures/expire";
import {
  accessTokenFor,
  cleanupUsers,
  desktopOnly,
  insertPage,
  makeUser,
  rand,
} from "../fixtures/data";
import {
  clickRows,
  collectRequests,
  foreignHosts,
  livePage,
  markupOf,
  settled,
} from "./store-blocks-helpers";
import { expectNoHorizontalScroll, url } from "../helpers";
import { emptyUser, draftWith, saveIndicator } from "../m2/editor-helpers";
import {
  addBlock,
  box,
  draftOf,
  expectDraft,
  makePng,
  openEditor,
  previewScreen,
  publishDocOf,
  rowOf,
  uploadImage,
  userWithDraft,
} from "../m2/blocks-helpers";
import { type Block, type PublishDoc } from "@/lib/document";

/**
 * M9-20 on a real page and in the editor: the book block (a cover, a title, an author and one
 * button per store). A page published with the secret key (so the public side does not depend on
 * the editor), the click redirect for each store, the editor's controls and the cover upload, and
 * the abuse cases through the owner's own JWT and the publishable key.
 */

test.afterAll(cleanupUsers);

// The first request of a route compiles it on the dev server, and the editor uploads a file.
test.describe.configure({ timeout: 120_000 });

const TITLE = "Lantern Lantern Lantern Lantern Lantern Lantern Lantern Lantern Lantern L".padEnd(
  80,
  "x",
);
const AUTHOR = "Mara Okafor with the Night Market Collective and many more"
  .padEnd(60, "x")
  .slice(0, 60);
const BLOCK_ID = "book-e2e-block1";
const LINKS = [
  { id: "book-e2e-amzn01", store: "amazon", url: "https://www.amazon.example/dp/0000000001" },
  { id: "book-e2e-appl01", store: "apple", url: "https://books.apple.example/us/book/id1" },
  {
    id: "book-e2e-bksh01",
    store: "bookshop",
    url: "https://bookshop.example/p/books/night-market",
  },
];
const WORDS = { amazon: "Amazon", apple: "Apple Books", bookshop: "Bookshop.org" } as const;

const png = (width = 300, height = 450) => ({
  name: "cover.png",
  mimeType: "image/png",
  buffer: makePng(width, height),
});

const bookOf = (cover: unknown, extra: Record<string, unknown> = {}): Block =>
  ({
    id: BLOCK_ID,
    type: "book",
    visible: true,
    title: TITLE,
    author: AUTHOR,
    cover,
    links: LINKS,
    ...extra,
  }) as Block;

test.describe("M9-20 the book block on a published page", () => {
  test("M9-20 cover, title, author and three store buttons: 44px targets, no overflow, wrapped long text, /r links, no destination in the markup, no third party", async ({
    page,
  }, info) => {
    expect(Array.from(TITLE)).toHaveLength(80);
    expect(Array.from(AUTHOR)).toHaveLength(60);
    const live = await livePage("bk1", (cover) => [bookOf(cover)]);
    const requests = collectRequests(page);
    await page.goto(live.url);
    await settled(page);
    await expectNoHorizontalScroll(page);

    const block = page.locator(`[data-block-id="${BLOCK_ID}"]`);
    await expect(block).toHaveAttribute("data-block-type", "book");

    // The cover: a 2:3 frame about 96px wide, the picture loaded, lazy and decoded asynchronously.
    const frame = block.locator(".pg-book-cover");
    const frameBox = await box(frame);
    expect(Math.abs(frameBox.width - 96)).toBeLessThanOrEqual(1);
    expect(Math.abs(frameBox.height / frameBox.width - 1.5)).toBeLessThan(0.02);
    const img = block.locator("img.pg-book-cover-img");
    await expect(img).toHaveAttribute("alt", `Cover of ${TITLE}`);
    await expect(img).toHaveAttribute("loading", "lazy");
    await expect(img).toHaveAttribute("decoding", "async");
    await expect(img).toHaveAttribute("referrerpolicy", "no-referrer");
    await expect(img).toHaveAttribute("width", "400");
    await expect(img).toHaveAttribute("height", "600");
    await expect
      .poll(() => img.evaluate((el) => (el as HTMLImageElement).naturalWidth > 0))
      .toBe(true);
    expect(await img.evaluate((el) => getComputedStyle(el).objectFit)).toBe("cover");

    // Long text wraps inside the column.
    for (const selector of [".pg-book-title", ".pg-book-author"]) {
      const text = block.locator(selector);
      expect(await text.evaluate((el) => el.scrollWidth <= el.clientWidth + 1), selector).toBe(
        true,
      );
    }
    await expect(block.locator("p.pg-book-title")).toHaveText(TITLE);
    await expect(block.locator("p.pg-book-author")).toHaveText(AUTHOR);

    // The buttons, in the stored order, each at least 44px tall, and so is every other anchor.
    const buttons = block.locator("a.pg-book-link");
    await expect(buttons).toHaveCount(3);
    for (const [index, link] of LINKS.entries()) {
      const button = buttons.nth(index);
      await expect(button).toHaveText(WORDS[link.store as keyof typeof WORDS]);
      await expect(button).toHaveAttribute("data-store", link.store);
      await expect(button).toHaveAttribute("href", `/r/${live.pageId}/${link.id}`);
      await expect(button).toHaveAttribute(
        "aria-label",
        `${TITLE} on ${WORDS[link.store as keyof typeof WORDS]}`,
      );
      await expect(button).toHaveAttribute("rel", "nofollow noopener");
      expect((await box(button)).height).toBeGreaterThanOrEqual(43.5);
    }
    for (const anchor of await page.locator("a").all()) {
      if (!(await anchor.isVisible())) continue;
      expect((await box(anchor)).height, await anchor.innerText()).toBeGreaterThanOrEqual(43.5);
    }

    if (desktopOnly(info)) {
      const blockBox = await box(block);
      expect(blockBox.width).toBeLessThanOrEqual(480);
      expect(blockBox.width).toBeGreaterThan(300);
      expect(Math.abs((await box(frame)).width - 96)).toBeLessThanOrEqual(1);
    }

    // The destinations are not in the markup; nothing was asked of another host.
    const html = await page.content();
    for (const link of LINKS) expect(html).not.toContain(new URL(link.url).host);
    expect(foreignHosts(requests, live.handle)).toEqual([]);
    expect(requests.some((request) => /\/media\//.test(request))).toBe(true);
  });

  test("M9-20 a page without the block carries none of its CSS; a page with it carries it in its one style element", async ({
    page,
  }) => {
    const plain = await livePage("bk2", () => [
      {
        id: "link-e2e-plain1",
        type: "link",
        visible: true,
        label: "Hello",
        url: "https://example.com/",
      } as Block,
    ]);
    await page.goto(plain.url);
    await settled(page);
    const plainCss = (await page.locator("style").allTextContents()).join("");
    expect(plainCss).not.toContain("pg-book");
    expect(await page.content()).not.toContain("pg-book");

    const withBook = await livePage("bk3", (cover) => [bookOf(cover)]);
    await page.goto(withBook.url);
    await settled(page);
    const css = (await page.locator("style").allTextContents()).join("");
    expect(css).toContain(".pg-book-link");
    expect(css).toContain(".pg-book-cover");
    expect(css).not.toContain("pg-map");
    expect(css).not.toContain("pg-app-badge");
  });

  test("M9-20 a title that is markup is drawn as text and runs nothing", async ({ page }) => {
    const live = await livePage("bk4", (cover) => [
      bookOf(cover, {
        title: "<img src=x onerror=alert(1)>",
        author: "</p><script>alert(1)</script>",
      }),
    ]);
    let dialogs = 0;
    page.on("dialog", async (dialog) => {
      dialogs += 1;
      await dialog.dismiss();
    });
    await page.goto(live.url);
    await settled(page);
    await expect(page.locator("p.pg-book-title")).toHaveText("<img src=x onerror=alert(1)>");
    await expect(page.locator("p.pg-book-author")).toHaveText("</p><script>alert(1)</script>");
    await expect(page.locator(".pg-book img")).toHaveCount(1); // the cover, and nothing the title made
    await expect(page.locator("p.pg-book-title img")).toHaveCount(0);
    expect(dialogs).toBe(0);
  });
});

test.describe("M9-20 the click redirect for each store", () => {
  test("M9-20 GET /r/<pageId>/<link id> is a 302 to the published URL with one click row each; every other id is a 404", async ({
    page,
  }) => {
    const live = await livePage("bk5", (cover) => [bookOf(cover)]);
    // The draft has a store the published document does not have, and a hidden book: Publish drops
    // a hidden block, so neither is in the published document.
    const draft = draftOf(live.handle, [
      bookOf(live.cover, {
        links: [
          ...LINKS,
          { id: "book-e2e-draft1", store: "amazon", url: "https://draft.example/" },
        ],
      }),
      {
        id: "book-e2e-hidden",
        type: "book",
        visible: false,
        title: "Hidden",
        author: "",
        cover: null,
        links: [{ id: "book-e2e-hidlnk", store: "amazon", url: "https://hidden.example/" }],
      },
    ]);
    const write = await adminClient().from("pages").update({ draft }).eq("id", live.pageId);
    expect(write.error).toBeNull();
    const other = await livePage("bk5b", (cover) => [bookOf(cover)]);
    const userAgent = await page.evaluate(() => navigator.userAgent);

    for (const link of LINKS) {
      const response = await page.request.get(
        `${live.url}r/${live.pageId}/${link.id}?to=https://evil.example&url=//evil.example`,
        { maxRedirects: 0, headers: { "user-agent": userAgent, referer: "https://evil.example/" } },
      );
      expect(response.status(), link.store).toBe(302);
      expect(response.headers().location).toBe(link.url);
      expect(response.headers()["cache-control"]).toBe("no-store");
      expect(response.headers()["set-cookie"]).toBeUndefined();
      await expect
        .poll(async () => (await clickRows(live.pageId, link.id)).length, { timeout: 15_000 })
        .toBe(1);
      expect((await clickRows(live.pageId, link.id))[0]).toMatchObject({
        type: "click",
        block_id: link.id,
      });
    }

    for (const target of [
      `${live.url}r/${live.pageId}/book-e2e-draft1`, // only in the draft
      `${live.url}r/${live.pageId}/book-e2e-hidlnk`, // in a hidden block
      `${live.url}r/${live.pageId}/${BLOCK_ID}`, // the book's own id has no target
      `${live.url}r/${live.pageId}/book-e2e-nobody`,
      `${other.url}r/${live.pageId}/${LINKS[0]!.id}`, // another page's host
    ]) {
      const response = await page.request.get(target, {
        maxRedirects: 0,
        headers: { "user-agent": userAgent },
      });
      expect(response.status(), target).toBe(404);
    }
    await page.waitForTimeout(500);
    for (const id of ["book-e2e-draft1", "book-e2e-hidlnk", BLOCK_ID]) {
      expect(await clickRows(live.pageId, id), id).toEqual([]);
    }
  });

  test("M9-20 a store that is removed and republished answers 404 and 'Clicks by link' reads 'Removed link' for its old clicks", async ({
    page,
    browser,
  }) => {
    const live = await livePage("bk6", (cover) => [bookOf(cover)]);
    const userAgent = await page.evaluate(() => navigator.userAgent);
    const link = LINKS[1]!;
    const before = await page.request.get(`${live.url}r/${live.pageId}/${link.id}`, {
      maxRedirects: 0,
      headers: { "user-agent": userAgent },
    });
    expect(before.status()).toBe(302);
    // The republish: the store is gone from the published document.
    const published = publishDocOf([bookOf(live.cover, { links: [LINKS[0]!, LINKS[2]!] })]);
    const write = await adminClient()
      .from("pages")
      .update({ published, published_at: new Date().toISOString() })
      .eq("id", live.pageId);
    expect(write.error).toBeNull();
    // A write behind the server's back: on a production build the cached click target is expired the
    // way the product does it (M9-13), as Publish would.
    await expireOwnerPages(browser, live.userId);
    const after = await page.request.get(`${live.url}r/${live.pageId}/${link.id}`, {
      maxRedirects: 0,
      headers: { "user-agent": userAgent },
    });
    expect(after.status()).toBe(404);
  });
});

test.describe("M9-20 the editor", () => {
  test("M9-20 add a book: counters, cover upload, up to three stores, 44px controls at 16px, the row summary, then Publish and the page matches the preview", async ({
    page,
    context,
  }, info) => {
    const user = await userWithDraft(context, "bk7");
    await openEditor(page);
    expect(
      await page
        .getByRole("region", { name: "Add a block" })
        .getByRole("button", { name: "Book", exact: true })
        .count(),
    ).toBe(1);
    const { row, panel, id } = await addBlock(page, "book");

    // Title and author, with counters.
    await expect(panel.getByText("0 / 80", { exact: true })).toBeVisible();
    await expect(panel.getByText("0 / 60", { exact: true })).toBeVisible();
    await panel.getByLabel("Title", { exact: true }).fill("The Night Market");
    await panel.getByLabel("Author", { exact: true }).fill("Mara Okafor");
    await expect(panel.getByText("16 / 80", { exact: true })).toBeVisible();
    await expect(panel.getByText("11 / 60", { exact: true })).toBeVisible();
    // A paste past the limit is cut, not refused.
    await panel.getByLabel("Author", { exact: true }).fill("a".repeat(75));
    await expect(panel.getByLabel("Author", { exact: true })).toHaveValue("a".repeat(60));
    await panel.getByLabel("Author", { exact: true }).fill("Mara Okafor");

    // The cover: Upload cover, then Replace cover and Remove, with its help line.
    await expect(panel.getByRole("button", { name: "Upload cover" })).toBeVisible();
    await expect(panel.getByText("JPG, PNG or WebP. Shown at a 2 to 3 ratio.")).toBeVisible();
    await panel.locator('input[type="file"]').setInputFiles(png());
    await expect(panel.getByRole("button", { name: "Replace cover" })).toBeVisible({
      timeout: 25_000,
    });
    for (const name of ["Replace cover", "Remove"]) {
      expect(
        (await box(panel.getByTestId("book-cover").getByRole("button", { name, exact: true })))
          .height,
      ).toBeGreaterThanOrEqual(43.5);
    }

    // Store rows: one at the start, up to three, "Add store" off at three with the reason.
    const rows = panel.getByRole("group");
    await expect(rows).toHaveCount(1);
    const add = panel.getByRole("button", { name: "Add store" });
    await add.click();
    await add.click();
    await expect(rows).toHaveCount(3);
    await expect(add).toBeDisabled();
    await expect(panel.getByText("You can add up to 3 stores.")).toBeVisible();
    // Each row has its store select, the address field and Move up, Move down and Remove.
    const stores = await panel
      .getByRole("combobox", { name: "Store" })
      .evaluateAll((els) => els.map((el) => (el as HTMLSelectElement).value));
    expect(stores).toEqual(["amazon", "apple", "bookshop"]);
    for (const [index, link] of LINKS.entries()) {
      await rows.nth(index).locator('input[data-field="url"]').fill(link.url);
    }
    // Move the Bookshop row up one place: the stored order follows.
    await rows.nth(2).getByRole("button", { name: "Move up" }).click();
    await expect(panel.getByRole("combobox", { name: "Store" }).nth(1)).toHaveValue("bookshop");

    // The row names the book and counts its stores.
    await expect(row).toContainText("The Night Market");
    await expect(row).toContainText("3 stores");

    // Every control is at least 44px tall and the inputs are 16px (no zoom on a phone).
    const controls = panel.locator("button, input:not([type=file]), select");
    const sizes = await controls.evaluateAll((els) =>
      els
        .filter((el) => (el as HTMLElement).offsetParent !== null)
        .map((el) => ({
          h: el.getBoundingClientRect().height,
          font: getComputedStyle(el).fontSize,
          tag: el.tagName,
          type: (el as HTMLInputElement).type,
          name:
            (el as HTMLElement).innerText ||
            (el as HTMLInputElement).placeholder ||
            el.getAttribute("data-field"),
        })),
    );
    for (const size of sizes) {
      expect(size.h, `${size.tag} ${size.name}`).toBeGreaterThanOrEqual(43.5);
      if (size.tag !== "BUTTON") expect(size.font, `${size.tag} ${size.name}`).toBe("16px");
    }
    await expectNoHorizontalScroll(page);

    // The draft holds what was typed, with a fresh id for every store and the block.
    const draft = await expectDraft(user.pageId, (d) =>
      d.blocks.some(
        (b) =>
          b.id === id &&
          b.type === "book" &&
          b.title === "The Night Market" &&
          b.author === "Mara Okafor" &&
          b.cover !== null &&
          b.links.length === 3 &&
          b.links.every((l) => l.url !== ""),
      ),
    );
    const stored = draft.blocks.find((b) => b.id === id) as Extract<Block, { type: "book" }>;
    expect(stored.links.map((l) => l.store)).toEqual(["amazon", "bookshop", "apple"]);
    expect(new Set([id, ...stored.links.map((l) => l.id)]).size).toBe(4);

    // Publish: the live page draws what the preview drew.
    const inPreview = desktopOnly(info) ? await markupOf(previewScreen(page), id) : null;
    await page.getByRole("button", { name: "Publish", exact: true }).first().click();
    await expect
      .poll(
        async () =>
          (await adminClient().from("pages").select("published_at").eq("id", user.pageId).single())
            .data?.published_at,
        { timeout: 20_000 },
      )
      .not.toBeNull();
    await page.goto(url(user.handle));
    await settled(page);
    await expect(page.locator(`[data-block-id="${id}"] a.pg-book-link`)).toHaveCount(3);
    if (inPreview !== null) expect(await markupOf(page.locator("body"), id)).toBe(inPreview);
  });

  test("M9-20 replacing or removing a cover changes only the draft: the published page keeps the old object", async ({
    context,
    page,
  }) => {
    const user = await makeUser("bk8");
    const handle = `zq-bk8-${rand(5)}`;
    const cover = await uploadImage(user.id, 400, 600);
    const doc = publishDocOf([bookOf(cover)]);
    const pageId = await insertPage(user.id, handle, {
      draft: draftOf(handle, [bookOf(cover)]),
      published: doc,
      published_at: new Date().toISOString(),
    });
    const { signInAs } = await import("../fixtures/auth");
    await signInAs(context, user.email);
    await openEditor(page);
    await rowOf(page, BLOCK_ID).locator("button[aria-expanded]").first().click();
    const panel = rowOf(page, BLOCK_ID).locator('[id^="block-panel-"]');
    await expect(panel.getByRole("button", { name: "Replace cover" })).toBeVisible();
    await panel
      .getByTestId("book-cover")
      .getByRole("button", { name: "Remove", exact: true })
      .click();
    await expect(panel.getByRole("button", { name: "Upload cover" })).toBeVisible();
    await expectDraft(pageId, (d) => d.blocks.some((b) => b.type === "book" && b.cover === null));
    const stored = (await adminClient().from("pages").select("published").eq("id", pageId).single())
      .data!.published as PublishDoc;
    expect((stored.blocks[0] as { cover: unknown }).cover).toEqual(cover);
    // The object itself is still in Storage (the live page still draws it).
    const { data } = await adminClient().storage.from("page-media").download(cover.path);
    expect(data).not.toBeNull();
  });

  test("M9-20 a store link to a blocked site shows 'That site is blocked' under that store's row and is not saved", async ({
    page,
    context,
  }) => {
    const domain = `bk-${rand(8)}.example`;
    const inserted = await adminClient().from("blocked_domains").insert({ domain, reason: "e2e" });
    expect(inserted.error).toBeNull();
    try {
      const user = await emptyUser(context, "bk9", {
        draft: draftWith("x", [bookOf(null, { title: "The Night Market" })]),
      });
      await openEditor(page);
      await rowOf(page, BLOCK_ID).locator("button[aria-expanded]").first().click();
      const item = rowOf(page, BLOCK_ID).locator(`[data-item-id="${LINKS[1]!.id}"]`);
      const field = item.locator('input[data-field="url"]');
      await field.fill(`https://books.${domain}/x`);
      await expect(item.getByText("That site is blocked. Use a different link.")).toBeVisible({
        timeout: 15_000,
      });
      // Only that row: the other stores are fine.
      await expect(
        rowOf(page, BLOCK_ID).getByText("That site is blocked. Use a different link."),
      ).toHaveCount(1);
      await field.fill(`https://ok-${rand(4)}.example/x`);
      await expect(
        rowOf(page, BLOCK_ID).getByText("That site is blocked. Use a different link."),
      ).toHaveCount(0, { timeout: 15_000 });
      await expect(saveIndicator(page)).not.toHaveAttribute("data-save-status", "blocked");
      expect(user.pageId).toBeTruthy();
    } finally {
      await adminClient().from("blocked_domains").delete().eq("domain", domain);
    }
  });
});

test.describe("M9-20 abuse: a draft written as raw JSON with the owner's own JWT", () => {
  test("M9-20 store 'evil', data: and credential URLs are refused at Publish, each field is named and nothing is published", async ({
    page,
    context,
  }) => {
    const links = [
      { id: "book-evil-lnk01", store: "evil", url: "https://example.com/ok" },
      { id: "book-evil-lnk02", store: "apple", url: "data:text/html,x" },
      { id: "book-evil-lnk03", store: "bookshop", url: "https://user@host.example/" },
    ];
    const user = await userWithDraft(context, "bk10", (handle) =>
      draftOf(handle, [bookOf(null, { links, title: "<img src=x onerror=alert(1)>" })]),
    );
    // The publishable key and the owner's JWT, as curl would use them: RLS lets the owner write it.
    const client = userClient(await accessTokenFor(user.email));
    const write = await client
      .from("pages")
      .update({
        draft: draftOf(user.handle, [
          bookOf(null, { links, title: "<img src=x onerror=alert(1)>" }),
        ]),
      })
      .eq("id", user.pageId);
    expect(write.error).toBeNull();

    await openEditor(page);
    await page.getByRole("button", { name: "Publish", exact: true }).first().click();
    const alert = page.getByRole("alert").filter({ hasText: "before publishing" });
    await expect(alert).toBeVisible();
    for (const link of links) {
      await expect(rowOf(page, BLOCK_ID).locator(`[data-item-id="${link.id}"]`)).toHaveAttribute(
        "data-invalid",
        "true",
      );
    }
    const panel = rowOf(page, BLOCK_ID).locator('[id^="block-panel-"]');
    await expect(panel.getByText("Pick Amazon, Apple Books or Bookshop.org.")).toBeVisible();

    const stored = await adminClient()
      .from("pages")
      .select("published, published_at")
      .eq("id", user.pageId)
      .single();
    expect(stored.data).toEqual({ published: null, published_at: null });
    const body = await (await page.request.get(url(user.handle))).text();
    expect(body).not.toContain("pg-book");
    expect(body).not.toContain("data:text/html");
    expect(body).not.toContain("user@host.example");
  });

  test("M9-20 a cover in another owner's folder is refused at Publish under the Cover field, and nothing is published", async ({
    page,
    context,
  }) => {
    const other = await makeUser("bk12b");
    const foreign = { path: `${other.id}/img-0123456789ab.webp`, width: 400, height: 600 };
    const user = await userWithDraft(context, "bk12", (handle) =>
      draftOf(handle, [bookOf(foreign)]),
    );
    await openEditor(page);
    await page.getByRole("button", { name: "Publish", exact: true }).first().click();
    const panel = rowOf(page, BLOCK_ID).locator('[id^="block-panel-"]');
    await expect(
      panel
        .getByTestId("book-cover")
        .getByText("That image isn’t in your uploads. Upload it again."),
    ).toBeVisible();
    const stored = await adminClient()
      .from("pages")
      .select("published, published_at")
      .eq("id", user.pageId)
      .single();
    expect(stored.data).toEqual({ published: null, published_at: null });
    const body = await (await page.request.get(url(user.handle))).text();
    expect(body).not.toContain("pg-book");
    expect(body).not.toContain(other.id);
  });

  test("M9-20 a hidden book holding bad fields does not stop Publish and is not drawn", async ({
    page,
    context,
  }) => {
    const user = await userWithDraft(context, "bk11", (handle) =>
      draftOf(handle, [
        bookOf(null, {
          visible: false,
          title: "",
          links: [{ id: "book-hid-lnk01", store: "kindle", url: "javascript:alert(1)" }],
        }),
        { id: "head-e2e-0001", type: "header", visible: true, text: "Hello" },
      ]),
    );
    await openEditor(page);
    await page.getByRole("button", { name: "Publish", exact: true }).first().click();
    await expect
      .poll(
        async () =>
          (await adminClient().from("pages").select("published_at").eq("id", user.pageId).single())
            .data?.published_at,
        { timeout: 20_000 },
      )
      .not.toBeNull();
    const body = await (await page.request.get(url(user.handle))).text();
    expect(body).toContain("Hello");
    expect(body).not.toContain("pg-book");
    expect(body).not.toContain("javascript:");
  });
});
