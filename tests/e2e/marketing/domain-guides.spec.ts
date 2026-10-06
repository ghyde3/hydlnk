import { expect, test } from "@playwright/test";
import { expectNoHorizontalScroll, url } from "../helpers";

/**
 * M13-01 smoke: the four registrar guides, at both projects (phone 390x844, desktop 1440x900).
 * Content pages skip the full browser suite (Gary 2026-10-06): one spec, the basics only.
 */
const SLUGS = [
  "connect-a-domain-godaddy",
  "connect-a-domain-namecheap",
  "connect-a-domain-squarespace",
  "connect-a-domain-cloudflare",
];

test("the guides are in the sitemap and linked from Connecting a domain", async ({ page }) => {
  const sitemap = await page.request.get(url(null, "/sitemap.xml"));
  const xml = await sitemap.text();
  for (const slug of SLUGS) expect(xml).toContain(`/learn/${slug}`);

  await page.goto(url(null, "/learn/connecting-a-domain"));
  for (const slug of SLUGS) {
    await expect(page.locator(`.link-list a[href="/learn/${slug}"]`)).toHaveCount(1);
  }
  await expectNoHorizontalScroll(page);
});

for (const slug of SLUGS) {
  test(`/learn/${slug} renders one h1, no sideways scroll, 44px links`, async ({ page }) => {
    const response = await page.goto(url(null, `/learn/${slug}`));
    expect(response?.status()).toBe(200);
    await expect(page.locator("h1")).toHaveCount(1);
    await expect(page.getByText("Checked October 2026")).toBeVisible();
    await expectNoHorizontalScroll(page);
    const links = page.locator(".link-list a");
    expect(await links.count()).toBeGreaterThanOrEqual(1);
    for (const link of await links.all()) {
      const box = await link.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(43.5);
    }
  });
}
