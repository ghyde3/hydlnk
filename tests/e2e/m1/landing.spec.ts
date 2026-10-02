import { expect, test, type Page } from "@playwright/test";
import { formatFreePrice, formatLandingPrice, lowestPaidPerMonth } from "@/lib/billing/prices";
import { axeViolations } from "../fixtures/a11y";
import { expectNoHorizontalScroll, expectTapTargets, url } from "../helpers";

/**
 * Landing page (M1-23 .. M1-27). Local dev server on http://localhost:3000, app host on
 * http://app.localhost:3000. Run both projects: phone (390x844) and desktop (1440x900).
 */

const APP = url("app");
const SIGNUP = url("app", "/signup");
const LOGIN = url("app", "/login");

const INK = "rgb(28, 27, 26)";
const PAGE = "rgb(244, 243, 240)";
const WHITE = "rgb(255, 255, 255)";
const LINE = "rgb(226, 223, 217)";

/** Scripts, waits and measurements shared by every describe below. */

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

test.describe("M1-23 landing header and hero", () => {
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
  });

  test("M1-23 header: charcoal bar, logo, nav links and their targets", async ({
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
    await expect(logo).toHaveAttribute("href", "#top");
    const diamond = logo.locator("span[aria-hidden='true']");
    // Rotated 45deg, so the bounding box is wider than the 9px square.
    await expect(diamond).toHaveCSS("width", "9px");
    await expect(diamond).toHaveCSS("height", "9px");
    await expect(diamond).toHaveCSS("background-color", "rgb(184, 145, 79)");
    const wordmark = logo.getByText("HYDLNK", { exact: true });
    await expect(wordmark).toHaveCSS("font-size", "15px");
    await expect(wordmark).toHaveCSS("font-weight", "700");
    await expect(wordmark).toHaveCSS("letter-spacing", "2.1px");

    const nav = page.getByRole("navigation", { name: "Main" });
    for (const [label, hash] of [
      ["Features", "#features"],
      ["Pricing", "#pricing"],
      ["FAQ", "#faq"],
    ] as const) {
      // Located by text: below 760px these links are display:none and leave the role tree.
      await expect(nav.locator("a", { hasText: label })).toHaveAttribute("href", hash);
    }
    await expect(nav.getByRole("link", { name: "Log in" })).toHaveAttribute("href", LOGIN);
    const claim = nav.locator("a", { hasText: "Claim your link" });
    await expect(claim).toHaveAttribute("href", SIGNUP);
    await expect(claim).toHaveCSS("background-color", "rgb(184, 145, 79)");
    await expect(claim).toHaveCSS("color", INK);
    // Section targets exist.
    for (const id of ["top", "features", "pricing", "faq"]) {
      await expect(page.locator(`#${id}`)).toHaveCount(1);
    }
  });

  test("M1-23 hero copy, fonts and brass accent", async ({ page, isMobile }) => {
    await open(page);
    const eyebrow = page.getByText("Link in bio, with real design control", { exact: true });
    await expect(eyebrow).toHaveCSS("font-size", "12px");
    await expect(eyebrow).toHaveCSS("text-transform", "uppercase");
    await expect(eyebrow).toHaveCSS("border-top-width", "1px");
    await expect(eyebrow).toHaveCSS("border-top-color", LINE);
    await expect(eyebrow).toHaveCSS("border-top-left-radius", "4px");
    expect(await eyebrow.evaluate((el) => getComputedStyle(el).fontFamily)).toMatch(/Geist.?Mono/);

    const h1 = page.getByRole("heading", { level: 1 });
    await expect(h1).toHaveText("One link. Designed like it’s yours.");
    await expect(h1.locator("span")).toHaveText("it’s yours.");
    await expect(h1.locator("span")).toHaveCSS("color", "rgb(132, 104, 57)");
    await expect(h1).toHaveCSS("font-weight", "700");
    if (!isMobile) await expect(h1).toHaveCSS("font-size", "60px");

    await expect(
      page.getByText(
        "Block layouts, a full theme system and your own domain — so your link page looks like your brand, not ours.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      page.getByText(
        `Free forever · No card required · Custom domains from ${lowestPaidPerMonth()}`,
        { exact: true },
      ),
    ).toBeVisible();

    // Instrument Serif lives only inside the phone mock.
    for (const target of [h1, page.getByRole("navigation", { name: "Main" })]) {
      const family = await target.evaluate((el) => getComputedStyle(el).fontFamily);
      expect(family).toMatch(/Public.?Sans/);
      expect(family).not.toMatch(/Instrument/);
    }
    const name = page.getByText("Mara Okafor", { exact: true });
    expect(await name.evaluate((el) => getComputedStyle(el).fontFamily)).toMatch(
      /Instrument.?Serif/,
    );
  });

  test("M1-23 hero phone mock: 290x600, decorative, no interactive content", async ({ page }) => {
    await open(page);
    const mock = page.locator('[aria-hidden="true"]').filter({ hasText: "Mara Okafor" });
    await expect(mock).toHaveCount(1);
    const b = await box(mock);
    expect(Math.round(b.width)).toBe(290);
    expect(Math.round(b.height)).toBe(600);
    await expect(mock).toHaveCSS("background-color", INK);
    for (const text of [
      "MO",
      "Mara Okafor",
      "Portrait & studio photographer",
      "Portrait sessions — fall dates",
      "Studio rental by the hour",
      "Prints & archive",
      "Night Market",
      "New series — view the gallery",
    ]) {
      await expect(mock.getByText(text, { exact: true })).toHaveCount(1);
    }
    expect(await mock.locator("a, button, input, select, textarea, [tabindex]").count()).toBe(0);
    // Four social circles (26px), the filled button and the two outlined ones.
    expect(
      await mock
        .locator("span")
        .evaluateAll((els) => els.filter((el) => el.getBoundingClientRect().width === 26).length),
    ).toBe(4);
    await expect(mock.getByText("Portrait sessions — fall dates")).toHaveCSS(
      "background-color",
      "rgb(201, 168, 106)",
    );
    for (const outlined of ["Studio rental by the hour", "Prints & archive"]) {
      const button = mock.getByText(outlined, { exact: true });
      await expect(button).toHaveCSS("border-top-color", "rgb(201, 168, 106)");
      await expect(button).toHaveCSS("border-top-width", "1px");
      await expect(button).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    }
    for (const label of ["fontHeading", "accent", "radius", "buttonStyle"]) {
      await expect(page.getByText(label, { exact: true })).toHaveCount(1);
    }
  });

  test("M1-23 phone layout: nav trimmed, copy above mock, chips hidden", async ({
    page,
    isMobile,
  }) => {
    test.skip(!isMobile, "phone project only");
    await open(page);
    await expectNoHorizontalScroll(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      390,
    );
    await expectTapTargets(page);

    const nav = page.getByRole("navigation", { name: "Main" });
    await expect(nav.getByRole("link", { name: "Log in" })).toBeVisible();
    for (const hidden of ["Features", "Pricing", "FAQ", "Claim your link"]) {
      await expect(nav.locator("a", { hasText: hidden })).toHaveCSS("display", "none");
    }

    const h1 = page.getByRole("heading", { level: 1 });
    const size = await h1.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(size).toBeGreaterThanOrEqual(38);

    const h1Box = await box(h1);
    const mockBox = await box(
      page.locator('[aria-hidden="true"]').filter({ hasText: "Mara Okafor" }),
    );
    expect(h1Box.y + h1Box.height).toBeLessThan(mockBox.y);

    for (const label of ["fontHeading", "accent", "radius", "buttonStyle"]) {
      await expect(page.getByText(label, { exact: true })).toBeHidden();
    }
  });

  test("M1-23 desktop layout: copy left, mock right, five nav items, four chips", async ({
    page,
    isMobile,
  }) => {
    test.skip(isMobile, "desktop project only");
    await open(page);
    const nav = page.getByRole("navigation", { name: "Main" });
    for (const name of ["Features", "Pricing", "FAQ", "Log in", "Claim your link"]) {
      await expect(nav.getByRole("link", { name })).toBeVisible();
    }
    const h1Box = await box(page.getByRole("heading", { level: 1 }));
    const mockBox = await box(
      page.locator('[aria-hidden="true"]').filter({ hasText: "Mara Okafor" }),
    );
    expect(h1Box.x + h1Box.width).toBeLessThan(mockBox.x + 60);
    expect(mockBox.x).toBeGreaterThan(h1Box.x + h1Box.width / 2);
    // Same band vertically: the h1 sits inside the mock's vertical extent.
    expect(h1Box.y).toBeGreaterThan(mockBox.y);
    expect(h1Box.y).toBeLessThan(mockBox.y + mockBox.height);
    for (const label of ["fontHeading", "accent", "radius", "buttonStyle"]) {
      await expect(page.getByText(label, { exact: true })).toBeVisible();
    }
  });
});

test.describe("M1-24 claim form hands off to app signup", () => {
  test("M1-24 form anatomy: label, input, suffix, button, container", async ({ page }) => {
    await open(page);
    const input = page.locator("#hero-handle");
    const form = page.locator("form").filter({ has: input });
    await expect(page.locator("label[for='hero-handle']")).toHaveText("Choose your handle");
    const label = await box(page.locator("label[for='hero-handle']"));
    expect(label.width).toBeLessThanOrEqual(1);
    await expect(input).toHaveAttribute("placeholder", "yourname");
    await expect(input).toHaveAttribute("autocomplete", "off");
    await expect(input).toHaveAttribute("spellcheck", "false");
    await expect(input).toHaveCSS("font-size", "16px");
    expect(await input.evaluate((el) => getComputedStyle(el).fontFamily)).toMatch(/Geist.?Mono/);
    await expect(form.getByText(".hydlnk.com", { exact: true })).toBeVisible();

    const button = form.getByRole("button", { name: "Claim it" });
    await expect(button).toHaveCSS("background-color", INK);
    await expect(button).toHaveCSS("color", WHITE);
    await expect(button).toHaveCSS("border-top-left-radius", "4px");
    expect(Math.round((await box(button)).height)).toBe(44);

    await expect(form).toHaveCSS("border-top-color", "rgb(201, 197, 190)");
    await expect(form).toHaveCSS("border-top-width", "1px");
    await expect(form).toHaveCSS("border-top-left-radius", "6px");
    await expect(form).toHaveCSS("max-width", "500px");
    expect((await box(form)).width).toBeLessThanOrEqual(500.5);
  });

  test("M1-24 typing Mara_Studio and clicking Claim it lands on a normalized signup URL", async ({
    page,
  }) => {
    await stubAppHost(page);
    await open(page);
    await ready(page);
    await page.locator("#hero-handle").fill("Mara_Studio");
    await page
      .locator("form")
      .filter({ has: page.locator("#hero-handle") })
      .getByRole("button", { name: "Claim it" })
      .click();
    await page.waitForURL(`${SIGNUP}?handle=marastudio`, { waitUntil: "commit" });
    expect(new URL(page.url()).searchParams.size).toBe(1);
  });

  test("M1-24 pressing Enter submits; an empty field goes to /signup with no parameter", async ({
    page,
  }) => {
    await stubAppHost(page);
    await open(page);
    await ready(page);
    await page.locator("#hero-handle").fill("Mara_Studio");
    await page.locator("#hero-handle").press("Enter");
    await page.waitForURL(`${SIGNUP}?handle=marastudio`, { waitUntil: "commit" });

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
    await page.locator("#hero-handle").fill("mara");
    await page.locator("#hero-handle").press("Enter");
    await page.waitForURL(`${SIGNUP}?handle=mara`, { waitUntil: "commit" });

    await page.goto(url());
    await page.locator("#hero-handle").fill("Mara_Studio");
    await page.locator("#hero-handle").press("Enter");
    // Raw value as typed: the signup page normalizes it.
    await page.waitForURL(`${SIGNUP}?handle=Mara_Studio`, { waitUntil: "commit" });
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
    await cta.fill("mara");
    await cta.press("Enter");
    await page.waitForURL(`${SIGNUP}?handle=mara`, { waitUntil: "commit" });

    await open(page);
    await ready(page);
    await page.locator("#cta-handle").fill("Mara_Studio");
    await page
      .locator("form")
      .filter({ has: page.locator("#cta-handle") })
      .getByRole("button", { name: "Claim it" })
      .click();
    await page.waitForURL(`${SIGNUP}?handle=marastudio`, { waitUntil: "commit" });
  });

  test("M1-24 the nav link carries a handle already typed in the hero form", async ({
    page,
    isMobile,
  }) => {
    test.skip(isMobile, "the nav claim link is desktop only");
    await stubAppHost(page);
    await open(page);
    await ready(page);
    await page.locator("#hero-handle").fill("Mara_Studio");
    await page
      .getByRole("navigation", { name: "Main" })
      .getByRole("link", { name: "Claim your link" })
      .click();
    await page.waitForURL(`${SIGNUP}?handle=marastudio`, { waitUntil: "commit" });
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
      const button = form.getByRole("button", { name: "Claim it" });
      const inputBox = await box(input);
      const buttonBox = await box(button);
      const formBox = await box(form);
      expect(buttonBox.y).toBeGreaterThanOrEqual(inputBox.y + inputBox.height - 1);
      expect(buttonBox.width).toBeGreaterThan(formBox.width - 24);
      const size = await input.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
      expect(size).toBeGreaterThanOrEqual(16);
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
      expect((await box(form)).width).toBeLessThanOrEqual(500.5);
    }
  });
});

test.describe("M1-25 features, theme tokens, domain and analytics", () => {
  test("M1-25 #features: heading copy and six cards in order", async ({ page }) => {
    await open(page);
    const features = page.locator("#features");
    await expect(features).toHaveCSS("background-color", WHITE);
    await expect(features.getByText("Free on every plan", { exact: true })).toBeVisible();
    await expect(
      features.getByRole("heading", {
        level: 2,
        name: "Design control is the product, so it’s free.",
      }),
    ).toBeVisible();
    await expect(
      features.getByText(
        "Every plan gets every block and the whole theme system. You pay for your own domain or more pages — never to make your page look good.",
        { exact: true },
      ),
    ).toBeVisible();

    await expect(features.getByRole("heading", { level: 3 })).toHaveText([
      "Blocks, not just buttons",
      "A real theme system",
      "Saved themes",
      "Per-link analytics",
      "Your own domain",
      "Fast and cookie-free",
    ]);
    const cards = features.locator("article");
    await expect(cards).toHaveCount(6);
    for (let i = 0; i < 6; i += 1) {
      const tile = cards.nth(i).locator("svg").first().locator("xpath=..");
      const b = await box(tile);
      expect([Math.round(b.width), Math.round(b.height)]).toEqual([40, 40]);
    }
    await expect(cards.locator("p")).toHaveText([
      "Link buttons, cards, headers, text, images, video and music embeds, social rows and two-column grids, in any order.",
      "Colors, type, shape, spacing and backgrounds are tokens. Change one and the whole page follows.",
      "Save a look once and apply it to any page, or start from a set of house themes.",
      "Views, clicks and click-through for every link on the free plan — not just one total.",
      "Serve your page from links.yourbrand.com. Set one DNS record and SSL is issued automatically.",
      "Pages are cached at the edge, and analytics use no cookies — so visitors never see a consent banner.",
    ]);
    const chip = cards.nth(4).getByText("Pro", { exact: true });
    await expect(chip).toHaveCSS("background-color", "rgb(246, 238, 223)");
    await expect(chip).toHaveCSS("color", "rgb(107, 82, 38)");
    await expect(features.getByText("Pro", { exact: true })).toHaveCount(1);
  });

  test("M1-25 #design: resolve row, token card with 23 tokens", async ({ page }) => {
    await open(page);
    const design = page.locator("#design");
    await expect(design).toHaveCSS("background-color", PAGE);
    await expect(design.getByText("The theme system", { exact: true })).toBeVisible();
    await expect(
      design.getByRole("heading", { level: 2, name: "Every choice is a token." }),
    ).toBeVisible();
    await expect(design.getByText("How a style resolves", { exact: true })).toBeVisible();
    for (const chip of ["system", "theme", "page", "block"]) {
      await expect(design.getByText(chip, { exact: true })).toHaveCount(1);
    }
    // ... in this order, left to right (or top to bottom when it wraps).
    const chipOrder = await Promise.all(
      ["system", "theme", "page", "block"].map(async (chip) => {
        const b = await design.getByText(chip, { exact: true }).boundingBox();
        return b!.y * 10_000 + b!.x;
      }),
    );
    expect(chipOrder).toEqual([...chipOrder].sort((a, b) => a - b));
    // Five color swatches (22px squares) in the Color row.
    const colorRow = design.getByText("Color", { exact: true }).locator("xpath=..");
    expect(
      await colorRow
        .locator("span")
        .evaluateAll((els) => els.filter((el) => el.getBoundingClientRect().width === 22).length),
    ).toBe(5);
    await expect(design.locator("[aria-hidden='true']").filter({ hasText: "→" })).toHaveCount(3);
    await expect(
      design.getByText(
        "Later wins. Block overrides cover color, button style and radius, so pages stay coherent.",
        { exact: true },
      ),
    ).toBeVisible();

    await expect(design.getByText("Theme · Noir", { exact: true })).toBeVisible();
    await expect(design.getByText("23 tokens", { exact: true })).toBeVisible();
    await expect(design.getByText("12 tokens")).toHaveCount(0);
    for (const row of ["Color", "Type", "Shape", "Buttons", "Spacing", "Background"]) {
      await expect(design.getByText(row, { exact: true })).toBeVisible();
    }
    await expect(design.getByText("Instrument Serif / Geist", { exact: true })).toBeVisible();
    await expect(design.getByText("radius 12 · border 1", { exact: true })).toBeVisible();
    for (const chip of ["Fill", "Outline", "Soft", "Pill"]) {
      await expect(design.getByText(chip, { exact: true })).toBeVisible();
    }
    await expect(design.getByText("regular", { exact: true })).toBeVisible();
    await expect(design.getByText("solid", { exact: true })).toBeVisible();
  });

  test("M1-25 domain and analytics cards", async ({ page }) => {
    await open(page);
    const domain = page
      .getByRole("heading", { level: 3, name: "Your domain, not ours." })
      .locator("xpath=..");
    await expect(domain.getByText("Pro", { exact: true })).toBeVisible();
    for (const head of ["Type", "Name", "Value"]) {
      await expect(domain.getByText(head, { exact: true })).toBeVisible();
    }
    await expect(domain.getByText("CNAME", { exact: true })).toBeVisible();
    await expect(domain.getByText("links", { exact: true })).toBeVisible();
    await expect(domain.getByText("cname.vercel-dns.com", { exact: true })).toBeVisible();
    await expect(domain.getByText("Example record", { exact: true })).toBeVisible();
    const status = domain.getByText("Verified · SSL issued", { exact: true });
    await expect(status).toBeVisible();
    const verified = status.locator("xpath=..");
    await expect(verified).toHaveCSS("background-color", "rgb(231, 243, 236)");
    // Row and icon keep --hl-good (#2F7D4F). The 13px label is #2B7448 because #2F7D4F on
    // #E7F3EC is 4.42:1 and axe (M1-27) rejects it below 4.5:1.
    await expect(verified).toHaveCSS("color", "rgb(47, 125, 79)");
    await expect(status).toHaveCSS("color", "rgb(43, 116, 72)");

    const analytics = page
      .getByRole("heading", { level: 3, name: "Analytics that answer something." })
      .locator("xpath=..");
    await expect(analytics.getByText("Every plan", { exact: true })).toBeVisible();
    for (const value of ["1,284", "902", "688", "Sample numbers"]) {
      await expect(analytics.getByText(value, { exact: true })).toBeVisible();
    }
  });

  test("M1-25 sections alternate white and #F4F3F0 with 1px dividers", async ({ page }) => {
    await open(page);
    const sections = page.locator("main > section");
    const backgrounds = await sections.evaluateAll((els) =>
      els.map((el) => getComputedStyle(el).backgroundColor),
    );
    expect(backgrounds).toEqual([WHITE, WHITE, PAGE, WHITE, PAGE, WHITE, INK]);
    const borders = await sections.evaluateAll((els) =>
      els.map(
        (el) =>
          `${getComputedStyle(el).borderBottomWidth} ${getComputedStyle(el).borderBottomColor}`,
      ),
    );
    for (const index of [0, 1, 2, 3, 4]) expect(borders[index]).toBe(`1px ${LINE}`);
    // Content sits in a 1200px container.
    for (const id of ["features", "design", "pricing", "faq"]) {
      const container = page.locator(`#${id} > div`).first();
      await expect(container).toHaveCSS("max-width", "1200px");
    }
    // The domain and analytics section has no id: it is the fourth section.
    await expect(sections.nth(3).locator("> div").first()).toHaveCSS("max-width", "1200px");
  });

  test("M1-25 phone layout: single-column grids and compact DNS table", async ({
    page,
    isMobile,
  }) => {
    test.skip(!isMobile, "phone project only");
    await open(page);
    await expectNoHorizontalScroll(page);
    await expectTapTargets(page);
    const columns = await page.evaluate(() => {
      const count = (el: Element | null) =>
        el ? getComputedStyle(el).gridTemplateColumns.split(" ").length : 0;
      return {
        features: count(document.querySelector("#features article")?.parentElement ?? null),
        design: document.querySelector("#design > div")?.children.length ?? 0,
        domain: count(document.querySelector("main > section:nth-of-type(4) > div")),
        pricing: count(document.querySelector("#pricing h3")?.closest("div.grid") ?? null),
      };
    });
    expect(columns.features).toBe(1);
    expect(columns.domain).toBe(1);
    expect(columns.pricing).toBe(1);

    const feature = await box(page.locator("#features article").first());
    const second = await box(page.locator("#features article").nth(1));
    expect(second.y).toBeGreaterThan(feature.y + feature.height - 1);
    const design = await box(page.locator("#design").getByText("Theme · Noir"));
    const resolve = await box(page.locator("#design").getByText("How a style resolves"));
    expect(design.y).toBeGreaterThan(resolve.y);

    const row = page.getByText("CNAME", { exact: true }).locator("xpath=..");
    const template = await row.evaluate((el) => getComputedStyle(el).gridTemplateColumns);
    expect(template.startsWith("58px 50px ")).toBe(true);
    const value = page.getByText("cname.vercel-dns.com", { exact: true });
    expect(await value.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  });

  test("M1-25 desktop layout: three feature columns, two-column theme, cards side by side", async ({
    page,
    isMobile,
  }) => {
    test.skip(isMobile, "desktop project only");
    await open(page);
    const xs = new Set<number>();
    for (const card of await page.locator("#features article").all()) {
      xs.add(Math.round((await box(card)).x));
    }
    expect(xs.size).toBe(3);

    const copy = await box(page.locator("#design").getByRole("heading", { level: 2 }));
    const token = await box(page.locator("#design").getByText("Theme · Noir"));
    expect(token.x).toBeGreaterThan(copy.x + copy.width - 1);

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
  test("M1-26 heading and three cards in order with the PLAN v1 lists", async ({ page }) => {
    await open(page);
    const pricing = page.locator("#pricing");
    await expect(pricing.getByText("Pricing", { exact: true })).toBeVisible();
    await expect(
      pricing.getByRole("heading", { level: 2, name: "Pay for your domain, not your design." }),
    ).toBeVisible();
    await expect(
      pricing.getByText("No commerce fees on any plan. Cancel anytime from your billing portal.", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(pricing.getByRole("heading", { level: 3 })).toHaveText(["Free", "Pro", "Studio"]);

    const card = (name: string) =>
      pricing.getByRole("heading", { level: 3, name, exact: true }).locator("xpath=../../..");
    const lists = async (name: string) =>
      (await card(name).locator("li").allTextContents()).map((t) => t.trim());

    await expect(card("Free")).toContainText(formatFreePrice());
    await expect(card("Free")).toContainText("forever");
    await expect(card("Free")).toContainText("One page that looks properly designed.");
    // The prices come from the one table (src/lib/billing/prices.ts): $9, or $60 a year ($5/mo billed yearly).
    await expect(card("Pro")).toContainText(formatLandingPrice("pro").price);
    await expect(card("Pro")).toContainText(formatLandingPrice("pro").per);
    await expect(card("Pro")).toContainText("For creators and small brands on their own domain.");
    await expect(card("Studio")).toContainText(formatLandingPrice("studio").price);
    await expect(card("Studio")).toContainText(formatLandingPrice("studio").per);
    await expect(card("Studio")).toContainText("For agencies and teams running pages for others.");

    expect(await lists("Free")).toEqual([
      "1 page",
      "Every block and the full theme system",
      "3 saved themes",
      "yourname.hydlnk.com",
      "Per-link clicks, last 30 days",
      "10 MB of uploads",
      "–Small “Made with HYDLNK” badge",
    ]);
    expect(await lists("Pro")).toEqual([
      "Everything in Free, plus",
      "1 custom domain with SSL",
      "3 pages",
      "No badge",
      "Unlimited saved themes",
      "1 year of analytics with referrers, devices and countries",
      "100 MB of uploads",
    ]);
    expect(await lists("Studio")).toEqual([
      "Everything in Pro, plus",
      "15 pages and 15 custom domains",
      "Themes shared across pages",
      "1 GB of uploads",
    ]);

    await expect(card("Pro")).toHaveCSS("border-top-color", INK);
    await expect(card("Pro")).toHaveCSS("border-top-width", "1px");
    const strip = card("Pro").getByText("Recommended", { exact: true });
    await expect(strip).toHaveCSS("background-color", INK);
    await expect(card("Free")).toHaveCSS("border-top-color", "rgb(217, 214, 208)");
    await expect(card("Studio")).toHaveCSS("border-top-color", "rgb(217, 214, 208)");
    await expect(pricing.getByText("Recommended", { exact: true })).toHaveCount(1);
  });

  test("M1-26 scope guard: nothing out of v1 anywhere on the page", async ({ page }) => {
    await open(page);
    const html = await page.content();
    expect(html).not.toMatch(/schedul|csv|invite editors|team access|custom css|version history/i);
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
    await expectTapTargets(page);
    const ys: number[] = [];
    const xs: number[] = [];
    for (const name of ["Free", "Pro", "Studio"]) {
      const b = await box(
        page.locator("#pricing").getByRole("heading", { level: 3, name, exact: true }),
      );
      ys.push(b.y);
      xs.push(Math.round(b.x));
    }
    expect(ys[0]).toBeLessThan(ys[1]!);
    expect(ys[1]).toBeLessThan(ys[2]!);
    expect(new Set(xs).size).toBe(1);
    for (const name of ["Start free", "Go Pro", "Start Studio"]) {
      const link = page.locator("#pricing").getByRole("link", { name, exact: true });
      const cardBox = await box(link.locator("xpath=../.."));
      expect((await box(link)).width).toBeGreaterThan(cardBox.width - 60);
    }
  });

  test("M1-26 desktop layout: three equal-height columns in the 1200px container", async ({
    page,
    isMobile,
  }) => {
    test.skip(isMobile, "desktop project only");
    await open(page, "#pricing");
    const boxes = [];
    for (const name of ["Free", "Pro", "Studio"]) {
      boxes.push(
        await box(
          page
            .locator("#pricing")
            .getByRole("heading", { level: 3, name, exact: true })
            .locator("xpath=../../.."),
        ),
      );
    }
    const [free, pro, studio] = boxes as [(typeof boxes)[0], (typeof boxes)[0], (typeof boxes)[0]];
    expect(free.x).toBeLessThan(pro.x);
    expect(pro.x).toBeLessThan(studio.x);
    expect(Math.abs(free.height - pro.height)).toBeLessThan(1);
    expect(Math.abs(pro.height - studio.height)).toBeLessThan(1);
    expect(Math.abs(free.width - pro.width)).toBeLessThan(1);
    expect(studio.x + studio.width - free.x).toBeLessThanOrEqual(1200.5);
  });
});

test.describe("M1-27 FAQ, CTA band and footer", () => {
  test("M1-27 FAQ: four details, first open, click Enter and Space toggle", async ({ page }) => {
    await open(page, "#faq");
    const faq = page.locator("#faq");
    await expect(faq.getByRole("heading", { level: 2, name: "Questions" })).toBeVisible();
    const items = faq.locator("details");
    await expect(items).toHaveCount(4);
    await expect(items.locator("summary")).toHaveText([
      /Is the free plan actually free\?/,
      /How do custom domains work\?/,
      /Do you take a cut of sales\?/,
      /What if my page gets a lot of traffic\?/,
    ]);
    await expect(items.nth(0)).toHaveJSProperty("open", true);
    for (const i of [1, 2, 3]) await expect(items.nth(i)).toHaveJSProperty("open", false);
    const answers = [
      "Yes. One page, every block, the full theme system and per-link analytics — no time limit and no card on file.",
      "On Pro, add a domain like links.yourbrand.com and set the one DNS record we show you. We verify it and issue SSL automatically.",
      "No. There are no commerce fees on any plan.",
      "It keeps serving. Pages are cached at the edge and built for traffic spikes, on every plan.",
    ];
    for (const [i, answer] of answers.entries()) await expect(items.nth(i)).toContainText(answer);

    for (let i = 0; i < 4; i += 1) {
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
    await page.keyboard.press("Space");
    await expect(third).toHaveJSProperty("open", false);
    // The plus mark stays a plus.
    await expect(items.nth(0).locator("summary")).toContainText("+");
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

    const input = page.locator("#cta-handle");
    const form = page.locator("form").filter({ has: input });
    await expect(form).toHaveCSS("background-color", "rgb(42, 40, 37)");
    await expect(form).toHaveCSS("border-top-color", "rgb(69, 65, 59)");
    await expect(input).toHaveCSS("color", "rgb(244, 243, 240)");
    await expect(form.getByText(".hydlnk.com", { exact: true })).toHaveCSS(
      "color",
      "rgb(169, 164, 155)",
    );
    const button = form.getByRole("button", { name: "Claim it" });
    await expect(button).toHaveCSS("background-color", "rgb(184, 145, 79)");
    await expect(button).toHaveCSS("color", INK);
    await expect(
      band.getByText("Free forever. Upgrade only when you want your own domain.", { exact: true }),
    ).toBeVisible();
  });

  test("M1-27 footer: brand, copyright, Privacy and Terms", async ({ page, isMobile }) => {
    await open(page);
    const footer = page.locator("footer");
    await expect(footer).toHaveCSS("background-color", WHITE);
    await expect(footer).toHaveCSS("border-top-width", "1px");
    await expect(footer).toHaveCSS("border-top-color", LINE);
    const diamond = footer.locator("span[aria-hidden='true']").first();
    await expect(diamond).toHaveCSS("width", "8px");
    await expect(diamond).toHaveCSS("height", "8px");
    await expect(diamond).toHaveCSS("background-color", "rgb(184, 145, 79)");
    await expect(footer.getByText("HYDLNK", { exact: true })).toBeVisible();
    // "© 2026" in 2026: the component prints the current year, so the test does too.
    await expect(footer.getByText(`© ${new Date().getFullYear()}`, { exact: true })).toBeVisible();

    const nav = page.getByRole("navigation", { name: "Footer" });
    await expect(nav.getByRole("link")).toHaveText(["Privacy", "Terms"]);
    await expect(nav.getByRole("link", { name: "Privacy" })).toHaveAttribute(
      "href",
      "http://localhost:3000/privacy",
    );
    await expect(nav.getByRole("link", { name: "Terms" })).toHaveAttribute(
      "href",
      "http://localhost:3000/terms",
    );
    for (const name of ["Privacy", "Terms"]) {
      expect((await box(nav.getByRole("link", { name }))).height).toBeGreaterThanOrEqual(44);
    }
    if (!isMobile) {
      const brand = await box(footer.getByText("HYDLNK", { exact: true }));
      const privacy = await box(nav.getByRole("link", { name: "Privacy" }));
      expect(privacy.x).toBeGreaterThan(brand.x + 600);
      expect(Math.abs(privacy.y + privacy.height / 2 - (brand.y + brand.height / 2))).toBeLessThan(
        6,
      );
    }
  });

  test("M1-27 heading outline has no skipped levels", async ({ page }) => {
    await open(page);
    const levels = await page
      .locator("h1, h2, h3, h4, h5, h6")
      .evaluateAll((els) => els.map((el) => Number(el.tagName.slice(1))));
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
    const violations = await axeViolations(page);
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
    const formBox = await box(form);
    expect(button.y).toBeGreaterThanOrEqual(inputBox.y + inputBox.height - 1);
    expect(button.width).toBeGreaterThan(formBox.width - 24);
    const footerLinks = page.getByRole("navigation", { name: "Footer" }).getByRole("link");
    for (const link of await footerLinks.all()) {
      const b = await box(link);
      expect(b.x + b.width).toBeLessThanOrEqual(390);
    }
  });

  test("M1-27 desktop layout: single FAQ column, 500px band form, one-row footer", async ({
    page,
    isMobile,
  }) => {
    test.skip(isMobile, "desktop project only");
    await open(page, "#faq");
    const items = page.locator("#faq details");
    const xs = new Set<number>();
    const widths = new Set<number>();
    for (const item of await items.all()) {
      const b = await box(item);
      xs.add(Math.round(b.x));
      widths.add(Math.round(b.width));
    }
    expect(xs.size).toBe(1);
    expect(widths.size).toBe(1);
    expect([...widths][0]!).toBeLessThanOrEqual(900);

    const input = page.locator("#cta-handle");
    const form = page.locator("form").filter({ has: input });
    expect((await box(form)).width).toBeLessThanOrEqual(500.5);
    const inputBox = await box(input);
    const buttonBox = await box(form.getByRole("button", { name: "Claim it" }));
    expect(
      Math.abs(inputBox.y + inputBox.height / 2 - (buttonBox.y + buttonBox.height / 2)),
    ).toBeLessThan(4);
  });
});
