import { expect, test } from "@playwright/test";
import {
  addPage,
  cleanupUsers,
  desktopOnly,
  phoneOnly,
  rand,
  signedInUser,
} from "../fixtures/data";
import { adminClient } from "../fixtures/auth";
import { expectNoHorizontalScroll, expectTapTargets, url } from "../helpers";
import {
  cardOf,
  domainHost,
  expectDomainsNavCurrent,
  seedDomain,
  shot,
} from "./domains-ui-helpers";

/**
 * The Domains screen as a page (M4-10, M4-14, M5-18): the HYDLNK address card, the plan states of
 * the Custom domain card (Free locked, Pro one slot, Studio fifteen), the Studio strip, the
 * account-wide list of domain cards and the three-step list with its status chip, at both
 * viewports. What the buttons do (check, polling, serves, remove) is domains-ui-actions.spec.ts.
 */

test.afterAll(cleanupUsers);
test.describe.configure({ timeout: 90_000 });

const MAIN = "main";

test.describe("M4-10 Domains screen: HYDLNK address, plan states and Studio upsell", () => {
  test("M4-10 Pro: header, nav, address card, usage line, add form and the Studio strip, no overflow", async ({
    page,
    context,
  }, info) => {
    const user = await signedInUser(context, { label: "dp", plan: "pro" });
    await page.goto(url("app", "/domains"));

    await expect(page.locator("main > header p")).toHaveText("Where your site lives");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Domains");
    await expectDomainsNavCurrent(page);
    await expect(page).toHaveTitle("Domains — HYDLNK");

    const address = page.locator("[data-hydlnk-address]");
    await expect(address.getByRole("heading", { name: "Your HYDLNK address" })).toBeVisible();
    await expect(address.locator("[data-hydlnk-address-value]")).toHaveText(
      `${user.handle}.hydlnk.com`,
    );
    await expect(
      address.getByText("Included on every plan. Keeps working alongside a custom domain."),
    ).toBeVisible();
    await expect(address.getByText("Live", { exact: true })).toBeVisible();
    await expect(address.getByText("SSL", { exact: true })).toBeVisible();
    expect(
      await address
        .locator("[data-hydlnk-address-value]")
        .evaluate((el) => getComputedStyle(el).fontSize),
    ).toBe("17px");

    const custom = page.locator("[data-custom-domain-card]");
    await expect(custom.getByRole("heading", { name: "Custom domain" })).toBeVisible();
    await expect(custom.locator("[data-domain-usage]")).toHaveText("0 of 1 used on Pro");
    expect(
      await custom.locator("[data-domain-usage]").evaluate((el) => getComputedStyle(el).fontSize),
    ).toBe("12px");

    // The add form: no empty list, just the form.
    const hostname = custom.getByLabel("Domain", { exact: true });
    await expect(hostname).toHaveAttribute("placeholder", "links.yourname.com");
    expect(await hostname.evaluate((el) => getComputedStyle(el).fontSize)).toBe("16px");
    const serves = custom.getByLabel("Serves");
    await expect(serves).toHaveValue(user.pageId);
    await expect(custom.getByRole("button", { name: "Add domain" })).toBeVisible();
    await expect(page.locator("[data-domain-card]")).toHaveCount(0);

    // The Studio strip is Pro only.
    const upsell = page.locator("[data-studio-upsell]");
    await expect(
      upsell.getByText("Running sites for clients? Studio includes 15 custom domains."),
    ).toBeVisible();
    const compare = upsell.getByRole("link", { name: "Compare plans" });
    await expect(compare).toHaveAttribute("href", "/settings#plans");
    expect(await upsell.evaluate((el) => getComputedStyle(el).borderTopStyle)).toBe("dashed");

    await expectNoHorizontalScroll(page);
    if (phoneOnly(info)) {
      await expectTapTargets(page, MAIN);
      // The strip stacks and its button is full width.
      const stripBox = (await upsell.boundingBox())!;
      const buttonBox = (await compare.boundingBox())!;
      expect(buttonBox.width).toBeGreaterThan(stripBox.width - 40);
      expect(buttonBox.y).toBeGreaterThan((await upsell.locator("p").boundingBox())!.y);
      // The form fields stack at full width.
      const inputBox = (await hostname.boundingBox())!;
      const selectBox = (await serves.boundingBox())!;
      expect(selectBox.y).toBeGreaterThan(inputBox.y + inputBox.height - 1);
      expect(Math.abs(selectBox.width - inputBox.width)).toBeLessThan(2);
    } else {
      await expect(page.getByRole("complementary")).toBeVisible();
      const widest = await page.locator("main [data-custom-domain-card]").boundingBox();
      expect(widest!.width).toBeLessThanOrEqual(880);
      // The strip's text and button share a row.
      const textBox = (await upsell.locator("p").boundingBox())!;
      const buttonBox = (await compare.boundingBox())!;
      expect(
        Math.abs(textBox.y + textBox.height / 2 - (buttonBox.y + buttonBox.height / 2)),
      ).toBeLessThan(24);
      // The form fields sit on one row.
      const inputBox = (await hostname.boundingBox())!;
      const selectBox = (await serves.boundingBox())!;
      const addBox = (await custom.getByRole("button", { name: "Add domain" }).boundingBox())!;
      expect(Math.abs(inputBox.y - selectBox.y)).toBeLessThan(2);
      expect(Math.abs(inputBox.y - addBox.y)).toBeLessThan(2);
    }
    await shot(page, "pro-empty");
  });

  test("M4-10 Free: the locked state, a See plans link, no domain input and no Studio strip", async ({
    page,
    context,
  }, info) => {
    await signedInUser(context, { label: "df", plan: "free" });
    await page.goto(url("app", "/domains"));

    const custom = page.locator("[data-custom-domain-card]");
    await expect(custom.getByText("Custom domains start on Pro.")).toBeVisible();
    const link = custom.getByRole("link", { name: "See plans" });
    await expect(link).toHaveAttribute("href", "/settings#plans");
    await expect(page.locator("input[name='hostname']")).toHaveCount(0);
    await expect(page.getByLabel("Domain", { exact: true })).toHaveCount(0);
    await expect(custom.locator("[data-domain-usage]")).toHaveCount(0);
    await expect(page.locator("[data-studio-upsell]")).toHaveCount(0);

    await link.click();
    await expect(page).toHaveURL(/\/settings#plans$/);
    await expect(page.locator("#plan-studio-heading")).toBeFocused();

    await page.goto(url("app", "/domains"));
    await expectNoHorizontalScroll(page);
    if (phoneOnly(info)) await expectTapTargets(page, MAIN);
    await shot(page, "free");
  });

  test("M4-10 Studio: 0 of 15 used on Studio and no Studio strip", async ({ page, context }) => {
    await signedInUser(context, { label: "ds", plan: "studio" });
    await page.goto(url("app", "/domains"));
    await expect(page.locator("[data-domain-usage]")).toHaveText("0 of 15 used on Studio");
    await expect(page.locator("[data-studio-upsell]")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Add domain" })).toBeVisible();
  });

  test("M4-10 a signed-out request redirects to sign-in", async ({ page }, info) => {
    test.skip(!desktopOnly(info), "a routing check: one viewport is enough");
    const response = await page.goto(url("app", "/domains"));
    expect(response?.status()).toBe(200);
    await expect(page).toHaveURL(/\/login/);
    await expect(page.locator("[data-hydlnk-address]")).toHaveCount(0);
  });

  test("M4-10 the address card says Not published yet for a draft page and follows the page switcher", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "the switcher menu is covered at both widths by the shell spec");
    const user = await signedInUser(context, { label: "dw", plan: "pro" });
    const secondHandle = `zq-dw2-${rand(5)}`;
    await addPage(user.userId, secondHandle); // a draft: never published
    await page.goto(url("app", "/domains"));
    const address = page.locator("[data-hydlnk-address]");
    await expect(address.locator("[data-address-chip='live']")).toBeVisible();

    await page.getByRole("button", { name: /^Switch site, current:/ }).click();
    await page.getByRole("menuitemradio", { name: new RegExp(secondHandle) }).click();
    await expect(address.locator("[data-hydlnk-address-value]")).toHaveText(
      `${secondHandle}.hydlnk.com`,
    );
    await expect(address.locator("[data-address-chip='unpublished']")).toHaveText(
      "Not published yet",
    );
    await expect(address.getByText("SSL", { exact: true })).toBeVisible();
  });

  test("M4-10 domains are listed account-wide, oldest first, and another account's never appear", async ({
    page,
    context,
    browser,
  }) => {
    const user = await signedInUser(context, { label: "dl", plan: "studio" });
    const secondHandle = `zq-dl2-${rand(5)}`;
    const secondId = await addPage(user.userId, secondHandle);
    const newer = domainHost("newer");
    const older = domainHost("older");
    await seedDomain(secondId, newer, { ageHours: 1 });
    await seedDomain(user.pageId, older, { ageHours: 5 });

    // Another account's domain: on a page of someone else, who has their own browser.
    const stranger = await signedInUser(await browser.newContext(), {
      label: "dlx",
      plan: "pro",
    });
    const foreign = domainHost("foreign");
    await seedDomain(stranger.pageId, foreign);

    await page.goto(url("app", "/domains"));
    const cards = page.locator("[data-domain-card]");
    await expect(cards).toHaveCount(2);
    await expect(cards.nth(0)).toHaveAttribute("data-domain-card", older);
    await expect(cards.nth(1)).toHaveAttribute("data-domain-card", newer);
    await expect(page.getByText(foreign)).toHaveCount(0);
    await expect(page.locator("[data-domain-usage]")).toHaveText("2 of 15 used on Studio");
    // Each card names the page it serves.
    await expect(cardOf(page, newer).getByLabel("Serves")).toHaveValue(secondId);
    await expect(cardOf(page, older).getByLabel("Serves")).toHaveValue(user.pageId);
  });
});

test.describe("M4-14 three-step setup list and status chip", () => {
  test("M4-14 a pending card: Waiting for DNS chip, step list, records and Check DNS now", async ({
    page,
    context,
  }, info) => {
    const user = await signedInUser(context, { label: "dc", plan: "pro" });
    const host = domainHost("pend");
    await seedDomain(user.pageId, host);
    await page.goto(url("app", "/domains"));

    const card = cardOf(page, host);
    await expect(card.locator("[data-domain-hostname]")).toHaveText(host);
    expect(
      await card.locator("[data-domain-hostname]").evaluate((el) => getComputedStyle(el).fontSize),
    ).toBe("17px");
    const chip = card.locator("[data-domain-chip]");
    await expect(chip).toHaveText("Waiting for DNS");
    await expect(chip).toHaveAttribute("aria-live", "polite");
    expect(await chip.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(
      "rgb(246, 238, 223)",
    );
    expect(await chip.evaluate((el) => getComputedStyle(el).color)).toBe("rgb(107, 82, 38)");

    const steps = card.locator("ol[data-domain-steps] > li");
    await expect(steps).toHaveCount(3);
    await expect(steps.nth(0)).toContainText("Domain added");
    await expect(steps.nth(0)).toContainText("Registered with our host. Nothing else to do here.");
    await expect(steps.nth(1).getByText("Add this record at your DNS provider")).toBeVisible();
    await expect(steps.nth(1)).toContainText("Wherever you bought example.test");
    await expect(steps.nth(1)).toContainText("GoDaddy, Namecheap, Cloudflare and so on.");
    await expect(steps.nth(2)).toContainText("We verify and issue SSL");
    await expect(steps.nth(2)).toContainText(
      "Automatic once the record resolves — usually minutes, occasionally up to 48 hours. We’ll email you when it’s live.",
    );
    await expect(card.getByRole("img", { name: "Step 1 of 3, done" })).toBeVisible();
    await expect(card.getByRole("img", { name: "Step 2 of 3, current" })).toBeVisible();
    await expect(card.getByRole("img", { name: "Step 3 of 3, to do" })).toBeVisible();
    const circle = card.getByRole("img", { name: "Step 2 of 3, current" });
    expect(await circle.evaluate((el) => el.getBoundingClientRect().width)).toBe(26);
    expect(await circle.evaluate((el) => getComputedStyle(el).borderColor)).toBe("rgb(28, 27, 26)");

    await expect(card.getByRole("button", { name: "Check DNS now" })).toBeVisible();
    await expect(card.getByRole("button", { name: "Remove domain" })).toBeVisible();
    await expect(card.getByRole("link", { name: /^Open / })).toHaveCount(0);

    await expectNoHorizontalScroll(page);
    if (phoneOnly(info)) {
      await expectTapTargets(page, MAIN);
      const check = (await card.getByRole("button", { name: "Check DNS now" }).boundingBox())!;
      const remove = (await card.getByRole("button", { name: "Remove domain" }).boundingBox())!;
      const cardBox = (await card.boundingBox())!;
      expect(check.width).toBeGreaterThan(cardBox.width - 40);
      expect(remove.width).toBeGreaterThan(cardBox.width - 40);
      expect(check.height).toBeGreaterThanOrEqual(44);
    } else {
      const check = (await card.getByRole("button", { name: "Check DNS now" }).boundingBox())!;
      const remove = (await card.getByRole("button", { name: "Remove domain" }).boundingBox())!;
      const cardBox = (await card.boundingBox())!;
      expect(Math.abs(check.y - remove.y)).toBeLessThan(2);
      // Remove sits at the right edge of the card.
      expect(cardBox.x + cardBox.width - (remove.x + remove.width)).toBeLessThan(24);
      expect(cardBox.width).toBeLessThanOrEqual(880);
    }
    await shot(page, "pending");
  });

  test("M4-14 a verified card: Live chip, three green checks, no records and an Open link", async ({
    page,
    context,
  }, info) => {
    const user = await signedInUser(context, { label: "dv", plan: "pro" });
    const host = domainHost("live");
    await seedDomain(user.pageId, host, { status: "verified" });
    await page.goto(url("app", "/domains"));

    const card = cardOf(page, host);
    const chip = card.locator("[data-domain-chip]");
    await expect(chip).toHaveText("Live · SSL issued");
    expect(await chip.evaluate((el) => getComputedStyle(el).color)).toBe("rgb(47, 125, 79)");
    expect(await chip.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(
      "rgb(231, 243, 236)",
    );
    for (const name of ["Step 1 of 3, done", "Step 2 of 3, done", "Step 3 of 3, done"]) {
      await expect(card.getByRole("img", { name })).toBeVisible();
    }
    await expect(card.locator("[data-step-state='done']")).toHaveCount(3);
    await expect(card.locator("ol[data-domain-steps]")).toContainText(
      `Verified. ${host} is serving your site over HTTPS.`,
    );
    await expect(card.locator("[data-dns-record]")).toHaveCount(0);
    await expect(card.getByRole("button", { name: "Check DNS now" })).toHaveCount(0);
    const open = card.getByRole("link", { name: `Open ${host}` });
    await expect(open).toHaveAttribute("href", `https://${host}`);
    await expect(open).toHaveAttribute("target", "_blank");
    await expect(open).toHaveAttribute("rel", "noopener");

    await expectNoHorizontalScroll(page);
    if (phoneOnly(info)) await expectTapTargets(page, MAIN);
    await shot(page, "verified");
  });

  test("M4-14 one pending and one verified row render two independent cards, oldest first", async ({
    page,
    context,
  }) => {
    const user = await signedInUser(context, { label: "d2", plan: "studio" });
    const pending = domainHost("p");
    const live = domainHost("v");
    await seedDomain(user.pageId, pending, { ageHours: 3 });
    await seedDomain(user.pageId, live, { status: "verified", ageHours: 1 });
    await page.goto(url("app", "/domains"));

    const cards = page.locator("[data-domain-card]");
    await expect(cards).toHaveCount(2);
    await expect(cards.nth(0)).toHaveAttribute("data-domain-card", pending);
    await expect(cards.nth(1)).toHaveAttribute("data-domain-card", live);
    await expect(cardOf(page, pending).locator("[data-domain-chip]")).toHaveText("Waiting for DNS");
    await expect(cardOf(page, live).locator("[data-domain-chip]")).toHaveText("Live · SSL issued");
    await expect(cardOf(page, pending).locator("ol[data-domain-steps]")).not.toContainText(
      "Verified.",
    );
    await expect(cardOf(page, live).locator("[data-dns-record]")).toHaveCount(0);
    // A real ordered list in each card, and a card's own steps.
    await expect(cards.locator("ol[data-domain-steps]")).toHaveCount(2);
  });
});

test.describe("M5-18 Domains stale-pending state", () => {
  test("M5-18 a domain pending for 48 hours replaces step 3 with the still-not-resolving text", async ({
    page,
    context,
  }, info) => {
    const user = await signedInUser(context, { label: "dk", plan: "studio" });
    const stale = domainHost("stale");
    const fresh = domainHost("fresh");
    await seedDomain(user.pageId, stale, { ageHours: 49 });
    await seedDomain(user.pageId, fresh, { ageHours: 47 });
    await page.goto(url("app", "/domains"));

    const staleSteps = cardOf(page, stale).locator("ol[data-domain-steps] > li").nth(2);
    await expect(staleSteps).toContainText(
      "Still not resolving after 48 hours. Check the record at your DNS provider, or remove the domain and add it again.",
    );
    await expect(staleSteps).not.toContainText("Automatic once the record resolves");
    const freshSteps = cardOf(page, fresh).locator("ol[data-domain-steps] > li").nth(2);
    await expect(freshSteps).toContainText("Automatic once the record resolves");

    await expectNoHorizontalScroll(page);
    if (phoneOnly(info)) await expectTapTargets(page, MAIN);
    await shot(page, "stale");
  });

  test("M5-18 a Pro account with no domain sees the form and no list", async ({
    page,
    context,
  }) => {
    await signedInUser(context, { label: "de", plan: "pro" });
    await page.goto(url("app", "/domains"));
    const custom = page.locator("[data-custom-domain-card]");
    await expect(custom.getByLabel("Domain", { exact: true })).toBeVisible();
    await expect(custom.getByLabel("Serves")).toBeVisible();
    await expect(custom.getByRole("button", { name: "Add domain" })).toBeVisible();
    await expect(page.locator("[data-domain-card]")).toHaveCount(0);
  });
});

test.describe("M5-09 a suspended account's Domains screen", () => {
  test("M5-09 every control that writes is disabled while the account is suspended", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "a state check: one viewport is enough");
    const user = await signedInUser(context, { label: "dz", plan: "studio" });
    const host = domainHost("susp");
    await seedDomain(user.pageId, host);
    const { error } = await adminClient()
      .from("accounts")
      .update({ suspended_at: new Date().toISOString() })
      .eq("id", user.userId);
    expect(error).toBeNull();
    await page.goto(url("app", "/domains"));

    const custom = page.locator("[data-custom-domain-card]");
    await expect(custom.getByRole("button", { name: "Add domain" })).toBeDisabled();
    await expect(custom.getByLabel("Domain", { exact: true })).toBeDisabled();
    const card = cardOf(page, host);
    await expect(card.getByRole("button", { name: "Check DNS now" })).toBeDisabled();
    await expect(card.getByRole("button", { name: "Remove domain" })).toBeDisabled();
    await expect(card.getByLabel("Serves")).toBeDisabled();
  });
});
