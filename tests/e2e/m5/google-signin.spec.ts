import { createHash } from "node:crypto";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import {
  GOOGLE_EXPIRED_MESSAGE,
  GOOGLE_FAILED_MESSAGE,
  GOOGLE_NONCE_COOKIE,
  GOOGLE_UNAVAILABLE_MESSAGE,
} from "@/lib/auth/google-shared";
import { PENDING_HANDLE_COOKIE } from "@/lib/handles/pending";
import { expectNoHorizontalScroll, expectTapTargets, url } from "../helpers";
import { rand } from "../fixtures/data";
import { gsi, routeGoogleScript, stubFace } from "../fixtures/google-stub";

/**
 * Google sign-in through Google Identity Services (M1-29 on /login, M1-30 on /signup).
 *
 * Google's script is stubbed with page routing: `renderButton` draws a plain face that, when
 * pressed, hands the test's credential to the callback the page registered with `initialize`,
 * exactly as Google's iframe would. Everything after that is the real thing: the real Server
 * Action, the real nonce cookie, the real local Supabase. The local Supabase has the Google
 * provider switched off (and a fake token has no valid signature anyway), so the sign-in itself
 * is always refused. That is the point of the specs: they prove the credential REACHES the action
 * and that every refusal is friendly, leaves no session, spends the nonce and sets no cookie.
 * The success path (valid token -> session, account row, pending handle) is covered by
 * tests/unit/auth-google-signin.test.ts against a mocked Supabase. There is deliberately no
 * test-only switch in the app that skips Google's verification: such a switch would be a
 * production-reachable way to sign in as anyone.
 *
 * Needs NEXT_PUBLIC_GOOGLE_CLIENT_ID on the dev server (a placeholder is fine: the id is never
 * sent to Google here). Without it the button is hidden, and the specs fail with that reason.
 */

const APP_ORIGIN = url("app").replace(/\/$/, "");

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const b64url = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");

/** A Google-looking ID token with a junk signature (nothing here verifies one: Supabase would). */
function fakeIdToken(claims: Record<string, unknown>): string {
  return `${b64url({ alg: "RS256", typ: "JWT" })}.${b64url({
    iss: "https://accounts.google.com",
    sub: "1234567890",
    email: "person@example.com",
    exp: Math.floor(Date.now() / 1000) + 3600,
    ...claims,
  })}.c2ln`;
}

async function nonceCookie(context: BrowserContext) {
  return (await context.cookies(APP_ORIGIN)).find((c) => c.name === GOOGLE_NONCE_COOKIE);
}

/** A token the way Google would issue it for the page as it stands: this page's client id and nonce. */
async function tokenForThisPage(page: Page, context: BrowserContext): Promise<string> {
  const { inits } = await gsi(page);
  const cookie = await nonceCookie(context);
  expect(cookie, "nonce cookie").toBeTruthy();
  return fakeIdToken({ aud: inits.at(-1)!.client_id, nonce: sha256(cookie!.value) });
}

const setCredential = (page: Page, credential: string) =>
  page.evaluate((value) => {
    (window as unknown as { __gsiCredential: string }).__gsiCredential = value;
  }, credential);

async function open(page: Page, context: BrowserContext, path: string, stub = true) {
  await routeGoogleScript(context, stub);
  await page.goto(url("app", path));
  // The "or" rule is part of the server-rendered page exactly when the client id is configured.
  if ((await page.getByRole("separator").count()) === 0) {
    throw new Error(
      "NEXT_PUBLIC_GOOGLE_CLIENT_ID is not set on the dev server, so the Google button is hidden. " +
        "Add it to .env.local (a placeholder is fine; scripts/lib/local-env-placeholders.sh) and restart pnpm dev.",
    );
  }
}

const noSession = async (context: BrowserContext) =>
  expect((await context.cookies()).filter((c) => c.name.startsWith("sb-"))).toEqual([]);

// Next.js keeps its own empty role=alert (the route announcer) on every page: only ours is a <p>.
const alert = (page: Page) => page.locator('p[role="alert"]');

test.describe("M1-29 Google sign-in on /login", () => {
  test("M1-29 draws Google's button, initialised with the client id and only sha256 of the nonce cookie", async ({
    page,
    context,
  }) => {
    await open(page, context, "/login");
    await expect(stubFace(page)).toBeVisible();

    const state = await gsi(page);
    expect(state.inits).toHaveLength(1);
    const init = state.inits[0]!;
    expect(init.client_id.length).toBeGreaterThan(0);
    expect(init.ux_mode).toBe("popup");
    expect(init.auto_select).toBe(false);
    expect(init.nonce).toMatch(/^[0-9a-f]{64}$/);
    expect(state.renders[0]).toMatchObject({
      type: "standard",
      theme: "outline",
      size: "large",
      text: "continue_with",
      shape: "rectangular",
    });

    // The raw nonce lives in an httpOnly host-only cookie; the page only ever saw its hash.
    const cookie = await nonceCookie(context);
    expect(cookie, "nonce cookie").toBeTruthy();
    expect(cookie!.httpOnly).toBe(true);
    expect(cookie!.sameSite).toBe("Lax");
    expect(cookie!.domain).toBe("app.localhost"); // no leading dot: host-only
    const lifeSeconds = cookie!.expires - Date.now() / 1000;
    expect(lifeSeconds).toBeGreaterThan(0);
    expect(lifeSeconds).toBeLessThanOrEqual(901);
    expect(sha256(cookie!.value)).toBe(init.nonce);
    expect(cookie!.value).not.toBe(init.nonce);
    expect(await page.evaluate(() => document.cookie)).not.toContain(GOOGLE_NONCE_COOKIE);
    expect(JSON.stringify(state)).not.toContain(cookie!.value);

    // Email sign-in is untouched, and nothing signed anyone in.
    await expect(page.getByRole("button", { name: "Email me a sign-in link" })).toBeEnabled();
    await noSession(context);
  });

  test("M1-29 a credential from Google reaches the Server Action; a refused one is friendly, leaves no session and spends the nonce", async ({
    page,
    context,
  }) => {
    await open(page, context, "/login");
    await expect(stubFace(page)).toBeVisible();
    const firstCookie = (await nonceCookie(context))!.value;

    await setCredential(page, await tokenForThisPage(page, context));
    await stubFace(page).click();

    // Right nonce and audience, so the request got as far as Supabase, which refuses a token whose
    // signature it can't verify (and the local project has the Google provider off anyway).
    await expect(alert(page)).toHaveText(GOOGLE_FAILED_MESSAGE);
    expect(page.url()).toBe(url("app", "/login"));
    await noSession(context);

    // The attempt spent the nonce: a new one was issued and Google initialised again with it.
    await expect.poll(async () => (await gsi(page)).inits.length).toBe(2);
    const second = (await nonceCookie(context))!.value;
    expect(second).not.toBe(firstCookie);
    const { inits } = await gsi(page);
    expect(inits[1]!.nonce).toBe(sha256(second));
    expect(inits[1]!.nonce).not.toBe(inits[0]!.nonce);
    await expect(stubFace(page)).toBeVisible();

    // And the second attempt works with that new nonce: it is refused by Supabase again, not by
    // our own nonce check ("expired").
    await setCredential(page, await tokenForThisPage(page, context));
    await stubFace(page).click();
    await expect(alert(page)).toHaveText(GOOGLE_FAILED_MESSAGE);
    await expect.poll(async () => (await gsi(page)).inits.length).toBe(3);
    await noSession(context);
  });

  test("M1-29 a token made for another nonce (a replay) is refused as expired, with no session", async ({
    page,
    context,
  }) => {
    await open(page, context, "/login");
    await expect(stubFace(page)).toBeVisible();
    const aud = (await gsi(page)).inits[0]!.client_id;

    // A token Google issued for some other page's nonce.
    await setCredential(page, fakeIdToken({ aud, nonce: sha256("some other page's nonce") }));
    await stubFace(page).click();
    await expect(alert(page)).toHaveText(GOOGLE_EXPIRED_MESSAGE);
    await noSession(context);
    // Spent: the page holds a new nonce once Google has been initialised a second time.
    await expect.poll(async () => (await gsi(page)).inits.length).toBe(2);

    // The raw nonce in the token's place of its hash is not accepted either.
    const raw = (await nonceCookie(context))!.value;
    await setCredential(page, fakeIdToken({ aud, nonce: raw }));
    await stubFace(page).click();
    await expect.poll(async () => (await gsi(page)).inits.length).toBe(3);
    await expect(alert(page)).toHaveText(GOOGLE_EXPIRED_MESSAGE);
    await noSession(context);
  });

  test("M1-29 a nonce cookie that has expired or been cleared is refused, then the page recovers by itself", async ({
    page,
    context,
  }) => {
    await open(page, context, "/login");
    await expect(stubFace(page)).toBeVisible();
    const token = await tokenForThisPage(page, context);

    await context.clearCookies({ name: GOOGLE_NONCE_COOKIE });
    expect(await nonceCookie(context)).toBeUndefined();
    await setCredential(page, token);
    await stubFace(page).click();
    await expect(alert(page)).toHaveText(GOOGLE_EXPIRED_MESSAGE);
    await noSession(context);

    // A new nonce is on its way and the button is live again.
    await expect.poll(async () => (await gsi(page)).inits.length).toBe(2);
    expect(await nonceCookie(context)).toBeTruthy();
    await expect(stubFace(page)).toBeVisible();
  });

  test("M1-29 when Google's script can't load, the page says so and email sign-in still works", async ({
    page,
    context,
  }) => {
    await open(page, context, "/login", false);
    await expect(page.getByText(GOOGLE_UNAVAILABLE_MESSAGE)).toBeVisible();
    await expect(stubFace(page)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Continue with Google" })).toHaveCount(0);
    await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Email me a sign-in link" })).toBeEnabled();
    await expectNoHorizontalScroll(page);
  });

  test("M1-29 layout: Google's button sits below the 'or' rule inside the form column, no sideways scroll, 44px targets on the phone", async ({
    page,
    context,
    isMobile,
  }) => {
    await open(page, context, "/login");
    const face = stubFace(page);
    await expect(face).toBeVisible();
    await expectNoHorizontalScroll(page);
    if (isMobile) await expectTapTargets(page);

    const column = (await page.locator("main > div").boundingBox())!;
    const rule = (await page.getByRole("separator").boundingBox())!;
    const button = (await face.boundingBox())!;
    expect(button.y).toBeGreaterThan(rule.y);
    expect(button.x).toBeGreaterThanOrEqual(column.x - 1);
    expect(button.x + button.width).toBeLessThanOrEqual(column.x + column.width + 1);
    expect(button.width).toBeLessThanOrEqual(400);
    // Google's button is 40px tall and can't be resized; the row around it keeps 48px.
    const row = (await face.locator("xpath=..").boundingBox())!;
    expect(row.height).toBeGreaterThanOrEqual(48);
    // On a phone the button spans the column; on a wide screen it is capped at Google's 400px.
    if (isMobile) expect(Math.round(button.width)).toBe(Math.round(column.width));
  });

  test("M1-29 the button is drawn again at the new width when the viewport changes", async ({
    page,
    context,
  }) => {
    await open(page, context, "/login");
    await expect(stubFace(page)).toBeVisible();
    const before = (await gsi(page)).renders.length;
    // Narrower than either project's viewport, so the column (max 400px) shrinks on both.
    await page.setViewportSize({ width: 330, height: 800 });
    await expect.poll(async () => (await gsi(page)).renders.length).toBeGreaterThan(before);
    const { renders } = await gsi(page);
    const last = renders.at(-1)!.width as number;
    const column = (await page.locator("main > div").boundingBox())!;
    expect(last).toBeLessThanOrEqual(Math.ceil(column.width));
    await expectNoHorizontalScroll(page);
  });
});

test.describe("M1-30 Google sign-up on /signup", () => {
  const handleInput = (page: Page) => page.getByLabel("Handle", { exact: true });
  const status = (page: Page) => page.locator("#su-handle-status");
  /** What covers Google's button while the handle can't be used. */
  const cover = (page: Page) => page.getByRole("button", { name: "Continue with Google" });
  const fresh = () => `zq-gg-${rand()}`;

  const MESSAGES = {
    short: "At least 3 characters — letters, numbers and dashes.",
    taken: "That one’s taken. Try another.",
    reserved: "That name is reserved. Try another.",
  };

  test("M1-30 Google's button waits for a usable handle; a press before that moves focus to the field and never reaches Google", async ({
    page,
    context,
  }) => {
    const handle = fresh();
    await open(page, context, `/signup?handle=${handle}`);
    await expect(stubFace(page)).toBeVisible();
    await expect(status(page)).toHaveText(`${handle}.hydlnk.com is available`);
    // Available: nothing covers Google's button.
    await expect(cover(page)).toHaveCount(0);

    const cases: [string, string][] = [
      ["mara", MESSAGES.taken],
      ["www", MESSAGES.reserved],
      ["ab", MESSAGES.short],
      ["", MESSAGES.short],
    ];
    for (const [value, message] of cases) {
      await handleInput(page).fill(value);
      await page.getByLabel("Email", { exact: true }).focus();
      await expect(status(page)).toHaveText(message);
      await expect(cover(page)).toBeVisible();
      // The iframe underneath is inert, so even the keyboard can't reach it.
      expect(await stubFace(page).evaluate((el) => !!el.parentElement?.closest("[inert]"))).toBe(
        true,
      );
      // A real press lands on the cover (force: it is aria-disabled on purpose).
      await cover(page).click({ force: true });
      await expect(handleInput(page)).toBeFocused();
      expect((await gsi(page)).clicks).toBe(0);
    }
    expect((await gsi(page)).inits).toHaveLength(1);

    // Back to a usable handle: the button opens again.
    const another = fresh();
    await handleInput(page).fill(another);
    await expect(status(page)).toHaveText(`${another}.hydlnk.com is available`);
    await expect(cover(page)).toHaveCount(0);
    expect(await stubFace(page).evaluate((el) => !!el.parentElement?.closest("[inert]"))).toBe(
      false,
    );
    expect(page.url()).toContain("/signup");
    await noSession(context);
    expect((await context.cookies()).find((c) => c.name === PENDING_HANDLE_COOKIE)).toBeUndefined();
  });

  test("M1-30 an available handle reaches the Server Action with the credential; a refusal sets no pending-handle cookie and no session", async ({
    page,
    context,
  }) => {
    const handle = fresh();
    await open(page, context, `/signup?handle=${handle}`);
    await expect(status(page)).toHaveText(`${handle}.hydlnk.com is available`);
    await expect(cover(page)).toHaveCount(0);

    await setCredential(page, await tokenForThisPage(page, context));
    await stubFace(page).click();
    // The handle passed the server's own check (else the message would be about the handle), so
    // the request reached Supabase, which refused the unsigned token.
    await expect(alert(page)).toHaveText(GOOGLE_FAILED_MESSAGE);
    expect((await gsi(page)).clicks).toBe(1);
    await noSession(context);
    // The handle cookie is only set once the sign-in has worked.
    expect((await context.cookies()).find((c) => c.name === PENDING_HANDLE_COOKIE)).toBeUndefined();
    await expect(handleInput(page)).toHaveValue(handle);
    await expect.poll(async () => (await gsi(page)).inits.length).toBe(2);
  });

  test("M1-30 abuse: a handle the browser check waved through is refused by the server before anyone is signed in", async ({
    page,
    context,
  }) => {
    // Pretend the browser's availability check says everything is available, so the button opens
    // for names the server will not accept: the Server Action must not take the client's word.
    await page.route("**/api/handles/check?*", (route) => {
      const handle = new URL(route.request().url()).searchParams.get("handle") ?? "";
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ handle, status: "available" }),
      });
    });
    await open(page, context, "/signup");
    await expect(stubFace(page)).toBeVisible();

    const cases: [string, string][] = [
      ["mara", MESSAGES.taken],
      ["www", MESSAGES.reserved],
    ];
    for (const [handle, message] of cases) {
      await handleInput(page).fill(handle);
      await expect(cover(page)).toHaveCount(0); // the gate believed the stub
      const before = (await gsi(page)).inits.length;
      await setCredential(page, await tokenForThisPage(page, context));
      await stubFace(page).click();

      await expect(status(page)).toHaveText(message);
      await expect(handleInput(page)).toBeFocused();
      await expect(alert(page)).toHaveCount(0); // a handle problem, not a Google problem
      await noSession(context);
      expect(
        (await context.cookies()).find((c) => c.name === PENDING_HANDLE_COOKIE),
        `pending cookie after ${handle}`,
      ).toBeUndefined();
      // The attempt spent the nonce: Google is initialised again with a new one.
      await expect.poll(async () => (await gsi(page)).inits.length).toBe(before + 1);
      await expect(stubFace(page)).toBeVisible();
    }
  });

  test("M1-30 layout: Google's button below the 'or' rule in the form column, no sideways scroll, 44px targets on the phone", async ({
    page,
    context,
    isMobile,
  }) => {
    const handle = fresh();
    await open(page, context, `/signup?handle=${handle}`);
    await expect(stubFace(page)).toBeVisible();
    await expect(status(page)).toHaveText(`${handle}.hydlnk.com is available`);
    await expectNoHorizontalScroll(page);
    if (isMobile) await expectTapTargets(page);

    const column = (await page.locator("main > div").boundingBox())!;
    const rule = (await page.getByRole("separator").boundingBox())!;
    const button = (await stubFace(page).boundingBox())!;
    expect(button.y).toBeGreaterThan(rule.y);
    expect(button.x).toBeGreaterThanOrEqual(column.x - 1);
    expect(button.x + button.width).toBeLessThanOrEqual(column.x + column.width + 1);
    const row = (await stubFace(page).locator("xpath=..").boundingBox())!;
    expect(row.height).toBeGreaterThanOrEqual(48);
    if (isMobile) expect(Math.round(button.width)).toBe(Math.round(column.width));

    // While it waits for a handle the cover is a full-size target too.
    await handleInput(page).fill("ab");
    await expect(cover(page)).toBeVisible();
    const covered = (await cover(page).boundingBox())!;
    expect(covered.height).toBeGreaterThanOrEqual(44);
    expect(Math.round(covered.width)).toBe(Math.round(column.width));
    if (isMobile) await expectTapTargets(page);
  });
});
