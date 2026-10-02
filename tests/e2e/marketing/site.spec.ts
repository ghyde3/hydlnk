import { expect, test, type Page } from "@playwright/test";
import { expectNoHorizontalScroll, expectTapTargets, url } from "../helpers";

/**
 * Marketing site v2 smoke tests, one per page, at both projects (phone 390x844, desktop 1440x900):
 * the page renders with its own title, description, canonical URL and Open Graph image; its
 * primary call to action reaches sign-up on the app host; nothing scrolls sideways; tap targets
 * are 44px on phones; and no copy promises what v1 doesn't ship. The home page's detailed checks
 * live in tests/e2e/m1/landing.spec.ts.
 */

const SIGNUP = url("app", "/signup");
const APP = url("app");
const OUT_OF_SCOPE = /schedul|csv|invite editors|team access|custom css|version history/i;

const PAGES: { path: string; title: RegExp; current: string | null }[] = [
  { path: "/features", title: /^Features \| HYDLNK$/, current: "Features" },
  { path: "/design", title: /^Design \| HYDLNK$/, current: "Design" },
  { path: "/domains", title: /^Custom domains \| HYDLNK$/, current: "Domains" },
  { path: "/analytics", title: /^Analytics \| HYDLNK$/, current: "Analytics" },
  { path: "/pricing", title: /^Pricing \| HYDLNK$/, current: "Pricing" },
  { path: "/learn", title: /^Learn \| HYDLNK$/, current: "Learn" },
  { path: "/learn/getting-started", title: /^Getting started · Learn \| HYDLNK$/, current: "Learn" },
  { path: "/learn/choosing-a-handle", title: /^Choosing a handle · Learn \| HYDLNK$/, current: "Learn" },
  { path: "/learn/designing-your-page", title: /^Designing your page · Learn \| HYDLNK$/, current: "Learn" },
  { path: "/learn/connecting-a-domain", title: /^Connecting a domain · Learn \| HYDLNK$/, current: "Learn" },
  { path: "/learn/understanding-analytics", title: /^Understanding analytics · Learn \| HYDLNK$/, current: "Learn" },
  { path: "/learn/plans-and-billing", title: /^Plans and billing · Learn \| HYDLNK$/, current: "Learn" },
  { path: "/faq", title: /^FAQ \| HYDLNK$/, current: null },
  { path: "/privacy", title: /^Privacy policy \| HYDLNK$/, current: null },
  { path: "/terms", title: /^Terms of service \| HYDLNK$/, current: null },
];

async function stubAppHost(page: Page) {
  await page.route(`${APP}**`, (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: "<title>stub</title>stub" }),
  );
}

for (const { path, title, current } of PAGES) {
  test(`${path} renders, converts and fits`, async ({ page, isMobile }) => {
    const response = await page.goto(url(null, path));
    expect(response?.status()).toBe(200);
    expect(response?.headers()["set-cookie"], "marketing pages set no cookie").toBeUndefined();

    // Document: one h1, title, description, canonical, Open Graph image.
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(page).toHaveTitle(title);
    await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", /.{40,}/);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", url(null, path));
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
      "content",
      new RegExp(`^${url(null, "/marketing/og/")}[a-z]+\\.jpg$`),
    );

    // Header: the page being viewed is marked in the navigation (desktop list).
    if (current && !isMobile) {
      const link = page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: current, exact: true });
      await expect(link).toHaveAttribute("aria-current", "page");
    }

    // Copy: nothing out of v1, no real people's names.
    const html = await page.content();
    expect(html).not.toMatch(OUT_OF_SCOPE);
    expect(html).not.toMatch(/Mara Okafor/);

    // Layout.
    await expectNoHorizontalScroll(page);
    if (isMobile) await expectTapTargets(page);

    // Conversion: the hero's primary button (or the CTA band) reaches sign-up on the app host.
    const heroClaim = page.locator("main").getByRole("link", { name: "Claim your handle", exact: true });
    if ((await heroClaim.count()) > 0) {
      await expect(heroClaim.first()).toHaveAttribute("href", SIGNUP);
    }
    const band = page.locator("#cta-handle");
    if ((await band.count()) > 0) {
      await stubAppHost(page);
      await expect(page.locator("form[data-ready='true']").filter({ has: band })).toHaveCount(1);
      await band.fill("Wren-Haven");
      await band.press("Enter");
      await page.waitForURL(`${SIGNUP}?handle=wren-haven`, { waitUntil: "commit" });
    }
  });
}

test("legal pages: last-updated date, a column no wider than 70 characters, linked from the footer", async ({
  page,
}) => {
  for (const path of ["/privacy", "/terms"]) {
    const requests: string[] = [];
    page.on("request", (request) => requests.push(request.url()));
    await page.goto(url(null, path));
    await expect(page.getByText(/^Last updated 2 October 2026$/)).toBeVisible();
    await expect(page.locator("time[datetime='2026-10-02']")).toHaveCount(1);
    const fits = await page.locator(".prose-hl").evaluate((el) => {
      const context = document.createElement("canvas").getContext("2d")!;
      context.font = getComputedStyle(el).font;
      const ch = context.measureText("0").width;
      return el.getBoundingClientRect().width <= 70 * ch + 1;
    });
    expect(fits).toBe(true);
    const footer = page.getByRole("navigation", { name: "Footer" });
    expect(await footer.getByRole("link", { name: path === "/privacy" ? "Privacy" : "Terms", exact: true }).evaluate((a) => (a as HTMLAnchorElement).href)).toBe(url(null, path));
    // No request leaves the HYDLNK hosts.
    const port = new URL(APP).port;
    expect(requests.filter((u) => !new URL(u).host.endsWith(`localhost:${port}`))).toEqual([]);
  }
  expect((await page.context().cookies()).map((c) => c.name)).toEqual([]);
});

test("privacy names the processors and the cookieless analytics; terms cover acceptable use", async ({
  page,
}) => {
  await page.goto(url(null, "/privacy"));
  const privacy = page.locator(".prose-hl");
  for (const text of ["Vercel", "Supabase", "Stripe", "Resend", "Google", "daily", "90 days", "privacy@hydlnk.com"]) {
    await expect(privacy).toContainText(text);
  }
  await page.goto(url(null, "/terms"));
  const terms = page.locator(".prose-hl");
  for (const text of ["Phishing", "Malware", "Impersonation", "Illegal content", "report link", "suspend", "100,000 views", "support@hydlnk.com"]) {
    await expect(terms).toContainText(text);
  }
});

test("design playground: radio groups restyle the demo page without JavaScript", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(url(null, "/design"));
  const demo = page.locator(".tp .dp");
  const bg = () => demo.evaluate((el) => getComputedStyle(el).backgroundColor);
  const before = await bg();
  await page.locator(".tp-option", { hasText: /^Ivory$/ }).click();
  await expect.poll(bg).not.toBe(before);
  await expect.poll(bg).toBe("rgb(243, 238, 228)");
  const button = demo.locator(".dp-link").first();
  await page.locator(".tp-option", { hasText: /^Pill$/ }).click();
  await expect(button).toHaveCSS("border-top-left-radius", "999px");
  await page.locator('input[name="tp-theme"][value="ivory"]').focus();
  await page.keyboard.press("ArrowLeft");
  await expect(page.locator('input[name="tp-theme"]:checked')).toHaveValue("noir");
  await context.close();
});

test("home showreel: the cut for the viewport plays, and the toggle pauses it", async ({ page, isMobile }) => {
  await page.goto(url());
  const toggle = page.locator("[data-showreel] button");
  await expect(toggle).toHaveAttribute("aria-label", "Pause showreel");
  const video = page.locator("[data-showreel] video");
  expect(await video.evaluate((el: HTMLVideoElement) => el.currentSrc)).toMatch(
    isMobile ? /showreel-4x5\.(webm|mp4)$/ : /showreel-16x9\.(webm|mp4)$/,
  );
  expect(await video.evaluate((el: HTMLVideoElement) => el.muted && !el.paused)).toBe(true);
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-label", "Play showreel");
  expect(await video.evaluate((el: HTMLVideoElement) => el.paused)).toBe(true);
});

test("home showreel with reduced motion: poster only, until Play is pressed", async ({ browser, isMobile }) => {
  const context = await browser.newContext({
    reducedMotion: "reduce",
    viewport: isMobile ? { width: 390, height: 844 } : { width: 1440, height: 900 },
    isMobile,
    hasTouch: isMobile,
  });
  const page = await context.newPage();
  await page.goto(url(), { waitUntil: "load" });
  const toggle = page.locator("[data-showreel] button");
  await expect(toggle).toHaveAttribute("aria-label", "Play showreel");
  await expect(toggle).toBeVisible();
  const video = page.locator("[data-showreel] video");
  // Nothing loads under reduced motion: no source, the poster stays.
  await page.waitForTimeout(500);
  expect(await video.evaluate((el: HTMLVideoElement) => el.currentSrc)).toBe("");
  await expect(page.locator("[data-showreel] picture img")).toBeVisible();
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-label", "Pause showreel");
  expect(await video.evaluate((el: HTMLVideoElement) => el.currentSrc)).toMatch(
    isMobile ? /showreel-4x5\./ : /showreel-16x9\./,
  );
  await expect.poll(() => video.evaluate((el: HTMLVideoElement) => !el.paused)).toBe(true);
  await context.close();
});

test("robots.txt and sitemap.xml exist on the root host only", async ({ page }) => {
  const robots = await page.goto(url(null, "/robots.txt"));
  expect(robots?.status()).toBe(200);
  expect(await robots!.text()).toContain(`Sitemap: ${url(null, "/sitemap.xml")}`);

  const sitemap = await page.goto(url(null, "/sitemap.xml"));
  expect(sitemap?.status()).toBe(200);
  const xml = await sitemap!.text();
  for (const { path } of PAGES) expect(xml).toContain(`<loc>${url(null, path)}</loc>`);

  // A tenant subdomain never serves the marketing sitemap, and its robots.txt doesn't point at one.
  const tenantSitemap = await page.goto(url("zz-no-such-handle", "/sitemap.xml"));
  expect(tenantSitemap?.status()).toBe(404);
  const tenantRobots = await page.goto(url("zz-no-such-handle", "/robots.txt"));
  expect(await tenantRobots!.text()).not.toContain("Sitemap:");
  const appRobots = await page.goto(url("app", "/robots.txt"));
  expect(await appRobots!.text()).toContain("Disallow: /");
});
