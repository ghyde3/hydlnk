import { expect, test, type Page } from "@playwright/test";
import { expectNoHorizontalScroll, expectTapTargets, url } from "../helpers";

/**
 * Comparison and search pages (M11-02, M11-03): each returns 200 with one h1, a canonical URL and
 * a place in the sitemap, links a guide, shows its date and sources, and does not scroll sideways;
 * the shared claim form hands the typed name to sign-up.
 */

const PAGES = [
  { path: "/vs/linktree", h1: "HYDLNK vs Linktree", guide: "/design-control" },
  { path: "/vs/beacons", h1: "HYDLNK vs Beacons", guide: "/design-control" },
  {
    path: "/linktree-custom-domain",
    h1: "Can you use a custom domain with Linktree?",
    guide: "/custom-domains",
  },
  {
    path: "/remove-linktree-badge",
    h1: "How to remove the Linktree logo from your page",
    guide: "/pricing",
  },
  {
    path: "/link-in-bio/shopify",
    h1: "Link in bio for Shopify stores",
    guide: "/link-in-bio/instagram",
  },
];

const APP = url("app");

async function stubAppHost(page: Page) {
  await page.route(`${APP}**`, (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: "<title>stub</title>stub" }),
  );
}

for (const { path, h1, guide } of PAGES) {
  test(`${path} is a complete page`, async ({ page, isMobile }) => {
    const response = await page.goto(url(null, path));
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(h1);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", url(null, path));
    await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", /.{70,}/);
    // The shared claim form (the handoff itself is tested below).
    await expect(page.locator("form").filter({ has: page.locator("#cta-handle") })).toHaveCount(1);

    const main = page.locator("main");
    await expect(main.locator(`a[href="${guide}"]`).first()).toBeVisible();
    await expect(main.getByText("Checked October 2026")).toBeVisible();
    await expect(main.getByText(/is not affiliated|not affiliated with/).first()).toBeVisible();
    await expect(main.getByRole("heading", { level: 2, name: "Sources" })).toBeVisible();
    const external = main.locator("#sources a[href^='https://']");
    expect(await external.count()).toBeGreaterThan(0);
    for (const rel of await external.evaluateAll((els) =>
      els.map((el) => el.getAttribute("rel")),
    )) {
      expect(rel).toContain("nofollow");
    }
    await expect(main.locator("img")).toHaveCount(0);

    await expectNoHorizontalScroll(page);
    if (isMobile) await expectTapTargets(page, "a, button");
  });

  test(`${path} is in the sitemap`, async ({ request }) => {
    const body = await (await request.get(url(null, "/sitemap.xml"))).text();
    expect(body).toContain(`<loc>${url(null, path)}</loc>`);
  });
}

test("the five pages have distinct titles and descriptions", async ({ request }) => {
  const titles: string[] = [];
  const descriptions: string[] = [];
  for (const { path } of PAGES) {
    const html = await (await request.get(url(null, path))).text();
    titles.push(/<title>([^<]*)<\/title>/.exec(html)?.[1] ?? "");
    descriptions.push(/<meta name="description" content="([^"]*)"/.exec(html)?.[1] ?? "");
  }
  expect(titles.every((value) => value.length > 0)).toBe(true);
  expect(descriptions.every((value) => value.length > 0)).toBe(true);
  expect(new Set(titles).size).toBe(PAGES.length);
  expect(new Set(descriptions).size).toBe(PAGES.length);
});

test("the claim form on a comparison page hands off to sign-up", async ({ page }) => {
  await page.goto(url(null, "/vs/linktree"));
  await stubAppHost(page);
  const field = page.locator("#cta-handle");
  await expect(page.locator("form[data-ready='true']").filter({ has: field })).toHaveCount(1);
  await field.fill("Wren-Haven");
  await field.press("Enter");
  await page.waitForURL(`${url("app", "/signup")}?handle=wren-haven`, { waitUntil: "commit" });
});

test("the comparison table lists HYDLNK's Free badge and Pro removal", async ({ page }) => {
  await page.goto(url(null, "/vs/beacons"));
  await expect(page.getByRole("table")).toContainText("Made with HYDLNK");
});

test("/remove-linktree-badge states the HYDLNK Free badge and that Pro removes it", async ({
  page,
}) => {
  await page.goto(url(null, "/remove-linktree-badge"));
  const main = page.locator("main");
  await expect(main.getByText(/HYDLNK Free shows a small .Made with HYDLNK. badge/)).toBeVisible();
  await expect(main.getByText(/Pro and Studio remove it/)).toBeVisible();
  await expect(main.getByText(/^No badge\. Pro is /)).toBeVisible();
});

test("/link-in-bio/shopify mentions linking a store and the discount block", async ({ page }) => {
  await page.goto(url(null, "/link-in-bio/shopify"));
  const main = page.locator("main");
  await expect(main.getByText(/store/i).first()).toBeVisible();
  await expect(main.getByRole("heading", { name: /^Link block: your store$/ })).toBeVisible();
  await expect(main.getByRole("heading", { name: /^Discount code block/ })).toBeVisible();
});

test("an unknown comparison is the branded 404", async ({ page }) => {
  const response = await page.goto(url(null, "/vs/not-a-rival"));
  expect(response?.status()).toBe(404);
});
