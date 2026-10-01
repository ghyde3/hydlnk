import { expect, test } from "@playwright/test";
import { expectNoHorizontalScroll, expectTapTargets, url } from "./helpers";

/**
 * Host-routing smoke tests against the local dev server (pnpm dev, Supabase running and seeded).
 * Run both projects: pnpm exec playwright test --grep @smoke
 *
 * Selectors use roles and text only, so they survive markup changes. Local status and redirect
 * checks go through the browser (page.goto) rather than the request fixture: Chromium resolves
 * *.localhost to loopback by itself, while Node's resolver may return only ::1.
 */
test.describe("host routing smoke", { tag: "@smoke" }, () => {
  test("marketing page renders the nav and hero", async ({ page }) => {
    const response = await page.goto(url());
    expect(response?.status()).toBe(200);
    await expect(
      page.getByText("HYDLNK", { exact: true }).filter({ visible: true }).first(),
    ).toBeVisible();
    await expect(
      page
        .getByRole("link", { name: /log in/i })
        .filter({ visible: true })
        .first(),
    ).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
  });

  test("claim form hands the handle off to app signup", async ({ page }) => {
    await page.goto(url());
    const handle = "my-new-handle";
    await page.getByRole("textbox").filter({ visible: true }).first().fill(handle);
    const submit = page
      .getByRole("button", { name: /claim/i })
      .or(page.getByRole("link", { name: /claim/i }))
      .filter({ visible: true })
      .first();
    await submit.click();
    await page.waitForURL(`http://app.localhost:3000/signup?handle=${handle}`, {
      waitUntil: "commit",
    });
  });

  test("app host signed out lands on the log in page", async ({ page }) => {
    // Since M1 the app host's "/" is gated: signed out goes to /login, which renders (200).
    const response = await page.goto(url("app"));
    expect(response?.status()).toBe(200);
    expect(page.url()).toBe(url("app", "/login"));
    await expect(page.getByRole("heading", { level: 1, name: "Log in" })).toBeVisible();
  });

  test("tenant host shows the seeded demo page", async ({ page }) => {
    const response = await page.goto(url("mara"));
    expect(response?.status()).toBe(200);
    await expect(page.getByText("Mara Okafor").filter({ visible: true }).first()).toBeVisible();
  });

  test("unknown tenant handle returns 404", async ({ page }) => {
    const response = await page.goto(url("zz-no-such-handle"));
    expect(response?.status()).toBe(404);
  });

  test("internal path on the root host returns 404", async ({ page }) => {
    const response = await page.goto(url(null, "/t/mara"));
    expect(response?.status()).toBe(404);
  });

  test("www redirects to the root host with a 308", async ({ page }) => {
    const response = await page.goto(url("www"));
    expect(response, "navigation should produce a response").not.toBeNull();
    // Walk back to the first request in the redirect chain and read its status.
    let hop = response!.request().redirectedFrom();
    expect(hop, "www.localhost should redirect").not.toBeNull();
    while (hop!.redirectedFrom()) hop = hop!.redirectedFrom();
    expect((await hop!.response())?.status()).toBe(308);
    expect(page.url()).toBe(url());
  });

  test.describe("phone layout", () => {
    // isMobile is true only in the "phone" project (see scripts/lib/viewports.ts).
    test.skip(({ isMobile }) => !isMobile, "phone project only");

    test("marketing page has no horizontal scroll and 44px tap targets", async ({ page }) => {
      await page.goto(url());
      await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
      await expectNoHorizontalScroll(page);
      await expectTapTargets(page);
    });

    test("app page has no horizontal scroll", async ({ page }) => {
      await page.goto(url("app"));
      await expect(page.getByRole("heading", { level: 1, name: "Log in" })).toBeVisible();
      await expectNoHorizontalScroll(page);
    });

    test("tenant page has no horizontal scroll", async ({ page }) => {
      await page.goto(url("mara"));
      await expect(page.getByText("Mara Okafor").filter({ visible: true }).first()).toBeVisible();
      await expectNoHorizontalScroll(page);
    });
  });
});
