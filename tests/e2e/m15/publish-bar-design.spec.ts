import { expect, test, type Locator, type Page } from "@playwright/test";
import { cleanupUsers } from "../fixtures/data";
import { expectNoHorizontalScroll } from "../helpers";
import { emptyUser, openEditor, statusChip } from "../m2/editor-helpers";
import { adminClient } from "../fixtures/auth";
import { addPageEntry, editSubPageHeader, entry, seedEntries } from "./entry-helpers";

/**
 * M15-10 step 4, the publish bar against DESIGN.md: the chip that opens it is named with the status
 * it shows and has a chevron at every width; the bar's chips are one style on the 4px grid in the
 * token colors; a title cut with an ellipsis carries the full text. One smoke per viewport (phone
 * 390x844, desktop 1440x900); each run makes its own user and site.
 */

test.afterAll(cleanupUsers);
test.describe.configure({ timeout: 180_000 });

const LONG = "A page whose title is far longer than one line of the publish bar can show";
const bar = (page: Page) => page.getByTestId("publish-bar");
const toggle = (page: Page) => page.getByTestId("publish-bar-toggle");
const row = (page: Page, key: string) => page.getByTestId(`publish-row-${key}`);
const style = (locator: Locator, property: string) =>
  locator.evaluate((element, name) => getComputedStyle(element).getPropertyValue(name), property);
/** A token's color as the browser computes it. */
const token = (page: Page, name: string) =>
  page.evaluate((variable) => {
    const probe = document.createElement("span");
    probe.style.color = `var(${variable})`;
    document.body.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  }, name);

test("M15-10 the publish bar's chip, chevron, chips and titles", async ({ page, context }) => {
  const user = await emptyUser(context, "pbd", { plan: "pro" });
  const { subId } = await seedEntries(user.pageId);
  const toolbar = page.getByTestId("workspace-toolbar-row");
  const publish = toolbar.getByRole("button", { name: "Publish", exact: true });

  await openEditor(page);
  await publish.click();
  await expect(statusChip(page)).toHaveText("Published", { timeout: 30_000 });
  // A page that is not live, with a long title, and a change on the live page: three states.
  const longId = await addPageEntry(user.pageId, { path: "long-title", title: LONG });
  await editSubPageHeader(page, "Changed");
  await expect
    .poll(async () => JSON.stringify((await entry(subId)).draft.blocks))
    .toContain("Changed");
  await page.reload();
  await expect(statusChip(page)).toHaveText("Unpublished changes");
  // Measured in Public Sans, the font the design is drawn in: the chip is in the server's HTML, so
  // it can be on screen in the fallback font for a moment before the swap.
  await page.evaluate(() => document.fonts.ready);

  // The chip: its name holds the text it shows, and Publish is still the only "Publish…" button.
  await expect(toggle(page)).toHaveAccessibleName(
    "Status: Unpublished changes, choose what to publish",
  );
  await expect(page.getByRole("button", { name: /^Publish/ })).toHaveCount(1);
  await expect(publish).toBeVisible();
  // The chevron shows at this width, inside the toggle, which stays a 44px target on one line.
  const chevron = toggle(page).getByTestId("publish-bar-chevron");
  await expect(chevron).toBeVisible();
  const [toggleBox, chevronBox, chipBox, publishBox] = await Promise.all([
    toggle(page).boundingBox(),
    chevron.boundingBox(),
    statusChip(page).boundingBox(),
    publish.boundingBox(),
  ]);
  expect(toggleBox!.height).toBeGreaterThanOrEqual(44);
  expect(chipBox!.height).toBeLessThanOrEqual(30);
  expect(chevronBox!.x).toBeGreaterThanOrEqual(chipBox!.x + chipBox!.width);
  expect(chevronBox!.x + chevronBox!.width).toBeLessThanOrEqual(publishBox!.x);
  await expectNoHorizontalScroll(page);

  // The bar: one chip style, 4px top and bottom, 8px sides, in the token colors.
  await toggle(page).click();
  await expect(bar(page)).toBeVisible();
  await expectNoHorizontalScroll(page);
  const colors = {
    live: [await token(page, "--hl-good-bg"), await token(page, "--hl-good-text")],
    changed: [await token(page, "--hl-brass-soft"), await token(page, "--hl-brass-soft-text")],
    draft: [await token(page, "--hl-track"), await token(page, "--hl-text-2")],
  } as const;
  for (const [key, state] of [
    ["design", "live"],
    [subId, "changed"],
    [longId, "draft"],
  ] as const) {
    const chip = row(page, key).locator("[data-item-state]");
    await expect(chip).toHaveAttribute("data-item-state", state);
    expect(await style(chip, "padding-top")).toBe("4px");
    expect(await style(chip, "padding-bottom")).toBe("4px");
    expect(await style(chip, "padding-left")).toBe("8px");
    expect(await style(chip, "border-radius")).toBe("4px");
    expect((await chip.boundingBox())!.height).toBe(24);
    expect(await style(chip, "background-color")).toBe(colors[state][0]);
    expect(await style(chip, "color")).toBe(colors[state][1]);
  }
  const liveDot = row(page, "design").locator("[data-item-state] span");
  expect(await style(liveDot, "background-color")).toBe(await token(page, "--hl-good"));

  // The long title is cut, and can be read in full.
  const title = row(page, longId).locator("p").first();
  await expect(title).toHaveAttribute("title", LONG);
  expect(await title.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);

  // Revisions: the "Published" tag is the same chip.
  await row(page, subId).getByRole("button", { name: "Revisions", exact: true }).click();
  const tag = page.getByTestId("page-revisions").locator("[data-revision-published]").first();
  await expect(tag).toBeVisible();
  expect(await style(tag, "padding-top")).toBe("4px");
  expect(await style(tag, "padding-bottom")).toBe("4px");
  expect(await style(tag, "background-color")).toBe(colors.live[0]);
  expect(await style(tag, "color")).toBe(colors.live[1]);
  await expectNoHorizontalScroll(page);
});

const SIXTY = "Sixty characters of title to fill a row of the publish bar..";

/** True when two boxes share any area (touching edges do not count). */
const intersect = (
  a: { top: number; bottom: number; left: number; right: number },
  b: { top: number; bottom: number; left: number; right: number },
) =>
  a.top < b.bottom - 0.5 &&
  b.top < a.bottom - 0.5 &&
  a.left < b.right - 0.5 &&
  b.left < a.right - 0.5;

/** The rows of a list: their boxes, and the box their padding leaves for what they hold. */
const measureRows = (list: Locator) =>
  list.evaluate((element) =>
    [...element.children].map((child) => {
      const box = child.getBoundingClientRect();
      const style = getComputedStyle(child);
      const inner = [...child.querySelectorAll("p, button, span, time")].map((part) =>
        part.getBoundingClientRect(),
      );
      return {
        top: box.top,
        bottom: box.bottom,
        left: box.left,
        right: box.right,
        // Where the row's own padding (and bottom border) lets content start and end.
        innerTop: box.top + parseFloat(style.paddingTop),
        innerBottom:
          box.bottom - parseFloat(style.paddingBottom) - parseFloat(style.borderBottomWidth),
        // The highest and the lowest pixel any text, chip or button of the row reaches.
        contentTop: Math.min(box.bottom, ...inner.map((part) => part.top)),
        contentBottom: Math.max(box.top, ...inner.map((part) => part.bottom)),
      };
    }),
  );

function expectRowsApart(rows: Awaited<ReturnType<typeof measureRows>>): void {
  rows.forEach((row, i) => {
    // The row did not shrink under what it holds: nothing is pushed into its padding, or past it.
    expect(row.contentTop, `row ${i} keeps its top padding`).toBeGreaterThanOrEqual(
      row.innerTop - 0.5,
    );
    expect(row.contentBottom, `row ${i} keeps its bottom padding`).toBeLessThanOrEqual(
      row.innerBottom + 0.5,
    );
    for (let j = i + 1; j < rows.length; j++) {
      expect(intersect(row, rows[j]!), `rows ${i} and ${j} overlap`).toBe(false);
    }
  });
}

test("M15-10 the publish bar with twelve pages: rows apart, buttons clickable, the list scrolls, the sheet clears the tab bar, Tab follows the eye", async ({
  page,
  context,
}) => {
  const user = await emptyUser(context, "pbm", { plan: "studio" });
  const { subId } = await seedEntries(user.pageId);
  // Home, Gallery and ten more: twelve pages, one with a 60-character title.
  expect(SIXTY).toHaveLength(60);
  let lastId = subId;
  for (let n = 1; n <= 10; n++) {
    lastId = await addPageEntry(user.pageId, {
      path: `page-${n}`,
      title: n === 3 ? SIXTY : `Page ${n}`,
    });
  }
  // Gallery has a long history: eighteen revisions, each one published.
  const admin = adminClient();
  const bumped = await admin.from("content_entries").update({ rev: 20 }).eq("id", subId);
  expect(bumped.error).toBeNull();
  const history = await admin.from("content_entry_revisions").insert(
    Array.from({ length: 18 }, (_, i) => ({
      entry_id: subId,
      site_id: user.pageId,
      rev: i + 2,
      snapshot: { path: "gallery", title: "Gallery", description: "", blocks: [] },
      was_published: true,
      source: "editor",
    })),
  );
  expect(history.error).toBeNull();

  const toolbar = page.getByTestId("workspace-toolbar-row");
  await openEditor(page);
  const phone = page.viewportSize()!.width < 760;

  // G3: Tab walks the toolbar row in the order the eye reads it, left to right.
  await toolbar.getByRole("button", { name: "Undo", exact: true }).focus();
  const walked: { name: string; x: number }[] = [];
  for (let step = 0; step < 12; step++) {
    const at = await page.evaluate((rowId) => {
      const active = document.activeElement;
      const row = document.querySelector(`[data-testid="${rowId}"]`);
      if (!active || !row || !row.contains(active)) return null;
      return {
        name: active.getAttribute("aria-label") ?? active.textContent ?? "",
        x: active.getBoundingClientRect().left,
      };
    }, "workspace-toolbar-row");
    if (at === null) break;
    walked.push(at);
    await page.keyboard.press("Tab");
  }
  const names = walked.map((stop) => stop.name);
  if (phone) {
    // Phone: Undo, Redo, the status chip, Publish.
    expect(names).toEqual([
      "Undo",
      "Redo",
      "Status: Not published, choose what to publish",
      "Publish",
    ]);
  } else {
    // Desktop keeps its layout: Undo, Redo, Preview, More, then Publish at the right edge.
    expect(names.slice(0, 2)).toEqual(["Undo", "Redo"]);
    expect(names.at(-1)).toBe("Publish");
  }
  walked.slice(1).forEach((stop, i) => {
    expect(stop.x, `${stop.name} comes after ${walked[i]!.name}`).toBeGreaterThan(walked[i]!.x);
  });
  // And backwards from Undo there is nothing of this row: the chip does not come before it.
  if (phone) {
    await toolbar.getByRole("button", { name: "Undo", exact: true }).focus();
    await page.keyboard.press("Shift+Tab");
    expect(
      await page.evaluate(
        () =>
          document
            .querySelector('[data-testid="workspace-toolbar-row"]')
            ?.contains(document.activeElement) ?? false,
      ),
    ).toBe(false);
  }

  await toggle(page).click();
  await expect(bar(page)).toBeVisible();
  const list = bar(page).locator("ul");
  await expect(list.locator("> li")).toHaveCount(13); // the design and twelve pages

  // G1: no row shrinks under its content, and no two rows share a pixel.
  expectRowsApart(await measureRows(list));
  // The list scrolls inside the bar; the page does not grow.
  const scroll = await list.evaluate((element) => ({
    content: element.scrollHeight,
    shown: element.clientHeight,
    overflow: getComputedStyle(element).overflowY,
  }));
  expect(scroll.content).toBeGreaterThan(scroll.shown);
  expect(scroll.overflow).toBe("auto");
  const barBox = (await bar(page).boundingBox())!;
  expect(barBox.y).toBeGreaterThanOrEqual(0);
  expect(barBox.y + barBox.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  await expectNoHorizontalScroll(page);

  // G2: on a phone the sheet sits on the tab bar, not over it.
  if (phone) {
    const tabs = page.locator('nav[aria-label="App sections"]');
    await expect(tabs).toBeVisible();
    const sheet = await bar(page).evaluate((element) => element.getBoundingClientRect().bottom);
    const tabsTop = await tabs.evaluate((element) => element.getBoundingClientRect().top);
    expect(sheet).toBeLessThanOrEqual(tabsTop);
    expect(tabsTop - sheet).toBeLessThan(1);
  }

  // Every row's buttons can be clicked where they are drawn (a covered button fails the trial).
  for (const key of ["design", "home", subId, lastId]) {
    await row(page, key).scrollIntoViewIfNeeded();
    for (const button of await row(page, key).getByRole("button").all()) {
      if (await button.isEnabled()) await button.click({ trial: true, timeout: 5_000 });
    }
  }
  // A real click on the last row's Revisions opens that page's revisions.
  await row(page, lastId).getByRole("button", { name: "Revisions", exact: true }).click();
  await expect(page.getByTestId("page-revisions")).toBeVisible();
  await expect(page.getByTestId("page-revisions")).toHaveAccessibleName("Revisions of Page 10");
  await page.getByRole("button", { name: /Back/ }).click();

  // The revisions list of a page with a long history: the same rules.
  await row(page, subId).scrollIntoViewIfNeeded();
  await row(page, subId).getByRole("button", { name: "Revisions", exact: true }).click();
  const revisions = page.getByTestId("page-revisions");
  await expect(revisions.locator("> li[data-rev]").first()).toBeVisible();
  expect(await revisions.locator("> li[data-rev]").count()).toBeGreaterThanOrEqual(12);
  expectRowsApart(await measureRows(revisions));
  expect(await revisions.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(
    true,
  );
  const lastRevision = revisions.locator("> li[data-rev]").last();
  await lastRevision.scrollIntoViewIfNeeded();
  await lastRevision.getByRole("button").click({ trial: true, timeout: 5_000 });
  await expectNoHorizontalScroll(page);
});
