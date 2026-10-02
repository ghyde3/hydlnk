import { expect, test, type Page } from "@playwright/test";
import { adminClient } from "../fixtures/auth";
import { cleanupUsers, rand } from "../fixtures/data";
import { rawRequest } from "../fixtures/http";
import { expectNoHorizontalScroll, expectTapTargets } from "../helpers";
import {
  draftWith,
  emptyUser,
  expectDraft,
  openEditor,
  pageRow,
  rowOf,
  saveIndicator,
  statusChip,
} from "../m2/editor-helpers";

/**
 * M5-03 steps 6, 7 and 8: the Editor and the link blocklist. Phone = 390x844, desktop = 1440x900.
 * Every spec makes its own user and lists its own (random) blocked domain, and removes it again.
 *
 *   6  typing a blocked address shows the inline error under that field, the save indicator reads
 *      "Not saved" without the retry sentence, Publish is disabled; fixing the address clears the
 *      error and the status goes back to "Saved"
 *   7  Publish re-checks the saved draft: a domain listed after the draft was saved stops it with
 *      the banner, the first affected block opens, the live page keeps serving what it served
 *   8  no horizontal scroll, the URL input is 16px, targets are at least 44px
 */

test.describe.configure({ timeout: 120_000 });

const BLOCKED = "That site is blocked. Use a different link.";
const RETRY_SENTENCE = "Couldn’t save. Your changes stay here and will retry.";

const domains: string[] = [];
const newDomain = () => `ed-${rand(8)}.example`;
async function listDomain(domain: string): Promise<void> {
  const { error } = await adminClient().from("blocked_domains").insert({ domain, reason: "e2e" });
  if (error) throw new Error(`blocked_domains insert failed: ${error.message}`);
  domains.push(domain);
}
test.afterAll(async () => {
  if (domains.length > 0) {
    await adminClient().from("blocked_domains").delete().in("domain", domains);
  }
  await cleanupUsers();
});

const ID = "lnk000000001";
const link = (url: string) => ({ id: ID, type: "link", visible: true, label: "Mine", url });
const publishButton = (page: Page) =>
  page.locator("main > header").getByRole("button", { name: "Publish", exact: true });
const urlInput = (page: Page) => rowOf(page, ID).locator('input[data-field="url"]');
const openRow = (page: Page) => rowOf(page, ID).locator("button[aria-expanded]").first().click();

test.describe("M5-03 the Editor refuses a link to a blocked site", () => {
  test("M5-03 typing a blocked address: inline error, Not saved without the retry sentence, Publish disabled; fixing it saves", async ({
    page,
    context,
    isMobile,
  }) => {
    const domain = newDomain();
    await listDomain(domain);
    const user = await emptyUser(context, "be", {
      draft: draftWith("x", [link("https://ok.example/start")]),
    });
    await openEditor(page);
    await openRow(page);
    await expect(urlInput(page)).toHaveValue("https://ok.example/start");
    await expect(publishButton(page)).toBeEnabled();
    const before = (await pageRow(user.pageId)).draft;

    await urlInput(page).fill(`https://${domain}/x`);
    // The error sits under that field; the status says Not saved; Publish is off.
    await expect(rowOf(page, ID).getByText(BLOCKED)).toBeVisible({ timeout: 15_000 });
    await expect(saveIndicator(page)).toHaveAttribute("data-save-status", "blocked");
    await expect(saveIndicator(page)).toHaveText("Not saved");
    await expect(page.getByText(RETRY_SENTENCE)).toHaveCount(0);
    await expect(publishButton(page)).toBeDisabled();
    // The database said no: the stored draft is the one from before.
    expect((await pageRow(user.pageId)).draft).toEqual(before);
    // The banner says which host, and that retrying will not help.
    await expect(page.getByRole("alert").filter({ hasText: domain })).toContainText(
      "Remove or change it.",
    );

    if (isMobile) {
      // Step 8: no horizontal scroll, 16px URL text, 44px targets, with the error showing.
      await expectNoHorizontalScroll(page);
      await expectTapTargets(page);
      expect(await urlInput(page).evaluate((el) => getComputedStyle(el).fontSize)).toBe("16px");
    }

    // Fix it: the error clears at once, the save goes through, the status returns to Saved.
    await urlInput(page).fill("https://ok.example/fixed");
    await expect(rowOf(page, ID).getByText(BLOCKED)).toHaveCount(0);
    await expect(saveIndicator(page)).toHaveAttribute("data-save-status", "saved", {
      timeout: 15_000,
    });
    await expect(saveIndicator(page)).toHaveText("Saved");
    await expect(publishButton(page)).toBeEnabled();
    await expectDraft(
      user.pageId,
      (draft) => (draft.blocks[0] as { url?: string }).url === "https://ok.example/fixed",
    );
  });

  test("M5-03 a very long blocked host wraps in the banner and under the field: no horizontal scroll at 390", async ({
    page,
    context,
    isMobile,
  }) => {
    const domain = newDomain();
    await listDomain(domain);
    const long = `${"a".repeat(60)}.${domain}`;
    await emptyUser(context, "bl", { draft: draftWith("x", [link("https://ok.example/start")]) });
    await openEditor(page);
    await openRow(page);
    await urlInput(page).fill(`https://${long}/x`);
    await expect(rowOf(page, ID).getByText(BLOCKED)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("alert").filter({ hasText: long })).toBeVisible();
    await expectNoHorizontalScroll(page);
    if (isMobile) await expectTapTargets(page);
  });

  test("M5-03 an address the database would refuse half way through typing never shows: typed on, it is never sent", async ({
    page,
    context,
  }) => {
    const user = await emptyUser(context, "bt", {
      draft: draftWith("x", [link("https://ok.example/start")]),
    });
    await openEditor(page);
    await openRow(page);
    // "https://exam" is refused by the database (a host with no dot), but it is only on its way to
    // a real address: typed on within the debounce it is never sent at all.
    await urlInput(page).fill("https://exam");
    await urlInput(page).pressSequentially("ple.com/a", { delay: 20 });
    await expect(saveIndicator(page)).toHaveAttribute("data-save-status", "saved", {
      timeout: 15_000,
    });
    await expect(rowOf(page, ID).getByText(BLOCKED)).toHaveCount(0);
    await expectDraft(
      user.pageId,
      (draft) => (draft.blocks[0] as { url?: string }).url === "https://example.com/a",
    );
  });

  test("M5-03 Publish re-checks the saved draft: a domain listed afterwards stops it, opens the block, leaves the live page alone; fixing the link publishes", async ({
    page,
    context,
    isMobile,
  }) => {
    const late = newDomain();
    // Not listed yet: the draft saves and publishes.
    const user = await emptyUser(context, "bp", {
      draft: draftWith("x", [link(`https://${late}/x`)]),
    });
    await openEditor(page);
    await publishButton(page).click();
    await expect(statusChip(page)).toHaveAttribute("data-publish-status", "published", {
      timeout: 20_000,
    });
    const live = await rawRequest(`${user.handle}.localhost:3000`, "/");
    expect(live.status).toBe(200);
    expect(live.body).toContain("Mine");
    const published = (await pageRow(user.pageId)).published_at;

    // The domain is listed after the draft was saved and published.
    await listDomain(late);

    await publishButton(page).click();
    await expect(
      page.getByText(
        `Can’t publish. 1 link points to a blocked site: ${late}. Remove or change it.`,
      ),
    ).toBeVisible({ timeout: 20_000 });
    // The first affected block opens with the inline error, and nothing about the live page moved.
    await expect(rowOf(page, ID).locator("button[aria-expanded]").first()).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await expect(rowOf(page, ID).getByText(BLOCKED)).toBeVisible();
    expect((await pageRow(user.pageId)).published_at).toBe(published);
    const still = await rawRequest(`${user.handle}.localhost:3000`, "/");
    expect(still.status).toBe(200);
    expect(still.body).toContain("Mine");
    if (isMobile) await expectNoHorizontalScroll(page);

    // Change the link: the error clears, and Publish goes through.
    await urlInput(page).fill("https://ok.example/after");
    await expect(rowOf(page, ID).getByText(BLOCKED)).toHaveCount(0);
    await expect(saveIndicator(page)).toHaveAttribute("data-save-status", "saved", {
      timeout: 15_000,
    });
    await publishButton(page).click();
    await expect(statusChip(page)).toHaveAttribute("data-publish-status", "published", {
      timeout: 20_000,
    });
    expect((await pageRow(user.pageId)).published_at).not.toBe(published);
  });
});
