import { expect, test, type Page } from "@playwright/test";
import { pagesPerSiteItem, sitesText } from "@/lib/marketing/plan-limits";
import { axeViolations } from "../fixtures/a11y";
import { SHOWN_PRICES } from "../fixtures/prices";
import { expectNoHorizontalScroll, expectTapTargets, url } from "../helpers";

/**
 * Home page (M1-23 .. M1-27, redesigned in M11-01: HYDLNK as the frame, look stage in the hero,
 * how-it-works band, see-it carousel). Local dev server on
 * http://localhost:3000 (HL_DEV_PORT overrides), app host on http://app.localhost:<port>.
 * Run both projects: phone (390x844) and desktop (1440x900). The other marketing pages have
 * their own smoke spec (tests/e2e/marketing/site.spec.ts).
 */

const APP = url("app");
const SIGNUP = url("app", "/signup");
const LOGIN = url("app", "/login");

const INK = "rgb(28, 27, 26)";
const PAGE = "rgb(244, 243, 240)";
const WHITE = "rgb(255, 255, 255)";
const LINE = "rgb(226, 223, 217)";
const BRASS = "rgb(212, 162, 63)";
const ACCENT = "rgb(45, 91, 227)";

const PAGE_LINKS = [
  ["Features", "/features"],
  ["Design", "/design-control"],
  ["Domains", "/custom-domains"],
  ["Analytics", "/link-analytics"],
  ["Pricing", "/pricing"],
  ["Learn", "/learn"],
] as const;

async function open(page: Page, hash = "") {
  const response = await page.goto(url(null, `/${hash}`));
  expect(response?.status()).toBe(200);
  return response!;
}

/** The claim forms set data-ready once hydrated, so a click never races the submit handler. */
async function ready(page: Page) {
  await expect(page.locator("form[data-ready='true']")).toHaveCount(2);
}

/** Replaces the app host with a stub so hand-off tests assert the URL, not the signup page. */
async function stubAppHost(page: Page) {
  await page.route(`${APP}**`, (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: "<title>stub</title>stub" }),
  );
}

async function box(locator: ReturnType<Page["locator"]>) {
  const b = await locator.boundingBox();
  expect(b, "element should have a box").not.toBeNull();
  return b!;
}

test.describe("M1-23 header and hero", () => {
  test("M1-23 document: title, description, one h1, no cookies, no Supabase traffic", async ({
    page,
  }) => {
    const requests: string[] = [];
    page.on("request", (request) => requests.push(request.url()));
    const response = await open(page);
    await page.waitForLoadState("networkidle");

    await expect(page).toHaveTitle("HYDLNK — Link in bio, with real design control");
    await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", /.{20,}/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);

    const headers = await response.allHeaders();
    expect(headers["set-cookie"], "marketing host sets no cookie").toBeUndefined();
    expect((await page.context().cookies()).map((c) => c.name)).toEqual([]);
    expect(requests.filter((u) => /supabase|:54321/i.test(u))).toEqual([]);
    // Nothing on the page comes from another host.
    const origins = new Set(requests.map((u) => new URL(u).host));
    expect([...origins].filter((host) => !host.endsWith(`localhost:${new URL(APP).port}`))).toEqual(
      [],
    );
  });

  test("M1-23 header: charcoal bar, logo, page links, Log in and Claim your link", async ({
    page,
    isMobile,
  }) => {
    await open(page);
    const header = page.locator("header").first();
    await expect(header).toHaveCSS("background-color", INK);
    expect((await box(header)).height).toBeGreaterThanOrEqual(64);

    const inner = header.locator("> div").first();
    await expect(inner).toHaveCSS("max-width", "1200px");
    await expect(inner).toHaveCSS("padding-left", "24px");
    await expect(inner).toHaveCSS("padding-right", "24px");
    if (!isMobile) {
      const b = await box(inner);
      expect(b.x).toBeCloseTo(120, 0);
      expect(b.width).toBeCloseTo(1200, 0);
    }

    const logo = header.getByRole("link", { name: "HYDLNK" });
    await expect(logo).toHaveAttribute("href", "/");
    const diamond = logo.locator("span[aria-hidden='true']");
    await expect(diamond).toHaveCSS("width", "9px");
    await expect(diamond).toHaveCSS("height", "9px");
    await expect(diamond).toHaveCSS("background-color", BRASS);
    const wordmark = logo.getByText("HYDLNK", { exact: true });
    await expect(wordmark).toHaveCSS("font-size", "15px");
    await expect(wordmark).toHaveCSS("font-weight", "700");
    await expect(wordmark).toHaveCSS("letter-spacing", "2.1px");

    const nav = page.getByRole("navigation", { name: "Main" });
    const inline = nav.locator(":scope > ul");
    for (const [label, href] of PAGE_LINKS) {
      await expect(inline.locator("a", { hasText: label })).toHaveAttribute("href", href);
    }
    await expect(nav.getByRole("link", { name: "Log in" })).toHaveAttribute("href", LOGIN);
    const claim = nav.locator(":scope > a", { hasText: "Claim your link" });
    await expect(claim).toHaveAttribute("href", SIGNUP);
    for (const id of ["how-it-works", "demos", "see-it", "link-in-bio-for", "pricing", "faq"]) {
      await expect(page.locator(`#${id}`)).toHaveCount(1);
    }
  });

  test("M1-23 hero copy and the speed line; the UI stays in Public Sans", async ({
    page,
    isMobile,
  }) => {
    await open(page);
    const h1 = page.getByRole("heading", { level: 1 });
    await expect(h1).toHaveText("One link. Designed like it’s yours.");
    await expect(h1).toHaveCSS("font-weight", "700");
    if (!isMobile) await expect(h1).toHaveCSS("font-size", "60px");
    await expect(
      page.getByText("Claim your name in seconds, publish in minutes.", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Link in bio, with real design control", { exact: true }),
    ).toBeVisible();
    for (const target of [h1, page.getByRole("navigation", { name: "Main" })]) {
      const family = await target.evaluate((el) => getComputedStyle(el).fontFamily);
      expect(family).toMatch(/Public.?Sans/);
      expect(family).not.toMatch(/Instrument|Fraunces/);
    }
  });

  test("M11-01 the header is sticky", async ({ page }) => {
    await open(page);
    const header = page.locator("header").first();
    await expect(header).toHaveCSS("position", "sticky");
    await page.evaluate(() => window.scrollTo(0, 1500));
    await expect.poll(async () => (await box(header)).y).toBeLessThanOrEqual(1);
  });

  const hero = (page: Page) => page.locator(".sp-hero");
  const pageOf = (page: Page, id: string) => hero(page).locator(`.sp-phone-page[data-look="${id}"]`);

  test("M11-01 look tabs: picking one switches the checked radio and the visible stage page", async ({
    page,
  }) => {
    await open(page);
    await ready(page);
    const radios = hero(page).locator('input[name="sp-look"]');
    await expect(radios).toHaveCount(3);
    const ids = await radios.evaluateAll((els) => els.map((el) => (el as HTMLInputElement).value));
    await expect(radios.nth(0)).toBeChecked();
    await expect(pageOf(page, ids[0]!)).toBeVisible();
    await expect(pageOf(page, ids[1]!)).toBeHidden();

    await hero(page).locator(".sp-tab").nth(1).click();
    await expect(radios.nth(1)).toBeChecked();
    await expect(radios.nth(0)).not.toBeChecked();
    await expect(pageOf(page, ids[1]!)).toBeVisible();
    await expect(pageOf(page, ids[0]!)).toBeHidden();
    // HYDLNK's own frame does not restyle.
    await expect(page.getByRole("heading", { level: 1 })).toHaveCSS("font-weight", "700");
  });

  test("M11-01 the Pause control toggles to Play and back", async ({ page }) => {
    await open(page);
    const control = hero(page).locator(".sp-cycle");
    await expect(control).toBeVisible();
    await expect(control).toContainText("Pause");
    await control.click();
    await expect(control).toContainText("Play");
    await control.click();
    await expect(control).toContainText("Pause");
  });

  test("M11-01 phone layout: no horizontal scroll, 44px targets, copy above the form", async ({
    page,
    isMobile,
  }) => {
    test.skip(!isMobile, "phone project only");
    await open(page);
    await ready(page);
    await expectNoHorizontalScroll(page);
    await expectTapTargets(page);

    const nav = page.getByRole("navigation", { name: "Main" });
    await expect(nav.getByRole("link", { name: "Log in" })).toBeVisible();
    await expect(nav.locator(":scope > ul")).toHaveCSS("display", "none");
    const menu = nav.locator("summary[aria-label='Menu']");
    await expect(menu).toBeVisible();
    const menuBox = await box(menu);
    expect(Math.min(menuBox.width, menuBox.height)).toBeGreaterThanOrEqual(44);
    await menu.click();
    for (const [label, href] of PAGE_LINKS) {
      const link = nav.locator("details a", { hasText: label });
      await expect(link).toBeVisible();
      await expect(link).toHaveAttribute("href", href);
    }
    await page.keyboard.press("Escape");
    await expect(nav.locator("details")).toHaveJSProperty("open", false);

    const h1 = page.getByRole("heading", { level: 1 });
    expect(
      await h1.evaluate((el) => parseFloat(getComputedStyle(el).fontSize)),
    ).toBeGreaterThanOrEqual(38);
    const form = await box(page.locator("form").filter({ has: page.locator("#hero-handle") }));
    expect((await box(h1)).y).toBeLessThan(form.y);
  });

  test("M11-01 desktop layout: every nav item visible; headline left of the stage", async ({
    page,
    isMobile,
  }) => {
    test.skip(isMobile, "desktop project only");
    await open(page);
    await ready(page);
    await expectNoHorizontalScroll(page);
    await expectTapTargets(page);
    const nav = page.getByRole("navigation", { name: "Main" });
    for (const [name] of PAGE_LINKS)
      await expect(nav.getByRole("link", { name, exact: true })).toBeVisible();
    for (const name of ["Log in", "Claim your link"])
      await expect(nav.getByRole("link", { name })).toBeVisible();
    await expect(nav.locator("summary[aria-label='Menu']")).toBeHidden();
    const h1 = await box(page.getByRole("heading", { level: 1 }));
    const stage = await box(page.locator(".hm-stage"));
    expect(stage.x).toBeGreaterThan(h1.x + h1.width / 2);
  });
});

test.describe("M11-01 see it in action (#see-it)", () => {
  test("twelve setups, each linking to an audience page; Next and Previous move the carousel", async ({
    page,
  }) => {
    await open(page);
    const section = page.locator("#see-it");
    await section.scrollIntoViewIfNeeded();
    await expect(section.locator(".sc-slide")).toHaveCount(12);
    const hrefs = await section
      .locator(".sc-setup-link")
      .evaluateAll((els) => els.map((el) => el.getAttribute("href")));
    expect(hrefs).toHaveLength(12);
    for (const href of hrefs) expect(href).toMatch(/^\/link-in-bio\/[a-z0-9-]+$/);

    const scroller = section.locator(".sc-scroller");
    const previous = section.getByRole("button", { name: "Previous setups" });
    const next = section.getByRole("button", { name: "Next setups" });
    // Previous is disabled at the start, set by the carousel's own code once it has hydrated.
    await expect(previous).toHaveJSProperty("disabled", true);
    await expect(next).toBeEnabled();
    expect(await scroller.evaluate((el) => el.scrollLeft)).toBeLessThanOrEqual(2);

    await next.click();
    await expect.poll(() => scroller.evaluate((el) => el.scrollLeft)).toBeGreaterThan(50);
    await expect(previous).toBeEnabled();
    await previous.click();
    await expect.poll(() => scroller.evaluate((el) => el.scrollLeft)).toBeLessThanOrEqual(2);
    await expect(previous).toHaveJSProperty("disabled", true);
  });
});

test.describe("M1-24 claim form hands off to app signup", () => {
  test("M1-24 form anatomy: label, input, suffix, button, container", async ({ page }) => {
    await open(page);
    const input = page.locator("#hero-handle");
    const form = page.locator("form").filter({ has: input });
    // The label is visible: it is the first thing the claim panel says.
    const label = page.locator("label[for='hero-handle']");
    await expect(label).toHaveText("Choose your handle");
    await expect(label).toBeVisible();
    expect((await box(label)).width).toBeGreaterThan(100);
    await expect(input).toHaveAttribute("placeholder", "you");
    await expect(input).toHaveAttribute("autocomplete", "off");
    await expect(input).toHaveAttribute("spellcheck", "false");
    await expect(input).toHaveCSS("font-size", "18px");
    expect(await input.evaluate((el) => getComputedStyle(el).fontFamily)).toMatch(/Geist.?Mono/);
    await expect(form.getByText(".hydlnk.com", { exact: true })).toBeVisible();

    // The field is white and the button is brass, both on a charcoal panel: the loudest thing on
    // the first screen. (DESIGN.md: a brass primary is for charcoal backgrounds.)
    const field = input.locator("..");
    await expect(field).toHaveCSS("background-color", WHITE);
    expect(Math.round((await box(field)).height)).toBe(56);
    const button = form.getByRole("button", { name: "Claim it" });
    await expect(button).toHaveCSS("background-color", ACCENT);
    await expect(button).toHaveCSS("color", WHITE);
    await expect(button).toHaveCSS("border-top-left-radius", "4px");
    expect(Math.round((await box(button)).height)).toBe(56);

    await expect(form).toHaveCSS("background-color", INK);
    await expect(form).toHaveCSS("border-top-left-radius", "6px");
    await expect(form).toHaveCSS("max-width", "520px");
    expect((await box(form)).width).toBeLessThanOrEqual(520.5);
  });

  test("M1-24 the line under the field says what the name becomes, and never claims it is free", async ({
    page,
  }) => {
    await open(page);
    await ready(page);
    const input = page.locator("#hero-handle");
    const hint = page.locator(`[id='${(await input.getAttribute("aria-describedby"))!}']`);
    await expect(hint).toHaveText("Free forever. No card required.");
    for (const [typed, message, invalid] of [
      ["wr", "Use at least 3 letters, numbers or dashes.", false],
      ["wren", "Next, we check that it’s available.", false],
      ["Wren_Haven", "We’ll use wrenhaven.hydlnk.com.", false],
      ["-wren", "Handles can’t start or end with a dash.", true],
      ["a".repeat(31), "Handles can be up to 30 characters.", true],
    ] as const) {
      await input.fill(typed);
      await expect(hint).toHaveText(message);
      if (invalid) await expect(input).toHaveAttribute("aria-invalid", "true");
      else await expect(input).not.toHaveAttribute("aria-invalid", "true");
      await expect(hint).not.toHaveText(/is available|is free|taken/);
    }
    await input.fill("");
    await expect(hint).toHaveText("Free forever. No card required.");
  });

  test("M1-24 the claim form keeps its charcoal panel colors inside a long-form guide", async ({
    page,
  }) => {
    await page.goto(url(null, "/learn/choosing-a-handle"));
    const input = page.locator("#guide-handle");
    const form = page.locator("form").filter({ has: input });
    await expect(form).toHaveCSS("background-color", INK);
    const hint = page.locator(`[id='${(await input.getAttribute("aria-describedby"))!}']`);
    // The guide's prose styles color every paragraph grey; the hint must stay readable on charcoal.
    await expect(hint).toHaveCSS("color", "rgb(185, 180, 171)");
    await expect(form.getByRole("button", { name: "Claim it" })).toHaveCSS(
      "background-color",
      ACCENT,
    );
  });

  test("M1-24 the claim field is on the first screen, and submitting it carries the handle to sign-up", async ({
    page,
  }) => {
    await open(page);
    await ready(page);
    await stubAppHost(page);
    const viewport = page.viewportSize()!;
    const input = page.locator("#hero-handle");
    const form = page.locator("form").filter({ has: input });
    // No scrolling: the whole claim panel, button included, is inside the first screen.
    const panel = await box(form);
    expect(panel.y).toBeGreaterThanOrEqual(0);
    expect(panel.y + panel.height).toBeLessThanOrEqual(viewport.height);
    await expect(input).toBeInViewport({ ratio: 1 });
    await expect(form.getByRole("button", { name: "Claim it" })).toBeInViewport({ ratio: 1 });

    await input.fill("Wren_Haven");
    await form.getByRole("button", { name: "Claim it" }).click();
    await page.waitForURL(`${SIGNUP}?handle=wrenhaven`, { waitUntil: "commit" });
  });

  test("M1-24 typing Wren_Haven and clicking Claim it lands on a normalized signup URL", async ({
    page,
  }) => {
    await stubAppHost(page);
    await open(page);
    await ready(page);
    await page.locator("#hero-handle").fill("Wren_Haven");
    await page
      .locator("form")
      .filter({ has: page.locator("#hero-handle") })
      .getByRole("button", { name: "Claim it" })
      .click();
    await page.waitForURL(`${SIGNUP}?handle=wrenhaven`, { waitUntil: "commit" });
    expect(new URL(page.url()).searchParams.size).toBe(1);
  });

  test("M1-24 pressing Enter submits; an empty field goes to /signup with no parameter", async ({
    page,
  }) => {
    await stubAppHost(page);
    await open(page);
    await ready(page);
    await page.locator("#hero-handle").fill("Wren_Haven");
    await page.locator("#hero-handle").press("Enter");
    await page.waitForURL(`${SIGNUP}?handle=wrenhaven`, { waitUntil: "commit" });

    await open(page);
    await ready(page);
    await page
      .locator("form")
      .filter({ has: page.locator("#hero-handle") })
      .getByRole("button", { name: "Claim it" })
      .click();
    await page.waitForURL(SIGNUP, { waitUntil: "commit" });
    expect(page.url()).toBe(SIGNUP);
  });

  test("M1-24 without JavaScript the form is a plain GET to the app host", async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.route(`${APP}**`, (route) =>
      route.fulfill({ status: 200, contentType: "text/html", body: "stub" }),
    );
    await page.goto(url());
    await page.locator("#hero-handle").fill("wren");
    await page.locator("#hero-handle").press("Enter");
    await page.waitForURL(`${SIGNUP}?handle=wren`, { waitUntil: "commit" });

    await page.goto(url());
    await page.locator("#hero-handle").fill("Wren_Haven");
    await page.locator("#hero-handle").press("Enter");
    // Raw value as typed: the signup page normalizes it.
    await page.waitForURL(`${SIGNUP}?handle=Wren_Haven`, { waitUntil: "commit" });
    await context.close();
  });

  test("M1-24 a 35-character value is handed off whole and signup shows its limit state", async ({
    page,
  }) => {
    const long = "a".repeat(35);
    await open(page);
    await ready(page);
    await page.locator("#hero-handle").fill(long);
    await expect(page.locator("#hero-handle")).toHaveValue(long);
    await page.locator("#hero-handle").press("Enter");
    await page.waitForURL(`${SIGNUP}?handle=${long}`, { waitUntil: "commit" });
    // Owned by the signup page (auth agent): its too-long state.
    await expect(page.getByText("Handles can be up to 30 characters.")).toBeVisible();
  });

  test("M1-24 the CTA band form (#cta-handle) behaves the same", async ({ page }) => {
    await stubAppHost(page);
    await open(page);
    await ready(page);
    const cta = page.locator("#cta-handle");
    await expect(page.locator("label[for='cta-handle']")).toHaveText("Choose your handle");
    await cta.fill("wren");
    await cta.press("Enter");
    await page.waitForURL(`${SIGNUP}?handle=wren`, { waitUntil: "commit" });

    await open(page);
    await ready(page);
    await page.locator("#cta-handle").fill("Wren_Haven");
    await page
      .locator("form")
      .filter({ has: page.locator("#cta-handle") })
      .getByRole("button", { name: "Claim it" })
      .click();
    await page.waitForURL(`${SIGNUP}?handle=wrenhaven`, { waitUntil: "commit" });
  });

  test("M1-24 the nav link carries a handle already typed in the hero form", async ({
    page,
    isMobile,
  }) => {
    test.skip(isMobile, "the nav claim link is desktop only");
    await stubAppHost(page);
    await open(page);
    await ready(page);
    await page.locator("#hero-handle").fill("Wren_Haven");
    await page
      .getByRole("navigation", { name: "Main" })
      .getByRole("link", { name: "Claim your link" })
      .click();
    await page.waitForURL(`${SIGNUP}?handle=wrenhaven`, { waitUntil: "commit" });
  });

  test("M1-24 phone layout: Claim it on its own full-width row, input 16px", async ({
    page,
    isMobile,
  }) => {
    test.skip(!isMobile, "phone project only");
    await open(page);
    await expectNoHorizontalScroll(page);
    await expectTapTargets(page);
    for (const id of ["hero-handle", "cta-handle"]) {
      const input = page.locator(`#${id}`);
      const form = page.locator("form").filter({ has: input });
      const inputBox = await box(input);
      const buttonBox = await box(form.getByRole("button", { name: "Claim it" }));
      const formBox = await box(form);
      expect(buttonBox.y).toBeGreaterThanOrEqual(inputBox.y + inputBox.height - 1);
      // The hero's panel pads the button by 16px a side; the band's form has no panel.
      expect(buttonBox.width).toBeGreaterThan(formBox.width - 36);
      expect(buttonBox.height).toBeGreaterThanOrEqual(44);
      expect(
        await input.evaluate((el) => parseFloat(getComputedStyle(el).fontSize)),
      ).toBeGreaterThanOrEqual(16);
    }
  });

  test("M1-24 desktop layout: input, suffix and button share one row", async ({
    page,
    isMobile,
  }) => {
    test.skip(isMobile, "desktop project only");
    await open(page);
    for (const id of ["hero-handle", "cta-handle"]) {
      const input = page.locator(`#${id}`);
      const form = page.locator("form").filter({ has: input });
      const inputBox = await box(input);
      const suffixBox = await box(form.getByText(".hydlnk.com", { exact: true }));
      const buttonBox = await box(form.getByRole("button", { name: "Claim it" }));
      const centers = [inputBox, suffixBox, buttonBox].map((b) => b.y + b.height / 2);
      expect(Math.max(...centers) - Math.min(...centers)).toBeLessThan(4);
      expect((await box(form)).width).toBeLessThanOrEqual(520.5);
    }
  });
});

test.describe("M1-25 how it works, demos, tokens, blocks, domain and analytics", () => {
  test("M1-25 #how-it-works: three steps, each with a guide link", async ({ page }) => {
    await open(page);
    const section = page.locator("#how-it-works");
    await expect(section.getByRole("heading", { level: 3 })).toHaveText([
      "Claim your name",
      "Build it with blocks",
      "Style it, then publish",
    ]);
    const links = section.getByRole("link");
    await expect(links).toHaveCount(3);
    for (const href of await links.evaluateAll((els) => els.map((el) => el.getAttribute("href")))) {
      expect(href).toMatch(/^\/learn\//);
    }
  });

  test("M1-25 #demos: three portraits with decorative demo phones for fictional brands", async ({
    page,
  }) => {
    await open(page);
    const figures = page.locator("#demos figure");
    await expect(figures).toHaveCount(3);
    for (const figure of await figures.all()) {
      const phone = figure.locator(".hm-person-phone");
      await expect(phone).toHaveAttribute("aria-hidden", "true");
      expect(await phone.locator("a, button, input, select, textarea").count()).toBe(0);
      await expect(figure.locator("figcaption")).toContainText("demo");
    }
    expect(await page.content()).not.toMatch(/Mara Okafor/);
  });

  test("M1-25 domain and analytics cards: example record and sample numbers", async ({ page }) => {
    await open(page);
    const domain = page
      .getByRole("heading", { level: 3, name: "Your domain, not ours." })
      .locator("xpath=..");
    await expect(domain.getByText("Pro", { exact: true })).toBeVisible();
    await expect(domain.getByText("CNAME", { exact: true })).toBeVisible();
    // The real CNAME target comes from the editor (per project), never from marketing copy.
    await expect(domain.getByText("shown in your editor", { exact: true })).toBeVisible();
    await expect(domain.getByText("Example record", { exact: true })).toBeVisible();
    const status = domain.getByText("Verified · SSL issued", { exact: true });
    await expect(status.locator("xpath=..")).toHaveCSS("background-color", "rgb(231, 243, 236)");
    await expect(status).toHaveCSS("color", "rgb(43, 116, 72)");
    await expect(domain.getByRole("link", { name: "How custom domains work" })).toHaveAttribute(
      "href",
      "/custom-domains",
    );

    const analytics = page
      .getByRole("heading", { level: 3, name: "Analytics that answer something." })
      .locator("xpath=..");
    for (const value of ["Every plan", "1,284", "902", "688", "Sample numbers"]) {
      await expect(analytics.getByText(value, { exact: true })).toBeVisible();
    }
  });

  test("M1-25 sections: white and #F4F3F0 bands, the how-it-works and CTA bands charcoal", async ({
    page,
  }) => {
    await open(page);
    const sections = page.locator("main > section");
    const backgrounds = await sections.evaluateAll((els) =>
      els.map((el) => getComputedStyle(el).backgroundColor),
    );
    expect(backgrounds).toEqual([WHITE, INK, WHITE, PAGE, WHITE, PAGE, WHITE, PAGE, INK]);
    for (const id of ["demos", "see-it", "link-in-bio-for", "pricing", "faq"]) {
      await expect(page.locator(`#${id} > div`).first()).toHaveCSS("max-width", "1200px");
    }
  });

  test("M1-25 phone layout: no overflow, 44px targets, single-column steps and plans", async ({
    page,
    isMobile,
  }) => {
    test.skip(!isMobile, "phone project only");
    await open(page);
    await ready(page);
    await expectNoHorizontalScroll(page);
    await expectTapTargets(page);
    const columns = await page.evaluate(() => {
      const count = (el: Element | null) =>
        el ? getComputedStyle(el).gridTemplateColumns.split(" ").length : 0;
      return {
        steps: count(document.querySelector("#how-it-works ol")),
        plans: count(document.querySelector("[data-plan-cards]")),
      };
    });
    expect(columns).toEqual({ steps: 1, plans: 1 });
  });

  test("M1-25 desktop layout: three steps in a row, cards side by side", async ({
    page,
    isMobile,
  }) => {
    test.skip(isMobile, "desktop project only");
    await open(page);
    await ready(page);
    await expectNoHorizontalScroll(page);
    await expectTapTargets(page);
    const ys = new Set<number>();
    for (const item of await page.locator("#how-it-works ol > li").all())
      ys.add(Math.round((await box(item)).y));
    expect(ys.size).toBe(1);
    const domain = await box(
      page.getByRole("heading", { level: 3, name: "Your domain, not ours." }),
    );
    const analytics = await box(
      page.getByRole("heading", { level: 3, name: "Analytics that answer something." }),
    );
    expect(analytics.x).toBeGreaterThan(domain.x + 200);
    expect(Math.abs(analytics.y - domain.y)).toBeLessThan(4);
  });
});

test.describe("M1-26 pricing", () => {
  const card = (page: Page, name: string) =>
    page
      .locator("#pricing")
      .getByRole("heading", { level: 3, name, exact: true })
      .locator("xpath=../../..");

  test("M1-26 heading and three cards in order with the PLAN v1 lists", async ({ page }) => {
    await open(page);
    const pricing = page.locator("#pricing");
    await expect(pricing.getByText("Pricing", { exact: true })).toBeVisible();
    await expect(
      pricing.getByRole("heading", { level: 2, name: "Design is never the paywall." }),
    ).toBeVisible();
    await expect(
      pricing.getByText(
        "We never take a cut of your sales, on any plan. Cancel anytime from your billing portal.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(pricing.getByRole("heading", { level: 3 })).toHaveText(["Free", "Pro", "Studio"]);
    const lists = async (name: string) =>
      (await card(page, name).locator("li").allTextContents()).map((t) => t.trim());

    // Yearly is the default view. innerText is what is on screen: the monthly price sits in the
    // DOM too, hidden by CSS, and textContent would see it.
    const shown = { useInnerText: true };
    // The amounts come from the one price table (src/lib/billing/prices.ts), never spelled here.
    await expect(card(page, "Free")).toContainText(SHOWN_PRICES.free, shown);
    await expect(card(page, "Free")).toContainText("forever", shown);
    await expect(card(page, "Pro")).toContainText(SHOWN_PRICES.yearlyHeadline("pro"), shown);
    await expect(card(page, "Pro")).toContainText(SHOWN_PRICES.yearlyNote("pro"), shown);
    await expect(card(page, "Pro")).not.toContainText(SHOWN_PRICES.monthlyAmount("pro"), shown);
    await expect(card(page, "Studio")).toContainText(SHOWN_PRICES.yearlyHeadline("studio"), shown);
    await expect(card(page, "Studio")).toContainText(SHOWN_PRICES.yearlyNote("studio"), shown);
    await expect(card(page, "Studio")).not.toContainText(
      SHOWN_PRICES.monthlyAmount("studio"),
      shown,
    );

    expect(await lists("Free")).toEqual([
      sitesText("free"),
      pagesPerSiteItem("free"),
      "Every block, theme and design option",
      "3 saved themes",
      "you.hydlnk.com",
      "Per-link clicks, last 30 days",
      "10 MB of uploads",
      "–Version history",
      "–Redirect mode",
      "–Small “Made with HYDLNK” badge",
    ]);
    expect(await lists("Pro")).toEqual([
      "Everything in Free, plus",
      "1 custom domain you own, with automatic SSL",
      sitesText("pro"),
      pagesPerSiteItem("pro"),
      "No badge",
      "Unlimited saved themes",
      "1 year of analytics with referrers, devices and countries",
      "Redirect mode: send visitors straight to one link",
      "100 MB of uploads",
      "Version history, last 25 versions",
    ]);
    expect(await lists("Studio")).toEqual([
      "Everything in Pro, plus",
      `${sitesText("studio")} and 15 custom domains you own`,
      pagesPerSiteItem("studio"),
      "Themes shared across sites",
      "1 GB of uploads",
    ]);

    await expect(card(page, "Pro")).toHaveCSS("border-top-color", INK);
    await expect(card(page, "Pro").getByText("Recommended", { exact: true })).toHaveCSS(
      "background-color",
      INK,
    );
    await expect(card(page, "Free")).toHaveCSS("border-top-color", "rgb(217, 214, 208)");
    await expect(card(page, "Studio")).toHaveCSS("border-top-color", "rgb(217, 214, 208)");
    await expect(pricing.getByRole("link", { name: "Compare plans" })).toHaveAttribute(
      "href",
      "/pricing",
    );
  });

  test("M1-26 scope guard: nothing out of v1 anywhere on the page", async ({ page }) => {
    await open(page);
    expect(await page.content()).not.toMatch(/scheduled posts|scheduling|csv|invite editors|team access|custom css/i);
  });

  test("M1-26 CTA buttons go to app signup and are at least 44px tall", async ({ page }) => {
    await open(page);
    for (const name of ["Start free", "Go Pro", "Start Studio"]) {
      const link = page.locator("#pricing").getByRole("link", { name, exact: true });
      await expect(link).toHaveAttribute("href", SIGNUP);
      expect((await box(link)).height).toBeGreaterThanOrEqual(44);
    }
  });

  test("M1-26 phone layout: one column in order, full-width buttons", async ({
    page,
    isMobile,
  }) => {
    test.skip(!isMobile, "phone project only");
    await open(page, "#pricing");
    await expectNoHorizontalScroll(page);
    const ys: number[] = [];
    const xs = new Set<number>();
    for (const name of ["Free", "Pro", "Studio"]) {
      const b = await box(
        page.locator("#pricing").getByRole("heading", { level: 3, name, exact: true }),
      );
      ys.push(b.y);
      xs.add(Math.round(b.x));
    }
    expect(ys[0]).toBeLessThan(ys[1]!);
    expect(ys[1]).toBeLessThan(ys[2]!);
    expect(xs.size).toBe(1);
    for (const name of ["Start free", "Go Pro", "Start Studio"]) {
      const link = page.locator("#pricing").getByRole("link", { name, exact: true });
      expect((await box(link)).width).toBeGreaterThan(
        (await box(link.locator("xpath=../.."))).width - 60,
      );
    }
  });

  test("M1-26 desktop layout: three equal-height columns in the 1200px container", async ({
    page,
    isMobile,
  }) => {
    test.skip(isMobile, "desktop project only");
    await open(page, "#pricing");
    const [free, pro, studio] = await Promise.all(
      ["Free", "Pro", "Studio"].map((name) => box(card(page, name))),
    );
    expect(free!.x).toBeLessThan(pro!.x);
    expect(pro!.x).toBeLessThan(studio!.x);
    expect(Math.abs(free!.height - pro!.height)).toBeLessThan(1);
    expect(Math.abs(pro!.height - studio!.height)).toBeLessThan(1);
    expect(studio!.x + studio!.width - free!.x).toBeLessThanOrEqual(1200.5);
  });
});

test.describe("M1-27 questions, CTA band and footer", () => {
  test("M1-27 FAQ: details items, first open, click Enter and Space toggle", async ({ page }) => {
    await open(page, "#faq");
    const faq = page.locator("#faq");
    await expect(faq.getByRole("heading", { level: 2, name: "Questions" })).toBeVisible();
    const items = faq.locator("details");
    await expect(items.locator("summary")).toHaveText([
      /Is the free plan actually free\?/,
      /What is a handle\?/,
      /How much of my page’s look can I change\?/,
      /How do custom domains work\?/,
      /Does my page use cookies\?/,
      /Do you take a cut of sales\?/,
    ]);
    await expect(items.nth(0)).toHaveJSProperty("open", true);
    await expect(items.nth(0)).toContainText("no time limit and no card on file");
    for (let i = 1; i < 6; i += 1) await expect(items.nth(i)).toHaveJSProperty("open", false);
    for (let i = 0; i < 6; i += 1) {
      const summary = items.nth(i).locator("summary");
      expect((await box(summary)).height).toBeGreaterThanOrEqual(44);
      await expect(summary).toContainText("+");
    }
    const second = items.nth(1);
    await second.locator("summary").click();
    await expect(second).toHaveJSProperty("open", true);
    await second.locator("summary").click();
    await expect(second).toHaveJSProperty("open", false);
    const third = items.nth(2);
    await third.locator("summary").focus();
    await page.keyboard.press("Enter");
    await expect(third).toHaveJSProperty("open", true);
    await page.keyboard.press("Enter");
    await expect(third).toHaveJSProperty("open", false);
    await page.keyboard.press("Space");
    await expect(third).toHaveJSProperty("open", true);
    await expect(faq.getByRole("link", { name: "All questions" })).toHaveAttribute("href", "/faq");
  });

  test("M1-27 CTA band: charcoal, dark form variant, note", async ({ page, isMobile }) => {
    await open(page);
    const band = page.locator("main > section").last();
    await expect(band).toHaveCSS("background-color", INK);
    const h2 = band.getByRole("heading", {
      level: 2,
      name: "Claim your name before someone else does.",
    });
    await expect(h2).toBeVisible();
    const size = await h2.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    if (isMobile) expect(size).toBeGreaterThanOrEqual(30);
    else expect(size).toBe(48);
    await expect(h2).toHaveCSS("text-align", "center");
    const form = page.locator("form").filter({ has: page.locator("#cta-handle") });
    // Same white field and brass button as the hero; the band itself is the charcoal panel.
    await expect(form).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await expect(page.locator("#cta-handle").locator("..")).toHaveCSS("background-color", WHITE);
    await expect(page.locator("#cta-handle")).toHaveCSS("color", INK);
    await expect(form.getByText(".hydlnk.com", { exact: true })).toHaveCSS(
      "color",
      "rgb(94, 90, 84)",
    );
    const button = form.getByRole("button", { name: "Claim it" });
    await expect(button).toHaveCSS("background-color", ACCENT);
    await expect(button).toHaveCSS("color", WHITE);
    await expect(
      band.getByText("Free forever. Upgrade only when you want your own domain.", { exact: true }),
    ).toBeVisible();
  });

  test("M1-27 footer: brand, copyright, page links, Privacy and Terms", async ({
    page,
    isMobile,
  }) => {
    await open(page);
    const footer = page.locator("footer");
    await expect(footer).toHaveCSS("background-color", WHITE);
    await expect(footer).toHaveCSS("border-top-width", "1px");
    await expect(footer).toHaveCSS("border-top-color", LINE);
    const diamond = footer.locator("span[aria-hidden='true']").first();
    await expect(diamond).toHaveCSS("width", "8px");
    await expect(diamond).toHaveCSS("background-color", BRASS);
    await expect(footer.getByText("HYDLNK", { exact: true })).toBeVisible();
    await expect(
      footer.getByText(`© ${new Date().getFullYear()} HYDLNK`, { exact: true }),
    ).toBeVisible();

    const nav = page.getByRole("navigation", { name: "Footer" });
    for (const [name, path] of [
      ["Privacy", "/privacy"],
      ["Terms", "/terms"],
      ["Pricing", "/pricing"],
      ["FAQ", "/faq"],
    ] as const) {
      const link = nav.getByRole("link", { name, exact: true });
      expect(await link.evaluate((a) => (a as HTMLAnchorElement).href)).toBe(url(null, path));
      const b = await box(link);
      expect(Math.min(b.width, b.height)).toBeGreaterThanOrEqual(44);
    }
    if (!isMobile) {
      const brand = await box(footer.getByText("HYDLNK", { exact: true }));
      const privacy = await box(nav.getByRole("link", { name: "Privacy" }));
      expect(privacy.x).toBeGreaterThan(brand.x + 600);
    }
  });

  test("M1-27 heading outline has no skipped levels", async ({ page }) => {
    await open(page);
    // The try-it phone shows a real page, which has its own name (h1) and headings; it is a picture
    // of a page (inert, hidden from assistive technology), not part of this page's outline.
    const levels = await page
      .locator("h1, h2, h3, h4, h5, h6")
      .evaluateAll((els) =>
        els
          .filter((el) => !el.closest("[data-page-root]"))
          .map((el) => Number(el.tagName.slice(1))),
      );
    expect(levels[0]).toBe(1);
    expect(levels.filter((level) => level === 1)).toHaveLength(1);
    for (let i = 1; i < levels.length; i += 1) {
      expect(levels[i]!, `heading ${i} follows level ${levels[i - 1]}`).toBeLessThanOrEqual(
        levels[i - 1]! + 1,
      );
    }
    expect(Math.max(...levels)).toBe(3);
  });

  test("M1-27 axe-core finds no serious or critical violations", async ({ page }) => {
    await open(page);
    await ready(page);
    // The invented brands inside the demo phones are not HYDLNK's UI; they are excluded here.
    const violations = (await axeViolations(page)).filter((v) => !v.includes(".sc-slide"));
    expect(violations, JSON.stringify(violations, null, 1)).toEqual([]);
  });

  test("M1-27 phone layout at #faq: no overflow, 44px targets, band button on its own row", async ({
    page,
    isMobile,
  }) => {
    test.skip(!isMobile, "phone project only");
    await open(page, "#faq");
    await expectNoHorizontalScroll(page);
    await expectTapTargets(page);
    const input = page.locator("#cta-handle");
    const form = page.locator("form").filter({ has: input });
    const button = await box(form.getByRole("button", { name: "Claim it" }));
    const inputBox = await box(input);
    expect(button.y).toBeGreaterThanOrEqual(inputBox.y + inputBox.height - 1);
    expect(button.width).toBeGreaterThan((await box(form)).width - 24);
    for (const link of await page
      .getByRole("navigation", { name: "Footer" })
      .getByRole("link")
      .all()) {
      const b = await box(link);
      expect(b.x + b.width).toBeLessThanOrEqual(390);
    }
  });

  test("M1-27 desktop layout: one FAQ column, 500px band form", async ({ page, isMobile }) => {
    test.skip(isMobile, "desktop project only");
    await open(page, "#faq");
    const xs = new Set<number>();
    const widths = new Set<number>();
    for (const item of await page.locator("#faq details").all()) {
      const b = await box(item);
      xs.add(Math.round(b.x));
      widths.add(Math.round(b.width));
    }
    expect(xs.size).toBe(1);
    expect(widths.size).toBe(1);
    expect([...widths][0]!).toBeLessThanOrEqual(900);
    const form = page.locator("form").filter({ has: page.locator("#cta-handle") });
    expect((await box(form)).width).toBeLessThanOrEqual(520.5);
  });
});
