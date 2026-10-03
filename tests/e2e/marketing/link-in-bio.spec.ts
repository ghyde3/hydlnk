import { expect, test, type Page } from "@playwright/test";
import { AUDIENCES, audienceHref } from "@/components/marketing/audiences/data";
import { expectNoHorizontalScroll, expectTapTargets, url } from "../helpers";

/**
 * Link-in-bio landing pages: the hub at /link-in-bio and one page per platform or kind of creator
 * at /link-in-bio/<slug>. Every page returns 200 with its h1, a canonical URL and structured data
 * that parses; the TikTok page is the one smoke test at both viewports (nothing scrolls sideways,
 * tap targets, the claim field hands the typed name to sign-up); an unknown slug is the branded 404.
 */

const SIGNUP = url("app", "/signup");
const APP = url("app");

async function stubAppHost(page: Page) {
  await page.route(`${APP}**`, (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: "<title>stub</title>stub" }),
  );
}

async function jsonLd(page: Page): Promise<Record<string, unknown>[]> {
  const scripts = await page.locator('script[type="application/ld+json"]').allTextContents();
  return scripts.map((text) => JSON.parse(text) as Record<string, unknown>);
}

const PAGES = [
  {
    path: audienceHref(),
    h1: "Link in bio pages for every kind of creator",
    title: /^Link in bio pages \| HYDLNK$/,
  },
  ...AUDIENCES.map((audience) => ({
    path: audienceHref(audience.slug),
    h1: audience.h1,
    title: new RegExp(`^${audience.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\| HYDLNK$`),
  })),
];

for (const { path, h1, title } of PAGES) {
  test(`${path} returns 200 with its h1, canonical URL and structured data`, async ({ page }) => {
    const response = await page.goto(url(null, path));
    expect(response?.status()).toBe(200);
    expect(response?.headers()["set-cookie"], "marketing pages set no cookie").toBeUndefined();

    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(h1);
    await expect(page).toHaveTitle(title);
    await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", /.{70,}/);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", url(null, path));

    const data = await jsonLd(page);
    const faq = data.find((item) => item["@type"] === "FAQPage") as
      { mainEntity: { name: string; acceptedAnswer: { text: string } }[] } | undefined;
    expect(faq, "FAQPage JSON-LD").toBeDefined();
    expect(faq!.mainEntity.length).toBeGreaterThanOrEqual(3);
    for (const entry of faq!.mainEntity) {
      expect(entry.name).not.toBe("");
      expect(entry.acceptedAnswer.text).not.toBe("");
      // The question is on the page as well, so the structured data describes what visitors see.
      await expect(page.locator("summary", { hasText: entry.name })).toHaveCount(1);
    }
    if (path !== audienceHref()) {
      const crumbs = data.find((item) => item["@type"] === "BreadcrumbList") as
        { itemListElement: { position: number; item: string }[] } | undefined;
      expect(crumbs?.itemListElement.map((entry) => entry.item)).toEqual([
        url(null, audienceHref()),
        url(null, path),
      ]);
    }
  });
}

test("the hub links to every page, and the footer lists the platforms", async ({ page }) => {
  await page.goto(url(null, audienceHref()));
  const main = page.locator("main");
  for (const audience of AUDIENCES) {
    await expect(main.locator(`a[href="${audienceHref(audience.slug)}"]`)).toHaveCount(1);
  }
  const footer = page.getByRole("navigation", { name: "Footer" });
  await expect(footer.getByText("Link in bio for", { exact: true })).toBeVisible();
  for (const name of ["TikTok", "Instagram", "YouTube", "Twitch", "X (Twitter)"]) {
    await expect(footer.getByRole("link", { name, exact: true })).toBeVisible();
  }
});

test("the TikTok page has its steps, the demo builder and a working claim field", async ({
  page,
  isMobile,
}) => {
  await page.goto(url(null, "/link-in-bio/tiktok"));

  await expect(
    page.getByRole("heading", { level: 2, name: "How to add your link to your TikTok bio" }),
  ).toBeVisible();
  await expect(page.locator("#how li")).toHaveCount(4);
  // The demo builder opens on this page's own sample (Kai Brennan, the TikTok preset) and its
  // controls load once the section nears the screen.
  await page.locator("#try").scrollIntoViewIfNeeded();
  await expect(page.locator("#try")).toContainText("Kai Brennan");
  await expect(page.locator("#try").getByRole("tablist", { name: "What to change" })).toBeVisible();
  await expect(page.locator("#faq summary").first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Link in bio for Instagram" }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "What each plan includes" })).toHaveAttribute(
    "href",
    "/pricing",
  );

  await expectNoHorizontalScroll(page);
  if (isMobile) await expectTapTargets(page);

  // Claim: the hero field carries the typed name to sign-up on the app host.
  await stubAppHost(page);
  const field = page.locator("#audience-hero-handle");
  await expect(page.locator("form[data-ready='true']").filter({ has: field })).toHaveCount(1);
  await field.fill("Wren-Haven");
  await field.press("Enter");
  await page.waitForURL(`${SIGNUP}?handle=wren-haven`, { waitUntil: "commit" });
});

test("an unknown link-in-bio page is the branded 404", async ({ page }) => {
  const response = await page.goto(url(null, "/link-in-bio/not-a-page"));
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});

test("the sitemap lists the hub and every page", async ({ request }) => {
  const response = await request.get(url(null, "/sitemap.xml"));
  expect(response.status()).toBe(200);
  const body = await response.text();
  for (const path of [
    audienceHref(),
    ...AUDIENCES.map((audience) => audienceHref(audience.slug)),
  ]) {
    expect(body).toContain(`<loc>${url(null, path)}</loc>`);
  }
});
