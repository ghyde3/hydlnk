import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { cleanupUsers, phoneOnly, signedInUser } from "../fixtures/data";
import { appRaw, rawRequest } from "../fixtures/http";
import { expectNoHorizontalScroll, expectTapTargets, url } from "../helpers";

/**
 * M9-10 with Sentry OFF (NEXT_PUBLIC_SENTRY_DSN unset, the default of every local run): nothing of
 * Sentry reaches a page, no request goes to a Sentry host, the console is silent about it, no route
 * exists for it on any host, and the app's own error panel is the one it always was. The DSN-set
 * behaviour (one scrubbed envelope per error, none for marketing or a tenant) is in sentry-stub.spec.ts,
 * which runs against a build started with the DSN pointing at a local stub.
 */

test.afterAll(cleanupUsers);
test.describe.configure({ timeout: 120_000 });

/** What a Sentry module in a bundle looks like: its package path, its global, or its ingest host. */
const SENTRY_IN_CODE = /@sentry[+/]|__SENTRY__|\.ingest\.[a-z.]*sentry\.io|sentry\.io\/api/;
const SENTRY_URL = /sentry/i;

const SCREENS = ["/editor", "/design", "/share", "/analytics", "/domains"] as const;

interface Capture {
  requests: string[];
  scripts: Array<{ url: string; text: string }>;
  console: string[];
  errors: string[];
}

function capture(page: Page): Capture {
  const seen: Capture = { requests: [], scripts: [], console: [], errors: [] };
  page.on("request", (request) => seen.requests.push(request.url()));
  page.on("response", async (response) => {
    if (response.request().resourceType() !== "script") return;
    try {
      seen.scripts.push({ url: response.url(), text: await response.text() });
    } catch {
      // A response that went away with the page is not a script of this page.
    }
  });
  page.on("console", (message) => seen.console.push(message.text()));
  page.on("pageerror", (error) => seen.errors.push(error.message));
  return seen;
}

async function signedIn(context: BrowserContext) {
  return signedInUser(context, { label: "so", plan: "pro" });
}

test.describe("M9-10 with no DSN, the app host loads nothing of Sentry", () => {
  for (const screen of SCREENS) {
    test(`M9-10 ${screen}: no Sentry request, no Sentry chunk, a silent console, no widget, and the layout still fits`, async ({ page, context }, info) => {
      await signedIn(context);
      const seen = capture(page);
      await page.goto(url("app", screen), { waitUntil: "networkidle" });
      await expect(page.locator("main, [role=main]").first()).toBeVisible();
      // Give a lazily loaded chunk every chance to appear.
      await page.waitForTimeout(500);

      expect(seen.requests.filter((u) => SENTRY_URL.test(u))).toEqual([]);
      expect(seen.scripts.length).toBeGreaterThan(0);
      const naming = seen.scripts.filter((script) => SENTRY_IN_CODE.test(script.text) || SENTRY_URL.test(script.url));
      expect(naming.map((s) => s.url)).toEqual([]);
      expect(seen.console.filter((line) => /sentry/i.test(line))).toEqual([]);
      expect(seen.errors).toEqual([]);
      expect(await page.locator('#sentry-feedback, [id^="sentry-"], [class*="sentry"]').count()).toBe(0);
      expect(await page.evaluate(() => "__SENTRY__" in window || "Sentry" in window)).toBe(false);

      await expectNoHorizontalScroll(page);
      // 44px is the phone floor (docs/DESIGN.md); the desktop layout has its own, smaller controls.
      if (phoneOnly(info)) await expectTapTargets(page);
    });
  }
});

test.describe("M9-10 no route, no tunnel, on any host", () => {
  const unknown = "/zq-no-such-route-9d2f";

  test("M9-10 /monitoring is a plain 404 on the app host, a tenant host and the marketing site, like any unknown path", async ({}, info) => {
    test.skip(info.project.name !== "desktop", "raw HTTP: one project is enough");
    const app = await appRaw("/monitoring");
    expect(app.status).toBe(404);
    expect(app.body).toContain("That page doesn’t exist.");
    expect((await appRaw(unknown)).status).toBe(404);
    expect((await appRaw("/monitoring?x=1")).status).toBe(404);

    // A tenant host answers one plain 404 for any path: byte for byte the same as for an invented one.
    const tenant = await rawRequest("mara.localhost:3000", "/monitoring");
    const invented = await rawRequest("mara.localhost:3000", unknown);
    expect(tenant.status).toBe(404);
    expect(tenant.body).toBe(invented.body);
    expect(tenant.body).not.toMatch(/sentry/i);

    const marketing = await rawRequest("localhost:3000", "/monitoring");
    expect(marketing.status).toBe(404);
    expect((await rawRequest("localhost:3000", unknown)).status).toBe(404);
    for (const raw of [app, marketing]) expect(raw.body).not.toMatch(/sentry/i);
  });

  test("M9-10 a POST to /monitoring, where a tunnel would be, is not a route either", async ({}, info) => {
    test.skip(info.project.name !== "desktop", "raw HTTP: one project is enough");
    for (const host of ["app.localhost:3000", "mara.localhost:3000", "localhost:3000"]) {
      const res = await rawRequest(host, "/monitoring", { method: "POST", body: "{}", headers: { "content-type": "application/json" } });
      expect([404, 405], `${host} POST /monitoring`).toContain(res.status);
    }
  });
});

test.describe("M9-10 the error pages are the ones they always were", () => {
  test("M9-10 a thrown error on an app screen shows the app's own error panel and no Sentry request goes out", async ({ page, context }, info) => {
    test.skip(Boolean(process.env.E2E_PROD_BUILD) && !process.env.HYDLNK_QUERY_COUNTER, "the fault cookie is honoured by the dev server and a hooked build only");
    await signedIn(context);
    await context.addCookies([{ name: "hl-fault", value: "route-throw", url: url("app") }]);
    const seen = capture(page);
    await page.goto(url("app", "/settings"));
    await expect(page.getByTestId("error-message")).toHaveText("Something went wrong. Try again.");
    await expect(page.getByRole("button", { name: "Retry", exact: true })).toBeVisible();
    await expect(page.getByTestId("error-reference")).toHaveText(/^Reference: [A-Za-z0-9_-]{6,}$/);
    await page.waitForTimeout(300);
    expect(seen.requests.filter((u) => SENTRY_URL.test(u))).toEqual([]);
    await expectNoHorizontalScroll(page);
    void info;
  });
});
