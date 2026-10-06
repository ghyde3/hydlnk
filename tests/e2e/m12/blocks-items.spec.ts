import { expect, test } from "@playwright/test";
import { cleanupUsers, desktopOnly } from "../fixtures/data";
import { expectNoHorizontalScroll, expectTapTargets, DEV_PORT, url } from "../helpers";
import { getClick, waitForClicks, type IngestPage } from "../m4/analytics-ingest-helpers";
import {
  addBlock,
  box,
  expectDraft,
  openEditor,
  previewScreen,
  showView,
  userWithDraft,
} from "../m2/blocks-helpers";
import { publishFromEditor, settled } from "../m9/blocks-fcd-helpers";

/**
 * M12-01 on a real page: an items block added in the editor with three items (one sold, one linked),
 * checked in the preview, published, drawn by the live page, and a click on the linked item counted
 * under the item's own id. At 390x844 and 1440x900: no sideways scroll, every control 44px tall.
 */

test.afterAll(cleanupUsers);
test.describe.configure({ timeout: 120_000 });

test("M12-01 add an items block with three items, publish it, and count a click on the linked item", async ({
  page,
  context,
}, info) => {
  const user = await userWithDraft(context, "it1");
  await openEditor(page);
  const { row, panel, id } = await addBlock(page, "items");
  await expect(row).toContainText("Items");
  await expect(row).toContainText("2 items");

  const cards = panel.getByRole("group", { name: /^Item \d+$/ });
  await expect(cards).toHaveCount(2);
  await panel.getByLabel("Heading (optional)").fill("Garage sale");
  await panel.getByLabel("Layout").selectOption("grid");

  await cards.nth(0).getByLabel("Name", { exact: true }).fill("Desk lamp");
  await cards.nth(0).getByLabel("Price", { exact: true }).fill("$12");
  await cards.nth(1).getByLabel("Name", { exact: true }).fill("Bookshelf");
  await cards.nth(1).getByLabel("Price", { exact: true }).fill("$40");
  await cards.nth(1).getByLabel("Description").fill("Pine, 5 shelves.");
  await cards.nth(1).getByRole("button", { name: "Sold", exact: true }).click();
  await expect(cards.nth(1).getByRole("button", { name: "Sold", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  await panel.getByRole("button", { name: "Add item" }).click();
  await expect(cards).toHaveCount(3);
  await cards.nth(2).getByLabel("Name", { exact: true }).fill("Mystery box");
  await cards.nth(2).getByLabel("Price", { exact: true }).fill("Free");
  await cards.nth(2).getByLabel("Link (optional)").fill("https://shop.example/mystery-box");

  // Every control in the form is at least 44px tall, and the editor does not scroll sideways.
  for (const control of await panel.locator("input, select, textarea, button").all()) {
    if (!(await control.isVisible())) continue;
    expect((await box(control)).height).toBeGreaterThanOrEqual(43.5);
  }
  await expectNoHorizontalScroll(page);

  await expectDraft(user.pageId, (draft) => {
    const block = draft.blocks.find((b) => b.id === id);
    return (
      block?.type === "items" &&
      block.layout === "grid" &&
      block.heading === "Garage sale" &&
      block.items.length === 3 &&
      block.items[1]!.sold === true &&
      block.items[2]!.url === "https://shop.example/mystery-box"
    );
  });
  const itemIds = await cards.evaluateAll((els) =>
    els.map((el) => el.getAttribute("data-item-id")),
  );

  await showView(page, "Preview");
  const preview = previewScreen(page);
  await expect(preview.locator(`.pg-items[data-block-id="${id}"] .pg-item`)).toHaveCount(3);
  await expect(preview.locator(".pg-item-sold")).toHaveText("Sold");
  await showView(page, "Blocks");

  await publishFromEditor(page, user.pageId);
  await page.goto(url(user.handle));
  await settled(page);

  const items = page.locator(`.pg-items[data-block-id="${id}"]`);
  await expect(items).toHaveAttribute("data-layout", "grid");
  await expect(items.locator(".pg-items-heading")).toHaveText("Garage sale");
  await expect(items.locator(".pg-item")).toHaveCount(3);
  await expect(items.locator(".pg-item-name")).toHaveText([
    "Desk lamp",
    "Bookshelf",
    "Mystery box",
  ]);
  await expect(items.locator(".pg-item-price")).toHaveText(["$12", "$40", "Free"]);
  // The sold item says Sold and has its price struck through.
  const sold = items.locator(".pg-item[data-sold]");
  await expect(sold).toHaveCount(1);
  await expect(sold.locator(".pg-item-sold")).toHaveText("Sold");
  await expect(sold.locator(".pg-item-price s")).toHaveText("$40");
  expect(
    await sold
      .locator(".pg-item-price s")
      .evaluate((el) => getComputedStyle(el).textDecorationLine),
  ).toContain("line-through");
  // Prices are display only: nothing to buy, and only the linked item is a link.
  await expect(items.locator("a")).toHaveCount(1);
  const href = await items.locator("a").getAttribute("href");
  expect(href).toBe(`/r/${user.pageId}/${itemIds[2]}`);
  await expect(items.locator("a")).toHaveAttribute("rel", "nofollow noopener");

  // Two columns in the grid, at both widths.
  const first = await box(items.locator(".pg-item").nth(0));
  const second = await box(items.locator(".pg-item").nth(1));
  expect(second.x).toBeGreaterThan(first.x + first.width / 2);

  await expectNoHorizontalScroll(page);
  await expectTapTargets(page, ".pg-items");
  if (desktopOnly(info)) expect(first.width).toBeLessThanOrEqual(480);

  // The click on the linked item is counted under the item's id, and goes to its address.
  const live: IngestPage = {
    userId: user.userId,
    email: user.email,
    handle: user.handle,
    pageId: user.pageId,
    host: `${user.handle}.localhost:${DEV_PORT}`,
    origin: `http://${user.handle}.localhost:${DEV_PORT}`,
    url: url(user.handle),
    doc: undefined as never,
  };
  const response = await getClick(live, itemIds[2]!);
  expect(response.status).toBe(302);
  expect(response.headers.location).toBe("https://shop.example/mystery-box");
  const clicks = await waitForClicks(user.pageId, 1);
  expect(clicks[0]).toMatchObject({ block_id: itemIds[2] });
  // An item without an address has no redirect.
  expect((await getClick(live, itemIds[0]!)).status).toBe(404);
});
