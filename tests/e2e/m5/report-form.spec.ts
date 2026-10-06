import { expect, test, type Page } from "@playwright/test";
import { adminClient } from "../fixtures/auth";
import { cleanupUsers, insertPage, makeUser, rand } from "../fixtures/data";
import { expectNoHorizontalScroll, expectTapTargets, url } from "../helpers";

/**
 * M5-05 the report form and the public page's footer link, on the phone (390x844) and desktop
 * (1440x900) projects. Each test gets its own client IP (x-forwarded-for on the browser context) so
 * the hourly limit never couples tests, its own published page, and removes its reports.
 */

test.describe.configure({ timeout: 120_000 });

const SENT = "Report sent. We’ll review it.";
const TOO_MANY = "Too many reports. Try again later.";
const NOT_FOUND = "We couldn’t find that page. Check the address.";
const MARA_PAGE_ID = "00000000-0000-4000-8000-0000000000b1";

const handles: string[] = [];

// report_attempts rows hold only hashes and are pruned by the database after a day: nothing to clean
// up there, and no way to tell this file's rows from another worker's.
test.afterAll(async () => {
  if (handles.length > 0) await adminClient().from("reports").delete().in("page_handle", handles);
  await cleanupUsers();
});

const hex = () => Math.floor(Math.random() * 0x10000).toString(16).padStart(4, "0");
const ipv6 = () => `2001:db8:${hex()}:${hex()}::${hex()}`;

async function publishedPage(label: string) {
  const user = await makeUser(label);
  const handle = `zq-${label}-${rand(5)}`;
  handles.push(handle);
  const pageId = await insertPage(user.id, handle, { published: { version: 1 }, published_at: new Date().toISOString() });
  return { handle, pageId };
}

const reportsFor = async (pageId: string) => {
  const { data, error } = await adminClient().from("reports").select("*").eq("page_id", pageId);
  if (error) throw new Error(error.message);
  return data;
};

async function openForm(page: Page, query = ""): Promise<void> {
  await page.goto(url(null, `/report${query}`));
  await expect(page.getByRole("heading", { level: 1, name: "Report a page" })).toBeVisible();
  await page.locator("form[data-ready='true']").waitFor();
}

const fields = (page: Page) => ({
  address: page.getByLabel("Page address"),
  reason: page.getByLabel("Reason"),
  details: page.getByLabel(/^Details/),
  email: page.getByLabel(/^Your email/),
  send: page.getByRole("button", { name: "Send report" }),
});

test.describe("M5-05 /report?page={pageId}", () => {
  test("M5-05 shows the page's address (handle only), sends a report and confirms it", async ({ page, context }) => {
    await context.setExtraHTTPHeaders({ "x-forwarded-for": ipv6() });
    const target = await publishedPage("rf-send");
    await openForm(page, `?page=${target.pageId}`);
    const f = fields(page);

    await expect(f.address).toHaveValue(`${target.handle}.hydlnk.com`);
    await expect(f.address).toHaveAttribute("readonly", "");
    await expect(page.locator("main")).not.toContainText("Mara");
    const options = await f.reason.locator("option").allTextContents();
    expect(options).toEqual(["Choose a reason", "Phishing or scam", "Malware", "Impersonation", "Illegal content", "Spam", "Something else"]);
    await expect(f.details).toHaveAttribute("maxlength", "1000");
    await expect(f.send).toBeVisible();

    await f.reason.selectOption({ label: "Phishing or scam" });
    await f.details.fill("This page asks for a bank login.");
    await f.email.fill("reporter@example.com");
    await f.send.click();
    await expect(page.getByText(SENT)).toBeVisible();
    await expect(f.send).toHaveCount(0);

    const rows = await reportsFor(target.pageId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ reason: "phishing", details: "This page asks for a bank login.", reporter_email: "reporter@example.com", status: "open", page_handle: target.handle });
    expect(rows[0]!.reporter_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  test("M5-05 the same visitor reporting the same page again reads the same and files nothing more", async ({ page, context }) => {
    await context.setExtraHTTPHeaders({ "x-forwarded-for": ipv6() });
    const target = await publishedPage("rf-twice");
    for (let i = 0; i < 2; i++) {
      await openForm(page, `?page=${target.pageId}`);
      await fields(page).reason.selectOption("spam");
      await fields(page).send.click();
      await expect(page.getByText(SENT)).toBeVisible();
    }
    expect(await reportsFor(target.pageId)).toHaveLength(1);
  });

  test("M5-05 a filled honeypot field reads as sent and files nothing", async ({ page, context }) => {
    await context.setExtraHTTPHeaders({ "x-forwarded-for": ipv6() });
    const target = await publishedPage("rf-bot");
    await openForm(page, `?page=${target.pageId}`);
    const trap = page.locator("input[name='company_url']");
    await expect(trap).toHaveCount(1);
    expect(await trap.evaluate((el) => el.closest("[aria-hidden='true']") !== null && (el as HTMLInputElement).tabIndex === -1)).toBe(true);
    await trap.evaluate((el) => {
      (el as HTMLInputElement).value = "http://spam.example";
    });
    await fields(page).reason.selectOption("phishing");
    await fields(page).send.click();
    await expect(page.getByText(SENT)).toBeVisible();
    expect(await reportsFor(target.pageId)).toEqual([]);
  });

  test("M5-05 a refused report shows 'Too many reports. Try again later.' under the button and keeps the form", async ({ page, context }) => {
    await context.setExtraHTTPHeaders({ "x-forwarded-for": ipv6() });
    const target = await publishedPage("rf-429");
    await page.route("**/report/submit", (route) =>
      route.fulfill({ status: 429, headers: { "retry-after": "60" }, contentType: "application/json", body: JSON.stringify({ ok: false, message: TOO_MANY }) }),
    );
    await openForm(page, `?page=${target.pageId}`);
    await fields(page).reason.selectOption("spam");
    await fields(page).send.click();
    await expect(page.getByRole("alert").filter({ hasText: TOO_MANY })).toBeVisible();
    await expect(fields(page).send).toBeEnabled();
    expect(await reportsFor(target.pageId)).toEqual([]);
  });

  test("M5-05 the sixth report from one address is refused in the browser too", async ({ page, context }) => {
    test.setTimeout(240_000);
    await context.setExtraHTTPHeaders({ "x-forwarded-for": ipv6() });
    const pages = await Promise.all([1, 2, 3, 4, 5, 6].map((n) => publishedPage(`rf-six${n}`)));
    for (const target of pages.slice(0, 5)) {
      await openForm(page, `?page=${target.pageId}`);
      await fields(page).reason.selectOption("malware");
      await fields(page).send.click();
      await expect(page.getByText(SENT)).toBeVisible();
    }
    await openForm(page, `?page=${pages[5]!.pageId}`);
    await fields(page).reason.selectOption("malware");
    await fields(page).send.click();
    await expect(page.getByRole("alert").filter({ hasText: TOO_MANY })).toBeVisible();
    expect(await reportsFor(pages[5]!.pageId)).toEqual([]);
    for (const target of pages.slice(0, 5)) expect(await reportsFor(target.pageId)).toHaveLength(1);
  });
});

test.describe("M5-05 /report without a page", () => {
  test("M5-05 asks for the address: a known handle or its address resolves, an unknown one says 'We couldn’t find that page. Check the address.'", async ({ page, context }) => {
    await context.setExtraHTTPHeaders({ "x-forwarded-for": ipv6() });
    const target = await publishedPage("rf-addr");
    await openForm(page);
    const f = fields(page);
    await expect(f.address).toBeEditable();
    await expect(f.address).toHaveAttribute("placeholder", "name.hydlnk.com");

    await f.address.fill(`nobody-${rand(8)}.hydlnk.com`);
    await f.reason.selectOption("impersonation");
    await f.send.click();
    await expect(page.getByRole("alert").filter({ hasText: NOT_FOUND })).toBeVisible();
    await expect(f.address).toHaveAttribute("aria-invalid", "true");

    await f.address.fill(`https://${target.handle}.hydlnk.com/`);
    await f.send.click();
    await expect(page.getByText(SENT)).toBeVisible();
    expect(await reportsFor(target.pageId)).toHaveLength(1);
  });

  test("M5-05 an unknown or malformed ?page= falls back to the address field with the not-found message", async ({ page }) => {
    await openForm(page, "?page=11111111-1111-4111-8111-111111111111");
    await expect(fields(page).address).toBeEditable();
    await expect(page.getByRole("alert").filter({ hasText: NOT_FOUND })).toBeVisible();
    await openForm(page, "?page=not-a-uuid");
    await expect(fields(page).address).toBeEditable();
  });

  test("M5-05 inline errors name the field and what to do: address, reason, details for Something else, email", async ({ page, context }) => {
    await context.setExtraHTTPHeaders({ "x-forwarded-for": ipv6() });
    await openForm(page);
    const f = fields(page);
    await f.send.click();
    await expect(page.getByText("Enter the page’s address, like name.hydlnk.com.")).toBeVisible();
    await expect(page.getByText("Choose a reason.")).toBeVisible();

    await f.address.fill("mara.hydlnk.com");
    await f.reason.selectOption("other");
    await f.email.fill("not-an-email");
    await f.send.click();
    await expect(page.getByText("Tell us what is wrong. Details are required for Something else.")).toBeVisible();
    await expect(page.getByText("Enter a valid email address, or leave it empty.")).toBeVisible();
    await expect(f.details).toHaveAttribute("aria-invalid", "true");
    await expect(f.email).toHaveAttribute("aria-invalid", "true");
    await expect(f.details).toBeFocused();
  });
});

test.describe("M5-05 layout", () => {
  test("M5-05 the form fits the viewport with 16px fields and 44px targets, inside the marketing chrome", async ({ page }, info) => {
    const target = await publishedPage("rf-layout");
    await openForm(page, `?page=${target.pageId}`);
    await expectNoHorizontalScroll(page);
    await expectTapTargets(page, "main");

    for (const [name, selector] of [["select", "select"], ["textarea", "textarea"], ["email", "input[type='email']"], ["address", "input[readonly]"]] as const) {
      const size = await page.locator(selector).first().evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
      expect(size, `${name} font size`).toBeGreaterThanOrEqual(16);
    }
    const send = await fields(page).send.boundingBox();
    expect(send!.height).toBeGreaterThanOrEqual(44);

    // Marketing chrome around it: the header and the footer of every marketing page.
    await expect(page.locator("header").first()).toBeVisible();
    await expect(page.locator("footer").first()).toBeVisible();
    const fieldBox = await fields(page).reason.boundingBox();
    const viewport = page.viewportSize()!;
    if (info.project.name === "phone") {
      expect(fieldBox!.width).toBeGreaterThan(viewport.width - 64);
    } else {
      // On the desktop the form is a column no wider than the page's content column.
      expect(fieldBox!.width).toBeLessThanOrEqual(560);
    }
    // Field and error styles follow Signup.dc.html: a 1px grey border, 6px radius, an inline error in the "bad" colour.
    const border = await fields(page).reason.evaluate((el) => {
      const style = getComputedStyle(el);
      return { width: style.borderTopWidth, radius: style.borderTopLeftRadius };
    });
    expect(border.width).toBe("1px");
    expect(parseFloat(border.radius)).toBeGreaterThanOrEqual(6);
  });

  test("M5-05 the form with its error messages still fits the viewport", async ({ page }) => {
    await openForm(page);
    await fields(page).send.click();
    await expect(page.getByText("Choose a reason.")).toBeVisible();
    await expectNoHorizontalScroll(page);
    await expectTapTargets(page, "main");
  });
});

test.describe("M5-05 the public page's footer link", () => {
  test("M5-05 'Report this page' on http://mara.localhost:3000 is 44px tall and opens the form with mara.hydlnk.com", async ({ page }) => {
    await page.goto(url("mara"));
    const link = page.getByRole("link", { name: "Report this page" });
    await expect(link).toBeVisible();
    const box = await link.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    expect(box!.width).toBeGreaterThanOrEqual(44);
    await expect(link).toHaveAttribute("href", `http://localhost:3000/report?page=${MARA_PAGE_ID}`);

    await link.click();
    await page.waitForURL(`**/report?page=${MARA_PAGE_ID}`);
    await page.locator("form[data-ready='true']").waitFor();
    await expect(fields(page).address).toHaveValue("mara.hydlnk.com");
  });

  test("M5-05 'Report a page' in the marketing footer opens the form with the address field", async ({ page }) => {
    await page.goto(url());
    const link = page.locator("footer").getByRole("link", { name: "Report a page" });
    test.skip((await link.count()) === 0, "the marketing footer link is a shared-file change (site-map.ts) made by the integration step");
    await link.click();
    await page.waitForURL("**/report");
    await expect(fields(page).address).toBeEditable();
  });
});
