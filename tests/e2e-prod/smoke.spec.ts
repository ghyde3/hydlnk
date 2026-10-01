import { expect, test } from "@playwright/test";
import { expectNoHorizontalScroll } from "../e2e/helpers";

/**
 * Production smoke checks, read-only. Run with: pnpm test:e2e:prod
 * Status and redirect checks use the request fixture with maxRedirects 0 so a redirect is
 * reported as such instead of being followed. Production DNS is real, so Node resolves it fine.
 *
 * `app.hydlnk.com` is expected to answer 200 while the editor is a placeholder; revisit this when
 * the app host starts redirecting signed-out visitors to the sign-in page.
 */
test.describe("production smoke", { tag: "@prod" }, () => {
  test("hydlnk.com answers 200 over HTTPS", async ({ request }) => {
    const response = await request.get("https://hydlnk.com/", { maxRedirects: 0 });
    expect(response.status()).toBe(200);
    expect(response.url()).toMatch(/^https:\/\//);
  });

  test("www.hydlnk.com redirects to the apex with a 308", async ({ request }) => {
    const response = await request.get("https://www.hydlnk.com/", { maxRedirects: 0 });
    expect(response.status()).toBe(308);
    expect(response.headers()["location"]).toBe("https://hydlnk.com/");
  });

  test("app.hydlnk.com answers 200 over HTTPS", async ({ request }) => {
    const response = await request.get("https://app.hydlnk.com/", { maxRedirects: 0 });
    expect(response.status()).toBe(200);
    expect(response.url()).toMatch(/^https:\/\//);
  });

  test("an unknown handle subdomain answers 404 over HTTPS", async ({ request }) => {
    const response = await request.get("https://zz-no-such-handle-9f3.hydlnk.com/", {
      maxRedirects: 0,
    });
    expect(response.status()).toBe(404);
    expect(response.url()).toMatch(/^https:\/\//);
  });

  test("plain http upgrades to https", async ({ request }) => {
    const response = await request.get("http://hydlnk.com/", { maxRedirects: 0 });
    expect([301, 302, 307, 308]).toContain(response.status());
    expect(response.headers()["location"]).toMatch(/^https:\/\/hydlnk\.com\//);
  });

  test("marketing page renders in a browser without sideways scroll", async ({ page }) => {
    const response = await page.goto("https://hydlnk.com/");
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
    await expectNoHorizontalScroll(page);
  });
});
