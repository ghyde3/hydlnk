import { expect, test, type Page } from "@playwright/test";
import {
  addPage,
  cleanupUsers,
  desktopOnly,
  phoneOnly,
  rand,
  signedInUser,
} from "../fixtures/data";
import { failVercelStub, markDnsReady, removalCalls, verifyCalls } from "../fixtures/vercel-stub";
import { expectNoHorizontalScroll, expectTapTargets, url } from "../helpers";
import {
  cardOf,
  domainHost,
  domainRow,
  markVerified,
  seedDomain,
  shot,
} from "./domains-ui-helpers";

/**
 * What the Domains screen's controls do (M4-15 buttons and live polling, M4-16, M4-17, M5-18's
 * failed-action states). The server rules behind them (cooldown, sweep, ownership, RLS) are the
 * domains-core specs; here the page is driven the way a customer drives it. Every run uses its own
 * hostnames, so the shared Vercel stub is only ever asked about domains this file made.
 */

test.afterAll(cleanupUsers);
test.describe.configure({ timeout: 120_000 });

const MAIN = "main";

/** Holds every server-action POST to the Domains page for `ms`, so the busy state can be observed. */
async function slowActions(page: Page, ms: number): Promise<void> {
  await page.route(url("app", "/domains"), async (route) => {
    if (route.request().method() === "POST") await new Promise((r) => setTimeout(r, ms));
    await route.continue();
  });
}

/**
 * Keeps the live poll out of a test about the button: the poll also verifies (with the same
 * cooldown), so one that lands first would turn the button's answer into "Checked a few seconds ago".
 */
async function withoutPolling(page: Page): Promise<void> {
  await page.route("**/api/domains/*", (route) => route.abort());
}

test.describe("M4-15 Check DNS now and live polling (UI)", () => {
  test("M4-15 Check DNS now is busy while the request runs and leaves a status line when DNS is not there yet", async ({
    page,
    context,
  }, info) => {
    const user = await signedInUser(context, { label: "ac", plan: "pro" });
    const host = domainHost("chk");
    await seedDomain(user.pageId, host);
    await withoutPolling(page);
    await page.goto(url("app", "/domains"));
    const card = cardOf(page, host);
    await slowActions(page, 1200);

    const check = card.getByRole("button", { name: "Check DNS now" });
    await check.click();
    const busy = card.getByRole("button", { name: "Checking…" });
    await expect(busy).toBeDisabled();
    await expect(busy).toHaveAttribute("aria-busy", "true");

    const line = card.locator("[data-check-line]");
    await expect(line).toContainText(
      "DNS isn’t pointing here yet. Records can take a while to spread.",
    );
    await expect(line).toContainText("Checked");
    await expect(card.getByRole("button", { name: "Check DNS now" })).toBeEnabled();
    await expect(card.locator("[data-domain-chip]")).toHaveText("Waiting for DNS");
    await expect(card.locator("[data-domain-chip]")).not.toHaveText(/Live/);

    await expectNoHorizontalScroll(page);
    if (phoneOnly(info)) {
      await expectTapTargets(page, MAIN);
      expect((await check.boundingBox())!.width).toBeGreaterThan(300);
    }
    await shot(page, "checked");
  });

  test("M4-15 when Vercel says the DNS is right the card flips to live in place and the button becomes Open", async ({
    page,
    context,
  }) => {
    const user = await signedInUser(context, { label: "al", plan: "pro" });
    const host = domainHost("flip");
    const id = await seedDomain(user.pageId, host);
    await withoutPolling(page);
    await page.goto(url("app", "/domains"));
    const card = cardOf(page, host);
    await expect(card.locator("[data-dns-record]:visible").first()).toBeVisible();

    await markDnsReady(host);
    await card.getByRole("button", { name: "Check DNS now" }).click();
    await expect(card.locator("[data-domain-chip]")).toHaveText("Live · SSL issued");
    const open = card.getByRole("link", { name: `Open ${host}` });
    await expect(open).toBeVisible();
    await expect(card.getByRole("button", { name: "Check DNS now" })).toHaveCount(0);
    await expect(card.locator("[data-dns-record]")).toHaveCount(0);
    await expect(card.locator("[data-check-line]")).toHaveText("");
    expect((await domainRow(id))!.status).toBe("verified");
    expect((await verifyCalls(host)).length).toBe(1);
  });

  test("M5-18 a failed check says so, leaves the status unchanged and enables the button again", async ({
    page,
    context,
  }) => {
    const user = await signedInUser(context, { label: "af", plan: "pro" });
    const host = domainHost("fail");
    const id = await seedDomain(user.pageId, host);
    await withoutPolling(page);
    await page.goto(url("app", "/domains"));
    const card = cardOf(page, host);

    // Every request the app makes for this hostname fails once at the stub (5xx).
    await failVercelStub(encodeURIComponent(host), 500, 6);
    await card.getByRole("button", { name: "Check DNS now" }).click();
    await expect(card.locator("[data-check-line]")).toHaveText(
      "We couldn’t check right now. Try again in a minute.",
    );
    await expect(card.getByRole("button", { name: "Check DNS now" })).toBeEnabled();
    await expect(card.locator("[data-domain-chip]")).toHaveText("Waiting for DNS");
    expect((await domainRow(id))!.status).toBe("pending");
  });

  test("M4-15 a pending card goes live on its own when the server verifies it (no reload)", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "the same code path at both widths: one viewport is enough");
    const user = await signedInUser(context, { label: "ap", plan: "pro" });
    const host = domainHost("poll");
    const id = await seedDomain(user.pageId, host);
    await page.goto(url("app", "/domains"));
    const card = cardOf(page, host);
    await expect(card.locator("[data-domain-chip]")).toHaveText("Waiting for DNS");

    const requests: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes(`/api/domains/${id}`)) requests.push(request.url());
    });
    // What the five-minute sweep (or another tab) does: the row becomes verified.
    await markVerified(id);
    await expect(card.locator("[data-domain-chip]")).toHaveText("Live · SSL issued", {
      timeout: 15_000,
    });
    expect(requests.length).toBeGreaterThanOrEqual(1);
    await expect(card.getByRole("link", { name: `Open ${host}` })).toBeVisible();
    await expect(card.getByRole("button", { name: "Check DNS now" })).toHaveCount(0);
    await expect(card.locator("[data-dns-record]")).toHaveCount(0);
    await expect(card.locator("[data-step-state='done']")).toHaveCount(3);
    await expect(card.locator("ol[data-domain-steps]")).toContainText(
      `Verified. ${host} is serving your page over HTTPS.`,
    );

    // Once live it stops asking.
    const after = requests.length;
    await page.waitForTimeout(12_000);
    expect(requests.length).toBe(after);
  });

  test("M4-15 polling pauses while the tab is hidden", async ({ page, context }, info) => {
    test.skip(!desktopOnly(info), "timing, not layout: one viewport is enough");
    const user = await signedInUser(context, { label: "ah", plan: "pro" });
    const host = domainHost("hid");
    const id = await seedDomain(user.pageId, host);
    await page.addInitScript(() => {
      let state: DocumentVisibilityState = "visible";
      Object.defineProperty(document, "visibilityState", { get: () => state });
      Object.defineProperty(document, "hidden", { get: () => state === "hidden" });
      (
        window as unknown as { __setVisibility: (v: DocumentVisibilityState) => void }
      ).__setVisibility = (value) => {
        state = value;
        document.dispatchEvent(new Event("visibilitychange"));
      };
    });
    await page.goto(url("app", "/domains"));
    await expect(cardOf(page, host)).toBeVisible();

    const requests: number[] = [];
    page.on("request", (request) => {
      if (request.url().includes(`/api/domains/${id}`)) requests.push(Date.now());
    });
    await page.evaluate(() =>
      (window as unknown as { __setVisibility: (v: string) => void }).__setVisibility("hidden"),
    );
    await page.waitForTimeout(13_000);
    expect(requests, "no poll while hidden").toHaveLength(0);

    await page.evaluate(() =>
      (window as unknown as { __setVisibility: (v: string) => void }).__setVisibility("visible"),
    );
    await expect.poll(() => requests.length, { timeout: 12_000 }).toBeGreaterThanOrEqual(1);
  });

  test("M4-15 a domain the sweep flipped shows the live card the next time the page opens", async ({
    page,
    context,
  }) => {
    const user = await signedInUser(context, { label: "as", plan: "pro" });
    const host = domainHost("swept");
    const id = await seedDomain(user.pageId, host);
    await markVerified(id);
    await page.goto(url("app", "/domains"));
    await expect(cardOf(page, host).locator("[data-domain-chip]")).toHaveText("Live · SSL issued");
    await expect(cardOf(page, host).getByRole("link", { name: `Open ${host}` })).toBeVisible();
  });
});

test.describe("M4-16 choose which page a domain serves", () => {
  test("M4-16 choosing another page saves, says Saved and updates the row; an unpublished page shows the hint", async ({
    page,
    context,
  }, info) => {
    const user = await signedInUser(context, { label: "av", plan: "pro" });
    const secondHandle = `zq-av2-${rand(5)}`;
    const secondId = await addPage(user.userId, secondHandle); // draft: not published
    const host = domainHost("srv");
    const id = await seedDomain(user.pageId, host);
    await page.goto(url("app", "/domains"));
    const card = cardOf(page, host);
    const serves = card.getByLabel("Serves");
    await expect(serves).toHaveValue(user.pageId);
    await expect(card.locator("[data-unpublished-hint]")).toHaveCount(0);
    // Both pages are listed by name and hydlnk.com address (M6-14; a page added with the secret key keeps the default name).
    await expect(serves.locator("option")).toHaveText([
      `Main page · ${user.handle}.hydlnk.com`,
      `Main page · ${secondHandle}.hydlnk.com`,
    ]);

    await serves.selectOption(secondId);
    await expect(card.getByText("Saved", { exact: true })).toBeVisible();
    await expect(card.locator("[data-unpublished-hint]")).toHaveText(
      "This page isn’t published yet. Visitors see a not-found page until you publish it.",
    );
    expect((await domainRow(id))!.page_id).toBe(secondId);

    // Back to the published page: the hint goes, the row follows.
    await serves.selectOption(user.pageId);
    await expect(card.locator("[data-unpublished-hint]")).toHaveCount(0);
    await expect.poll(async () => (await domainRow(id))!.page_id).toBe(user.pageId);

    await page.reload();
    await expect(cardOf(page, host).getByLabel("Serves")).toHaveValue(user.pageId);

    await expectNoHorizontalScroll(page);
    if (phoneOnly(info)) {
      await expectTapTargets(page, MAIN);
      const box = (await cardOf(page, host).getByLabel("Serves").boundingBox())!;
      const cardBox = (await cardOf(page, host).boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.width).toBeGreaterThan(cardBox.width - 60);
    } else {
      // Inline after the hostname, on the same row.
      const name = (await cardOf(page, host).locator("[data-domain-hostname]").boundingBox())!;
      const select = (await cardOf(page, host).getByLabel("Serves").boundingBox())!;
      expect(Math.abs(name.y + name.height / 2 - (select.y + select.height / 2))).toBeLessThan(14);
      expect(select.x).toBeGreaterThan(name.x + name.width - 1);
    }
  });
});

test.describe("M4-17 remove a custom domain", () => {
  test("M4-17 Remove opens an inline confirmation; Keep and Escape close it and return focus", async ({
    page,
    context,
  }, info) => {
    const user = await signedInUser(context, { label: "ar", plan: "pro" });
    const host = domainHost("rm");
    await seedDomain(user.pageId, host);
    await page.goto(url("app", "/domains"));
    const card = cardOf(page, host);
    const trigger = card.getByRole("button", { name: "Remove domain" });
    await trigger.click();

    const confirm = card.locator("[data-remove-confirm]");
    await expect(confirm).toContainText(
      `Remove ${host}? Visitors will no longer reach your page there.`,
    );
    await expect(confirm.getByRole("button", { name: "Remove domain" })).toBeVisible();
    await expect(confirm.getByRole("button", { name: "Keep domain" })).toBeVisible();

    await expectNoHorizontalScroll(page);
    if (phoneOnly(info)) {
      await expectTapTargets(page, MAIN);
      const remove = (await confirm.getByRole("button", { name: "Remove domain" }).boundingBox())!;
      const keep = (await confirm.getByRole("button", { name: "Keep domain" }).boundingBox())!;
      const box = (await confirm.boundingBox())!;
      expect(keep.y).toBeGreaterThan(remove.y + remove.height - 1); // stacked
      expect(remove.width).toBeGreaterThan(box.width - 40);
      expect(keep.width).toBeGreaterThan(box.width - 40);
    } else {
      // Inline: the card's primary button did not move.
      const check = card.getByRole("button", { name: "Check DNS now" });
      const before = (await check.boundingBox())!;
      expect(before.y).toBeLessThan((await confirm.boundingBox())!.y);
    }
    await shot(page, "remove-confirm");

    await confirm.getByRole("button", { name: "Keep domain" }).click();
    await expect(confirm).toHaveCount(0);
    await expect(card.getByRole("button", { name: "Remove domain" })).toBeFocused();

    await card.getByRole("button", { name: "Remove domain" }).click();
    await expect(confirm).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(confirm).toHaveCount(0);
    await expect(card.getByRole("button", { name: "Remove domain" })).toBeFocused();
  });

  test("M4-17 confirming removes it at the host, deletes the row, frees the slot and brings the form back", async ({
    page,
    context,
  }) => {
    const user = await signedInUser(context, { label: "ad", plan: "pro" });
    const host = domainHost("gone");
    const id = await seedDomain(user.pageId, host);
    await page.goto(url("app", "/domains"));
    await expect(page.locator("[data-domain-usage]")).toHaveText("1 of 1 used on Pro");
    await expect(page.getByRole("button", { name: "Add domain" })).toHaveCount(0);

    const card = cardOf(page, host);
    await card.getByRole("button", { name: "Remove domain" }).click();
    await card
      .locator("[data-remove-confirm]")
      .getByRole("button", { name: "Remove domain" })
      .click();

    await expect(card).toHaveCount(0);
    await expect(page.locator("[data-domain-usage]")).toHaveText("0 of 1 used on Pro");
    await expect(page.getByRole("button", { name: "Add domain" })).toBeVisible();
    expect(await domainRow(id)).toBeNull();
    expect((await removalCalls(host)).length).toBe(1);
  });

  test("M4-17 a host failure keeps the row and says so; the retry removes it", async ({
    page,
    context,
  }) => {
    const user = await signedInUser(context, { label: "ax", plan: "pro" });
    const host = domainHost("keep");
    const id = await seedDomain(user.pageId, host);
    await page.goto(url("app", "/domains"));
    const card = cardOf(page, host);

    await failVercelStub(encodeURIComponent(host), 500, 1);
    await card.getByRole("button", { name: "Remove domain" }).click();
    const confirm = card.locator("[data-remove-confirm]");
    await confirm.getByRole("button", { name: "Remove domain" }).click();
    await expect(card.getByRole("alert")).toHaveText(
      "We couldn’t remove that domain from our host. Try again.",
    );
    expect(await domainRow(id)).not.toBeNull();
    await expect(card).toBeVisible();

    await confirm.getByRole("button", { name: "Remove domain" }).click();
    await expect(card).toHaveCount(0);
    expect(await domainRow(id)).toBeNull();
  });
});
