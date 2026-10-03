import { axeViolations } from "../fixtures/a11y";
import { expect, test, type BrowserContext, type Page, type Request } from "@playwright/test";
import { adminClient, signInAs } from "../fixtures/auth";
import { cleanupUsers, desktopOnly, phoneOnly, rand } from "../fixtures/data";
import { expectNoHorizontalScroll, expectTapTargets } from "../helpers";
import { makeJpeg, makePngImage } from "../m5/images-fixtures";
import { removeFolders, sessionCookie, uploadMedia, uploaded } from "../m5/images-helpers";
import { confirmPhoto } from "./position-dialog-helpers";
import {
  bid,
  expectDraft,
  isDraftPatch,
  openEditor,
  openRow,
  pageRow,
  previewScreen,
  reloadEditor,
  rowIds,
  rowOf,
  rows,
  saveIndicator,
  seededUser,
  setDraft,
  slotButton,
  statusChip,
  textBlocks,
  userWithBlocks,
  type DraftDoc,
} from "./history-helpers";
import { draftDocSchema } from "@/lib/document";

/**
 * M6-06 and M6-07: undo and redo in the Editor. The engine itself is covered by the unit tests
 * (tests/unit/m6-history-*.test.ts); here the whole path is run in the browser: the buttons, the
 * shortcuts, the autosave write each step makes (rev + 1, `draft` only), the stale-tab guard on an
 * Undo, the refusal of an image that was deleted since, a link the database now refuses, and the
 * rules about rows and focus.
 */

test.afterAll(async () => {
  if (domains.length > 0)
    await adminClient().from("blocked_domains").delete().in("domain", domains);
  await removeFolders(owners.splice(0));
  await cleanupUsers();
});
const owners: string[] = [];
const domains: string[] = [];

const NAME = (page: Page) => page.getByLabel("Display name", { exact: true });
const BIO = (page: Page) => page.getByLabel("Bio", { exact: true });
const header = (page: Page) => page.locator("main > header");
const undoButton = (page: Page) => header(page).getByRole("button", { name: "Undo", exact: true });
const redoButton = (page: Page) => header(page).getByRole("button", { name: "Redo", exact: true });
const publishButton = (page: Page) =>
  header(page).getByRole("button", { name: "Publish", exact: true });

const UNDO_KEY = "Control+z";
const REDO_KEY = "Control+Shift+z";

type Stored = Omit<DraftDoc, "rev">;
async function stored(pageId: string): Promise<Stored> {
  const { rev: _rev, ...rest } = (await pageRow(pageId)).draft;
  void _rev;
  return rest;
}

/** Waits until autosave is done, then reads what the database holds (without `rev`). */
async function settled(page: Page, pageId: string): Promise<Stored> {
  await expect(saveIndicator(page)).not.toHaveText("Saving...", { timeout: 15_000 });
  await expect
    .poll(async () => (await saveIndicator(page).getAttribute("data-save-status")) ?? "idle", {
      timeout: 15_000,
    })
    .toMatch(/^(idle|saved)$/);
  return stored(pageId);
}

/** Polls the database until its draft equals `want` (autosave is asynchronous). */
async function expectStored(pageId: string, want: Stored, why: string): Promise<void> {
  await expect
    .poll(async () => JSON.stringify(await stored(pageId)), { message: why, timeout: 20_000 })
    .toBe(JSON.stringify(want));
}

const patchesOf = (page: Page) => {
  const sent: { keys: string[]; rev: number; draft: DraftDoc }[] = [];
  page.on("request", (request: Request) => {
    if (!isDraftPatch(request)) return;
    const body = JSON.parse(request.postData() ?? "{}") as { draft?: DraftDoc };
    sent.push({ keys: Object.keys(body), rev: body.draft?.rev ?? -1, draft: body.draft! });
  });
  return sent;
};

test.describe("M6-07 the buttons", () => {
  test("M6-07 Undo and Redo: two 44x44 icon buttons left of the status chip, disabled after load, with the shortcut in the tooltip", async ({
    page,
    context,
  }, info) => {
    await seededUser(context, "uhd");
    await openEditor(page);
    for (const [button, label] of [
      [undoButton(page), "Undo"],
      [redoButton(page), "Redo"],
    ] as const) {
      await expect(button).toBeVisible();
      await expect(button).toBeDisabled();
      const box = (await button.boundingBox())!;
      expect(box.width).toBeCloseTo(44, 0);
      expect(box.height).toBeCloseTo(44, 0);
      await expect(button.locator("svg")).toHaveCount(1);
      await expect(button).toHaveCSS("background-color", "rgb(255, 255, 255)");
      await expect(button).toHaveCSS("border-top-color", "rgb(201, 197, 190)");
      await expect(button).toHaveCSS("border-top-width", "1px");
      await expect(button).toHaveCSS("border-top-left-radius", "6px");
      const title = (await button.getAttribute("title"))!;
      expect(title).toMatch(
        label === "Undo" ? /^Undo \((Ctrl\+Z|⌘Z)\)/ : /^Redo \((Ctrl\+Shift\+Z|⇧⌘Z)\)/,
      );
      // What Undo does not do is said in the tooltip.
      for (const word of ["Publish", "page names", "preview links", "deleted themes"]) {
        expect(title).toContain(word);
      }
    }
    const chip = (await statusChip(page).boundingBox())!;
    const undoBox = (await undoButton(page).boundingBox())!;
    const redoBox = (await redoButton(page).boundingBox())!;
    expect(undoBox.x).toBeLessThan(redoBox.x);
    if (desktopOnly(info)) {
      // One row with the chip, Preview and Publish; the buttons sit left of the chip.
      expect(redoBox.x + redoBox.width).toBeLessThanOrEqual(chip.x + 0.5);
      const publish = (await publishButton(page).boundingBox())!;
      const preview = (await header(page)
        .getByRole("link", { name: "Preview", exact: true })
        .boundingBox())!;
      for (const box of [chip, preview, publish]) {
        expect(Math.abs(box.y + box.height / 2 - (undoBox.y + undoBox.height / 2))).toBeLessThan(4);
      }
    }
    if (phoneOnly(info)) {
      // The cluster wraps under the title; nothing covers Publish and nothing scrolls sideways.
      const publish = (await publishButton(page).boundingBox())!;
      const overlaps = (a: typeof publish, b: typeof publish) =>
        a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
      expect(overlaps(undoBox, publish)).toBe(false);
      expect(overlaps(redoBox, publish)).toBe(false);
      expect(overlaps(chip, publish)).toBe(false);
      await expectNoHorizontalScroll(page);
      await expectTapTargets(page, "main > header");
    }
  });
});

test.describe("M6-07 shortcuts, steps and saves", () => {
  test("M6-07 typing a name and pressing Ctrl+Z restores it in one step, keeping focus; Redo, saves with rev + 1, the Published chip", async ({
    page,
    context,
  }) => {
    const user = await seededUser(context, "uk1");
    await openEditor(page);
    const patches = patchesOf(page);
    const original = await NAME(page).inputValue();
    await expect(statusChip(page)).toHaveText("Published");

    // Five keystrokes are one step.
    await NAME(page).click();
    await NAME(page).press("End");
    await page.keyboard.type(" Hello", { delay: 25 });
    await expect(NAME(page)).toHaveValue(`${original} Hello`);
    await expect(statusChip(page)).toHaveText("Unpublished changes");
    await expect(undoButton(page)).toBeEnabled();
    await expect(saveIndicator(page)).toHaveText("Saved", { timeout: 15_000 });
    const afterTyping = patches.length;
    expect(afterTyping).toBeGreaterThanOrEqual(1);
    const storedRev = (await pageRow(user.pageId)).draft.rev;

    await page.keyboard.press(UNDO_KEY);
    await expect(NAME(page)).toHaveValue(original);
    // The field keeps focus and a caret.
    await expect(NAME(page)).toBeFocused();
    expect(await NAME(page).evaluate((el: HTMLInputElement) => el.selectionStart !== null)).toBe(
      true,
    );
    await expect(undoButton(page)).toBeDisabled();
    await expect(redoButton(page)).toBeEnabled();
    await expect(
      page.getByRole("status").filter({ hasText: "Undid the last change." }),
    ).toHaveCount(1);
    // Saving..., then Saved; back at the published state the chip says Published again.
    await expect(saveIndicator(page)).toHaveText("Saving...");
    await expect(saveIndicator(page)).toHaveText("Saved", { timeout: 15_000 });
    await expect(statusChip(page)).toHaveText("Published");

    // The write was one PATCH carrying only `draft`, with rev one above the stored one.
    const undoPatch = patches[patches.length - 1]!;
    expect(patches.length).toBe(afterTyping + 1);
    expect(undoPatch.keys).toEqual(["draft"]);
    expect(undoPatch.rev).toBe(storedRev + 1);
    expect(undoPatch.draft.profile.name).toBe(original);
    expect((await pageRow(user.pageId)).draft.profile.name).toBe(original);

    // Redo: Shift+Ctrl+Z, then Ctrl+Y, each bring the typed name back.
    await page.keyboard.press(REDO_KEY);
    await expect(NAME(page)).toHaveValue(`${original} Hello`);
    await expect(page.getByRole("status").filter({ hasText: "Redid the change." })).toHaveCount(1);
    await expect(saveIndicator(page)).toHaveText("Saved", { timeout: 15_000 });
    await page.keyboard.press(UNDO_KEY);
    await expect(NAME(page)).toHaveValue(original);
    await page.keyboard.press("Control+y");
    await expect(NAME(page)).toHaveValue(`${original} Hello`);
    await expect(redoButton(page)).toBeDisabled();
    await expect(saveIndicator(page)).toHaveText("Saved", { timeout: 15_000 });
    const revs = patches.map((p) => p.rev);
    expect(revs).toEqual([...revs].sort((a, b) => a - b));
    expect(new Set(revs).size).toBe(revs.length);
    expect((await pageRow(user.pageId)).draft.profile.name).toBe(`${original} Hello`);
  });

  test("M6-07 Cmd+Z and Shift+Cmd+Z work too, anywhere on the screen, with nothing focused; with nothing to undo or redo the page says so", async ({
    page,
    context,
  }) => {
    await seededUser(context, "uk2");
    await openEditor(page);
    const original = await BIO(page).inputValue();

    // Nothing to undo yet: the shortcut changes nothing and says so.
    await page.getByRole("heading", { level: 2, name: /^Blocks/ }).click();
    await page.keyboard.press("Control+z");
    await expect(page.getByRole("status").filter({ hasText: "Nothing to undo." })).toHaveCount(1);
    await expect(BIO(page)).toHaveValue(original);
    await expect(saveIndicator(page)).toHaveText("");

    await BIO(page).fill("A different bio");
    // Focus leaves the field: the shortcut still works on the screen.
    await header(page).getByRole("button", { name: "Publish", exact: true }).focus();
    await page.keyboard.press("Meta+z");
    await expect(BIO(page)).toHaveValue(original);
    await page.keyboard.press("Shift+Meta+z");
    await expect(BIO(page)).toHaveValue("A different bio");
    await page.keyboard.press("Control+Shift+z");
    await expect(page.getByRole("status").filter({ hasText: "Nothing to redo." })).toHaveCount(1);
    await expect(BIO(page)).toHaveValue("A different bio");
  });

  test("M6-07 a text field that is not the draft's keeps the browser's own undo", async ({
    page,
    context,
  }) => {
    const user = await seededUser(context, "uk3");
    await openEditor(page);
    await header(page).getByRole("button", { name: "Rename page" }).click();
    const field = header(page).getByLabel("Page name");
    await expect(field).toBeFocused();
    await field.fill("Renamed in the header");
    const before = await stored(user.pageId);
    await page.keyboard.press(UNDO_KEY);
    // The app did not take the key: no message, no step, and the draft is as it was.
    await expect(
      page.getByRole("status").filter({ hasText: /Nothing to undo|Undid the last/ }),
    ).toHaveCount(0);
    await expect(undoButton(page)).toBeDisabled();
    expect(await stored(user.pageId)).toEqual(before);
  });

  test("M6-07 the open row stays open while its block exists; undoing an add removes the row and closes it; focus stays on the pressed button", async ({
    page,
    context,
  }) => {
    const user = await userWithBlocks(context, "uk4", textBlocks(3));
    await openEditor(page);
    await expect(rows(page)).toHaveCount(3);

    // An edit inside an open row: Undo keeps the row open.
    const row = await openRow(page, bid(2));
    await row.locator("textarea, input[type=text]").first().fill("Edited text");
    await expect(undoButton(page)).toBeEnabled();
    await undoButton(page).click();
    await expect(undoButton(page))
      .toBeFocused()
      .catch(() => undefined);
    await expect(row.locator("button[aria-expanded]").first()).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await expect(rowOf(page, bid(2))).toContainText("Text 2");

    // Add a block (it opens), then undo the add: the row is gone and nothing is open.
    await page
      .getByRole("region", { name: "Add a block" })
      .getByRole("button", { name: "Divider" })
      .click();
    await expect(rows(page)).toHaveCount(4);
    await undoButton(page).focus();
    await undoButton(page).click();
    await expect(rows(page)).toHaveCount(3);
    await expect(page.locator('li[data-block-id] button[aria-expanded="true"]')).toHaveCount(0);
    await expect(undoButton(page)).toBeFocused();
    await redoButton(page).focus();
    await redoButton(page).click();
    await expect(rows(page)).toHaveCount(4);
    await expect(redoButton(page)).toBeFocused();
    await expect(saveIndicator(page)).toHaveText("Saved", { timeout: 15_000 });
    expect((await pageRow(user.pageId)).draft.blocks).toHaveLength(4);
  });
});

test.describe("M6-06 the toast, Publish and what is not a step", () => {
  test("M6-06 the 'Block deleted.' Undo restores the block as one step: Ctrl+Z removes it again and Redo brings it back", async ({
    page,
    context,
  }) => {
    const user = await userWithBlocks(context, "ut1", textBlocks(3));
    await openEditor(page);
    const before = await rowIds(page);
    await (await openRow(page, bid(2))).getByRole("button", { name: "Delete block" }).click();
    await expect(rows(page)).toHaveCount(2);
    await page
      .getByRole("button", { name: "Undo", exact: true })
      .filter({ hasText: "Undo" })
      .last()
      .click();
    await expect(rows(page)).toHaveCount(3);
    expect(await rowIds(page)).toEqual(before);

    await page.keyboard.press(UNDO_KEY);
    await expect(rows(page)).toHaveCount(2);
    expect(await rowIds(page)).toEqual([bid(1), bid(3)]);
    await page.keyboard.press(REDO_KEY);
    await expect(rows(page)).toHaveCount(3);
    expect(await rowIds(page)).toEqual(before);
    await expectDraft(user.pageId, (d) => d.blocks.length === 3);
  });

  test("M6-07 Publish is not a step and Undo never touches pages.published or the live page; the tabs and the history stay", async ({
    page,
    context,
  }) => {
    const user = await seededUser(context, "ut2");
    await openEditor(page);
    const original = await NAME(page).inputValue();
    await NAME(page).fill(`${original} Two`);
    await publishButton(page).click();
    await expect(statusChip(page)).toHaveText("Published", { timeout: 20_000 });
    const published = await pageRow(user.pageId);

    // The edit before Publish is still a step; Publish itself is not.
    await expect(undoButton(page)).toBeEnabled();
    await undoButton(page).click();
    await expect(NAME(page)).toHaveValue(original);
    await expect(undoButton(page)).toBeDisabled();
    await expect(statusChip(page)).toHaveText("Unpublished changes");
    await expectDraft(user.pageId, (d) => d.profile.name === original);
    await expect(saveIndicator(page)).toHaveText("Saved", { timeout: 15_000 });
    const after = await pageRow(user.pageId);
    expect(after.published).toEqual(published.published);
    expect(after.published_at).toBe(published.published_at);
    expect(after.draft.profile.name).toBe(original);
    // Redo restores the published state's name: the chip says Published again.
    await redoButton(page).click();
    await expect(statusChip(page)).toHaveText("Published");
  });

  test("M6-07 renaming the page and creating or turning off a share link are not steps: the history is what it was, and an Undo leaves the name and the link alone", async ({
    page,
    context,
  }) => {
    const user = await seededUser(context, "ut4");
    await openEditor(page);
    const original = await NAME(page).inputValue();
    await NAME(page).fill(`${original} Edit`);
    await expect(saveIndicator(page)).toHaveText("Saved", { timeout: 15_000 });
    // One step on the stack: Undo is on, Redo is off.
    await expect(undoButton(page)).toBeEnabled();
    await expect(redoButton(page)).toBeDisabled();

    // Rename the page (M6-14).
    await page.getByRole("button", { name: "Rename page" }).click();
    await page.getByLabel("Page name", { exact: true }).fill("Summer tour");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(
      header(page).getByRole("heading", { level: 1, name: "Summer tour" }),
    ).toBeVisible();

    // Create a share link, then turn it off (M6-12).
    const share = header(page).getByRole("button", { name: "Share preview" });
    const dialog = page.getByRole("dialog");
    await share.click();
    await dialog.getByRole("button", { name: "Create link", exact: true }).click();
    await expect(dialog.getByLabel("Preview link")).toBeVisible();
    await dialog.getByRole("button", { name: "Close" }).click();
    await expect(dialog).toBeHidden();
    await share.click();
    await dialog.getByRole("button", { name: "Turn off" }).click();
    await expect(dialog.getByRole("status").filter({ hasText: "Turned off." })).toBeVisible();
    await dialog.getByRole("button", { name: "Close" }).click();
    await expect(dialog).toBeHidden();

    // The history still holds exactly the one edit.
    await expect(undoButton(page)).toBeEnabled();
    await expect(redoButton(page)).toBeDisabled();
    await undoButton(page).click();
    await expect(NAME(page)).toHaveValue(original);
    await expect(undoButton(page)).toBeDisabled();
    await expect(redoButton(page)).toBeEnabled();
    await expectDraft(user.pageId, (d) => d.profile.name === original);

    // Neither the name nor the link moved with the Undo.
    const row = await adminClient().from("pages").select("name").eq("id", user.pageId).single();
    expect(row.data?.name).toBe("Summer tour");
    const links = await adminClient()
      .from("preview_links")
      .select("revoked_at")
      .eq("page_id", user.pageId);
    expect(links.data).toHaveLength(1);
    expect(links.data![0]!.revoked_at).not.toBeNull();
    await expect(
      header(page).getByRole("heading", { level: 1, name: "Summer tour" }),
    ).toBeVisible();
  });

  test("M6-06 switching tabs keeps the history (phone), and a reload starts with an empty one", async ({
    page,
    context,
  }, info) => {
    await seededUser(context, "ut3");
    await openEditor(page);
    await NAME(page).fill("Tab test");
    await expect(undoButton(page)).toBeEnabled();
    if (phoneOnly(info)) {
      await page.getByRole("tab", { name: "Preview" }).click();
      await expect(previewScreen(page)).toBeVisible();
      await page.getByRole("tab", { name: "Blocks" }).click();
      await expect(undoButton(page)).toBeEnabled();
    }
    await expect(saveIndicator(page)).toHaveText("Saved", { timeout: 15_000 });
    await reloadEditor(page);
    await expect(NAME(page)).toHaveValue("Tab test");
    await expect(undoButton(page)).toBeDisabled();
    await expect(redoButton(page)).toBeDisabled();
    // Nothing of the history is stored in the browser.
    const stores = await page.evaluate(() => ({
      local: Object.keys(localStorage).join(","),
      session: Object.keys(sessionStorage).join(","),
    }));
    expect(stores.local + stores.session).not.toMatch(/history|undo|redo/i);
  });
});

test.describe("M6-07 every change is undoable", () => {
  test.describe.configure({ timeout: 240_000 });

  test("M6-07 14 actions, each followed by Undo (the draft from before) and Redo (the draft from after)", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "the table is the same at every width; run once");
    const LINK = {
      id: "lnk-tbl-001",
      type: "link",
      visible: true,
      label: "Table link",
      url: "https://example.com/table",
    };
    const user = await userWithBlocks(context, "utbl", [
      LINK,
      ...textBlocks(3),
      { id: "hdr-tbl-001", type: "header", visible: true, text: "Header row" },
    ]);
    owners.push(user.id);
    await openEditor(page);
    const card = page.getByRole("region", { name: "Profile", exact: true });
    const fileInput = card.locator("input[type=file]");
    const jpegA = await makeJpeg({ width: 400, height: 400 });
    const jpegB = await makeJpeg({ width: 420, height: 420, color: [30, 120, 90] });

    const table: [string, () => Promise<void>][] = [
      ["edit the display name", () => NAME(page).fill("Table name")],
      ["edit the bio", () => BIO(page).fill("Table bio")],
      [
        "upload a photo",
        async () => {
          await fileInput.setInputFiles({ name: "a.jpg", mimeType: "image/jpeg", buffer: jpegA });
          await confirmPhoto(page); // M6-24: the position dialog first
          await expect(card.getByRole("button", { name: "Replace photo" })).toBeVisible();
        },
      ],
      [
        "replace it",
        async () => {
          await fileInput.setInputFiles({ name: "b.jpg", mimeType: "image/jpeg", buffer: jpegB });
          await confirmPhoto(page); // M6-24: the position dialog first
          await expect(card.getByRole("button", { name: "Replace photo" })).toBeEnabled();
        },
      ],
      ["remove it", () => card.getByRole("button", { name: "Remove" }).click()],
      [
        "add a block",
        () =>
          page
            .getByRole("region", { name: "Add a block" })
            .getByRole("button", { name: "Divider" })
            .click(),
      ],
      [
        "insert a block with +",
        async () => {
          await slotButton(page, 2).click();
          await page
            .getByRole("group", { name: "Block types for position 2" })
            .getByRole("button", { name: "Header" })
            .click();
        },
      ],
      [
        "duplicate",
        async () => {
          await (
            await openRow(page, "hdr-tbl-001")
          )
            .getByRole("button", { name: "Duplicate block" })
            .click();
        },
      ],
      [
        "delete",
        async () => {
          await (await openRow(page, bid(2))).getByRole("button", { name: "Delete block" }).click();
        },
      ],
      [
        "move with the buttons",
        async () => {
          await (await openRow(page, bid(1))).getByRole("button", { name: "Move down" }).click();
        },
      ],
      [
        "reorder by drag",
        async () => {
          const handle = rowOf(page, bid(3)).getByRole("button", { name: "Drag to reorder" });
          await handle.scrollIntoViewIfNeeded();
          const from = (await handle.boundingBox())!;
          const target = (await rowOf(page, LINK.id).boundingBox())!;
          const x = from.x + from.width / 2;
          const y = from.y + from.height / 2;
          await page.mouse.move(x, y);
          await page.mouse.down();
          await page.mouse.move(x, y - 12, { steps: 4 });
          await page.mouse.move(x, target.y + target.height * 0.2, { steps: 20 });
          await page.mouse.up();
        },
      ],
      [
        "toggle visibility",
        async () => {
          await rowOf(page, LINK.id).getByRole("button", { name: "Visible on page" }).click();
        },
      ],
      [
        "edit a link label",
        async () => {
          await (
            await openRow(page, LINK.id)
          )
            .locator('input[data-field="label"]')
            .fill("Table label");
        },
      ],
      [
        "set a per-block color override",
        async () => {
          await (
            await openRow(page, LINK.id)
          )
            .locator('input[data-field="override-color"]')
            .fill("#123456");
        },
      ],
    ];
    expect(table).toHaveLength(14);

    for (const [label, act] of table) {
      const before = await settled(page, user.pageId);
      await act();
      await expect
        .poll(async () => JSON.stringify(await stored(user.pageId)), {
          message: `${label}: the edit is stored`,
          timeout: 20_000,
        })
        .not.toBe(JSON.stringify(before));
      const after = await settled(page, user.pageId);
      expect(draftDocSchema.safeParse({ ...after, rev: 0 }).success, label).toBe(true);

      await undoButton(page).click();
      await expectStored(user.pageId, before, `${label}: Undo restores the draft from before`);
      await redoButton(page).click();
      await expectStored(user.pageId, after, `${label}: Redo restores the draft from after`);
      await settled(page, user.pageId);
    }
  });
});

test.describe("M6-06 images", () => {
  test.describe.configure({ timeout: 90_000 });

  async function userWithPhoto(context: BrowserContext, label: string) {
    const user = await userWithBlocks(context, label, textBlocks(1));
    owners.push(user.id);
    const made = uploaded(
      await uploadMedia(await makePngImage({ width: 200, height: 200, color: [10, 100, 200] }), {
        kind: "avatar",
        cookie: await sessionCookie(context),
        contentType: "image/png",
      }),
    );
    const draft = (await pageRow(user.pageId)).draft;
    await setDraft(user.pageId, {
      ...draft,
      profile: {
        ...draft.profile,
        photo: { path: made.path, width: made.width, height: made.height },
      },
    });
    return { user, made };
  }

  test("M6-06 undoing a removed photo checks the file first (a HEAD request) and restores it while it exists; an Undo makes no other request", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "not viewport dependent");
    const { user, made } = await userWithPhoto(context, "ui1");
    await openEditor(page);
    const card = page.getByRole("region", { name: "Profile", exact: true });
    await card.getByRole("button", { name: "Remove" }).click();
    await expect(card.getByRole("button", { name: "Upload photo" })).toBeVisible();
    await expect(saveIndicator(page)).toHaveText("Saved", { timeout: 15_000 });

    const calls: string[] = [];
    page.on("request", (request) => {
      const url = request.url();
      if (request.method() === "GET") return;
      calls.push(`${request.method()} ${new URL(url).pathname}`);
    });
    await undoButton(page).click();
    await expect(card.getByRole("button", { name: "Replace photo" })).toBeVisible();
    await expect(saveIndicator(page)).toHaveText("Saved", { timeout: 15_000 });
    expect((await pageRow(user.pageId)).draft.profile.photo?.path).toBe(made.path);
    const heads = calls.filter((c) => c.startsWith("HEAD"));
    expect(heads).toEqual([`HEAD /storage/v1/object/public/page-media/${made.path}`]);
    // Only the HEAD check and the save of the restored draft (the delayed cleanup call may follow).
    const others = calls.filter(
      (c) =>
        !c.startsWith("HEAD") && c !== "PATCH /rest/v1/pages" && c !== "POST /api/media/cleanup",
    );
    expect(others).toEqual([]);
  });

  test("M6-06 an image that was deleted since: nothing changes, the history stays, and the page says why", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "not viewport dependent");
    const { user, made } = await userWithPhoto(context, "ui2");
    await openEditor(page);
    const card = page.getByRole("region", { name: "Profile", exact: true });
    await card.getByRole("button", { name: "Remove" }).click();
    await expect(saveIndicator(page)).toHaveText("Saved", { timeout: 15_000 });
    const removed = await stored(user.pageId);
    // The cleanup deletes the file once nothing names it.
    const { error } = await adminClient().storage.from("page-media").remove([made.path]);
    expect(error).toBeNull();

    const patches = patchesOf(page);
    await page.keyboard.press(UNDO_KEY);
    const notice = page.locator("[data-history-notice]");
    await expect(notice).toHaveText("Can’t undo that. The earlier image was already deleted.");
    await expect(notice).toHaveAttribute("role", "status");
    expect(await axeViolations(page)).toEqual([]);
    // Nothing changed: the photo is still removed, Undo is still there, Redo is not.
    await expect(card.getByRole("button", { name: "Upload photo" })).toBeVisible();
    await expect(undoButton(page)).toBeEnabled();
    await expect(redoButton(page)).toBeDisabled();
    await page.waitForTimeout(1500);
    expect(patches).toHaveLength(0);
    expect(await stored(user.pageId)).toEqual(removed);
    // The notice goes with the next edit.
    await BIO(page).fill("Moving on");
    await expect(notice).toHaveCount(0);
  });

  test("M6-06 when the check itself cannot be made (the network fails) the step is applied", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "not viewport dependent");
    const { user, made } = await userWithPhoto(context, "ui3");
    await openEditor(page);
    const card = page.getByRole("region", { name: "Profile", exact: true });
    await card.getByRole("button", { name: "Remove" }).click();
    await expect(saveIndicator(page)).toHaveText("Saved", { timeout: 15_000 });
    await page.route("**/storage/v1/object/public/page-media/**", (route) =>
      route.request().method() === "HEAD" ? route.abort() : route.continue(),
    );
    await page.keyboard.press(UNDO_KEY);
    await expect(card.getByRole("button", { name: "Replace photo" })).toBeVisible();
    // Poll the database: "Saved" is already showing from before the Undo, so it proves nothing yet.
    await expectDraft(user.pageId, (d) => d.profile.photo?.path === made.path);
    await expect(saveIndicator(page)).toHaveText("Saved", { timeout: 15_000 });
    await expect(page.locator("[data-history-notice]")).toHaveCount(0);
  });
});

test.describe("M6-06 the stale-tab guard and the database on an Undo", () => {
  test("M6-06 an Undo in a tab that is behind is refused as a stale write and the database keeps the newer content", async ({
    page,
    context,
    browser,
  }) => {
    const user = await seededUser(context, "ust");
    const contextB = await browser.newContext(
      page.viewportSize() ? { viewport: page.viewportSize()! } : {},
    );
    try {
      await signInAs(contextB, user.email);
      const pageB = await contextB.newPage();
      await openEditor(pageB); // B loads at rev N
      const oldName = await NAME(pageB).inputValue();
      const oldBio = await BIO(pageB).inputValue();

      const bioB = `B bio ${rand(4)}`;
      await BIO(pageB).fill(bioB); // B edits the bio: rev N+1
      await expect(saveIndicator(pageB)).toHaveText("Saved", { timeout: 15_000 });

      await openEditor(page); // A loads afterwards, at N+1
      const nameA = `A name ${rand(4)}`;
      await NAME(page).fill(nameA); // A saves: rev N+2
      await expect(saveIndicator(page)).toHaveText("Saved", { timeout: 15_000 });
      const stored2 = await pageRow(user.pageId);

      // B presses Undo: its write is conditional on N+1 and matches no row.
      const patchesB = patchesOf(pageB);
      await undoButton(pageB).click();
      await expect(
        pageB.getByText("This page changed in another tab. Reload to keep editing."),
      ).toBeVisible({ timeout: 15_000 });
      await expect(saveIndicator(pageB)).toHaveText("Not saved");
      expect(patchesB.length).toBeGreaterThanOrEqual(1);
      expect(patchesB[0]!.rev).toBe(stored2.draft.rev + 0);

      // The database keeps A's content: the new name and B's first bio edit.
      const row = await pageRow(user.pageId);
      expect(row.draft.profile.name).toBe(nameA);
      expect(row.draft.profile.bio).toBe(bioB);
      expect(row.draft.rev).toBe(stored2.draft.rev);
      expect(oldName).not.toBe(nameA);
      expect(oldBio).not.toBe(bioB);
    } finally {
      await contextB.close();
    }
  });

  test("M6-07 an Undo cannot bring back a link the database now refuses: Not saved, the banner, Publish off, the stored draft unchanged", async ({
    page,
    context,
  }) => {
    const domain = `ud-${rand(8)}.example`;
    const LINK = {
      id: "lnk-blk-001",
      type: "link",
      visible: true,
      label: "To be blocked",
      url: `https://${domain}/x`,
    };
    const user = await userWithBlocks(context, "ubl", [LINK, ...textBlocks(1)]);
    await openEditor(page);
    await publishButton(page).click();
    await expect(statusChip(page)).toHaveText("Published", { timeout: 20_000 });
    const published = await pageRow(user.pageId);

    // Delete the link (saved), then the domain is blocked, then Ctrl+Z.
    await (await openRow(page, LINK.id)).getByRole("button", { name: "Delete block" }).click();
    await expect(rows(page)).toHaveCount(1);
    await expect(saveIndicator(page)).toHaveText("Saved", { timeout: 15_000 });
    const withoutLink = await stored(user.pageId);
    const { error } = await adminClient().from("blocked_domains").insert({ domain, reason: "e2e" });
    expect(error).toBeNull();
    domains.push(domain);

    await page.keyboard.press(UNDO_KEY);
    await expect(rows(page)).toHaveCount(2); // restored on screen
    await expect(saveIndicator(page)).toHaveAttribute("data-save-status", "blocked", {
      timeout: 15_000,
    });
    await expect(saveIndicator(page)).toHaveText("Not saved");
    await expect(
      page.getByText(
        `Not saved. A link on this page points to a blocked site: ${domain}. Remove or change it.`,
      ),
    ).toBeVisible();
    await expect(publishButton(page)).toBeDisabled();
    // Nothing the database refused was stored, and nothing live moved.
    expect(await stored(user.pageId)).toEqual(withoutLink);
    const after = await pageRow(user.pageId);
    expect(after.published).toEqual(published.published);
    expect(after.published_at).toBe(published.published_at);
  });
});

test.describe("M6-06 a long history on a full page", () => {
  test.describe.configure({ timeout: 180_000 });

  test("M6-06 100 edits on a 50-block page are undone back to the original draft, with no sideways scroll", async ({
    page,
    context,
  }) => {
    const blocks = Array.from({ length: 50 }, (_, i) => ({
      id: bid(i + 1),
      type: "text",
      visible: true,
      text: `Block ${i + 1}`,
    }));
    const user = await userWithBlocks(context, "u100", blocks);
    await openEditor(page);
    const original = await stored(user.pageId);
    const hiddenStates = () =>
      rows(page).evaluateAll((els) => els.map((el) => el.getAttribute("data-hidden") === "true"));
    const originalStates = await hiddenStates();

    // 100 visibility toggles: every one is a step of its own. The first two blocks are toggled
    // three times and the others twice, so the end state differs from the original.
    await page.evaluate(() => {
      const toggles = Array.from(
        document.querySelectorAll<HTMLButtonElement>('button[aria-label="Visible on page"]'),
      );
      for (let i = 0; i < 100; i++) toggles[i % 49]!.click();
    });
    await expect(undoButton(page)).toBeEnabled();
    await expect(saveIndicator(page)).toHaveText("Saved", { timeout: 20_000 });
    const afterAll = await hiddenStates();
    expect(afterAll).not.toEqual(originalStates);

    for (let i = 0; i < 100; i++) await page.keyboard.press(UNDO_KEY);
    await expect(undoButton(page)).toBeDisabled();
    expect(await hiddenStates()).toEqual(originalStates);
    expect(await rowIds(page)).toEqual(blocks.map((b) => b.id));
    await expect(redoButton(page)).toBeEnabled();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await expectNoHorizontalScroll(page);
    // The saves follow the steps: the database ends at the original draft.
    await expectStored(user.pageId, original, "the stored draft is the original one again");
    await expectTapTargets(page, "main > header");

    // And Redo replays them all.
    for (let i = 0; i < 100; i++) await page.keyboard.press(REDO_KEY);
    await expect(redoButton(page)).toBeDisabled();
    expect(await hiddenStates()).toEqual(afterAll);
  });
});
