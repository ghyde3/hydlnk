import { expect, test, type Page } from "@playwright/test";
import { adminClient } from "../fixtures/auth";
import { cleanupUsers, desktopOnly, phoneOnly } from "../fixtures/data";
import { appRaw } from "../fixtures/http";
import { expectNoHorizontalScroll, expectTapTargets, url } from "../helpers";
import { draftOf } from "../m2/blocks-helpers";
import { draftWith, openEditor, rowOf, saveIndicator, setDraft } from "../m2/editor-helpers";
import { ingestPage } from "../m4/analytics-ingest-helpers";
import { makeAdminEmail, signInAsAdmin, signInAsUser, tenantRaw } from "../m5/admin-helpers";
import { signIn, uniq } from "../fixtures/data";
import { APP_ORIGIN } from "../m5/admin-helpers";
import {
  auditRows,
  domainRow,
  linkBlock,
  newDomain,
  track,
  trackDomain,
} from "./blocked-links-helpers";

/**
 * M7-13: the /admin/blocked-links screen at 390x844 and 1440x900. Every test has its own random
 * domain, admin and (when it needs one) live page; the actions' rules are M7-12 (blocked-links-api).
 */

test.describe.configure({ timeout: 120_000 });
test.afterAll(async () => {
  await track.cleanup();
  await cleanupUsers();
});

const SCREEN = url("app", "/admin/blocked-links");

const form = (page: Page) => page.getByRole("form", { name: "Block a domain" });
const domainInput = (page: Page) => form(page).getByLabel("Domain", { exact: true });
const reasonInput = (page: Page) => form(page).getByLabel("Reason", { exact: true });
const blockButton = (page: Page) => form(page).getByRole("button", { name: /^Block(ing)?/ });
const domainRowEl = (page: Page, domain: string) => page.locator(`tr[data-domain="${domain}"]`);
const panel = (page: Page) => page.getByRole("status");

async function open(page: Page): Promise<void> {
  await page.goto(SCREEN);
  await expect(page.getByRole("heading", { level: 1, name: "Blocked links" })).toBeVisible();
  // The form is a client component: wait until it has React handlers before typing into it.
  await page.waitForFunction(() => {
    const input = document.querySelector("form[aria-label='Block a domain'] input");
    return !!input && Object.keys(input).some((key) => key.startsWith("__reactProps$"));
  });
}

async function add(page: Page, domain: string, reason: string): Promise<void> {
  await domainInput(page).fill(domain);
  await reasonInput(page).fill(reason);
  await blockButton(page).click();
}

test.describe("M7-13 who sees the screen", () => {
  test("M7-13 signed out goes to sign-in, a signed-in non-admin gets the app's 404 (the same page as an unknown route), the tenant host answers 404", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "no UI involved");
    const anonymous = await appRaw("/admin/blocked-links");
    expect(anonymous.status).toBe(307);
    expect(new URL(anonymous.location ?? "", APP_ORIGIN).pathname).toBe("/login");

    await signInAsUser(context, "blsna");
    await page.goto(url("app", "/no-such-route-m713"));
    // Dev compiles the 404 on first use: wait for it to draw before reading its text.
    await expect(page.getByText("That page doesn’t exist.")).toBeVisible({ timeout: 30_000 });
    const unknownText = (await page.locator("body").innerText()).trim();
    const response = await page.goto(SCREEN);
    expect(response?.status()).toBe(404);
    await expect(page.getByText("That page doesn’t exist.")).toBeVisible({ timeout: 30_000 });
    expect((await page.locator("body").innerText()).trim()).toBe(unknownText);
    expect(unknownText.length).toBeGreaterThan(0);
    expect((await tenantRaw("mara", "/admin/blocked-links")).status).toBe(404);
  });
});

test.describe("M7-13 the screen", () => {
  test("M7-13 header, sentence, the fourth admin section, the overview tile and the list", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "desktop layout");
    await signInAsAdmin(context, "blsh");

    // The Admin overview gains a tile with the number of domains.
    await page.goto(url("app", "/admin"));
    const tile = page.getByRole("main").getByRole("link", { name: /Blocked links/ });
    await expect(tile).toBeVisible();
    const total = await adminClient()
      .from("blocked_domains")
      .select("domain", { count: "exact", head: true });
    await expect(tile).toContainText(String(total.count));
    await tile.click();
    await expect(page).toHaveURL(SCREEN);

    // The sidebar has the section, after Traffic, and it is current.
    const nav = page.locator("aside").getByRole("navigation", { name: "Admin" });
    await expect(nav.getByRole("link")).toHaveText([
      "Reports",
      "Pages",
      "Traffic",
      "Blocked links",
    ]);
    await expect(nav.getByRole("link", { name: "Blocked links" })).toHaveAttribute(
      "aria-current",
      "page",
    );

    const header = page.locator("main > header").first();
    await expect(header.locator("p").first()).toHaveText("admin / blocked links");
    await expect(header.getByRole("heading", { level: 1, name: "Blocked links" })).toBeVisible();
    await expect(
      page.getByText(
        "People can’t save or publish a link to these domains or their subdomains. Pages that are already live keep serving.",
      ),
    ).toBeVisible();

    // The list: a data table, a mono header row, newest first, with the starter list in it.
    const head = page.locator("thead");
    await expect(head.locator("th")).toHaveText(["Domain", "Reason", "Added", "Actions"]);
    expect(await head.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(
      "rgb(244, 243, 240)",
    );
    const th = head.locator("th").first();
    expect(await th.evaluate((el) => getComputedStyle(el).fontFamily)).toMatch(/mono/i);
    expect(await th.evaluate((el) => getComputedStyle(el).textTransform)).toBe("uppercase");

    // Find a starter entry (it can be on a later page when many others are listed).
    const starter = domainRowEl(page, "grabify.link");
    for (let pageNumber = 1; pageNumber <= 20 && (await starter.count()) === 0; pageNumber++) {
      await page.goto(`${SCREEN}?page=${pageNumber + 1}`);
    }
    await expect(starter).toBeVisible();
    await expect(starter).toContainText("ip-logger");
    await expect(starter.locator("td").nth(2)).toHaveText(/[A-Z][a-z]{2} \d{1,2}, \d{4}$/);
    expect(
      await starter
        .locator("td")
        .first()
        .evaluate((el) => getComputedStyle(el).fontFamily),
    ).toMatch(/mono/i);
    await expect(starter.getByRole("button", { name: "Remove grabify.link" })).toBeVisible();
    await expectNoHorizontalScroll(page);
  });

  test("M7-13 past the last page the list reads 'No domains are blocked.'", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "same copy at both sizes");
    await signInAsAdmin(context, "blem");
    await page.goto(`${SCREEN}?page=9999`);
    await expect(page.getByText("No domains are blocked.")).toBeVisible();
    await expect(page.locator("tr[data-domain]")).toHaveCount(0);
  });
});

test.describe("M7-13 adding a domain", () => {
  test("M7-13 adding shows the live pages that already link to it, never unpublishes them, and a double click sends one request", async ({
    page,
    context,
  }, info) => {
    const domain = newDomain("bladd");
    const live = await ingestPage("bladdlive", {
      blocks: [
        linkBlock("lnkblk000001", `https://shop.${domain}/a`),
        linkBlock("lnkblk000002", `https://shop.${domain}/b`),
      ],
      draft: draftOf("x", [
        linkBlock("lnkblk000001", `https://shop.${domain}/a`),
        linkBlock("lnkblk000002", `https://shop.${domain}/b`),
      ]),
    });
    const admin = await signInAsAdmin(context, "bladd");
    await open(page);

    const posts: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "POST" && request.url().endsWith("/api/admin/blocked-links")) {
        posts.push(request.url());
      }
    });

    const formBefore = await form(page).boundingBox();
    await domainInput(page).fill(`https://www.${domain}/pasted-url`);
    await reasonInput(page).fill("e2e add");
    await blockButton(page).dblclick();

    const result = panel(page);
    await expect(result).toContainText(
      `Blocked ${domain}. 1 live page already links to it. Nothing was unpublished.`,
    );
    expect(posts).toHaveLength(1);

    // The page: its handle in mono, a link that opens its live address in a new tab, the matching host and the link count.
    const handle = result.locator("span.font-mono", { hasText: live.handle });
    await expect(handle).toBeVisible();
    expect(await handle.evaluate((el) => getComputedStyle(el).fontFamily)).toMatch(/mono/i);
    const view = result.getByRole("link", { name: "View page" });
    await expect(view).toHaveAttribute("href", `${live.origin}/`);
    await expect(view).toHaveAttribute("target", "_blank");
    await expect(view).toHaveAttribute("rel", "noopener noreferrer");
    await expect(result).toContainText(`shop.${domain} · 2 links`);
    await expect(result).toContainText(
      "1 draft also links to it. Its owner will see Not saved until they change the link.",
    );
    await expect(result.getByRole("button", { name: "Dismiss" })).toBeVisible();

    // The form cleared, the domain is at the top of the list, and one audit row was written.
    await expect(domainInput(page)).toHaveValue("");
    await expect(reasonInput(page)).toHaveValue("");
    await expect(page.locator("tr[data-domain]").first()).toHaveAttribute("data-domain", domain);
    await expect(domainRowEl(page, domain)).toContainText("e2e add");
    expect(await auditRows(domain)).toMatchObject([
      {
        admin_id: admin.userId,
        action: "block_domain",
        detail: { domain, reason: "e2e add", live_pages: 1, draft_pages: 1 },
      },
    ]);

    // Nothing was unpublished: the page still serves its own address.
    expect((await tenantRaw(live.handle)).status).toBe(200);
    const row = await adminClient()
      .from("pages")
      .select("published_at")
      .eq("id", live.pageId)
      .single();
    expect(row.data?.published_at).not.toBeNull();

    // On desktop the panel sits between the form and the table, and the form did not move.
    if (desktopOnly(info)) {
      const formAfter = await form(page).boundingBox();
      expect(formAfter!.y).toBeCloseTo(formBefore!.y, 0);
      const panelBox = await result.boundingBox();
      const tableBox = await page.locator("table").boundingBox();
      expect(panelBox!.y).toBeGreaterThanOrEqual(formAfter!.y + formAfter!.height - 1);
      expect(panelBox!.y + panelBox!.height).toBeLessThanOrEqual(tableBox!.y);
    }
    await expectNoHorizontalScroll(page);

    await result.getByRole("button", { name: "Dismiss" }).click();
    await expect(panel(page)).toHaveCount(0);
  });

  test("M7-13 a domain nothing links to reads 'No live pages link to it.'", async ({
    page,
    context,
  }) => {
    const domain = newDomain("blnone");
    await signInAsAdmin(context, "blnone");
    await open(page);
    await add(page, domain, "e2e none");
    await expect(panel(page)).toContainText(`Blocked ${domain}. No live pages link to it.`);
    await expect(panel(page).getByRole("link", { name: "View page" })).toHaveCount(0);
  });

  test("M7-13 each refusal shows under its field with role=alert, and nothing is added", async ({
    page,
    context,
  }, info) => {
    await signInAsAdmin(context, "blerr");
    await open(page);
    const alert = form(page).getByRole("alert");

    await add(page, "", "e2e");
    await expect(alert).toHaveText("Enter a domain, such as example.com.");
    await expect(domainInput(page)).toHaveAttribute("aria-invalid", "true");

    await add(page, "com", "e2e");
    await expect(alert).toHaveText("Use the full domain, such as example.com.");

    await add(page, "1.2.3.4", "e2e");
    await expect(alert).toHaveText("IP addresses are blocked already.");

    const domain = newDomain("blerr");
    await add(page, domain, "");
    await expect(alert).toHaveText("Add a reason so others know why.");
    await expect(reasonInput(page)).toHaveAttribute("aria-invalid", "true");
    // The reason's own sentence sits under the reason field, not under the domain.
    await expect(
      page.locator(
        "#" + (await reasonInput(page).getAttribute("aria-describedby"))?.split(" ").pop(),
      ),
    ).toHaveText("Add a reason so others know why.");

    await add(page, domain, "x".repeat(121));
    await expect(alert).toHaveText("Use 120 characters or fewer for the reason.");
    expect(await domainRow(domain)).toBeNull();

    // Every refusal is a plain sentence with no stack trace or SQL.
    await expect(page.locator("body")).not.toContainText(/stack|sql|exception|violates/i);

    // The same domain twice: the second add is "already blocked".
    await add(page, domain, "e2e once");
    await expect(panel(page)).toContainText(`Blocked ${domain}.`);
    await add(page, domain, "e2e twice");
    await expect(alert).toHaveText(`${domain} is already blocked.`);
    await expect(domainInput(page)).toHaveAttribute("aria-invalid", "true");
    expect(await auditRows(domain)).toHaveLength(1);

    // Text is text: markup in a reason shows as characters and runs nothing.
    let dialogs = 0;
    page.on("dialog", async (dialog) => {
      dialogs++;
      await dialog.dismiss();
    });
    const markup = newDomain("blxss");
    await add(page, markup, "<img src=x onerror=alert(1)>");
    await expect(domainRowEl(page, markup)).toContainText("<img src=x onerror=alert(1)>");
    await expect(page.locator("tr[data-domain] img")).toHaveCount(0);
    expect(dialogs).toBe(0);
    if (phoneOnly(info)) await expectNoHorizontalScroll(page);
  });
});

test.describe("M7-13 removing a domain", () => {
  test("M7-13 Remove asks first (Escape and Keep blocked return focus), then removes once, with one audit row and focus on the list heading", async ({
    page,
    context,
  }) => {
    const domain = newDomain("blrm");
    const admin = await signInAsAdmin(context, "blrm");
    await open(page);
    await add(page, domain, "e2e remove");
    await expect(domainRowEl(page, domain)).toBeVisible();

    const remove = page.getByRole("button", { name: `Remove ${domain}` });
    await remove.click();
    const confirm = page.locator(`tr[data-confirm-for="${domain}"]`);
    await expect(confirm).toContainText(`Remove ${domain}? Pages can link to it again.`);
    await expect(confirm.getByRole("button", { name: "Remove domain" })).toBeVisible();
    await expect(confirm.getByRole("button", { name: "Keep blocked" })).toBeVisible();

    // Escape closes it and gives focus back to Remove.
    await page.keyboard.press("Escape");
    await expect(confirm).toHaveCount(0);
    await expect(remove).toBeFocused();

    // So does Keep blocked.
    await remove.click();
    await confirm.getByRole("button", { name: "Keep blocked" }).click();
    await expect(confirm).toHaveCount(0);
    await expect(remove).toBeFocused();
    expect(await domainRow(domain)).not.toBeNull();
    expect(await auditRows(domain)).toHaveLength(1);

    // Confirming (even with a double click) removes it once.
    const posts: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "POST" && request.url().includes("/remove"))
        posts.push(request.url());
    });
    await remove.click();
    await confirm.getByRole("button", { name: "Remove domain" }).dblclick();
    await expect(panel(page)).toHaveText(new RegExp(`Removed ${domain.replace(/\./g, "\\.")}\\.`));
    await expect(domainRowEl(page, domain)).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Blocked domains" })).toBeFocused();
    expect(posts).toHaveLength(1);
    expect(await domainRow(domain)).toBeNull();
    const rows = await auditRows(domain);
    expect(rows.map((row) => row.action)).toEqual(["block_domain", "unblock_domain"]);
    expect(rows[1]).toMatchObject({
      admin_id: admin.userId,
      detail: { domain, reason: "e2e remove" },
    });
  });
});

test.describe("M7-13 end to end: the editor and the blocklist", () => {
  test("M7-13 after the domain is added a link to it shows Not saved with the blocked-site banner, and after it is removed the same link saves", async ({
    page,
    context,
  }) => {
    const domain = newDomain("bled");
    // An admin with a page of their own, so the same session opens the editor.
    const email = await makeAdminEmail("bled");
    const me = await signIn(context, email, { handle: uniq("bled").slice(0, 28) });
    const ID = "lnkedt000001";
    await setDraft(
      me.pageId!,
      draftWith("bled", [
        { id: ID, type: "link", visible: true, label: "Mine", url: "https://ok.example/start" },
      ]),
    );

    await open(page);
    await add(page, domain, "e2e editor");
    await expect(panel(page)).toContainText(`Blocked ${domain}.`);

    await openEditor(page);
    const urlField = rowOf(page, ID).locator('input[data-field="url"]');
    await rowOf(page, ID).locator("button[aria-expanded]").first().click();
    await urlField.fill(`https://x.${domain}/`);
    await expect(saveIndicator(page)).toHaveAttribute("data-save-status", "blocked", {
      timeout: 15_000,
    });
    await expect(saveIndicator(page)).toHaveText("Not saved");
    await expect(page.getByRole("alert").filter({ hasText: domain })).toContainText(
      "Remove or change it.",
    );

    // Remove the domain on this screen: the same link now saves.
    await open(page);
    await page.getByRole("button", { name: `Remove ${domain}` }).click();
    await page
      .locator(`tr[data-confirm-for="${domain}"]`)
      .getByRole("button", { name: "Remove domain" })
      .click();
    await expect(domainRowEl(page, domain)).toHaveCount(0);

    await openEditor(page);
    await rowOf(page, ID).locator("button[aria-expanded]").first().click();
    await urlField.fill(`https://x.${domain}/`);
    await expect(saveIndicator(page)).toHaveAttribute("data-save-status", "saved", {
      timeout: 15_000,
    });
  });
});

test.describe("M7-13 layout", () => {
  test("M7-13 at 390x844 the sections wrap, the form is stacked and full width, rows are cards, nothing scrolls sideways and every target is 44px", async ({
    page,
    context,
  }, info) => {
    test.skip(!phoneOnly(info), "phone layout");
    const long = trackDomain(`${"a".repeat(55)}.${"b".repeat(55)}.${newDomain("blph")}`);
    await signInAsAdmin(context, "blph");
    await open(page);

    const nav = page.getByRole("navigation", { name: "Admin sections" });
    await expect(nav.getByRole("link")).toHaveText([
      "Reports",
      "Pages",
      "Traffic",
      "Blocked links",
    ]);
    for (const link of await nav.getByRole("link").all()) {
      expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }

    const viewport = page.viewportSize()!.width;
    const formBox = await form(page).boundingBox();
    const domainBox = await domainInput(page).boundingBox();
    const reasonBox = await reasonInput(page).boundingBox();
    const buttonBox = await blockButton(page).boundingBox();
    expect(domainBox!.y + domainBox!.height).toBeLessThanOrEqual(reasonBox!.y);
    expect(reasonBox!.y + reasonBox!.height).toBeLessThanOrEqual(buttonBox!.y);
    expect(domainBox!.width).toBeGreaterThan(viewport * 0.8);
    expect(buttonBox!.width).toBeGreaterThan(formBox!.width * 0.85);
    for (const box of [domainBox!, reasonBox!, buttonBox!])
      expect(box.height).toBeGreaterThanOrEqual(44);
    expect(await domainInput(page).evaluate((el) => getComputedStyle(el).fontSize)).toBe("16px");
    expect(await reasonInput(page).evaluate((el) => getComputedStyle(el).fontSize)).toBe("16px");
    await expect(domainInput(page)).toHaveAttribute("placeholder", "example.com");

    // Rows are stacked cards labeled Domain, Reason and Added.
    await expect(page.locator("thead")).toBeHidden();
    const first = page.locator("tr[data-domain]").first();
    await expect(first).toBeVisible();
    const displays = await first
      .locator("td")
      .evaluateAll((tds) => tds.map((td) => getComputedStyle(td).display));
    expect(new Set(displays)).toEqual(new Set(["block"]));
    for (const label of ["Domain", "Reason", "Added"]) {
      await expect(first.getByText(label, { exact: true })).toBeVisible();
    }

    // A long domain and a long reason wrap; the confirmation and the result do not widen the page.
    await add(page, long, "r".repeat(120));
    await expect(panel(page)).toContainText("Blocked ");
    await expectNoHorizontalScroll(page);
    const added = page.locator("tr[data-domain]").first();
    await added.getByRole("button", { name: /^Remove / }).click();
    await expect(page.locator("tr[data-confirm-for]")).toBeVisible();
    await expectNoHorizontalScroll(page);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await expectTapTargets(page);
  });

  test("M7-13 at 1440x900 the form is one row above the table, which is a data table in the style of /admin/traffic", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "desktop layout");
    await signInAsAdmin(context, "bldt");
    await open(page);
    const domainBox = await domainInput(page).boundingBox();
    const reasonBox = await reasonInput(page).boundingBox();
    const buttonBox = await blockButton(page).boundingBox();
    // One row: the three controls share a top edge (the button is the same height as the inputs).
    expect(Math.abs(domainBox!.y - reasonBox!.y)).toBeLessThan(2);
    expect(Math.abs(buttonBox!.y - domainBox!.y)).toBeLessThan(2);
    expect(buttonBox!.x).toBeGreaterThan(reasonBox!.x + reasonBox!.width - 1);
    const tableBox = await page.locator("table").boundingBox();
    expect(tableBox!.y).toBeGreaterThan(domainBox!.y + domainBox!.height);
    expect(await blockButton(page).evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(
      "rgb(28, 27, 26)",
    );
    await expect(page.locator("thead")).toBeVisible();
    await expectNoHorizontalScroll(page);
  });
});
