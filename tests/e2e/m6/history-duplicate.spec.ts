import { axeViolations } from "../fixtures/a11y";
import { expect, test, type Request } from "@playwright/test";
import { cleanupUsers, desktopOnly, phoneOnly } from "../fixtures/data";
import { rawRequest } from "../fixtures/http";
import { expectNoHorizontalScroll, expectTapTargets } from "../helpers";
import { waitForClicks } from "../m4/analytics-ingest-helpers";
import {
  makePngImage,
  objectExists,
  removeFolders,
  sessionCookie,
  uploadMedia,
  uploaded,
} from "../m5/images-helpers";
import {
  bid,
  expectDraft,
  focused,
  openEditor,
  openRow,
  pageRow,
  patchDraftAsUser,
  previewScreen,
  reloadEditor,
  rowIds,
  rowOf,
  rows,
  saveIndicator,
  setDraft,
  status,
  textBlocks,
  userWithBlocks,
} from "./history-helpers";
import { BLOCK_ID_PATTERN, draftDocSchema, type Block } from "@/lib/document";
import { collectIds } from "@/lib/editor/duplicate";

/**
 * M6-05: Duplicate block. A smoke per viewport for the flow, the id rules (full: ids are analytics
 * keys and the page must keep passing requireUniqueIds), images that stay while any block names
 * them, the analytics of the copy, the 50-block limit, the layout of the four panel buttons, and
 * the abuse case of repeated ids written straight to the database.
 */

test.afterAll(async () => {
  await removeFolders(owners.splice(0));
  await cleanupUsers();
});
const owners: string[] = [];

const LINK = {
  id: "lnk-book-01",
  type: "link",
  visible: true,
  label: "Book a session",
  url: "https://example.com/book",
  overrides: { accent: "#C46A4F", buttonStyle: "pill", radius: 4 },
};

const duplicateButton = (row: ReturnType<typeof rowOf>) =>
  row.getByRole("button", { name: "Duplicate block", exact: true });

/** The same block with every id replaced by "x", for "equal except for ids". */
function withoutIds(block: unknown): unknown {
  const clone = JSON.parse(JSON.stringify(block));
  clone.id = "x";
  for (const item of [...(clone.icons ?? []), ...(clone.cells ?? [])]) item.id = "x";
  return clone;
}

test.describe("M6-05 duplicate a block", () => {
  test("M6-05 the copy lands right after the original with every setting, opened and focused; the original closes; it autosaves", async ({
    page,
    context,
  }) => {
    const user = await userWithBlocks(context, "dup1", [LINK, ...textBlocks(2)]);
    await openEditor(page);
    const row = await openRow(page, LINK.id);
    const panelButtons = row.locator('[id^="block-panel-"]').getByRole("button");
    const names = await panelButtons.allTextContents();
    expect(names.join("|")).toMatch(/Move up\|Move down\|Duplicate block\|Delete block$/);
    const button = duplicateButton(row);
    await expect(button).toBeEnabled();
    expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(43.5);
    await expect(button).toHaveCSS("border-top-color", "rgb(201, 197, 190)");
    await expect(button).toHaveCSS("background-color", "rgb(255, 255, 255)");

    await button.click();
    await expect(rows(page)).toHaveCount(4);
    const ids = await rowIds(page);
    expect(ids[0]).toBe(LINK.id);
    const copyId = ids[1]!;
    expect(copyId).not.toBe(LINK.id);
    expect(copyId).toMatch(BLOCK_ID_PATTERN);
    expect(ids.slice(2)).toEqual([bid(1), bid(2)]);

    // The copy is open with its first input focused; the original closed.
    await expect(rowOf(page, copyId).locator("button[aria-expanded]").first()).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await expect(rowOf(page, LINK.id).locator("button[aria-expanded]").first()).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    await expect.poll(async () => (await focused(page)).blockId).toBe(copyId);
    expect((await focused(page)).tag).toBe("INPUT");
    await expect(page.getByRole("heading", { level: 2, name: "Blocks · 4" })).toBeVisible();
    await expect(status(page, "Block duplicated.")).toHaveCount(1);
    // The preview shows both.
    await expect(previewScreen(page).getByText("Book a session")).toHaveCount(2);

    // Autosaved, with every setting copied and nothing shared but the values.
    await expect(saveIndicator(page)).toHaveText("Saved");
    const stored = await expectDraft(user.pageId, (d) => d.blocks.length === 4);
    expect(stored.blocks.map((b) => b.id)).toEqual(ids);
    expect(withoutIds(stored.blocks[1])).toEqual(withoutIds(stored.blocks[0]));
    expect(stored.blocks[1]).toMatchObject({
      label: "Book a session",
      url: "https://example.com/book",
      visible: true,
      overrides: LINK.overrides,
    });
    expect(draftDocSchema.safeParse(stored).success).toBe(true);
    expect(collectIds(stored).size).toBe(4);

    await reloadEditor(page);
    expect(await rowIds(page)).toEqual(ids);
  });

  test("M6-05 social icons and grid cells get new ids too; ids stay unique across the page", async ({
    page,
    context,
  }) => {
    const social = {
      id: "soc-row-0001",
      type: "social",
      visible: true,
      icons: [
        { id: "ico-ig-0001", platform: "instagram", url: "https://instagram.com/mara" },
        { id: "ico-mail-001", platform: "email", address: "hello@example.com" },
      ],
    };
    const grid = {
      id: "grd-prt-0001",
      type: "grid",
      visible: true,
      cells: [
        { id: "cel-a-00001", title: "Prints", subtitle: "", url: "https://example.com/a" },
        { id: "cel-b-00001", title: "Workshops", subtitle: "", url: "https://example.com/b" },
      ],
    };
    const user = await userWithBlocks(context, "dup2", [social, grid]);
    await openEditor(page);
    for (const original of [social, grid]) {
      const row = await openRow(page, original.id);
      await duplicateButton(row).click();
    }
    await expect(rows(page)).toHaveCount(4);
    const stored = await expectDraft(user.pageId, (d) => d.blocks.length === 4);
    const all = [...collectIds(stored)];
    // 2 blocks x 2 (block + 2 items each) ... every id once: 2 + 2*2 originals + same again.
    expect(all).toHaveLength(2 * (1 + 2) * 2);
    for (const id of all) expect(id).toMatch(BLOCK_ID_PATTERN);
    const [s1, s2] = stored.blocks.filter((b) => b.type === "social") as Extract<
      Block,
      { type: "social" }
    >[];
    expect(s2!.icons.map((i) => i.id)).not.toEqual(s1!.icons.map((i) => i.id));
    expect(withoutIds(s2)).toEqual(withoutIds(s1));
    expect(draftDocSchema.safeParse(stored).success).toBe(true);
  });

  test("M6-05 a hidden block gives a hidden copy; an incomplete block duplicates fine and its Publish errors stay with it", async ({
    page,
    context,
  }) => {
    const hidden = {
      id: "hid-link-001",
      type: "link",
      visible: false,
      label: "Hidden one",
      url: "https://example.com/h",
    };
    const incomplete = {
      id: "inc-link-001",
      type: "link",
      visible: true,
      label: "No address yet",
      url: "",
    };
    const user = await userWithBlocks(context, "dup3", [hidden, incomplete]);
    await openEditor(page);

    // Publish refuses the empty address and marks the original.
    await page
      .locator("main > header")
      .getByRole("button", { name: "Publish", exact: true })
      .click();
    await expect(rowOf(page, incomplete.id)).toHaveAttribute("data-invalid", "");

    await duplicateButton(await openRow(page, hidden.id)).click();
    await expect(rows(page)).toHaveCount(3);
    let ids = await rowIds(page);
    await expect(rowOf(page, ids[1]!)).toHaveAttribute("data-hidden", "true");

    await duplicateButton(await openRow(page, incomplete.id)).click();
    await expect(rows(page)).toHaveCount(4);
    ids = await rowIds(page);
    const copy = ids[ids.indexOf(incomplete.id) + 1]!;
    expect(copy).not.toBe(incomplete.id);
    // The Publish error belongs to the original only, until the next Publish.
    await expect(rowOf(page, copy)).not.toHaveAttribute("data-invalid", "");
    await expect(rowOf(page, copy)).toContainText("No address yet");
    const stored = await expectDraft(user.pageId, (d) => d.blocks.length === 4);
    expect(stored.blocks.filter((b) => b.visible === false)).toHaveLength(2);
  });

  test("M6-05 at 50 blocks Duplicate block is disabled and the limit message shows beside it", async ({
    page,
    context,
  }) => {
    await userWithBlocks(
      context,
      "dup50",
      Array.from({ length: 50 }, (_, i) => ({ id: bid(i + 1), type: "divider", visible: true })),
    );
    await openEditor(page);
    const row = await openRow(page, bid(5));
    await expect(duplicateButton(row)).toBeDisabled();
    await expect(row.getByText("You’ve reached the 50-block limit.")).toBeVisible();
    await expect(rows(page)).toHaveCount(50);
    expect(await axeViolations(page)).toEqual([]);
  });
});

test.describe("M6-05 the file of a copied image", () => {
  test.describe.configure({ timeout: 120_000 });

  test("M6-05 a copy points at the same file without uploading; the file stays while one block still names it and goes when both are gone", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "not viewport dependent");
    const user = await userWithBlocks(context, "dupimg", []);
    owners.push(user.id);
    const made = uploaded(
      await uploadMedia(await makePngImage({ width: 240, height: 180, color: [20, 90, 160] }), {
        kind: "content",
        cookie: await sessionCookie(context),
        contentType: "image/png",
      }),
    );
    const card = {
      id: "crd-img-0001",
      type: "card",
      visible: true,
      title: "Studio",
      caption: "",
      url: "https://example.com/studio",
      image: { path: made.path, width: made.width, height: made.height },
    };
    await setDraft(user.pageId, { ...(await pageRow(user.pageId)).draft, blocks: [card] });
    await openEditor(page);

    const wrote: string[] = [];
    page.on("request", (request: Request) => {
      const u = request.url();
      const mutating = request.method() !== "GET" && request.method() !== "HEAD";
      if (mutating && (u.includes("/api/media") || u.includes("/storage/v1"))) {
        if (!u.includes("/api/media/cleanup")) wrote.push(`${request.method()} ${u}`);
      }
    });

    await duplicateButton(await openRow(page, card.id)).click();
    await expect(rows(page)).toHaveCount(2);
    const [first, second] = await rowIds(page);
    const stored = await expectDraft(user.pageId, (d) => d.blocks.length === 2);
    const paths = stored.blocks.map((b) => (b.type === "card" ? b.image?.path : null));
    expect(paths).toEqual([made.path, made.path]);
    expect(wrote, "no upload and no Storage write").toEqual([]);

    // Delete one of the two and wait out the cleanup: the file stays, the other image still loads.
    const cleanupAfterFirst = page.waitForResponse(
      (r) => r.url().includes("/api/media/cleanup") && r.request().method() === "POST",
      { timeout: 40_000 },
    );
    await (await openRow(page, first!)).getByRole("button", { name: "Delete block" }).click();
    await expect(rows(page)).toHaveCount(1);
    await cleanupAfterFirst;
    expect(await objectExists(made.path)).toBe(true);
    await expect(
      previewScreen(page)
        .locator(`img[src*="${made.path.split("/")[1]}"]`)
        .first(),
    ).toBeVisible();
    const imageLoads = await previewScreen(page)
      .locator("img")
      .first()
      .evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0);
    expect(imageLoads).toBe(true);

    // Delete both: the file goes after the cleanup.
    const cleanupAfterSecond = page.waitForResponse(
      (r) => r.url().includes("/api/media/cleanup") && r.request().method() === "POST",
      { timeout: 40_000 },
    );
    await (await openRow(page, second!)).getByRole("button", { name: "Delete block" }).click();
    await expect(rows(page)).toHaveCount(0);
    await cleanupAfterSecond;
    await expect.poll(() => objectExists(made.path), { timeout: 15_000 }).toBe(false);
  });
});

test.describe("M6-05 analytics of a copy", () => {
  test.describe.configure({ timeout: 120_000 });

  test("M6-05 after Publish a click on the copy goes through /r/{pageId}/{copy id} and logs that id", async ({
    page,
    context,
  }) => {
    const user = await userWithBlocks(context, "dupan", [LINK]);
    await openEditor(page);
    await duplicateButton(await openRow(page, LINK.id)).click();
    await expect(rows(page)).toHaveCount(2);
    const [original, copy] = await rowIds(page);
    await expect(saveIndicator(page)).toHaveText("Saved");
    await page
      .locator("main > header")
      .getByRole("button", { name: "Publish", exact: true })
      .click();
    await expect(page.locator("[data-publish-status]")).toHaveText("Published", {
      timeout: 20_000,
    });

    const live = await rawRequest(`${user.handle}.localhost:3000`, "/");
    expect(live.status).toBe(200);
    expect(live.body).toContain(`/r/${user.pageId}/${original}`);
    expect(live.body).toContain(`/r/${user.pageId}/${copy}`);

    await page.route("https://example.com/**", (route) =>
      route.fulfill({ status: 200, contentType: "text/html", body: "<title>destination</title>" }),
    );
    await page.goto(`http://${user.handle}.localhost:3000/`);
    await page.locator(`a[data-block-id="${copy}"]`).click();
    await page.waitForURL("https://example.com/book");
    const clicks = await waitForClicks(user.pageId, 1);
    expect(clicks[0]).toMatchObject({ block_id: copy, type: "click" });
    expect(clicks.some((c: { block_id: string }) => c.block_id === original)).toBe(false);
  });
});

test.describe("M6-05 layout of the panel buttons", () => {
  test("M6-05 phone: Move up, Move down, Duplicate block and Delete block wrap two by two at 44px; nothing scrolls sideways", async ({
    page,
    context,
  }, info) => {
    test.skip(!phoneOnly(info));
    await userWithBlocks(context, "dupl", textBlocks(3));
    await openEditor(page);
    const row = await openRow(page, bid(2));
    const boxes = [];
    for (const name of ["Move up", "Move down", "Duplicate block", "Delete block"]) {
      const box = (await row.getByRole("button", { name, exact: true }).boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(43.5);
      boxes.push(box);
    }
    const tops = boxes.map((b) => Math.round(b.y));
    expect(new Set(tops).size).toBe(2);
    expect(tops[0]).toBe(tops[1]);
    expect(tops[2]).toBe(tops[3]);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await expectNoHorizontalScroll(page);
    await expectTapTargets(page, "#editor-panel-blocks");
  });

  test("M6-05 desktop: the four buttons sit in one row of the expanded panel", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info));
    await userWithBlocks(context, "dupd", textBlocks(3));
    await openEditor(page);
    const row = await openRow(page, bid(2));
    const tops = [];
    for (const name of ["Move up", "Move down", "Duplicate block", "Delete block"]) {
      tops.push(
        Math.round((await row.getByRole("button", { name, exact: true }).boundingBox())!.y),
      );
    }
    expect(new Set(tops).size).toBe(1);
  });
});

test.describe("M6-05 abuse: repeated ids written straight to the database", () => {
  /** A user with a published page, then `blocks` written into the draft the way any client can. */
  async function publishedThenCorrupted(
    page: import("@playwright/test").Page,
    context: import("@playwright/test").BrowserContext,
    label: string,
    blocks: unknown[],
  ) {
    const user = await userWithBlocks(context, label, textBlocks(2));
    await openEditor(page);
    await page
      .locator("main > header")
      .getByRole("button", { name: "Publish", exact: true })
      .click();
    await expect(page.locator("[data-publish-status]")).toHaveText("Published", {
      timeout: 20_000,
    });
    const before = await pageRow(user.pageId);
    const liveBefore = await rawRequest(`${user.handle}.localhost:3000`, "/");
    expect(liveBefore.status).toBe(200);
    await patchDraftAsUser(context, user.pageId, {
      ...before.draft,
      rev: before.draft.rev + 50,
      blocks,
    });
    await reloadEditor(page);
    await expect(
      page.getByText(
        "Some content couldn’t be read and was reset in the editor. Nothing is saved until you edit.",
      ),
    ).toBeVisible();
    return { user, before };
  }

  /** Publish refuses the stored draft, and neither `pages.published` nor the live page moves. */
  async function expectPublishRefused(
    page: import("@playwright/test").Page,
    user: { pageId: string; handle: string },
    before: Awaited<ReturnType<typeof pageRow>>,
    forbidden: string[],
    opts: { names?: boolean } = {},
  ) {
    await page
      .locator("main > header")
      .getByRole("button", { name: "Publish", exact: true })
      .click();
    const alert = page.getByRole("alert").filter({ hasText: "before publishing" });
    await expect(alert).toBeVisible({ timeout: 20_000 });
    // The message sits with the block it is about, so it shows when that block is in the list.
    if (opts.names !== false)
      await expect(alert).toContainText("Ids must be unique within a page.");
    const after = await pageRow(user.pageId);
    expect(after.published).toEqual(before.published);
    expect(after.published_at).toBe(before.published_at);
    const live = await rawRequest(`${user.handle}.localhost:3000`, "/");
    expect(live.status).toBe(200);
    expect(live.body).toContain("Text 1");
    for (const text of forbidden) expect(live.body).not.toContain(text);
  }

  test("M6-05 a block and its 'copy' sharing one id: the editor keeps the first, Publish refuses the stored draft, the live page does not change", async ({
    page,
    context,
  }) => {
    const { user, before } = await publishedThenCorrupted(page, context, "dupab", [
      { id: bid(1), type: "text", visible: true, text: "Text 1" },
      { id: bid(1), type: "text", visible: true, text: "Its copy, same id" },
    ]);
    expect(await rowIds(page)).toEqual([bid(1)]);
    await expect(rowOf(page, bid(1))).toContainText("Text 1");
    await expectPublishRefused(page, user, before, ["Its copy, same id"]);
  });

  test("M6-05 two icons in one social block sharing an id: the editor keeps the first icon, Publish refuses the stored draft", async ({
    page,
    context,
  }) => {
    const { user, before } = await publishedThenCorrupted(page, context, "dupic", [
      { id: bid(1), type: "text", visible: true, text: "Text 1" },
      {
        id: "soc-dupe-001",
        type: "social",
        visible: true,
        icons: [
          { id: "ico-twin-001", platform: "instagram", url: "https://instagram.com/first" },
          { id: "ico-twin-001", platform: "tiktok", url: "https://tiktok.com/@second" },
        ],
      },
    ]);
    expect((await rowIds(page))[0]).toBe(bid(1));
    // The stored draft is what Publish checks, whatever the editor made of it on load.
    await expectPublishRefused(page, user, before, ["tiktok.com/@second"], { names: false });
    // The repair keeps the first icon of two that share an id (`loadDraft` dedupes icons and cells).
    const social = await openRow(page, "soc-dupe-001");
    await expect(social.locator('[data-item-id="ico-twin-001"]')).toHaveCount(1);
    await expect(social.locator('[data-item-id="ico-twin-001"]')).toContainText("Instagram");
    // With the block kept, the refusal names the repeated id.
    await expect(page.getByRole("alert").filter({ hasText: "before publishing" })).toContainText(
      "Ids must be unique within a page.",
    );
  });
});
