import { expect, test, type Locator, type Page } from "@playwright/test";
import { formatBandPrice, formatCardPrice, formatPrice } from "@/lib/billing/prices";
import { adminClient } from "../fixtures/auth";
import {
  addPage,
  cleanupUsers,
  desktopOnly,
  phoneOnly,
  rand,
  signedInUser,
} from "../fixtures/data";
import { appRaw } from "../fixtures/http";
import { expectNoHorizontalScroll, expectTapTargets, url } from "../helpers";

/**
 * M4-05, M4-32 and M4-33: the Settings & billing screen. One smoke per state on both projects
 * (phone 390x844, desktop 1440x900): it renders, the numbers and copy come from the account, no
 * sideways scroll, every tap target 44px. Nothing here calls Stripe for real: the card clause is
 * unit-tested (tests/unit/limits-settings-band.test.ts) and this spec checks that an unreachable or
 * unknown customer drops it while the rest renders.
 */

test.afterAll(cleanupUsers);

const MIB = 1024 * 1024;
const settings = () => url("app", "/settings");
const uploaded: string[] = [];

test.afterAll(async () => {
  if (uploaded.length > 0)
    await adminClient().storage.from("page-media").remove(uploaded.splice(0));
});

const box = async (locator: Locator) => (await locator.boundingBox())!;

async function setBilling(userId: string, patch: Record<string, unknown>) {
  const { error } = await adminClient().from("accounts").update(patch).eq("id", userId);
  if (error) throw new Error(`setBilling failed: ${error.message}`);
}

const sub = (n = rand(8)) => ({
  stripe_customer_id: `cus_zq_${n}`,
  stripe_subscription_id: `sub_zq_${n}`,
});

const PERIOD_END = "2026-11-01T12:00:00Z";

async function seedUploads(userId: string, mib: number) {
  const path = `${userId}/seed-${rand()}.png`;
  const { error } = await adminClient()
    .storage.from("page-media")
    .upload(path, Buffer.alloc(mib * MIB), { contentType: "image/png" });
  if (error) throw new Error(`seed upload failed: ${error.message}`);
  uploaded.push(path);
}

const card = (page: Page, plan: "free" | "pro" | "studio") =>
  page.locator(`[data-plan-card="${plan}"]`);

test.describe("M4-05 Settings & billing: plan band and plan cards", () => {
  test("M4-05 a signed-out request redirects to sign-in and renders no plan data", async ({}, info) => {
    test.skip(!desktopOnly(info), "one raw request is enough");
    const res = await appRaw("/settings");
    expect(res.status).toBe(307);
    expect(new URL(res.location!, "http://app.localhost:3000").pathname).toBe("/login");
    expect(res.body).not.toContain("Current plan");
    expect(res.body).not.toContain("Upgrade to");
  });

  test("M4-05 Free account: band, three plan cards, upgrade buttons, Account card below, layout", async ({
    page,
    context,
  }, info) => {
    await signedInUser(context, { label: "bf" });
    await page.goto(settings());

    await expect(page.locator("main > header p")).toHaveText("Account");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Settings & billing");

    const band = page.locator("[data-plan-band]");
    await expect(band).toContainText("Current plan");
    await expect(band.locator("[data-band-plan]")).toHaveText("Free");
    await expect(band.locator("[data-band-price]")).toHaveText("$0 · free forever");
    await expect(band.locator("[data-band-renewal]")).toHaveCount(0);
    // No Stripe customer yet: no portal buttons.
    await expect(band.getByRole("button")).toHaveCount(0);

    // Three cards with the blurbs from PLAN.md; nothing deferred from v1 is mentioned.
    await expect(page.locator("[data-plan-card]")).toHaveCount(3);
    await expect(card(page, "free")).toContainText(
      "1 page, hydlnk.com address, 30 days of per-link clicks.",
    );
    await expect(card(page, "pro")).toContainText(
      "3 pages, 1 custom domain, a year of analytics, no badge.",
    );
    await expect(card(page, "studio")).toContainText(
      "15 pages, 15 custom domains, a year of analytics, no badge.",
    );
    await expect(page.locator("main")).not.toContainText(/editors|team access|csv|scheduled/i);

    // The card matching the plan is an inert tile; the others carry the upgrade buttons.
    await expect(card(page, "free")).toHaveAttribute("data-current", "true");
    await expect(card(page, "free").locator("[data-current-plan-tile]")).toHaveText("Current plan");
    await expect(card(page, "free").getByRole("button")).toHaveCount(0);
    await expect(card(page, "pro").getByRole("button", { name: "Upgrade to Pro" })).toBeVisible();
    await expect(
      card(page, "studio").getByRole("button", { name: "Upgrade to Studio" }),
    ).toBeVisible();

    // The Monthly | Yearly control switches the prices.
    const group = page.getByRole("group", { name: "Billing interval" });
    await expect(group.getByRole("button", { name: "Monthly" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(card(page, "pro").locator("[data-plan-price]")).toHaveText(
      formatCardPrice("pro", "month"),
    );
    await expect(card(page, "studio").locator("[data-plan-price]")).toHaveText(
      formatCardPrice("studio", "month"),
    );
    // Yearly applies to both plans (decided 2026-10-02: "$5/mo, billed yearly" and "$15/mo, billed yearly").
    await group.getByRole("button", { name: "Yearly" }).click();
    await expect(card(page, "pro").locator("[data-plan-price]")).toHaveText(
      formatCardPrice("pro", "year"),
    );
    await expect(card(page, "studio").locator("[data-plan-price]")).toHaveText(
      formatCardPrice("studio", "year"),
    );
    await group.getByRole("button", { name: "Monthly" }).click();

    // The Account card from Milestone 1 stays, below the new cards.
    const account = page.locator("main section", {
      has: page.getByRole("heading", { level: 2, name: "Account" }),
    });
    await expect(account).toBeVisible();
    expect((await box(account)).y).toBeGreaterThan((await box(page.locator("#plans"))).y);

    await expectNoHorizontalScroll(page);
    await expectTapTargets(page);

    if (phoneOnly(info)) {
      const free = await box(card(page, "free"));
      const pro = await box(card(page, "pro"));
      const studio = await box(card(page, "studio"));
      // One column: stacked, same left edge and width.
      expect(pro.y).toBeGreaterThan(free.y + free.height - 1);
      expect(studio.y).toBeGreaterThan(pro.y + pro.height - 1);
      expect(Math.abs(pro.x - free.x)).toBeLessThan(1);
      expect(Math.abs(pro.width - free.width)).toBeLessThan(1);
      // Full-width buttons, at least 44px tall.
      for (const plan of ["pro", "studio"] as const) {
        const button = await box(card(page, plan).getByRole("button"));
        const cardBox = await box(card(page, plan));
        expect(button.height).toBeGreaterThanOrEqual(44);
        expect(button.width).toBeGreaterThan(cardBox.width - 32);
      }
      const tabs = page.getByRole("navigation", { name: "App sections" });
      await expect(tabs.locator("a[aria-current='page']")).toHaveText("Account");
    } else {
      const free = await box(card(page, "free"));
      const pro = await box(card(page, "pro"));
      const studio = await box(card(page, "studio"));
      // Three cards in one row.
      expect(Math.abs(pro.y - free.y)).toBeLessThan(1);
      expect(Math.abs(studio.y - free.y)).toBeLessThan(1);
      expect(studio.x).toBeGreaterThan(pro.x);
      expect(pro.x).toBeGreaterThan(free.x);
      // The content column is capped at 920px.
      expect((await box(page.locator("#plans"))).width).toBeLessThanOrEqual(920);
      const sidebar = page.getByRole("navigation", { name: "App" });
      // M7-01: Settings & billing is in the account menu; no sidebar link is current on /settings.
      await expect(sidebar.locator("a[aria-current='page']")).toHaveCount(0);
      expect((await box(page.locator("aside"))).width).toBe(240);
    }
  });

  test("M4-05 /settings#plans scrolls the plans into view and focuses the Studio card heading", async ({
    page,
    context,
  }) => {
    await signedInUser(context, { label: "bh" });
    await page.goto(`${settings()}#plans`);
    await expect(page.locator("#plan-studio-heading")).toBeFocused();
  });

  test("M4-05 Pro on monthly: price, renewal date, portal buttons and the card buttons", async ({
    page,
    context,
  }, info) => {
    const user = await signedInUser(context, { label: "bp" });
    await setBilling(user.userId, {
      plan: "pro",
      billing_interval: "month",
      current_period_end: PERIOD_END,
      cancel_at_period_end: false,
      ...sub(),
    });
    await page.goto(settings());

    const band = page.locator("[data-plan-band]");
    await expect(band.locator("[data-band-plan]")).toHaveText("Pro");
    await expect(band.locator("[data-band-price]")).toHaveText(formatBandPrice("pro", "month"));
    // The Stripe stub knows no such customer, so the card clause is dropped and the rest renders.
    await expect(band.locator("[data-band-renewal]")).toHaveText("Renews Nov 1, 2026.");
    await expect(band.getByRole("button", { name: /^Manage billing/ })).toBeVisible();
    await expect(
      band.getByRole("button", { name: `Switch to yearly · ${formatPrice("pro", "year")}` }),
    ).toBeVisible();
    await expect(band).toContainText(
      "Card, invoices and cancellation open in Stripe’s secure customer portal.",
    );

    // Pro account: Free card downgrades, Pro is the current plan, Studio upgrades through the portal.
    await expect(card(page, "free").getByRole("button", { name: "Downgrade" })).toBeVisible();
    await expect(card(page, "pro").locator("[data-current-plan-tile]")).toBeVisible();
    await expect(
      card(page, "studio").getByRole("button", { name: "Upgrade to Studio" }),
    ).toBeVisible();
    // No Monthly | Yearly control (nothing to check out) and no Checkout button anywhere.
    await expect(page.getByRole("group", { name: "Billing interval" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Upgrade to Pro" })).toHaveCount(0);

    await expectNoHorizontalScroll(page);
    await expectTapTargets(page);
    if (phoneOnly(info)) {
      // The portal buttons are full width on a phone.
      const manage = await box(band.getByRole("button", { name: /^Manage billing/ }));
      const bandBox = await box(band);
      expect(manage.width).toBeGreaterThan(bandBox.width - 40);
      expect(manage.height).toBeGreaterThanOrEqual(44);
    } else {
      const manage = await box(band.getByRole("button", { name: /^Manage billing/ }));
      expect(manage.width).toBeLessThanOrEqual(320);
      // The group sits in the right half of the band.
      const bandBox = await box(band);
      expect(manage.x).toBeGreaterThan(bandBox.x + bandBox.width / 2);
    }
  });

  test("M4-05 Pro yearly, Studio monthly, cancel at period end, and Free with a Stripe customer", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "copy checks run once, on desktop");
    const user = await signedInUser(context, { label: "bs" });
    const band = page.locator("[data-plan-band]");

    await setBilling(user.userId, {
      plan: "pro",
      billing_interval: "year",
      current_period_end: PERIOD_END,
      ...sub(),
    });
    await page.goto(settings());
    await expect(band.locator("[data-band-price]")).toHaveText(formatBandPrice("pro", "year"));
    await expect(band.getByRole("button", { name: /^Manage billing/ })).toBeVisible();
    // Yearly subscribers do not see the switch.
    await expect(band.getByRole("button", { name: /Switch to yearly/ })).toHaveCount(0);

    await setBilling(user.userId, { plan: "studio", billing_interval: "month" });
    await page.reload();
    await expect(band.locator("[data-band-plan]")).toHaveText("Studio");
    await expect(band.locator("[data-band-price]")).toHaveText(formatBandPrice("studio", "month"));
    await expect(
      band.getByRole("button", { name: `Switch to yearly · ${formatPrice("studio", "year")}` }),
    ).toBeVisible();
    // Studio: Free and Pro both downgrade.
    await expect(card(page, "free").getByRole("button", { name: "Downgrade" })).toBeVisible();
    await expect(card(page, "pro").getByRole("button", { name: "Downgrade" })).toBeVisible();
    await expect(card(page, "studio").locator("[data-current-plan-tile]")).toBeVisible();

    await setBilling(user.userId, { plan: "pro", cancel_at_period_end: true });
    await page.reload();
    await expect(band.locator("[data-band-renewal]")).toHaveText(
      "Ends Nov 1, 2026. You keep Pro until then.",
    );

    // A Free account that once subscribed keeps its customer id: Manage billing, no renewal line.
    await setBilling(user.userId, {
      plan: "free",
      billing_interval: null,
      current_period_end: null,
      cancel_at_period_end: false,
      stripe_subscription_id: null,
    });
    await page.reload();
    await expect(band.locator("[data-band-plan]")).toHaveText("Free");
    await expect(band.locator("[data-band-renewal]")).toHaveCount(0);
    await expect(band.getByRole("button", { name: /^Manage billing/ })).toBeVisible();
    await expect(band.getByRole("button", { name: /Switch to yearly/ })).toHaveCount(0);
  });
});

test.describe("M4-32 usage meters", () => {
  test("M4-32 Pro: pages, domains, uploads and saved themes as n / limit, with a dashed no-limit track", async ({
    page,
    context,
  }, info) => {
    const user = await signedInUser(context, { label: "mu" });
    await setBilling(user.userId, { plan: "pro" });
    await addPage(user.userId, `zq-mu2-${rand()}`);
    const admin = adminClient();
    const domain = await admin.from("domains").insert({
      page_id: user.pageId,
      hostname: `${user.handle}.meter.example`,
      status: "verified",
      verified_at: new Date().toISOString(),
    });
    expect(domain.error).toBeNull();
    const themes = await admin
      .from("themes")
      .insert(
        Array.from({ length: 5 }, (_, i) => ({ owner_id: user.userId, name: `T${i}`, tokens: {} })),
      );
    expect(themes.error).toBeNull();
    await seedUploads(user.userId, 3);

    await page.goto(settings());
    const meter = (key: string) => page.locator(`[data-meter="${key}"]`);
    await expect(meter("pages").locator("[data-meter-text]")).toHaveText("2 / 3");
    await expect(meter("domains").locator("[data-meter-text]")).toHaveText("1 / 1");
    await expect(meter("uploads").locator("[data-meter-text]")).toHaveText("3 / 100 MB");
    await expect(meter("themes").locator("[data-meter-text]")).toHaveText("5 · no limit");
    await expect(meter("themes").locator("[data-meter-track='dashed']")).toBeVisible();
    // The fills are min(100%, used / limit).
    const fill = async (key: string) =>
      (await box(meter(key).locator("[data-meter-fill]"))).width /
      (await box(meter(key).locator("[data-meter-track='solid']"))).width;
    expect(await fill("pages")).toBeCloseTo(2 / 3, 1);
    expect(await fill("domains")).toBeCloseTo(1, 1);
    expect(await fill("uploads")).toBeCloseTo(0.03, 1);
    for (const key of ["pages", "domains", "uploads", "themes"]) {
      await expect(meter(key).locator("[data-meter-note]")).toHaveCount(0);
    }

    await expectNoHorizontalScroll(page);
    await expectTapTargets(page);
    const pages = await box(meter("pages"));
    const domains = await box(meter("domains"));
    if (phoneOnly(info)) {
      // One column.
      expect(domains.y).toBeGreaterThan(pages.y + pages.height - 1);
      expect(Math.abs(domains.x - pages.x)).toBeLessThan(1);
    } else {
      // The meters wrap in a grid inside the 920px column: side by side.
      expect(Math.abs(domains.y - pages.y)).toBeLessThan(1);
      expect(domains.x).toBeGreaterThan(pages.x);
    }
  });

  test("M4-32 Free: Custom domains reads 'Not included' with a dashed track, saved themes n / 3", async ({
    page,
    context,
  }) => {
    await signedInUser(context, { label: "mf" });
    await page.goto(settings());
    const domains = page.locator('[data-meter="domains"]');
    await expect(domains.locator("[data-meter-text]")).toHaveText("Not included");
    await expect(domains.locator("[data-meter-track='dashed']")).toBeVisible();
    await expect(page.locator('[data-meter="themes"] [data-meter-text]')).toHaveText("0 / 3");
    await expect(page.locator('[data-meter="pages"] [data-meter-text]')).toHaveText("1 / 1");
    await expect(page.locator('[data-meter="uploads"] [data-meter-text]')).toHaveText("<1 / 10 MB");
  });
});

test.describe("M4-33 over the limit after a downgrade", () => {
  test("M4-33 a Pro account with 3 pages, a domain, 4 themes and 12 MiB, downgraded to Free, keeps everything and reads over its limits", async ({
    page,
    context,
  }) => {
    const user = await signedInUser(context, { label: "dg" });
    await setBilling(user.userId, { plan: "pro", ...sub() });
    await addPage(user.userId, `zq-dg2-${rand()}`);
    await addPage(user.userId, `zq-dg3-${rand()}`);
    const admin = adminClient();
    await admin.from("domains").insert({
      page_id: user.pageId,
      hostname: `${user.handle}.down.example`,
      status: "verified",
      verified_at: new Date().toISOString(),
    });
    await admin
      .from("themes")
      .insert(
        Array.from({ length: 4 }, (_, i) => ({ owner_id: user.userId, name: `D${i}`, tokens: {} })),
      );
    await seedUploads(user.userId, 3);
    await seedUploads(user.userId, 3);
    await seedUploads(user.userId, 3);
    await seedUploads(user.userId, 3);

    // What the customer.subscription.deleted webhook does to the row.
    await setBilling(user.userId, {
      plan: "free",
      stripe_subscription_id: null,
      billing_interval: null,
      current_period_end: null,
      cancel_at_period_end: false,
    });
    await page.goto(settings());

    const meter = (key: string) => page.locator(`[data-meter="${key}"]`);
    await expect(meter("pages").locator("[data-meter-text]")).toHaveText("3 / 1");
    await expect(meter("domains").locator("[data-meter-text]")).toHaveText("1 / 0");
    await expect(meter("themes").locator("[data-meter-text]")).toHaveText("4 / 3");
    await expect(meter("uploads").locator("[data-meter-text]")).toHaveText("12 / 10 MB");
    for (const key of ["pages", "domains", "themes", "uploads"]) {
      await expect(meter(key)).toHaveAttribute("data-over", "true");
      await expect(meter(key).locator("[data-meter-note]")).toHaveText(
        "Over your plan’s limit. What you have stays; you can’t add more.",
      );
    }
    // The fill stays full.
    const pagesFill = (await box(meter("pages").locator("[data-meter-fill]"))).width;
    const pagesTrack = (await box(meter("pages").locator("[data-meter-track='solid']"))).width;
    expect(pagesFill).toBeCloseTo(pagesTrack, 0);

    await expectNoHorizontalScroll(page);
    await expectTapTargets(page);
    // Nothing was deleted: all three pages are listed, and the data is where it was.
    await expect(page.locator("[data-page-row]")).toHaveCount(3);
  });
});
