import { expect, test, type Page } from "@playwright/test";
import { expectNoHorizontalScroll, expectTapTargets } from "../helpers";
import { adminClient, supabaseUrl } from "../fixtures/auth";
import { cleanupUsers, desktopOnly, phoneOnly } from "../fixtures/data";
import { rawRequest, restAs } from "../fixtures/http";
import { BLOCK_TYPES, BLOCK_TYPE_LABELS, LIMITS, draftDocSchema, newBlockId } from "@/lib/document";
import {
  accessToken,
  css,
  draftWith,
  emptyUser,
  expectDraft,
  openEditor,
  pageRow,
  previewScreen,
  reloadEditor,
  rowOf,
  rows,
  saveIndicator,
  seededUser,
  setDraft,
} from "./editor-helpers";
import { makePng } from "./editor-images";

/** M2-10 (add), M2-11 (rows and panels), M2-12 (visibility), M2-13 (delete with undo). */

test.afterAll(cleanupUsers);

const IDS = {
  social: "Sx4kT9pLq2Wa",
  header: "Hd7mN3cYb8Ue",
  link: "Bt5rJ1fGz6Os",
  link2: "Qw8vC2nKd4Ly",
  card: "Lc6hP0yRe3Zi",
  embed: "Ym1gA5uVf7Tx",
  grid: "Jn9bE4sXo2Mq",
  divider: "Vk3wD8tHa5Pr",
  text: "Ge2zU7qNc9Fl",
  image: "Im4gB6kWs8Xz",
};

const toggle = (page: Page, id: string) =>
  rowOf(page, id).getByRole("button", { name: "Visible on page" });
const rowButton = (page: Page, id: string) => rowOf(page, id).locator("button[aria-expanded]");
const panel = (page: Page, id: string) => page.locator(`#block-panel-${id}`);
const countHeading = (page: Page, n: number) =>
  page.getByRole("heading", { level: 2, name: `Blocks · ${n}` });
const chip = (page: Page, type: (typeof BLOCK_TYPES)[number]) =>
  page.getByRole("button", { name: BLOCK_TYPE_LABELS[type], exact: true });

/** Previewed block ids in order (on a phone the preview tab has to be open). */
const previewIds = (page: Page) =>
  previewScreen(page)
    .locator("[data-block-id]")
    .evaluateAll((els) => els.map((el) => el.getAttribute("data-block-id")));

async function openPreviewTab(page: Page, info: { project: { name: string } }) {
  if (info.project.name === "phone") await page.getByRole("tab", { name: "Preview" }).click();
}
async function openBlocksTab(page: Page, info: { project: { name: string } }) {
  if (info.project.name === "phone") await page.getByRole("tab", { name: "Blocks" }).click();
}

function dividers(n: number) {
  return Array.from({ length: n }, () => ({
    id: newBlockId(),
    type: "divider",
    visible: true,
  }));
}

// ---------------------------------------------------------------------------------------------
// M2-10
// ---------------------------------------------------------------------------------------------

test.describe("M2-10 add a block", () => {
  test("M2-10 nine chips in order, 4px radius, #D9D6D0 border and a brass plus", async ({
    page,
    context,
  }) => {
    await emptyUser(context, "ad1");
    await openEditor(page);
    const card = page.getByRole("region", { name: "Add a block" });
    await expect(card.getByText("Goes to the end of the page")).toBeVisible();
    const chips = card.getByRole("button");
    await expect(chips).toHaveText(
      BLOCK_TYPES.map((t) => `+${BLOCK_TYPE_LABELS[t]}`).map((t) => t),
    );
    expect(BLOCK_TYPES.map((t) => BLOCK_TYPE_LABELS[t])).toEqual([
      "Link",
      "Card",
      "Header",
      "Text",
      "Image",
      "Social",
      "Embed",
      "Grid",
      "Divider",
    ]);
    const first = chips.first();
    expect(await css(first, "border-top-left-radius")).toBe("4px");
    expect(await css(first, "border-top-color")).toBe("rgb(217, 214, 208)");
    expect(await css(first.locator("span"), "color")).toBe("rgb(132, 104, 57)");
  });

  test("M2-10 each chip appends one block with its defaults, a fresh id, and the draft saves", async ({
    page,
    context,
  }, info) => {
    const user = await emptyUser(context, "ad2");
    await openEditor(page);
    for (const [i, type] of BLOCK_TYPES.entries()) {
      await chip(page, type).click();
      await expect(rows(page)).toHaveCount(i + 1);
      await expect(countHeading(page, i + 1)).toBeVisible();
      const row = rows(page).nth(i);
      expect(await row.getAttribute("data-block-type")).toBe(type);
      // Expanded, in view, with focus on the first input (a divider focuses the row).
      await expect(row.locator("button[aria-expanded]")).toHaveAttribute("aria-expanded", "true");
      await expect(row).toBeInViewport();
      if (type === "divider") {
        await expect(row).toBeFocused();
      } else {
        const focused = await row.evaluate((el) => {
          const active = document.activeElement;
          return {
            inside: !!active && el.contains(active),
            tag: active?.tagName,
          };
        });
        expect(focused.inside, `${type}: focus is inside the new row`).toBe(true);
        expect(["INPUT", "TEXTAREA", "SELECT"]).toContain(focused.tag);
      }
    }
    await expect(saveIndicator(page)).toHaveText("Saved");
    const draft = await expectDraft(user.pageId, (d) => d.blocks.length === 9);
    expect(draftDocSchema.safeParse(draft).success).toBe(true);
    const byType: Record<string, Record<string, unknown>> = Object.fromEntries(
      draft.blocks.map((b) => [b.type, b]),
    );
    expect(draft.blocks.map((b) => b.type)).toEqual([...BLOCK_TYPES]);
    expect(new Set(draft.blocks.map((b) => b.id)).size).toBe(9);
    expect(byType.link).toMatchObject({ label: "New link", url: "", visible: true });
    expect(byType.card).toMatchObject({ title: "New card", caption: "", url: "", image: null });
    expect(byType.header).toMatchObject({ text: "New section" });
    expect(byType.text).toMatchObject({ text: "New text block" });
    expect(byType.image).toMatchObject({ image: null, alt: "" });
    expect(byType.social).toMatchObject({ icons: [{ platform: "instagram", url: "" }] });
    expect(byType.embed).toMatchObject({ url: "", caption: "Video or music" });
    expect(byType.grid!.cells).toHaveLength(2);
    expect(byType.divider).toMatchObject({ type: "divider", visible: true });

    // The live preview follows: the new link shows its label.
    await openPreviewTab(page, info);
    await expect(previewScreen(page)).toContainText("New link");
    await expect(previewScreen(page)).toContainText("New section");
  });

  test("M2-10 at 50 blocks every chip is disabled with the limit message; at 49 one more is allowed", async ({
    page,
    context,
  }) => {
    const user = await emptyUser(context, "ad3");
    await setDraft(user.pageId, draftWith(user.handle, dividers(49)));
    await openEditor(page);
    await expect(countHeading(page, 49)).toBeVisible();
    await expect(page.getByText("You’ve reached the 50-block limit.")).toHaveCount(0);
    await chip(page, "divider").click();
    await expect(countHeading(page, 50)).toBeVisible();
    for (const type of BLOCK_TYPES) await expect(chip(page, type)).toBeDisabled();
    await expect(page.getByText("You’ve reached the 50-block limit.")).toBeVisible();
    // A disabled chip adds nothing.
    await chip(page, "link").click({ force: true });
    await expect(rows(page)).toHaveCount(50);
    await expect(saveIndicator(page)).toHaveText("Saved");
    await expectDraft(user.pageId, (d) => d.blocks.length === 50);
  });

  test("M2-10 direct API: a draft of 51 blocks is accepted by the database", async ({
    context,
  }) => {
    const user = await emptyUser(context, "ad4");
    const token = await accessToken(context);
    const res = await restAs(token, `/pages?id=eq.${user.pageId}`, {
      method: "PATCH",
      body: { draft: draftWith(user.handle, dividers(LIMITS.blocks + 1)) },
    });
    expect(res.status).toBe(200);
    expect((await pageRow(user.pageId)).draft.blocks).toHaveLength(51);
  });

  test("M2-10 phone: chips are 44px tall and wrap; desktop: all nine fit in two rows", async ({
    page,
    context,
  }, info) => {
    await emptyUser(context, "ad5");
    await openEditor(page);
    const card = page.getByRole("region", { name: "Add a block" });
    const boxes = await card.getByRole("button").evaluateAll((els) =>
      els.map((el) => {
        const r = el.getBoundingClientRect();
        return { y: Math.round(r.y), height: r.height, right: r.right };
      }),
    );
    for (const box of boxes) expect(box.height).toBeGreaterThanOrEqual(44);
    const rowCount = new Set(boxes.map((b) => b.y)).size;
    if (phoneOnly(info)) {
      expect(rowCount).toBeGreaterThanOrEqual(2);
      await expectNoHorizontalScroll(page);
      await expectTapTargets(page);
      for (const box of boxes) expect(box.right).toBeLessThanOrEqual(390);
    } else {
      expect(rowCount).toBeLessThanOrEqual(2);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// M2-11
// ---------------------------------------------------------------------------------------------

test.describe("M2-11 block rows", () => {
  test("M2-11 the heading, the hint and a row for each of the nine types, with derived titles", async ({
    page,
    context,
  }) => {
    await seededUser(context, "rw1");
    await openEditor(page);
    const heading = page.getByRole("heading", { level: 2, name: "Blocks · 10" });
    await expect(heading).toBeVisible();
    expect(await css(heading, "font-size")).toBe("13px");
    expect(await css(heading, "text-transform")).toBe("uppercase");
    expect(await css(heading, "font-family")).toMatch(/Geist.?Mono/);
    await expect(page.getByText("Tap a block to edit it")).toBeVisible();

    const expected: Record<string, [string, string, string]> = {
      [IDS.social]: ["Social", "Instagram, TikTok, YouTube, Email", "4 icons"],
      [IDS.header]: ["Header", "Book a session", ""],
      [IDS.link]: ["Link", "Portrait sessions — fall dates", "https://"],
      [IDS.card]: ["Card", "Night Market", "https://"],
      [IDS.embed]: ["Embed", "Behind the lens, ep. 4", "https://"],
      [IDS.grid]: ["Grid", "Prints · Workshops", "2 cards"],
      [IDS.divider]: ["Divider", "Divider", ""],
      [IDS.image]: ["Image", "The studio at golden hour", ""],
    };
    for (const [id, [type, title, sub]] of Object.entries(expected)) {
      const parts = rowButton(page, id).locator("> span");
      await expect(parts.nth(0)).toHaveText(type);
      await expect(parts.nth(1)).toHaveText(title);
      if (sub) await expect(parts.nth(2)).toContainText(sub);
      else await expect(parts).toHaveCount(2);
    }
    // Text: its first 60 characters.
    const text = await rowButton(page, IDS.text).locator("> span").nth(1).innerText();
    const stored = (await pageRow((await seededPageId(page))!)).draft.blocks.find(
      (b) => b.id === IDS.text,
    ) as { text: string };
    expect(text).toBe(
      Array.from(stored.text.replace(/\s+/g, " ").trim()).slice(0, 60).join("").trim(),
    );

    // Look: mono uppercase 11px type, 14/600 title, mono 12px sub, a drag handle.
    const parts = rowButton(page, IDS.link).locator("> span");
    expect(await css(parts.nth(0), "font-size")).toBe("11px");
    expect(await css(parts.nth(0), "text-transform")).toBe("uppercase");
    expect(await css(parts.nth(0), "font-family")).toMatch(/Geist.?Mono/);
    expect(await css(parts.nth(1), "font-size")).toBe("14px");
    expect(await css(parts.nth(1), "font-weight")).toBe("600");
    expect(await css(parts.nth(2), "font-size")).toBe("12px");
    expect(await css(parts.nth(2), "font-family")).toMatch(/Geist.?Mono/);
    await expect(
      rowOf(page, IDS.link).getByRole("button", { name: "Drag to reorder" }),
    ).toBeVisible();
    expect((await rowOf(page, IDS.link).boundingBox())!.height).toBeGreaterThanOrEqual(58);
  });

  test("M2-11 a row opens and closes its panel; opening another closes the first; the panel is indented", async ({
    page,
    context,
  }, info) => {
    await seededUser(context, "rw2");
    await openEditor(page);
    const a = rowButton(page, IDS.link);
    const b = rowButton(page, IDS.link2);
    await expect(a).toHaveAttribute("aria-expanded", "false");
    await a.click();
    await expect(a).toHaveAttribute("aria-expanded", "true");
    await expect(panel(page, IDS.link)).toBeVisible();
    expect(await css(rowOf(page, IDS.link), "border-top-color")).toBe("rgb(28, 27, 26)");
    expect(await css(panel(page, IDS.link), "background-color")).toBe("rgb(250, 250, 248)");
    expect(await css(panel(page, IDS.link), "padding-left")).toBe(
      phoneOnly(info) ? "16px" : "36px",
    );

    await b.click();
    await expect(a).toHaveAttribute("aria-expanded", "false");
    await expect(b).toHaveAttribute("aria-expanded", "true");
    await expect(panel(page, IDS.link)).toHaveCount(0);
    await expect(panel(page, IDS.link2)).toBeVisible();
    await b.click();
    await expect(b).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator("[id^='block-panel-']")).toHaveCount(0);
    expect(await css(rowOf(page, IDS.link2), "border-top-color")).toBe("rgb(226, 223, 217)");
  });

  test("M2-11 editing in the panel updates the row, the preview and the draft", async ({
    page,
    context,
  }, info) => {
    const user = await seededUser(context, "rw3");
    await openEditor(page);
    await rowButton(page, IDS.link2).click();
    const label = panel(page, IDS.link2).getByLabel("Label", { exact: true });
    await label.fill("Studio hire by the hour");
    await expect(rowButton(page, IDS.link2).locator("> span").nth(1)).toHaveText(
      "Studio hire by the hour",
    );
    await expectDraft(user.pageId, (d) =>
      d.blocks.some(
        (b) => b.id === IDS.link2 && (b as { label: string }).label === "Studio hire by the hour",
      ),
    );
    await openPreviewTab(page, info);
    await expect(previewScreen(page)).toContainText("Studio hire by the hour");
  });

  test("M2-11 with zero blocks the list shows the empty state", async ({ page, context }) => {
    await emptyUser(context, "rw4");
    await openEditor(page);
    await expect(page.getByText("No blocks yet. Add your first block above.")).toBeVisible();
    await expect(countHeading(page, 0)).toBeVisible();
  });

  test("M2-11 phone: a 120-character title and a 300-character URL are ellipsized; controls are 44px; no Hidden chip", async ({
    page,
    context,
  }, info) => {
    test.skip(!phoneOnly(info), "phone layout");
    const user = await emptyUser(context, "rw5");
    const long = newBlockId();
    const hidden = newBlockId();
    await setDraft(
      user.pageId,
      draftWith(user.handle, [
        {
          id: long,
          type: "image",
          visible: true,
          image: null,
          alt: "L".repeat(40) + " " + "ong".repeat(26),
          url: "https://example.com/" + "p".repeat(280),
        },
        { id: hidden, type: "header", visible: false, text: "A hidden header" },
      ]),
    );
    await openEditor(page);
    await expectNoHorizontalScroll(page);
    await expectTapTargets(page);
    await expectTapTargets(page, "li[data-block-id]");
    const parts = rowButton(page, long).locator("> span");
    const alt = await parts.nth(1).innerText();
    expect(alt.length).toBeGreaterThanOrEqual(100);
    for (const index of [1, 2]) {
      expect(await css(parts.nth(index), "text-overflow")).toBe("ellipsis");
      expect(await parts.nth(index).evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
    }
    await expect(rowOf(page, hidden).getByText("Hidden", { exact: true })).toBeHidden();
    await expect(toggle(page, hidden)).toHaveAttribute("aria-pressed", "false");
    await rowButton(page, long).click();
    await expectNoHorizontalScroll(page);
    await expectTapTargets(page, "li[data-block-id]");
  });

  test("M2-11 desktop: rows fill the block column (max 720px)", async ({ page, context }, info) => {
    test.skip(!desktopOnly(info), "desktop layout");
    await seededUser(context, "rw6");
    await openEditor(page);
    const column = (await page.getByRole("region", { name: "Blocks", exact: true }).boundingBox())!;
    const row = (await rowOf(page, IDS.link).boundingBox())!;
    expect(row.width).toBeLessThanOrEqual(720);
    expect(Math.abs(row.width - column.width)).toBeLessThanOrEqual(1);
  });
});

async function seededPageId(page: Page): Promise<string | undefined> {
  // The handle is in the breadcrumb: `{handle}.hydlnk.com / main`.
  const crumb = await page.locator("main > header p").innerText();
  const handle = crumb.split(".hydlnk.com")[0]!;
  const { data } = await adminClient().from("pages").select("id").eq("handle", handle).single();
  return data?.id as string | undefined;
}

// ---------------------------------------------------------------------------------------------
// M2-12
// ---------------------------------------------------------------------------------------------

test.describe("M2-12 visibility toggle", () => {
  test("M2-12 the toggle: aria-pressed, a 32x18 pill, a 14px knob and a 52x48 hit area", async ({
    page,
    context,
  }) => {
    await seededUser(context, "vi1");
    await openEditor(page);
    const on = toggle(page, IDS.link);
    await expect(on).toHaveAttribute("aria-pressed", "true");
    const hit = (await on.boundingBox())!;
    expect(hit.width).toBeGreaterThanOrEqual(52);
    expect(hit.height).toBeGreaterThanOrEqual(48);
    const pill = on.locator("span").first();
    expect((await pill.boundingBox())!.width).toBe(32);
    expect((await pill.boundingBox())!.height).toBe(18);
    expect(await css(pill, "background-color")).toBe("rgb(28, 27, 26)");
    const knob = pill.locator("span");
    expect((await knob.boundingBox())!.width).toBe(14);
    expect(await css(knob, "background-color")).toBe("rgb(255, 255, 255)");

    const off = toggle(page, IDS.image); // hidden in the seed
    await expect(off).toHaveAttribute("aria-pressed", "false");
    expect(await css(off.locator("span").first(), "background-color")).toBe("rgb(201, 197, 190)");
  });

  test("M2-12 off dims the row to 55%, shows the Hidden chip and leaves the preview; on restores it in place; it persists", async ({
    page,
    context,
  }, info) => {
    const user = await seededUser(context, "vi2");
    await openEditor(page);
    await openPreviewTab(page, info);
    const before = await previewIds(page);
    expect(before).toContain(IDS.link2);
    await openBlocksTab(page, info);

    const row = rowOf(page, IDS.link2);
    await toggle(page, IDS.link2).click();
    await expect(toggle(page, IDS.link2)).toHaveAttribute("aria-pressed", "false");
    expect(await css(row.locator("[data-dim]"), "opacity")).toBe("0.55");
    const chip = row.getByText("Hidden", { exact: true });
    if (phoneOnly(info)) await expect(chip).toBeHidden();
    else await expect(chip).toBeVisible();
    await openPreviewTab(page, info);
    expect(await previewIds(page)).toEqual(before.filter((id) => id !== IDS.link2));
    await openBlocksTab(page, info);

    await expect(saveIndicator(page)).toHaveText("Saved");
    await expectDraft(
      user.pageId,
      (d) => d.blocks.find((b) => b.id === IDS.link2)?.visible === false,
    );
    await reloadEditor(page);
    await expect(toggle(page, IDS.link2)).toHaveAttribute("aria-pressed", "false");

    await toggle(page, IDS.link2).click();
    await expect(toggle(page, IDS.link2)).toHaveAttribute("aria-pressed", "true");
    await expect(row.locator("[data-dim]")).toHaveCount(0);
    await openPreviewTab(page, info);
    expect(await previewIds(page)).toEqual(before);
  });

  test("M2-12 it works for all nine block types", async ({ page, context }) => {
    const user = await seededUser(context, "vi3");
    await openEditor(page);
    const ids = Object.values(IDS);
    for (const id of ids) {
      const t = toggle(page, id);
      if ((await t.getAttribute("aria-pressed")) === "true") await t.click();
      await expect(t).toHaveAttribute("aria-pressed", "false");
    }
    await expect(saveIndicator(page)).toHaveText("Saved");
    const draft = await expectDraft(user.pageId, (d) => d.blocks.every((b) => b.visible === false));
    expect(new Set(draft.blocks.map((b) => b.type)).size).toBe(9);
    await reloadEditor(page);
    for (const id of ids) await expect(toggle(page, id)).toHaveAttribute("aria-pressed", "false");
  });

  test("M2-12 after Publish a hidden block's text and URL are gone from published and the live page, still in the draft", async ({
    page,
    context,
  }) => {
    const user = await seededUser(context, "vi4");
    await openEditor(page);
    const live0 = await rawRequest(`${user.handle}.localhost:3000`, "/");
    expect(live0.body).toContain("Studio rental by the hour");
    await toggle(page, IDS.link2).click();
    await page
      .locator("main > header")
      .getByRole("button", { name: "Publish", exact: true })
      .click();
    await expect(page.locator("[data-publish-status]")).toHaveText("Published");

    const row = await pageRow(user.pageId);
    const published = JSON.stringify(row.published);
    expect(published).not.toContain("Studio rental by the hour");
    expect(published).not.toContain("maraokafor.example/studio");
    expect(JSON.stringify(row.draft)).toContain("Studio rental by the hour");
    const live = await rawRequest(`${user.handle}.localhost:3000`, "/");
    expect(live.body).not.toContain("Studio rental by the hour");
    expect(live.body).not.toContain("maraokafor.example/studio");
    await expect(rowOf(page, IDS.link2)).toBeVisible(); // still in the editor list
  });

  test("M2-12 direct API: every block hidden through PostgREST, published through the gate, strips them all", async ({
    page,
    context,
  }) => {
    const user = await seededUser(context, "vi5");
    const token = await accessToken(context);
    const draft = (await pageRow(user.pageId)).draft;
    const hiddenAll = { ...draft, blocks: draft.blocks.map((b) => ({ ...b, visible: false })) };
    const res = await restAs(token, `/pages?id=eq.${user.pageId}`, {
      method: "PATCH",
      body: { draft: hiddenAll },
    });
    expect(res.status).toBe(200);
    await openEditor(page);
    await page
      .locator("main > header")
      .getByRole("button", { name: "Publish", exact: true })
      .click();
    await expect(page.locator("[data-publish-status]")).toHaveText("Published");
    const row = await pageRow(user.pageId);
    expect((row.published as { blocks: unknown[] }).blocks).toEqual([]);
    expect(row.draft.blocks).toHaveLength(10);
  });

  test("M2-12 phone: the hit area is 44px both ways and nothing overflows; desktop: the toggle sits at the right edge", async ({
    page,
    context,
  }, info) => {
    await seededUser(context, "vi6");
    await openEditor(page);
    const hit = (await toggle(page, IDS.link).boundingBox())!;
    expect(hit.width).toBeGreaterThanOrEqual(44);
    expect(hit.height).toBeGreaterThanOrEqual(44);
    const row = (await rowOf(page, IDS.link).boundingBox())!;
    expect(hit.x + hit.width).toBeGreaterThan(row.x + row.width - 12);
    expect(hit.x + hit.width).toBeLessThanOrEqual(row.x + row.width);
    if (phoneOnly(info)) {
      await expectNoHorizontalScroll(page);
      await expectTapTargets(page, "li[data-block-id]");
    }
  });
});

// ---------------------------------------------------------------------------------------------
// M2-13
// ---------------------------------------------------------------------------------------------

test.describe("M2-13 delete with undo", () => {
  test("M2-13 Delete block removes the block at once, no confirm; Undo restores the same block at its index", async ({
    page,
    context,
  }, info) => {
    const user = await seededUser(context, "de1");
    await openEditor(page);
    const original = (await pageRow(user.pageId)).draft.blocks;
    const target = original[2]!; // the first link
    let dialogs = 0;
    page.on("dialog", (d) => {
      dialogs += 1;
      void d.dismiss();
    });

    await rowButton(page, target.id).click();
    const del = panel(page, target.id).getByRole("button", { name: "Delete block" });
    expect(await css(del, "background-color")).toBe("rgb(255, 255, 255)");
    expect(await css(del, "border-top-color")).toBe("rgb(232, 196, 189)");
    expect(await css(del, "color")).toBe("rgb(178, 58, 43)");
    expect((await del.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await del.click();
    await expect(rowOf(page, target.id)).toHaveCount(0);
    await expect(countHeading(page, 9)).toBeVisible();
    expect(dialogs).toBe(0);

    const toast = page.getByRole("status").filter({ hasText: "Block deleted." });
    await expect(toast).toBeVisible();
    await expect(toast).toHaveAttribute("aria-live", "polite");
    const undo = toast.getByRole("button", { name: "Undo" });
    expect((await undo.boundingBox())!.height).toBeGreaterThanOrEqual(44);

    await openPreviewTab(page, info);
    expect(await previewIds(page)).not.toContain(target.id);
    await openBlocksTab(page, info);
    await expect(saveIndicator(page)).toHaveText("Saved");
    await expectDraft(user.pageId, (d) => !d.blocks.some((b) => b.id === target.id));

    await undo.click();
    await expect(rowOf(page, target.id)).toBeVisible();
    await expect(toast.getByRole("button", { name: "Undo" })).toHaveCount(0);
    const order = await rows(page).evaluateAll((els) =>
      els.map((e) => e.getAttribute("data-block-id")),
    );
    expect(order).toEqual(original.map((b) => b.id));
    await expect(saveIndicator(page)).toHaveText("Saved");
    const restored = await expectDraft(user.pageId, (d) =>
      d.blocks.some((b) => b.id === target.id),
    );
    expect(restored.blocks[2]).toEqual(target);
  });

  test("M2-13 the toast stays for 8 seconds; after that the block can no longer be restored from it", async ({
    page,
    context,
  }) => {
    await seededUser(context, "de2");
    await openEditor(page);
    await rowButton(page, IDS.divider).click();
    await panel(page, IDS.divider).getByRole("button", { name: "Delete block" }).click();
    const undo = page.getByRole("button", { name: "Undo" });
    await expect(undo).toBeVisible();
    await page.waitForTimeout(7000);
    await expect(undo).toBeVisible();
    await expect(undo).toBeHidden({ timeout: 4000 });
    await expect(rowOf(page, IDS.divider)).toHaveCount(0);
  });

  test("M2-13 deleting the last block shows the empty state; reload keeps it gone; the live page still has it; no Storage call", async ({
    page,
    context,
  }) => {
    const user = await emptyUser(context, "de3");
    const id = newBlockId();
    await setDraft(
      user.pageId,
      draftWith(user.handle, [{ id, type: "header", visible: true, text: "Only block here" }]),
    );
    await adminClient()
      .from("pages")
      .update({
        published: {
          version: 1,
          profile: { name: user.handle, bio: "", photo: null },
          theme: { ref: null, overrides: {} },
          tokens: (await import("@/lib/theme")).SYSTEM_DEFAULT_TOKENS,
          blocks: [{ id, type: "header", visible: true, text: "Only block here" }],
        },
        published_at: new Date().toISOString(),
      })
      .eq("id", user.pageId)
      .throwOnError();
    const storage: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes("/storage/v1/")) storage.push(`${r.method()} ${r.url()}`);
    });
    await openEditor(page);
    await rowButton(page, id).click();
    await panel(page, id).getByRole("button", { name: "Delete block" }).click();
    await expect(page.getByText("No blocks yet. Add your first block above.")).toBeVisible();
    await expect(previewScreen(page)).not.toContainText("Only block here");
    await expect(saveIndicator(page)).toHaveText("Saved");
    await reloadEditor(page);
    await expect(page.getByText("No blocks yet. Add your first block above.")).toBeVisible();
    expect(await pageRow(user.pageId).then((r) => r.draft.blocks)).toEqual([]);
    const live = await rawRequest(`${user.handle}.localhost:3000`, "/");
    expect(live.body).toContain("Only block here");
    expect(storage).toEqual([]);
  });

  test("M2-13 deleting an image block with an uploaded image makes no Storage call and keeps the object readable", async ({
    page,
    context,
  }) => {
    const user = await emptyUser(context, "de6");
    await openEditor(page);
    await chip(page, "image").click();
    const row = rows(page).first();
    await row.locator("input[type=file]").setInputFiles({
      name: "block.png",
      mimeType: "image/png",
      buffer: makePng(64, 48),
    });
    const stored = await expectDraft(
      user.pageId,
      (d) => (d.blocks[0] as { image: unknown } | undefined)?.image != null,
    );
    const path = (stored.blocks[0] as unknown as { image: { path: string } }).image.path;
    const storage: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/storage/v1/"))
        storage.push(`${request.method()} ${request.url()}`);
    });
    await row.getByRole("button", { name: "Delete block" }).click();
    await expect(rows(page)).toHaveCount(0);
    await expectDraft(user.pageId, (d) => d.blocks.length === 0);
    expect(storage).toEqual([]);
    const object = await fetch(`${supabaseUrl()}/storage/v1/object/public/page-media/${path}`);
    expect(object.status).toBe(200);
  });

  test("M2-13 phone: the toast sits above the tab bar and below nothing it should not cover", async ({
    page,
    context,
  }, info) => {
    test.skip(!phoneOnly(info), "phone layout");
    await seededUser(context, "de4");
    await openEditor(page);
    await rowButton(page, IDS.divider).click();
    await panel(page, IDS.divider).getByRole("button", { name: "Delete block" }).click();
    const toast = page.getByRole("status").filter({ hasText: "Block deleted." }).locator("> div");
    await expect(toast).toBeVisible();
    const tabs = (await page.getByRole("navigation", { name: "App sections" }).boundingBox())!;
    const box = (await toast.boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(tabs.y);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    const publish = (await page
      .locator("main > header")
      .getByRole("button", { name: "Publish" })
      .boundingBox())!;
    expect(box.y).toBeGreaterThan(publish.y + publish.height);
    await expectNoHorizontalScroll(page);
    await expectTapTargets(page, "[role='status']");
  });

  test("M2-13 desktop: the toast appears at the bottom left of the main column", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "desktop layout");
    await seededUser(context, "de5");
    await openEditor(page);
    await rowButton(page, IDS.divider).click();
    await panel(page, IDS.divider).getByRole("button", { name: "Delete block" }).click();
    const toast = page.getByRole("status").filter({ hasText: "Block deleted." }).locator("> div");
    await expect(toast).toBeVisible();
    const box = (await toast.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(240);
    expect(box.x).toBeLessThan(400);
    expect(box.y + box.height).toBeGreaterThan(900 - 60);
    expect(box.y + box.height).toBeLessThanOrEqual(900);
  });
});
