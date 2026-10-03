import { expect, test } from "@playwright/test";
import { cleanupUsers, desktopOnly, phoneOnly, rand, signedInUser } from "../fixtures/data";
import { addCalls, setDomainState } from "../fixtures/vercel-stub";
import { expectNoHorizontalScroll, expectTapTargets, url } from "../helpers";
import { cardOf, domainHost, seedDomain, shot } from "./domains-ui-helpers";

/**
 * The DNS records of step 2 (M4-13) and the add form's UI (M4-11, M4-12 at the limit): rendered
 * from what the Vercel stub returns for the hostname, copied with the Copy button, and a domain
 * added through the form appearing without a reload. What the server refuses (the hostname
 * validator's 18 cases, the plan gate, ownership, the compensating remove) is the domains-core
 * specs; here is how a customer sees it.
 */

test.afterAll(cleanupUsers);
test.describe.configure({ timeout: 90_000 });

const MAIN = "main";
const TXT_VALUE = `vc-domain-verify=${"links.example.test".padEnd(30, "x")},${"a".repeat(28)}`;

test.describe("M4-13 DNS records shown are the ones Vercel returns", () => {
  test("M4-13 a subdomain shows the CNAME Vercel returned, the ownership TXT row and the apex note", async ({
    page,
    context,
  }, info) => {
    const user = await signedInUser(context, { label: "rr", plan: "pro" });
    const host = `links-${rand(4)}.example.test`;
    await seedDomain(user.pageId, host);
    await setDomainState(host, {
      added: true,
      apexName: "example.test",
      recommendedCNAME: [{ rank: 1, value: "abc123.vercel-dns-017.com." }],
      recommendedIPv4: [{ rank: 1, value: ["203.0.113.10"] }],
      verification: [
        {
          type: "TXT",
          domain: "_vercel.example.test",
          value: TXT_VALUE,
          reason: "pending_verification",
        },
      ],
    });
    await page.goto(url("app", "/domains"));
    const card = cardOf(page, host);
    await expect(card.getByText("Add these records at your DNS provider")).toBeVisible();

    const rows = card.locator("[data-dns-record]:visible");
    if (phoneOnly(info)) {
      // A stacked definition list per record.
      await expect(rows).toHaveCount(2);
      await expect(card.locator("dl").first()).toContainText("CNAME");
      await expect(card.locator("dl").first()).toContainText(host.split(".")[0]!);
      await expect(card.locator("dl").first()).toContainText("abc123.vercel-dns-017.com");
      await expect(card.locator("dl").first()).not.toContainText("abc123.vercel-dns-017.com.");
      await expect(card.locator("dl").nth(1)).toContainText("_vercel");
      await expect(card.locator("dl").nth(1)).toContainText(TXT_VALUE);
      await expectNoHorizontalScroll(page);
      await expectTapTargets(page, MAIN);
      // The 70-character TXT value wraps inside the card.
      const value = card.locator("dl").nth(1).locator("span.font-mono");
      const box = (await value.boundingBox())!;
      expect(box.height).toBeGreaterThan(30);
      const cardBox = (await card.boundingBox())!;
      expect(box.x + box.width).toBeLessThanOrEqual(cardBox.x + cardBox.width);
      for (const copy of await card.getByRole("button", { name: "Copy record value" }).all()) {
        expect((await copy.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      }
    } else {
      const table = card.getByRole("table", { name: "DNS records to add" });
      await expect(table.getByRole("columnheader")).toHaveText(["Type", "Name", "Value", "Copy"]);
      await expect(rows).toHaveCount(2);
      await expect(rows.nth(0)).toContainText("CNAME");
      await expect(rows.nth(0)).toContainText(host.split(".")[0]!);
      await expect(rows.nth(0)).toContainText("abc123.vercel-dns-017.com");
      await expect(rows.nth(1)).toContainText("TXT");
      await expect(rows.nth(1)).toContainText("_vercel");
      await expect(rows.nth(1)).toContainText(TXT_VALUE);
      // 80 / 80 / flexible / 72 columns, mono 13px, header 11px uppercase.
      const columns = await table
        .getByRole("row")
        .first()
        .evaluate((el) => getComputedStyle(el).gridTemplateColumns);
      expect(columns.split(" ").slice(0, 2)).toEqual(["80px", "80px"]);
      expect(columns.split(" ").at(-1)).toBe("72px");
      expect(await table.evaluate((el) => getComputedStyle(el).fontSize)).toBe("13px");
      expect(
        await table
          .getByRole("columnheader")
          .first()
          .evaluate((el) => getComputedStyle(el).fontSize),
      ).toBe("11px");
      expect(
        await table
          .getByRole("row")
          .first()
          .evaluate((el) => getComputedStyle(el).backgroundColor),
      ).toBe("rgb(244, 243, 240)");
    }

    await expect(card.locator("[data-apex-note]")).toHaveText(
      "Using a root domain like example.test instead? Add an A record for @ pointing to 203.0.113.10.",
    );
    await shot(page, "records");
  });

  test("M4-13 an apex domain shows the A record, one record means 'this record' and no note", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "the layouts are covered by the subdomain test");
    const user = await signedInUser(context, { label: "ra", plan: "pro" });
    const host = `zq-apex-${rand(5)}.test`;
    await seedDomain(user.pageId, host);
    await setDomainState(host, {
      added: true,
      apexName: host,
      recommendedIPv4: [
        { rank: 2, value: ["203.0.113.99"] },
        { rank: 1, value: ["203.0.113.10", "203.0.113.11"] },
      ],
    });
    await page.goto(url("app", "/domains"));
    const card = cardOf(page, host);
    await expect(card.getByText("Add this record at your DNS provider")).toBeVisible();
    const row = card.locator("[data-dns-record]:visible");
    await expect(row).toHaveCount(1);
    await expect(row).toContainText("A");
    await expect(row).toContainText("@");
    await expect(row).toContainText("203.0.113.10");
    await expect(row).not.toContainText("203.0.113.99");
    await expect(card.locator("[data-apex-note]")).toHaveCount(0);
  });

  test("M4-13 changing what Vercel returns changes what the card shows after a reload", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "a data flow: one viewport is enough");
    const user = await signedInUser(context, { label: "rc", plan: "pro" });
    const host = `links-${rand(4)}.example.test`;
    await seedDomain(user.pageId, host);
    await setDomainState(host, {
      added: true,
      recommendedCNAME: [{ rank: 1, value: "first.example-dns.test." }],
    });
    await page.goto(url("app", "/domains"));
    await expect(cardOf(page, host).locator("[data-dns-record]:visible")).toContainText(
      "first.example-dns.test",
    );
    await setDomainState(host, {
      recommendedCNAME: [{ rank: 1, value: "second.example-dns.test." }],
    });
    await page.reload();
    await expect(cardOf(page, host).locator("[data-dns-record]:visible")).toContainText(
      "second.example-dns.test",
    );
  });

  test("M4-13 Copy writes only the Value to the clipboard and says Copied for two seconds", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "the same button at both widths: one viewport is enough");
    await context.grantPermissions(["clipboard-read", "clipboard-write"], {
      origin: url("app"),
    });
    const user = await signedInUser(context, { label: "rk", plan: "pro" });
    const host = `links-${rand(4)}.example.test`;
    await seedDomain(user.pageId, host);
    await setDomainState(host, {
      added: true,
      recommendedCNAME: [{ rank: 1, value: "copyme.example-dns.test." }],
    });
    await page.goto(url("app", "/domains"));
    const card = cardOf(page, host);
    const copy = card.getByRole("button", { name: "Copy record value" }).first();
    await expect(copy).toHaveText("Copy");
    await copy.click();
    await expect(copy).toHaveText("Copied");
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      "copyme.example-dns.test",
    );
    await expect(copy).toHaveText("Copy", { timeout: 4000 });
  });

  test("M4-13 when the config request fails the card says it could not load the records, shows no values and offers Try again", async ({
    page,
    context,
  }, info) => {
    const user = await signedInUser(context, { label: "ru", plan: "pro" });
    const host = `links-${rand(4)}.example.test`;
    await seedDomain(user.pageId, host);
    await setDomainState(host, { added: true, configStatus: 500 });
    await page.goto(url("app", "/domains"));
    const card = cardOf(page, host);
    const unavailable = card.locator("[data-dns-unavailable]");
    await expect(unavailable).toContainText("We couldn’t load your DNS records.");
    await expect(card.locator("[data-dns-record]")).toHaveCount(0);
    await expect(card.getByRole("button", { name: "Copy record value" })).toHaveCount(0);
    await expect(card.getByText(/vercel-dns|203\.0\.113/)).toHaveCount(0);
    const retry = unavailable.getByRole("button", { name: "Try again" });
    await expectNoHorizontalScroll(page);
    if (phoneOnly(info)) {
      await expectTapTargets(page, MAIN);
      expect((await retry.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }

    // The host answers again: Try again brings the records in place.
    await setDomainState(host, { configStatus: null });
    await retry.click();
    await expect(card.locator("[data-dns-record]:visible").first()).toBeVisible();
    await expect(unavailable).toHaveCount(0);
  });
});

test.describe("M4-11 adding a domain from the form", () => {
  test("M4-11 a valid hostname adds a card without a reload, and the add form gives way to the usage line", async ({
    page,
    context,
  }, info) => {
    const user = await signedInUser(context, { label: "ad1", plan: "pro" });
    const host = domainHost("add").toUpperCase();
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.goto(url("app", "/domains"));
    const custom = page.locator("[data-custom-domain-card]");
    await custom.getByLabel("Domain", { exact: true }).fill(host);
    await custom.getByRole("button", { name: "Add domain" }).click();

    const lower = host.toLowerCase();
    await expect(cardOf(page, lower)).toBeVisible();
    await expect(cardOf(page, lower).locator("[data-domain-chip]")).toHaveText("Waiting for DNS");
    // At 1 of 1 the form is gone and only the usage line says so (M4-12).
    await expect(page.locator("[data-domain-usage]")).toHaveText("1 of 1 used on Pro");
    await expect(custom.getByRole("button", { name: "Add domain" })).toHaveCount(0);
    await expect(custom.locator("input")).toHaveCount(0);
    await expect(cardOf(page, lower).getByLabel("Serves")).toHaveValue(user.pageId);
    expect((await addCalls(lower)).length).toBe(1);
    expect(pageErrors, "no uncaught error after the add and the refresh").toEqual([]);

    await expectNoHorizontalScroll(page);
    if (phoneOnly(info)) await expectTapTargets(page, MAIN);
    await shot(page, "added");
  });

  test("M4-11 the server's refusal appears under the form and nothing is added", async ({
    page,
    context,
  }) => {
    await signedInUser(context, { label: "ad2", plan: "pro" });
    await page.goto(url("app", "/domains"));
    const custom = page.locator("[data-custom-domain-card]");
    const field = custom.getByLabel("Domain", { exact: true });
    const error = custom.locator("[data-add-domain-error]");

    // Empty: said before any request.
    await custom.getByRole("button", { name: "Add domain" }).click();
    await expect(error).toHaveText("Enter your domain, like links.example.com.");

    // A URL: the server's sentence, under the input, linked to it.
    await field.fill("https://links.example.test");
    await custom.getByRole("button", { name: "Add domain" }).click();
    await expect(error).toHaveText("Enter just the domain, like links.example.com.");
    await expect(field).toHaveAttribute("aria-invalid", "true");
    await expect(field).toHaveAttribute("aria-describedby", (await error.getAttribute("id")) ?? "");
    await expect(page.locator("[data-domain-card]")).toHaveCount(0);

    // Typing clears it.
    await field.fill("links.example.test");
    await expect(error).toBeEmpty();
  });

  test("M4-11 a failure at the host shows its sentence and leaves nothing behind", async ({
    page,
    context,
  }) => {
    await signedInUser(context, { label: "ad3", plan: "pro" });
    const host = domainHost("addfail");
    await setDomainState(host, { addError: { status: 500, code: "injected" } });
    await page.goto(url("app", "/domains"));
    const custom = page.locator("[data-custom-domain-card]");
    await custom.getByLabel("Domain", { exact: true }).fill(host);
    await custom.getByRole("button", { name: "Add domain" }).click();
    await expect(custom.locator("[data-add-domain-error]")).toHaveText(
      "We couldn’t reach our host to add that domain. Try again.",
    );
    await expect(page.locator("[data-domain-card]")).toHaveCount(0);
    await expect(page.locator("[data-domain-usage]")).toHaveText("0 of 1 used on Pro");
    await expect(custom.getByRole("button", { name: "Add domain" })).toBeEnabled();
  });
});

test.describe("M4-12 at the limit", () => {
  test("M4-12 at the limit the form is replaced by the usage line and the existing domain still renders", async ({
    page,
    context,
  }, info) => {
    const user = await signedInUser(context, { label: "lim", plan: "pro" });
    const host = domainHost("lim");
    await seedDomain(user.pageId, host);
    await page.goto(url("app", "/domains"));
    await expect(page.locator("[data-domain-usage]")).toHaveText("1 of 1 used on Pro");
    await expect(page.locator("[data-custom-domain-card] input")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Add domain" })).toHaveCount(0);
    await expect(cardOf(page, host)).toBeVisible();
    await expect(page.locator("[data-studio-upsell]")).toBeVisible();
    await expectNoHorizontalScroll(page);
    if (phoneOnly(info)) await expectTapTargets(page, MAIN);
  });
});
