import { expect, test, type Page } from "@playwright/test";
import { adminClient } from "../fixtures/auth";
import { cleanupUsers, rand } from "../fixtures/data";
import { expectNoHorizontalScroll } from "../helpers";
import { rawBuffer } from "../m2/publish-helpers";
import { saveIndicator } from "../m2/editor-helpers";
import {
  L1,
  TEXT_ID,
  box,
  isPhone,
  link,
  openBlock,
  openEditor,
  pageRow,
  selectText,
  textBlock,
  toolbarOf,
  userWithBlocks,
} from "./text-helpers";

const domains: string[] = [];
test.afterAll(async () => {
  if (domains.length > 0)
    await adminClient().from("blocked_domains").delete().in("domain", domains);
  await cleanupUsers();
});
test.describe.configure({ timeout: 120_000 });

/**
 * M6-29 in the editor: a blocked address in a text link shows under that link's row, the save says
 * Not saved, Publish is off and then refused with the host, and the layout holds on a phone.
 */

const BLOCKED = "That site is blocked. Use a different link.";
const RETRY = "Couldn’t save. Your changes stay here and will retry.";

async function listDomain(domain: string) {
  const { error } = await adminClient().from("blocked_domains").insert({ domain, reason: "e2e" });
  if (error) throw new Error(`blocked_domains insert failed: ${error.message}`);
  domains.push(domain);
}
const newDomain = () => `tl-${rand(8)}.example`;

const publishButton = (page: Page) =>
  page.getByTestId("workspace-toolbar").getByRole("button", { name: "Publish", exact: true });
const rowOfBlock = (page: Page) => page.locator(`li[data-block-id="${TEXT_ID}"]`);
const linkRow = (page: Page) => rowOfBlock(page).locator(`li[data-item-id="${L1}"]`);
const addressField = (page: Page) =>
  page.locator(`#block-panel-${TEXT_ID} input[data-field="link-address"]`);

test.describe("M6-29 the editor refuses a blocked link in text", () => {
  test("M6-29 adding a blocked address: the error is on that link's row, Not saved without the retry sentence, Publish is off; changing the address clears it", async ({
    page,
    context,
  }) => {
    const domain = newDomain();
    await listDomain(domain);
    const user = await userWithBlocks(context, "tbk", [textBlock("Hello world")]);
    await openEditor(page);
    await openBlock(page, TEXT_ID);
    const before = (await pageRow(user.pageId)).draft;

    await selectText(page, TEXT_ID, 6, 11);
    await toolbarOf(page, TEXT_ID).getByRole("button", { name: "Link", exact: true }).click();
    await addressField(page).fill(`https://${domain}/x`);
    await page.getByRole("button", { name: "Add link", exact: true }).click();

    // The error is under that link's row inside the expanded block.
    const row = rowOfBlock(page).locator("section[aria-label='Links in this text'] li").first();
    await expect(row.getByText(BLOCKED, { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(saveIndicator(page)).toHaveAttribute("data-save-status", "blocked");
    await expect(saveIndicator(page)).toHaveText("Not saved");
    await expect(page.getByText(RETRY)).toHaveCount(0);
    await expect(publishButton(page)).toBeDisabled();
    expect((await pageRow(user.pageId)).draft).toEqual(before);
    // The banner names the host.
    await expect(page.getByRole("alert").filter({ hasText: domain })).toContainText(
      "Remove or change it.",
    );

    if (isPhone(page)) {
      await expectNoHorizontalScroll(page);
      for (const b of await row.getByRole("button").all())
        expect((await box(b)).height).toBeGreaterThanOrEqual(44);
    } else {
      // Under the link's row, inside the block panel.
      const message = await box(row.getByText(BLOCKED, { exact: true }));
      const rowBox = await box(row);
      const panel = await box(page.locator(`#block-panel-${TEXT_ID}`));
      expect(message.y + message.height).toBeLessThanOrEqual(rowBox.y + rowBox.height + 1);
      expect(message.x).toBeGreaterThanOrEqual(panel.x - 0.5);
      expect(message.x + message.width).toBeLessThanOrEqual(panel.x + panel.width + 0.5);
    }

    // Change the address: the error clears at once, the save goes through, the status returns to Saved.
    await row.getByRole("button", { name: /^Edit link/ }).click();
    await addressField(page).fill("https://ok.example/fixed");
    await page.getByRole("button", { name: "Update link", exact: true }).click();
    await expect(page.getByText(BLOCKED)).toHaveCount(0);
    await expect(saveIndicator(page)).toHaveAttribute("data-save-status", "saved", {
      timeout: 15_000,
    });
    await expect(saveIndicator(page)).toHaveText("Saved");
    await expect(publishButton(page)).toBeEnabled();
  });

  test("M6-29 a failed Publish names the host, opens the text block and keeps the error only while the link holds it", async ({
    page,
    context,
  }) => {
    const late = newDomain();
    const user = await userWithBlocks(context, "tbp", [
      textBlock("Hello world", [link(6, 11, L1, `https://${late}/x`)]),
    ]);
    await openEditor(page);
    await publishButton(page).click();
    await expect(page.locator('[data-publish-status="published"]')).toBeVisible({
      timeout: 20_000,
    });
    const published = (await pageRow(user.pageId)).published_at;
    expect((await rawBuffer(`${user.handle}.localhost:3000`, "/")).status).toBe(200);

    // The domain is listed after the draft was saved and published.
    await listDomain(late);
    await publishButton(page).click();
    await expect(
      page.getByText(
        `Can’t publish. 1 link points to a blocked site: ${late}. Remove or change it.`,
      ),
    ).toBeVisible({ timeout: 20_000 });
    // The text block opens, with the error on that link's row.
    await expect(rowOfBlock(page).locator("button[aria-expanded]").first()).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await expect(linkRow(page).getByText(BLOCKED, { exact: true })).toBeVisible();
    expect((await pageRow(user.pageId)).published_at).toBe(published);
    // The blocked link is not served: the live page is the old one, untouched.
    const live = await rawBuffer(`${user.handle}.localhost:3000`, "/");
    expect(live.status).toBe(200);

    if (isPhone(page)) {
      // The banner and the error wrap, sit above the bottom tab bar and do not cover Publish.
      await expectNoHorizontalScroll(page);
      const alert = page.getByRole("alert").filter({ hasText: late });
      const alertBox = await box(alert);
      const tabs = page.getByRole("navigation", { name: "App sections" });
      if (await tabs.isVisible()) {
        const tabsBox = await box(tabs);
        expect(alertBox.y + alertBox.height).toBeLessThanOrEqual(tabsBox.y + 1);
      }
      const publish = publishButton(page);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(200);
      const publishBox = await box(publish);
      const alertNow = await box(alert);
      const overlaps =
        alertNow.x < publishBox.x + publishBox.width &&
        publishBox.x < alertNow.x + alertNow.width &&
        alertNow.y < publishBox.y + publishBox.height &&
        publishBox.y < alertNow.y + alertNow.height;
      expect(overlaps, "the banner does not cover Publish").toBe(false);
      const topmost = await page.evaluate(
        ({ x, y }) => {
          const el = document.elementFromPoint(x, y);
          return el?.closest("button")?.textContent?.trim() ?? el?.tagName ?? null;
        },
        { x: publishBox.x + publishBox.width / 2, y: publishBox.y + publishBox.height / 2 },
      );
      expect(topmost).toBe("Publish");
    }

    // Change the link: the error clears, and Publish goes through.
    await linkRow(page)
      .getByRole("button", { name: /^Edit link/ })
      .click();
    await addressField(page).fill("https://ok.example/after");
    await page.getByRole("button", { name: "Update link", exact: true }).click();
    await expect(page.getByText(BLOCKED)).toHaveCount(0);
    await expect(saveIndicator(page)).toHaveAttribute("data-save-status", "saved", {
      timeout: 15_000,
    });
    await publishButton(page).click();
    await expect(page.locator('[data-publish-status="published"]')).toBeVisible({
      timeout: 20_000,
    });
    expect((await pageRow(user.pageId)).published_at).not.toBe(published);
  });

  test("M6-29 a very long blocked host wraps under the link's row and in the banner; no sideways scroll", async ({
    page,
    context,
  }) => {
    const domain = newDomain();
    await listDomain(domain);
    const long = `${"a".repeat(60)}.${domain}`;
    await userWithBlocks(context, "tbl", [
      textBlock("Hello world", [link(6, 11, L1, "https://ok.example/")]),
    ]);
    await openEditor(page);
    await openBlock(page, TEXT_ID);
    await linkRow(page)
      .getByRole("button", { name: /^Edit link/ })
      .click();
    await addressField(page).fill(`https://${long}/x`);
    await page.getByRole("button", { name: "Update link", exact: true }).click();
    await expect(linkRow(page).getByText(BLOCKED, { exact: true })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByRole("alert").filter({ hasText: long })).toBeVisible();
    await expectNoHorizontalScroll(page);
    for (const b of await linkRow(page).getByRole("button").all()) {
      expect((await box(b)).height).toBeGreaterThanOrEqual(44);
    }
  });
});
