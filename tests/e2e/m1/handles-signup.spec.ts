import { expect, test, type Page } from "@playwright/test";
import { expectNoHorizontalScroll, expectTapTargets, url } from "../helpers";
import { adminClient } from "../fixtures/auth";
import {
  cleanupUsers,
  insertPage,
  makeUser,
  pagesOf,
  rand,
  signIn,
  trackEmail,
  userIdByEmail,
} from "../fixtures/data";
import { rawRequest } from "../fixtures/http";
import { getMessage, messagesTo, signInLinkFrom, waitForMessages } from "../fixtures/mailpit";
import { gsi, routeGoogleScript, setGoogleCredential, stubFace } from "../fixtures/google-stub";
import { GOOGLE_FAILED_MESSAGE } from "@/lib/auth/google-shared";

const RED = "rgb(178, 58, 43)"; // #B23A2B
const GREEN = "rgb(47, 125, 79)"; // #2F7D4F
const NEUTRAL_TEXT = "rgb(94, 90, 84)"; // #5E5A54
const BORDER_NEUTRAL = "rgb(217, 214, 208)"; // #D9D6D0

const MESSAGES = {
  short: "At least 3 characters — letters, numbers and dashes.",
  taken: "That one’s taken. Try another.",
  reserved: "That name is reserved. Try another.",
  invalid: "Handles can’t start or end with a dash or start with xn--.",
  too_long: "Handles can be up to 30 characters.",
  failed: "Couldn’t check that handle. Try again.",
};

const handleInput = (page: Page) => page.getByLabel("Handle", { exact: true });
const status = (page: Page) => page.locator("#su-handle-status");
const borderOf = (page: Page) =>
  handleInput(page).evaluate((el) => getComputedStyle(el.parentElement!).borderTopColor);
const colorOf = (page: Page) =>
  status(page)
    .locator("span")
    .first()
    .evaluate((el) => getComputedStyle(el).color);

test.afterAll(cleanupUsers);

test.describe("M1-11 signup handle field", () => {
  test("M1-11 normalizes as you type and the brand pill mirrors it", async ({ page, isMobile }) => {
    await page.goto(url("app", "/signup"));
    const input = handleInput(page);
    await expect(input).toHaveValue("");
    if (!isMobile) await expect(page.locator("aside")).toContainText("yourname.hydlnk.com");

    await input.fill("Zq_Test 9!");
    await expect(input).toHaveValue("zqtest9");
    if (!isMobile) await expect(page.locator("aside")).toContainText("zqtest9.hydlnk.com");

    await input.fill("");
    if (!isMobile) await expect(page.locator("aside")).toContainText("yourname.hydlnk.com");
  });

  test("M1-11 empty or short: neutral message, neutral border, no request", async ({ page }) => {
    const requests: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes("/api/handles/check")) requests.push(r.url());
    });
    await page.goto(url("app", "/signup"));
    await expect(status(page)).toHaveText(MESSAGES.short);
    await expect(handleInput(page)).toHaveValue("");

    await handleInput(page).fill("ab");
    await expect(status(page)).toHaveText(MESSAGES.short);
    expect(await colorOf(page)).toBe(NEUTRAL_TEXT);
    expect(await borderOf(page)).toBe(BORDER_NEUTRAL);
    await page.waitForTimeout(700);
    expect(requests).toEqual([]);
  });

  test("M1-11 live states after the debounce: taken, reserved, invalid, too long, available", async ({
    page,
  }) => {
    await page.goto(url("app", "/signup"));
    const input = handleInput(page);
    await expect(input).not.toHaveAttribute("maxlength", /.*/);

    await input.fill("mara");
    await expect(status(page)).toHaveText(MESSAGES.taken);
    expect(await colorOf(page)).toBe(RED);
    expect(await borderOf(page)).toBe(RED);

    for (const reserved of ["www", "app", "api"]) {
      await input.fill(reserved);
      await expect(status(page)).toHaveText(MESSAGES.reserved);
      expect(await colorOf(page)).toBe(RED);
    }
    for (const invalid of ["-mara", "xn--abc", "mara-"]) {
      await input.fill(invalid);
      await expect(status(page)).toHaveText(MESSAGES.invalid);
      expect(await borderOf(page)).toBe(RED);
    }
    await input.fill("a".repeat(31));
    await expect(status(page)).toHaveText(MESSAGES.too_long);
    await expect(input).toHaveValue("a".repeat(31));

    await input.fill("zq-live-1");
    await expect(status(page)).toHaveText("zq-live-1.hydlnk.com is available");
    expect(await colorOf(page)).toBe(GREEN);
    await expect(status(page).locator("svg")).toHaveCount(1);
  });

  test("M1-11 shows 'Checking…' in flight and discards stale responses", async ({ page }) => {
    await page.route("**/api/handles/check?handle=mara", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      await route.continue();
    });
    await page.goto(url("app", "/signup"));
    const input = handleInput(page);

    // The delayed request has to be in flight (past the debounce) when the next value is typed.
    const inFlight = page.waitForRequest(/\/api\/handles\/check\?handle=mara$/);
    await input.fill("mara");
    await expect(status(page)).toHaveText("Checking…");
    expect(await colorOf(page)).toBe(NEUTRAL_TEXT);
    await inFlight;

    await input.fill("zq-live-2");
    await expect(status(page)).toHaveText("Checking…");
    await expect(status(page)).toHaveText("zq-live-2.hydlnk.com is available");

    // The delayed 'mara' answer lands during the next second: it must never show.
    for (let i = 0; i < 8; i++) {
      await page.waitForTimeout(250);
      await expect(status(page)).toHaveText("zq-live-2.hydlnk.com is available");
    }
  });

  test("M1-11 a failing endpoint says so and leaves submit enabled", async ({ page, context }) => {
    await routeGoogleScript(context);
    await page.route("**/api/handles/check**", (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: '{"error":"check_failed"}',
      }),
    );
    await page.goto(url("app", "/signup"));
    await handleInput(page).fill("zq-fail-1");
    await expect(status(page)).toHaveText(MESSAGES.failed);
    expect(await colorOf(page)).toBe(NEUTRAL_TEXT);
    await expect(page.getByRole("button", { name: "Email me a sign-in link" })).toBeEnabled();
    // A failing check does not block Google's button (the server judges the handle again before
    // anyone is signed in): its face is live and no cover sits over it.
    await expect(stubFace(page)).toBeVisible();
    await expect(page.getByRole("button", { name: "Continue with Google" })).toHaveCount(0);
  });

  test("M1-11 the status region is a polite live region wired to the input", async ({ page }) => {
    await page.goto(url("app", "/signup"));
    const region = status(page);
    await expect(region).toHaveAttribute("aria-live", "polite");
    const describedBy = await handleInput(page).getAttribute("aria-describedby");
    expect(describedBy).toBe("su-handle-status");
    for (const value of ["", "mara", "zq-live-1", "-x"]) {
      await handleInput(page).fill(value);
      await expect(region).not.toHaveText("Checking…");
      const box = await region.boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(20);
    }
  });

  test("M1-11 ?handle= prefills, checks at once and renders server-side", async ({ page }) => {
    await page.goto(url("app", "/signup?handle=zq-pre-1"));
    await expect(handleInput(page)).toHaveValue("zq-pre-1");
    await expect(status(page)).toHaveText("zq-pre-1.hydlnk.com is available");

    await page.goto(url("app", "/signup?handle=Mara"));
    await expect(handleInput(page)).toHaveValue("mara");
    await expect(status(page)).toHaveText(MESSAGES.taken);

    // Before JS runs: the initial HTML already holds the normalized value.
    const html = await rawRequest("app.localhost:3000", "/signup?handle=Mara");
    expect(html.status).toBe(200);
    expect(html.body).toMatch(
      /<input[^>]*id="su-handle"[^>]*value="mara"|<input[^>]*value="mara"[^>]*id="su-handle"/,
    );
  });

  test("M1-11 hostile and long input: escaped, kept in full, other params ignored", async ({
    page,
  }) => {
    let dialogs = 0;
    page.on("dialog", async (dialog) => {
      dialogs++;
      await dialog.dismiss();
    });
    const hostile = encodeURIComponent("<script>alert(1)</script>");
    await page.goto(url("app", `/signup?handle=${hostile}`));
    await expect(handleInput(page)).toHaveValue("scriptalert1script");
    expect(dialogs).toBe(0);
    const html = await rawRequest("app.localhost:3000", `/signup?handle=${hostile}`);
    expect(html.body).not.toContain("<script>alert(1)");
    expect(html.body).not.toContain("alert(1)</script>");

    const long = "b".repeat(40);
    await page.goto(url("app", `/signup?handle=${long}`));
    await expect(handleInput(page)).toHaveValue(long);
    await expect(status(page)).toHaveText(MESSAGES.too_long);

    await page.goto(url("app", "/signup?other=zq-ignored-1&next=/evil"));
    await expect(handleInput(page)).toHaveValue("");
  });

  test("M1-11 phone: 30-character handle fits, long messages wrap, tap targets are 44px", async ({
    page,
    context,
    isMobile,
  }) => {
    test.skip(!isMobile, "phone project only");
    await routeGoogleScript(context);
    await page.goto(url("app", `/signup?handle=${"a".repeat(30)}`));
    await expect(status(page)).toHaveText(`${"a".repeat(30)}.hydlnk.com is available`);
    await expectNoHorizontalScroll(page);
    await expectTapTargets(page);

    // The long value scrolls inside the input.
    const scrolls = await handleInput(page).evaluate((el) => el.scrollWidth > el.clientWidth);
    expect(scrolls).toBe(true);

    await handleInput(page).fill("-mara");
    await expect(status(page)).toHaveText(MESSAGES.invalid);
    await expectNoHorizontalScroll(page);
    const box = (await status(page).boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    // Wraps inside the column instead of overflowing it, however long the message is.
    const overflows = await status(page).evaluate((el) => el.scrollWidth > el.clientWidth);
    expect(overflows).toBe(false);
  });

  test("M1-11 desktop: status under the field, pill wraps long values inside itself", async ({
    page,
    isMobile,
  }) => {
    test.skip(isMobile, "desktop project only");
    await page.goto(url("app", `/signup?handle=${"a".repeat(30)}`));
    await expect(status(page)).toHaveText(`${"a".repeat(30)}.hydlnk.com is available`);
    const input = (await handleInput(page).boundingBox())!;
    const line = (await status(page).boundingBox())!;
    expect(line.y).toBeGreaterThanOrEqual(input.y + input.height - 1);

    const pill = page.locator("aside span", { hasText: `${"a".repeat(30)}` }).first();
    await expect(pill).toBeVisible();
    expect(await pill.evaluate((el) => getComputedStyle(el).overflowWrap)).toBe("anywhere");
    const pillBox = (await pill.boundingBox())!;
    const asideBox = (await page.locator("aside").boundingBox())!;
    expect(pillBox.x + pillBox.width).toBeLessThanOrEqual(asideBox.x + asideBox.width);
  });
});

test.describe("M1-12 signup with an email sign-in link", () => {
  async function requestLink(page: Page, handle: string, email: string) {
    trackEmail(email);
    await page.goto(url("app", `/signup?handle=${handle}`));
    await expect(status(page)).toHaveText(`${handle}.hydlnk.com is available`);
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  }

  test("M1-12 sends one link, shows the sent state, and the link claims the handle on another device", async ({
    page,
    browser,
  }) => {
    const handle = `zq-su-${rand()}`;
    const email = `e2e-su-${rand()}@example.com`;
    await requestLink(page, handle, email);

    await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
    // The sent state replaces the form: its fields stay mounted but hidden.
    await expect(page.getByLabel("Email", { exact: true })).toBeHidden();
    await expect(page.getByLabel("Handle", { exact: true })).toBeHidden();
    await expect(
      page.getByText(
        `We emailed a sign-in link to ${email}. Open it to claim ${handle}.hydlnk.com.`,
      ),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Use a different email" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Resend link" })).toBeVisible();

    const messages = await waitForMessages(email, 1);
    expect(messages).toHaveLength(1);
    const link = signInLinkFrom((await getMessage(messages[0]!.ID)).HTML);

    // A brand-new browser context: a different device, no cookies, no local state.
    const device = await browser.newContext();
    const other = await device.newPage();
    await other.goto(link);
    await other.waitForURL("http://app.localhost:3000/editor", { timeout: 30_000 });
    await device.close();

    const userId = await userIdByEmail(email);
    expect(userId).toBeTruthy();
    const pages = await pagesOf(userId!);
    expect(pages).toHaveLength(1);
    expect(pages[0]).toMatchObject({ handle, owner_id: userId });
    const accounts = await adminClient().from("accounts").select("id").eq("id", userId!);
    expect(accounts.data).toHaveLength(1);
  });

  test("M1-12 taken, reserved, short and invalid handles are refused server-side before any email", async ({
    page,
  }) => {
    const email = `e2e-su-bad-${rand()}@example.com`;
    await page.goto(url("app", "/signup"));
    const emailField = page.getByLabel("Email", { exact: true });
    const submit = page.getByRole("button", { name: "Email me a sign-in link" });

    const cases: [string, string][] = [
      ["mara", MESSAGES.taken],
      ["www", MESSAGES.reserved],
      ["ab", MESSAGES.short],
      ["-x1", MESSAGES.invalid],
    ];
    for (const [handle, message] of cases) {
      await handleInput(page).fill(handle);
      await emailField.fill(email);
      await emailField.focus();
      await submit.click();
      await expect(status(page)).toHaveText(message);
      await expect(handleInput(page)).toBeFocused();
      await expect(page.getByRole("heading", { name: "Check your email" })).toHaveCount(0);
    }
    await page.waitForTimeout(500);
    expect(await messagesTo(email)).toHaveLength(0);
    // The abuse case: those submissions were the Server Action posts. No auth user was created.
    expect(await userIdByEmail(email)).toBeUndefined();
  });

  test("M1-12 an account that already has a page signing up again keeps one page", async ({
    page,
    browser,
  }) => {
    const email = `e2e-su-again-${rand()}@example.com`;
    const owned = `zq-own-${rand()}`;
    const fresh = `zq-new-${rand()}`;
    // Created through the admin API, not signInAs: generating a sign-in link would start the
    // provider's one-link-per-minute clock for this address before the form asks for one.
    const existing = await adminClient().auth.admin.createUser({ email, email_confirm: true });
    const userId = existing.data.user!.id;
    await insertPage(userId, owned);

    await requestLink(page, fresh, email);
    await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
    const messages = await waitForMessages(email, 1);
    const link = signInLinkFrom((await getMessage(messages.at(-1)!.ID)).HTML);

    const device = await browser.newContext();
    const other = await device.newPage();
    await other.goto(link);
    await other.waitForURL("http://app.localhost:3000/editor", { timeout: 30_000 });
    await device.close();

    const pages = await pagesOf(userId);
    expect(pages).toHaveLength(1);
    expect(pages[0]!.handle).toBe(owned);
  });

  test("M1-12 invalid email is reported inline and sends nothing; resend hits the rate limit message", async ({
    page,
  }) => {
    await page.goto(url("app", "/signup?handle=zq-em-1"));
    await expect(status(page)).toHaveText("zq-em-1.hydlnk.com is available");
    const emailField = page.getByLabel("Email", { exact: true });
    await emailField.fill("not-an-email");
    await page.getByRole("button", { name: "Email me a sign-in link" }).click();
    await expect(page.getByText("Enter a valid email address.")).toBeVisible();
    await expect(emailField).toBeFocused();
    await expect(page.getByRole("heading", { name: "Check your email" })).toHaveCount(0);

    // The provider allows one link per address per minute: an immediate resend is refused with
    // the same words as the log in screen, and the sent state stays on screen.
    const email = `e2e-su-rl-${rand()}@example.com`;
    trackEmail(email);
    await emailField.fill(email);
    await page.getByRole("button", { name: "Email me a sign-in link" }).click();
    await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
    await page.getByRole("button", { name: "Resend link" }).click();
    await expect(page.getByText("You can request another link in a minute.")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
    expect(await waitForMessages(email, 1)).toHaveLength(1);
  });

  test("M1-12 'Use a different email' returns to the form with the handle kept", async ({
    page,
  }) => {
    const handle = `zq-diff-${rand()}`;
    await requestLink(page, handle, `e2e-su-diff-${rand()}@example.com`);
    await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
    await page.getByRole("button", { name: "Use a different email" }).click();
    await expect(page.getByRole("heading", { name: "Check your email" })).toHaveCount(0);
    await expect(handleInput(page)).toHaveValue(handle);
    await expect(page.getByLabel("Email", { exact: true })).toHaveValue("");
  });

  test("M1-12 sent state layout: no horizontal scroll, 44px targets, full-width buttons / 400px column", async ({
    page,
    isMobile,
  }) => {
    const handle = `zq-lay-${rand()}`;
    await requestLink(page, handle, `e2e-su-lay-${rand()}@example.com`);
    await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
    const different = page.getByRole("button", { name: "Use a different email" });
    const resend = page.getByRole("button", { name: "Resend link" });

    if (isMobile) {
      await expectNoHorizontalScroll(page);
      await expectTapTargets(page);
      const main = (await page.locator("main > div").boundingBox())!;
      for (const button of [different, resend]) {
        const box = (await button.boundingBox())!;
        expect(Math.round(box.width)).toBe(Math.round(main.width));
        expect(box.height).toBeGreaterThanOrEqual(44);
      }
    } else {
      const column = (await page.locator("main > div").boundingBox())!;
      expect(column.width).toBeLessThanOrEqual(400);
      const box = (await different.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(column.x - 1);
      expect(box.x + box.width).toBeLessThanOrEqual(column.x + column.width + 1);
      await expect(page.locator("aside")).toContainText(`${handle}.hydlnk.com`);
    }
  });
});

/*
 * M1-13 was written for the redirect flow (a "Continue with Google" button that left for Supabase's
 * authorize endpoint with the handle in a short-lived cookie). Google sign-up is now Google's own
 * button handing the page an ID token (M1-30, tests/e2e/m5/google-signin.spec.ts), so these specs
 * keep the intent of M1-13 for it: an unusable handle never reaches Google and sets no cookie, a
 * usable one rides along to the server and never into a URL, and the layout holds. The last spec
 * (the pending-handle cookie claimed after sign-in) is unchanged. Google's script is stubbed.
 */
test.describe("M1-13 Google on signup (replaced by the Google Identity Services button)", () => {
  const AUTHORIZE = "http://127.0.0.1:54321/auth/v1/authorize**";

  test("M1-13 a usable handle reaches the server with the credential, never leaves for Supabase's authorize endpoint and sets no handle cookie when sign-in is refused", async ({
    page,
    context,
  }) => {
    await routeGoogleScript(context);
    const handle = `zq-gs-${rand()}`;
    let left = false;
    await context.route(AUTHORIZE, (route) => {
      left = true;
      return route.fulfill({ status: 200, contentType: "text/plain", body: "google stub" });
    });
    const urls: string[] = [];
    page.on("request", (request) => urls.push(request.url()));

    await page.goto(url("app", `/signup?handle=${handle}`));
    await expect(status(page)).toHaveText(`${handle}.hydlnk.com is available`);
    await expect(stubFace(page)).toBeVisible();
    // A usable handle: no cover over Google's button.
    await expect(page.getByRole("button", { name: "Continue with Google" })).toHaveCount(0);

    // A credential that is not a Google token: refused by the server before anyone is signed in.
    await setGoogleCredential(page, "not-a-token");
    await stubFace(page).click();
    await expect(page.locator('p[role="alert"]')).toHaveText(GOOGLE_FAILED_MESSAGE);
    expect((await gsi(page)).clicks).toBe(1);

    expect(left).toBe(false);
    expect(page.url()).toBe(url("app", `/signup?handle=${handle}`));
    expect(urls.filter((u) => u.includes("/auth/v1/authorize"))).toEqual([]);
    const cookies = await context.cookies("http://app.localhost:3000");
    expect(cookies.find((c) => c.name === "hl-pending-handle")).toBeUndefined();
    expect(cookies.filter((c) => c.name.startsWith("sb-"))).toEqual([]);
  });

  test("M1-13 an unusable handle never reaches Google and sets no cookie", async ({
    page,
    context,
  }) => {
    await routeGoogleScript(context);
    await page.goto(url("app", "/signup"));
    await expect(stubFace(page)).toBeAttached();
    // The cover over Google's button: an aria-disabled button that sends focus to the Handle field.
    const cover = page.getByRole("button", { name: "Continue with Google" });

    const cases: [string, string][] = [
      ["mara", MESSAGES.taken],
      ["www", MESSAGES.reserved],
      ["ab", MESSAGES.short],
      ["", MESSAGES.short],
    ];
    for (const [handle, message] of cases) {
      await handleInput(page).fill(handle);
      await page.getByLabel("Email", { exact: true }).focus();
      await expect(status(page)).toHaveText(message);
      await expect(cover).toHaveAttribute("aria-disabled", "true");
      // A real press lands on the cover (force: it is aria-disabled on purpose).
      await cover.click({ force: true });
      await expect(handleInput(page)).toBeFocused();
    }
    await page.waitForTimeout(500);
    // Google's button was never pressed (initialised once, never opened), and nothing was set.
    const state = await gsi(page);
    expect(state.clicks).toBe(0);
    expect(state.inits).toHaveLength(1);
    expect(page.url()).toContain("/signup");
    const cookies = await context.cookies("http://app.localhost:3000");
    expect(cookies.find((c) => c.name === "hl-pending-handle")).toBeUndefined();
  });

  test("M1-13 layout: Google's button spans the column on the phone, below the 'or' rule on desktop", async ({
    page,
    context,
    isMobile,
  }) => {
    await routeGoogleScript(context);
    await page.goto(url("app", "/signup?handle=zq-gs-1"));
    await expect(stubFace(page)).toBeVisible();
    const box = (await stubFace(page).boundingBox())!;
    const row = (await stubFace(page).locator("xpath=..").boundingBox())!;
    // Google draws its button 40px tall in its own iframe (no resizing); the row keeps 48px.
    expect(row.height).toBeGreaterThanOrEqual(48);
    if (isMobile) {
      await expectNoHorizontalScroll(page);
      await expectTapTargets(page);
      const column = (await page.locator("main > div").boundingBox())!;
      expect(Math.round(box.width)).toBe(Math.round(column.width));
    } else {
      const or = (await page.getByRole("separator").boundingBox())!;
      expect(box.y).toBeGreaterThan(or.y);
      const form = (await page.locator("main > div").boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(form.x - 1);
    }
  });

  test("M1-13 the pending-handle cookie is claimed after sign-in; bad cookies create nothing", async ({
    browser,
  }) => {
    async function visitClaim(
      cookieValue: string | null,
      email: string,
      opts: { handle?: string } = {},
    ) {
      const context = await browser.newContext();
      // The cookie is set when signup starts, before the user comes back through /auth/callback.
      if (cookieValue !== null) {
        await context.addCookies([
          { name: "hl-pending-handle", value: cookieValue, url: "http://app.localhost:3000" },
        ]);
      }
      const { userId } = await signIn(context, email, opts);
      const page = await context.newPage();
      await page.goto(url("app", "/claim"));
      await page.waitForLoadState("domcontentloaded");
      const landed = new URL(page.url()).pathname;
      const left = (await context.cookies("http://app.localhost:3000")).find(
        (c) => c.name === "hl-pending-handle",
      );
      await context.close();
      return { userId, landed, cookieStillThere: left !== undefined };
    }

    // A valid cookie: the page is created, the cookie cleared, the user lands in the editor.
    const good = `zq-ck-${rand()}`;
    const ok = await visitClaim(good, `zq-ck-ok-${rand()}@example.com`);
    expect(ok.landed).toBe("/editor");
    expect(ok.cookieStillThere).toBe(false);
    expect((await pagesOf(ok.userId)).map((p) => p.handle)).toEqual([good]);

    // Taken since: lands on /claim, nothing created (the cookie is cleared as well).
    const taken = await visitClaim("mara", `zq-ck-tk-${rand()}@example.com`);
    expect(taken.landed).toBe("/claim");
    expect(await pagesOf(taken.userId)).toHaveLength(0);
    expect(taken.cookieStillThere).toBe(false);

    // Tampered and over-long values: ignored, no page, plain claim step.
    for (const bad of ["WWW", "<script>x</script>", "x".repeat(40), "ab"]) {
      const result = await visitClaim(bad, `zq-ck-bad-${rand()}@example.com`);
      expect(result.landed, bad).toBe("/claim");
      expect(await pagesOf(result.userId), bad).toHaveLength(0);
    }

    // The account already has a page: no second page.
    const owned = `zq-ow-${rand()}`;
    const again = await visitClaim(`zq-two-${rand()}`, `zq-ck-two-${rand()}@example.com`, {
      handle: owned,
    });
    expect(again.landed).toBe("/editor");
    expect((await pagesOf(again.userId)).map((p) => p.handle)).toEqual([owned]);
    // ... and the callback dropped the cookie instead of leaving it for its 15 minutes.
    expect(again.cookieStillThere).toBe(false);
  });
});

// Used by the claim specs too.
export { makeUser };
