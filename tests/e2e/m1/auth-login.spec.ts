import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { expectNoHorizontalScroll, expectTapTargets, url } from "../helpers";
import { adminClient } from "../fixtures/auth";
import { uniq } from "../fixtures/data";
import { getMessage, messagesTo, waitForMessages } from "../fixtures/mailpit";
import { gsi, routeGoogleScript, stubFace } from "../fixtures/google-stub";
import { GOOGLE_NONCE_COOKIE } from "@/lib/auth/google-shared";

const LOGIN = url("app", "/login");
const SUPABASE = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";

/** Unique per run AND per project: phone and desktop run in parallel and must not rate-limit each other. */
const address = (label: string, project: string) => `${uniq(label)}-${project}@example.com`;

/** Opens /login and waits for hydration (the buttons stay disabled until then), so typing is never lost. */
async function openLogin(page: Page) {
  const response = await page.goto(LOGIN);
  await expect(page.getByRole("button", { name: "Email me a sign-in link" })).toBeEnabled();
  return response;
}
const alertsIn = (page: Page) => page.getByRole("alert");
const emailField = (page: Page) => page.getByLabel("Email", { exact: true });
const sendButton = (page: Page) => page.getByRole("button", { name: "Email me a sign-in link" });

test.describe("M1-03 log in page and email sign-in link", () => {
  test("M1-03 layout: charcoal panel, Log in form, no handle or password field", async ({
    page,
    context,
  }) => {
    await routeGoogleScript(context);
    const response = await openLogin(page);
    expect(response?.status()).toBe(200);
    await expect(page).toHaveTitle("HYDLNK — Log in");
    await expect(page.getByRole("heading", { level: 1, name: "Log in" })).toBeVisible();
    await expect(emailField(page)).toBeVisible();
    await expect(sendButton(page)).toBeVisible();
    await expect(page.getByText("or", { exact: true })).toBeVisible();
    // Google's own button (stubbed here, M1-29) sits below the "or" rule.
    await expect(stubFace(page)).toBeVisible();
    await expect(page.getByRole("link", { name: "Create your site" })).toHaveAttribute(
      "href",
      "/signup",
    );
    await expect(page.locator('input[type="password"]')).toHaveCount(0);
    await expect(page.locator('input[name*="handle" i], input[id*="handle" i]')).toHaveCount(0);
    // Uses the Signup layout: a charcoal panel next to (or above) the form.
    const panel = await page
      .locator("aside")
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(panel).toBe("rgb(28, 27, 26)");
  });

  test("M1-03 sent state, resend countdown, one message in the inbox", async ({
    page,
  }, testInfo) => {
    const email = address("login", testInfo.project.name);
    await page.clock.install();
    await openLogin(page);
    await emailField(page).fill(email);
    await sendButton(page).click();

    await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
    await expect(page.getByText(`We emailed a sign-in link to ${email}.`)).toBeVisible();
    const resend = page.getByRole("button", { name: /^Resend/ });
    await expect(resend).toBeDisabled();
    await expect(resend).toHaveText("Resend in 60s");

    // Exactly one message reaches the local inbox within 10 s.
    const first = await waitForMessages(email, 1, 10_000);
    expect(first).toHaveLength(1);

    await page.clock.runFor(30_000);
    await expect(resend).toHaveText(/Resend in (29|30)s/);
    await expect(resend).toBeDisabled();
    await page.clock.runFor(31_000);
    await expect(resend).toHaveText("Resend link");
    await expect(resend).toBeEnabled();

    await new Promise((r) => setTimeout(r, 1000));
    expect(await messagesTo(email)).toHaveLength(1);

    // 'Use a different email' returns to the form, field cleared and focused.
    await page.getByRole("button", { name: "Use a different email" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Log in" })).toBeVisible();
    await expect(emailField(page)).toHaveValue("");
    await expect(emailField(page)).toBeFocused();
  });

  test("M1-03 the email: subject, parts, one link, copy, sizes", async ({ page }, testInfo) => {
    const email = address("mail", testInfo.project.name);
    await openLogin(page);
    await emailField(page).fill(email);
    await sendButton(page).click();
    await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();

    const [summary] = await waitForMessages(email, 1, 10_000);
    expect(summary).toBeTruthy();
    const message = await getMessage(summary!.ID);

    expect(message.Subject).toBe("Your HYDLNK sign-in link");
    expect(message.HTML.length).toBeGreaterThan(100);
    expect(message.Text.length).toBeGreaterThan(20);

    const anchors = [...message.HTML.matchAll(/<a\s[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)];
    expect(anchors).toHaveLength(1);
    const href = anchors[0]![1]!.replaceAll("&amp;", "&");
    expect(anchors[0]![2]!.replace(/<[^>]+>/g, "").trim()).toBe("Sign in to HYDLNK");
    expect(href.startsWith("http://app.localhost:3000/auth/callback")).toBe(true);
    expect(href).not.toContain("supabase.co");
    expect(href).not.toContain("/auth/v1/verify");
    expect(message.Text).toContain(href);

    const plain = message.Text.replace(/\s+/g, " ");
    expect(plain).toContain("works once");
    expect(plain).toContain("expires in 1 hour");
    expect(plain).toContain("If you didn’t ask for this, ignore this email.");
    expect(message.HTML.replace(/<!doctype[^>]*>/i, "")).not.toContain("!");
    expect(message.Text).not.toContain("!");

    // No fixed width above 600px, and the link button is at least 44px tall, at both viewports.
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.setContent(message.HTML);
      const link = page.locator("a");
      const box = await link.boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
      const widest = await page.evaluate(() =>
        // The card is the only table; whatever wraps it may be full-bleed.
        Math.max(
          ...Array.from(document.querySelectorAll("table")).map(
            (t) => t.getBoundingClientRect().width,
          ),
        ),
      );
      expect(widest).toBeLessThanOrEqual(width <= 600 ? width : 600);
      await expectNoHorizontalScroll(page);
    }
    expect(
      Math.max(...[...message.HTML.matchAll(/\bwidth:\s*(\d+)px/g)].map((m) => Number(m[1])), 0),
    ).toBeLessThanOrEqual(600);
  });

  test("M1-03 no account enumeration: unknown and known addresses get the same state and an email", async ({
    page,
  }, testInfo) => {
    const unknown = address("never-seen", testInfo.project.name);
    const known = address("known", testInfo.project.name);
    const created = await adminClient().auth.admin.createUser({
      email: known,
      email_confirm: true,
    });
    expect(created.error).toBeNull();

    const sentStates: string[] = [];
    for (const email of [unknown, known]) {
      await openLogin(page);
      await emailField(page).fill(email);
      await sendButton(page).click();
      await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
      const text = (await page.locator("main").innerText()).split(email).join("<email>");
      sentStates.push(text);
      expect(await waitForMessages(email, 1, 10_000)).toHaveLength(1);
    }
    expect(sentStates[0]).toBe(sentStates[1]);
    await adminClient().auth.admin.deleteUser(created.data.user!.id);
  });

  test("M1-03 invalid input shows an alert, sends no request and refocuses the field", async ({
    page,
    context,
  }) => {
    await routeGoogleScript(context);
    await openLogin(page);
    // Google's button asks the server for its nonce when the page loads (M1-29): let that finish,
    // so what is recorded below is only what pressing the email button sends.
    await expect(stubFace(page)).toBeVisible();
    await expect.poll(async () => (await gsi(page)).inits.length).toBe(1);
    const posts: string[] = [];
    page.on("request", (r) => {
      if (r.method() === "POST") posts.push(r.url());
    });
    for (const value of ["", "not-an-email"]) {
      await emailField(page).fill(value);
      await page.getByRole("heading", { level: 1 }).click(); // move focus away
      await sendButton(page).click();
      await expect(
        alertsIn(page).filter({ hasText: "Enter a valid email address." }),
      ).toBeVisible();
      await expect(emailField(page)).toBeFocused();
    }
    expect(posts).toEqual([]);
  });

  test("M1-03 a second request for the same address within a minute says to wait", async ({
    page,
  }, testInfo) => {
    const email = address("limit", testInfo.project.name);
    await openLogin(page);
    await emailField(page).fill(email);
    await sendButton(page).click();
    await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
    await page.getByRole("button", { name: "Use a different email" }).click();
    await emailField(page).fill(email);
    await sendButton(page).click();
    const alert = alertsIn(page).filter({ hasText: "You can request another link in a minute." });
    await expect(alert).toBeVisible();
    await expect(page.locator("body")).not.toContainText("For security purposes");
    expect(await messagesTo(email)).toHaveLength(1);
  });

  test("M1-03 local rate limits let 20 addresses in an hour all deliver, template is wired in config", async ({}, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "one project is enough for a config check");
    const config = readFileSync("supabase/config.toml", "utf8");
    expect(config).toMatch(
      /\[auth\.email\.template\.magic_link\][^[]*content_path\s*=\s*"\.\/supabase\/templates\/magic-link\.html"/,
    );
    expect(config).toMatch(
      /\[auth\.email\.template\.magic_link\][^[]*subject\s*=\s*"Your HYDLNK sign-in link"/,
    );
    expect(Number(/^email_sent\s*=\s*(\d+)/m.exec(config)?.[1])).toBeGreaterThanOrEqual(20);

    const run = uniq("bulk");
    const addresses = Array.from({ length: 20 }, (_, i) => `${run}-${i}@example.com`);
    const results = await Promise.all(
      addresses.map((email) =>
        fetch(`${SUPABASE}/auth/v1/otp`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? readKey(),
          },
          body: JSON.stringify({ email }),
        }).then((r) => r.status),
      ),
    );
    expect(results).toEqual(Array(20).fill(200));
    for (const email of addresses) expect(await waitForMessages(email, 1, 15_000)).toHaveLength(1);
  });

  test.describe("phone layout", () => {
    test.skip(({ isMobile }) => !isMobile, "phone project only");

    test("M1-03 at 390x844: no horizontal scroll, 44px targets, slim logo-only bar, 16px inputs", async ({
      page,
      context,
    }, testInfo) => {
      // Google's real script draws its own 40px button when it loads in time (CI); the stub keeps
      // the page's own 44px control the thing under test, as the other tests in this file do.
      await routeGoogleScript(context);
      await openLogin(page);
      await expect(page.getByRole("heading", { level: 1, name: "Log in" })).toBeVisible();
      await expectNoHorizontalScroll(page);
      await expectTapTargets(page);
      const bar = await page.locator("aside").boundingBox();
      expect(bar!.height).toBeLessThanOrEqual(80);
      expect(bar!.width).toBeGreaterThanOrEqual(389);
      await expect(page.getByText("Claim your name.")).toBeHidden();
      await expect(page.getByText("Free forever. No card required.")).toBeHidden();
      expect(
        await emailField(page).evaluate((el) => parseFloat(getComputedStyle(el).fontSize)),
      ).toBeGreaterThanOrEqual(16);

      // Sent state fits too.
      await emailField(page).fill(address("phone", testInfo.project.name));
      await sendButton(page).click();
      await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
      await expectNoHorizontalScroll(page);
      await expectTapTargets(page);
    });
  });

  test.describe("desktop layout", () => {
    test.skip(({ isMobile }) => isMobile, "desktop project only");

    test("M1-03 at 1440x900: two columns, 400px form column, 48px primary button, sent state in place", async ({
      page,
    }, testInfo) => {
      await openLogin(page);
      const panel = await page.locator("aside").boundingBox();
      const main = await page.locator("main").boundingBox();
      expect(panel!.x).toBe(0);
      expect(panel!.width).toBeGreaterThanOrEqual(480);
      expect(main!.x).toBeGreaterThanOrEqual(panel!.x + panel!.width - 1);
      const column = await page.locator("main > div").boundingBox();
      expect(column!.width).toBeLessThanOrEqual(400);
      const primary = await sendButton(page).boundingBox();
      expect(primary!.height).toBe(48);

      await emailField(page).fill(address("wide", testInfo.project.name));
      await sendButton(page).click();
      const heading = page.getByRole("heading", { name: "Check your email" });
      await expect(heading).toBeVisible();
      const headingBox = await heading.boundingBox();
      expect(headingBox!.x).toBeCloseTo(column!.x, 0);
      expect(headingBox!.width).toBeLessThanOrEqual(400);
    });
  });
});

function readKey(): string {
  const text = readFileSync(".env.local", "utf8");
  return /^NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=(.*)$/m.exec(text)![1]!.trim();
}

/*
 * M1-08 was written for the redirect flow (a "Continue with Google" button that started Supabase's
 * PKCE authorize request). Google sign-in is now Google's own button handing the page an ID token
 * (M1-29, tests/e2e/m5/google-signin.spec.ts), so these specs keep the intent of M1-08 for it:
 * the button is on the page below the "or" rule, pressing it never sends the browser off to
 * Supabase's authorize endpoint, a failed external sign-in lands on /login with a message and no
 * session, and the layout holds at 390 and 1440. Google's script is stubbed; Google is never driven.
 */
test.describe("M1-08 Google on the log in page (replaced by the Google Identity Services button)", () => {
  test("M1-08 the button is Google's own: initialised once, popup mode, and pressing it never starts a redirect to Supabase's authorize endpoint", async ({
    page,
    context,
  }) => {
    await routeGoogleScript(context);
    let authorize: string | undefined;
    await page.route("**/auth/v1/authorize**", async (route) => {
      authorize = route.request().url();
      await route.fulfill({ status: 200, contentType: "text/html", body: "<p>intercepted</p>" });
    });
    await openLogin(page);
    await expect(stubFace(page)).toBeVisible();

    const state = await gsi(page);
    expect(state.inits).toHaveLength(1);
    expect(state.inits[0]).toMatchObject({ ux_mode: "popup", auto_select: false });
    expect(state.inits[0]!.client_id.length).toBeGreaterThan(0);
    // The nonce handed to Google is a hash; the raw value stays in an httpOnly cookie.
    expect(state.inits[0]!.nonce).toMatch(/^[0-9a-f]{64}$/);
    expect(
      (await context.cookies(LOGIN)).find((c) => c.name === GOOGLE_NONCE_COOKIE)?.httpOnly,
    ).toBe(true);

    // A press with no usable credential stays on the page: nothing goes to /authorize.
    await stubFace(page).click();
    await page.waitForTimeout(500);
    expect(authorize).toBeUndefined();
    expect(page.url()).toBe(LOGIN);
  });

  test("M1-08 the callback is in the local redirect allow-list", async () => {
    const config = readFileSync("supabase/config.toml", "utf8");
    const list = /additional_redirect_urls\s*=\s*\[([^\]]*)\]/.exec(config)?.[1] ?? "";
    expect(list).toContain('"http://app.localhost:3000/auth/callback"');
  });

  test("M1-08 a failed external sign-in lands on /login with the message and no session", async ({
    page,
    context,
  }) => {
    const response = await page.goto(
      url("app", "/auth/callback?error=access_denied&error_description=The+user+denied+access"),
    );
    expect(response?.status()).toBe(200);
    await expect(page).toHaveURL(url("app", "/login?error=link_invalid"));
    await expect(
      page.getByText("That sign-in link expired or was already used. Request a new one."),
    ).toBeVisible();
    expect((await context.cookies()).filter((c) => c.name.startsWith("sb-"))).toEqual([]);
  });

  test.describe("phone layout", () => {
    test.skip(({ isMobile }) => !isMobile, "phone project only");
    test("M1-08 at 390x844: Google's button spans the form column inside a row at least 48px tall", async ({
      page,
      context,
    }) => {
      await routeGoogleScript(context);
      await openLogin(page);
      await expect(stubFace(page)).toBeVisible();
      await expectNoHorizontalScroll(page);
      await expectTapTargets(page);
      // Google draws its button 40px tall inside its own iframe and does not allow resizing it; the
      // row around it keeps the 48px height.
      const face = (await stubFace(page).boundingBox())!;
      const row = (await stubFace(page).locator("xpath=..").boundingBox())!;
      const form = (await page.locator("form").boundingBox())!;
      expect(row.height).toBeGreaterThanOrEqual(48);
      expect(face.width).toBeCloseTo(form.width, 0);
    });
  });

  test.describe("desktop layout", () => {
    test.skip(({ isMobile }) => isMobile, "desktop project only");
    test("M1-08 at 1440x900: Google's button below the or divider in the 400px column", async ({
      page,
      context,
    }) => {
      await routeGoogleScript(context);
      await openLogin(page);
      await expect(stubFace(page)).toBeVisible();
      const divider = await page.getByText("or", { exact: true }).boundingBox();
      const button = (await stubFace(page).boundingBox())!;
      const row = (await stubFace(page).locator("xpath=..").boundingBox())!;
      const column = await page.locator("main > div").boundingBox();
      expect(button.y).toBeGreaterThan(divider!.y);
      expect(row.height).toBeGreaterThanOrEqual(48);
      expect(button.width).toBeLessThanOrEqual(400);
      expect(button.x).toBeGreaterThanOrEqual(column!.x - 1);
    });
  });
});
