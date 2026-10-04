import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { cleanupUsers, makeUser, phoneOnly, desktopOnly } from "../fixtures/data";
import { signInAs } from "../fixtures/auth";
import { FAULT_COOKIE_IGNORED, PRODUCTION_BUILD, appRaw, rawRequest } from "../fixtures/http";
import { expectNoHorizontalScroll, expectTapTargets, url } from "../helpers";
import { emptyUser } from "../m2/editor-helpers";

/**
 * M5-20: the not-found, error and sign-in failure pages. Phone project = 390x844, desktop =
 * 1440x900. Statuses and bodies are read raw (no browser), the layout in the browser.
 *
 * "A route that throws" needs a server failure that a Playwright route cannot cause; the
 * `hl-fault=route-throw` cookie makes Settings throw (src/lib/testing/faults.ts: on the dev server
 * and on a production build started with the test hooks, as CI does; a production server without
 * them ignores it, so those specs skip against one).
 */

test.afterAll(cleanupUsers);

const NOT_FOUND = "That page doesn’t exist.";
const ERROR = "Something went wrong. Try again.";
const EXPIRED = "That sign-in link expired or was already used. Request a new one.";

const setFault = (context: BrowserContext, name: string) =>
  context.addCookies([{ name: "hl-fault", value: name, url: url("app") }]);

async function expectLayout(page: Page): Promise<void> {
  await expectNoHorizontalScroll(page);
  await expectTapTargets(page);
}

test.describe("M5-20 the app host's 404", () => {
  test("M5-20 signed out: 404 with the sentence and a link to the Editor, on a plain HYDLNK page", async ({
    page,
  }) => {
    const raw = await appRaw("/nope");
    expect(raw.status).toBe(404);
    expect(raw.body).toContain(NOT_FOUND);
    expect(raw.body).not.toMatch(/signed in as|sign out/i);

    const response = await page.goto(url("app", "/nope"));
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(NOT_FOUND);
    const link = page.getByRole("link", { name: "Go to the Editor" });
    await expect(link).toHaveAttribute("href", "/editor");
    // Plain: no app shell around it.
    await expect(page.getByRole("navigation", { name: /^App/ })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "HYDLNK home" })).toBeVisible();
    await expectLayout(page);
    // Chrome of Signup.dc.html: the charcoal bar with the logo over a light page.
    const bar = page.locator("body > div > div").first();
    expect(await bar.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(
      "rgb(28, 27, 26)",
    );
    // The link goes to the Editor, which sends a signed-out visitor to sign-in.
    await link.click();
    await page.waitForURL(url("app", "/login"));
  });

  test("M5-20 signed in: the same 404 inside the app shell, with the link to the Editor", async ({
    page,
    context,
  }) => {
    await emptyUser(context, "nf");
    const response = await page.goto(url("app", "/nope"));
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(NOT_FOUND);
    // The shell is drawn: the sidebar on desktop, the tab bar on the phone.
    const nav = phoneOnly(test.info())
      ? page.getByRole("navigation", { name: "App sections" })
      : page.getByRole("navigation", { name: "App", exact: true });
    await expect(nav).toBeVisible();
    // One <main>, with the 404 inside it.
    await expect(page.locator("main")).toHaveCount(1);
    await expect(page.locator("main").getByRole("heading", { level: 1 })).toHaveText(NOT_FOUND);
    await expectLayout(page);

    await page.getByRole("link", { name: "Go to the Editor" }).click();
    await page.waitForURL(url("app", "/editor"));
    await expect(page.getByLabel("Display name", { exact: true })).toBeVisible();
  });

  test("M5-20 signed in with no page yet: the plain 404 (not a redirect to /claim)", async ({
    page,
    context,
  }) => {
    // The gate sends a pageless account to /claim from every screen; a 404 must still answer 404.
    const user = await makeUser("nf0");
    await signInAs(context, user.email);
    const response = await page.goto(url("app", "/nope"), { waitUntil: "domcontentloaded" });
    expect(response?.status()).toBe(404);
    await expect(page).toHaveURL(url("app", "/nope"));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(NOT_FOUND);
    await expect(page.getByRole("navigation", { name: /^App/ })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Go to the Editor" })).toBeVisible();
  });

  test("M5-20 deep unknown paths and API-looking ones are the same 404", async ({
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "no UI involved");
    await emptyUser(context, "nf2");
    for (const path of ["/nope/deeper/still", "/editor/nope", "/pages/nope", "/%E0%A4%A"]) {
      const res = await appRaw(path);
      // `next start` answers a malformed escape (%E0%A4%A) with its own plain 500, before any route
      // of ours (the same on the root host; there is no decode in src/proxy.ts). `next dev` answers
      // 400 and Vercel's edge rejects it with 400 before the app is reached.
      const accepted = PRODUCTION_BUILD && path.includes("%E0%A4%A") ? [404, 400, 500] : [404, 400];
      expect(accepted, path).toContain(res.status);
    }
  });
});

test.describe("M5-20 the marketing 404", () => {
  test("M5-20 the root host's unknown path is a 404 with the marketing nav and footer", async ({
    page,
  }) => {
    const raw = await rawRequest("localhost:3000", "/nope");
    expect(raw.status).toBe(404);
    const response = await page.goto(url(null, "/nope"));
    expect(response?.status()).toBe(404);
    await expect(page.locator("header").first()).toBeVisible();
    await expect(page.locator("footer")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expectLayout(page);
  });
});

test.describe("M5-20 an address that is not a handle", () => {
  test("M5-20 a reserved address says so, offers no claim button and answers 404", async ({
    page,
  }) => {
    const raw = await rawRequest("admin.localhost:3000", "/");
    expect(raw.status).toBe(404);
    expect(raw.body).toContain("That address is reserved.");
    expect(raw.body).not.toMatch(/Claim /);
    expect(raw.body).not.toContain("This address isn’t claimed.");
    expect(raw.headers["set-cookie"]).toBeUndefined();

    const response = await page.goto(url("admin", "/"));
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("That address is reserved.");
    await expect(page.getByRole("link", { name: /^Claim/ })).toHaveCount(0);
    await expect(page.locator('a[href*="signup"]')).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Go to hydlnk.com" })).toBeVisible();
    await expectLayout(page);
  });

  test("M5-20 an invalid address says so, offers no claim button and answers 404", async ({
    page,
  }) => {
    for (const host of ["ab", "-x1", "a--b-", "x".repeat(31)]) {
      const raw = await rawRequest(`${host}.localhost:3000`, "/");
      expect(raw.status, host).toBe(404);
      expect(raw.body, host).toContain("That address isn’t valid.");
      expect(raw.body, host).not.toMatch(/Claim /);
    }
    const response = await page.goto(url("ab", "/"));
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("That address isn’t valid.");
    await expect(page.getByRole("link", { name: /^Claim/ })).toHaveCount(0);
    await expect(page.locator('a[href*="signup"]')).toHaveCount(0);
    await expectLayout(page);
  });

  test("M5-20 a free, valid address still offers to claim it (nothing else changed)", async ({}, info) => {
    test.skip(!desktopOnly(info), "no UI involved");
    const raw = await rawRequest(
      `zq-free-${Math.random().toString(36).slice(2, 8)}.localhost:3000`,
      "/",
    );
    expect(raw.status).toBe(404);
    expect(raw.body).toContain("This address isn’t claimed.");
  });

  test("M5-20 a reserved or invalid address does not echo itself back or leak the other panel", async ({}, info) => {
    test.skip(!desktopOnly(info), "no UI involved");
    const reserved = await rawRequest("billing.localhost:3000", "/");
    expect(reserved.body).toContain("That address is reserved.");
    expect(reserved.body).not.toContain("That address isn’t valid.");
    const invalid = await rawRequest("ab.localhost:3000", "/");
    expect(invalid.body).toContain("That address isn’t valid.");
    expect(invalid.body).not.toContain("That address is reserved.");
  });
});

test.describe("M5-20 sign-in link failures", () => {
  test("M5-20 /auth/callback?code=invalid lands on sign-in with the expired-link message and the email field focused", async ({
    page,
  }) => {
    const raw = await appRaw("/auth/callback?code=invalid");
    expect(raw.status).toBe(303);
    expect(raw.location).toContain("/login?error=link_invalid");
    expect(raw.body).not.toMatch(/^\s*[{[]/);

    await page.goto(url("app", "/auth/callback?code=invalid"));
    await page.waitForURL(/\/login\?error=link_invalid/);
    await expect(page.getByRole("alert").filter({ hasText: EXPIRED })).toBeVisible();
    await expect(page.getByLabel("Email", { exact: true })).toBeFocused();
    // Not blank, not JSON.
    expect((await page.locator("body").innerText()).trim().startsWith("{")).toBe(false);
    await expectLayout(page);
  });

  test("M5-20 an emailed link that is wrong, expired or of the wrong kind ends the same way", async ({
    page,
  }) => {
    for (const query of [
      "token_hash=not-a-real-token&type=email",
      "token_hash=x&type=recovery",
      "code=",
      "token_hash=",
    ]) {
      await page.goto(url("app", `/auth/callback?${query}`));
      await page.waitForURL(/\/login(\?error=link_invalid)?$/);
      await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
    }
    await page.goto(url("app", "/auth/callback?token_hash=not-a-real-token&type=email"));
    await page.waitForURL(/\/login\?error=link_invalid/);
    await expect(page.getByText(EXPIRED)).toBeVisible();
    await expect(page.getByLabel("Email", { exact: true })).toBeFocused();
  });

  test("M5-20 a message arriving from a callback is only ever one of ours (nothing from the URL reaches the page)", async ({
    page,
  }) => {
    await page.goto(url("app", "/login?error=%3Cb%3Ehello%3C%2Fb%3E"));
    await expect(page.getByRole("heading", { name: "Log in" })).toBeVisible();
    await expect(page.locator("body")).not.toContainText("hello");
    // (Next's own route announcer is a role=alert too, and empty.)
    await expect(page.getByRole("alert").filter({ hasText: /\S/ })).toHaveCount(0);
  });
});

test.describe("M5-20 a route that throws", () => {
  test.skip(
    FAULT_COOKIE_IGNORED,
    "this production server was started without the test hooks, so it ignores the fault cookie",
  );

  test("M5-20 the error boundary: the sentence, Retry and a small reference id, inside the shell, no stack trace", async ({
    page,
    context,
  }) => {
    await emptyUser(context, "er");
    await setFault(context, "route-throw");
    await page.goto(url("app", "/settings"));
    const message = page.getByTestId("error-message");
    await expect(message).toHaveText(ERROR);
    await expect(message).toHaveAttribute("role", "alert");
    const retry = page.getByRole("button", { name: "Retry", exact: true });
    await expect(retry).toBeVisible();
    const reference = page.getByTestId("error-reference");
    await expect(reference).toHaveText(/^Reference: [A-Za-z0-9_-]{6,}$/);
    // The shell stays; no stack trace, no message, no file names.
    const nav = phoneOnly(test.info())
      ? page.getByRole("navigation", { name: "App sections" })
      : page.getByRole("navigation", { name: "App", exact: true });
    await expect(nav).toBeVisible();
    const text = await page.locator("main").innerText();
    expect(text).not.toMatch(
      /Injected fault|Error:|\bat\s+\S+\s+\(|\.tsx?:\d+|node_modules|stack/i,
    );
    expect(text).not.toContain("route-throw");
    await expectLayout(page);

    // Retry while the fault is on: the same boundary, no crash.
    await retry.click();
    await expect(message).toHaveText(ERROR);
    // The fault is gone: Retry renders the screen.
    await context.clearCookies({ name: "hl-fault" });
    await retry.click();
    await expect(page.getByRole("heading", { level: 1, name: "Settings & billing" })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByTestId("error-message")).toHaveCount(0);
  });

  test("M5-20 the reference on the page is the one the server logged for that error", async ({
    page,
    context,
  }) => {
    await emptyUser(context, "er2");
    await setFault(context, "route-throw");
    await page.goto(url("app", "/settings"));
    const reference = (await page.getByTestId("error-reference").innerText())
      .replace("Reference: ", "")
      .trim();
    // A digest is a hash of the server error: stable shape, never the message.
    expect(reference).toMatch(/^[A-Za-z0-9_-]{6,}$/);
    expect(reference.toLowerCase()).not.toContain("fault");
  });
});
