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
import { getMessage, signInLinkFrom, waitForMessages } from "../fixtures/mailpit";

const MESSAGES = {
  short: "At least 3 characters — letters, numbers and dashes.",
  taken: "That one’s taken. Try another.",
  reserved: "That name is reserved. Try another.",
  invalid: "Handles can’t start or end with a dash or start with xn--.",
};

const handleInput = (page: Page) => page.getByLabel("Handle", { exact: true });
const status = (page: Page) => page.locator("#cl-handle-status");

test.afterAll(cleanupUsers);

/** M1-14: the claim step for signed-in accounts that have no page. */
test.describe("M1-14 claim step", () => {
  test("M1-14 shows the signup layout with the claim form, no email field, no Google", async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const email = `e2e-cl-${rand()}@example.com`;
    await signIn(context, email);
    const page = await context.newPage();
    await page.goto(url("app", "/claim"));

    await expect(page.getByRole("heading", { level: 1, name: "Pick your handle" })).toBeVisible();
    await expect(page.getByText("This is your hydlnk.com address.")).toBeVisible();
    await expect(handleInput(page)).toBeVisible();
    await expect(page.getByRole("button", { name: "Claim it" })).toBeVisible();
    await expect(page.getByText(`Signed in as ${email}. Not you?`)).toBeVisible();
    const signOut = page.getByRole("button", { name: "Sign out" });
    await expect(signOut).toBeVisible();
    expect((await signOut.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await expect(page.getByLabel("Email", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /google/i })).toHaveCount(0);
    await context.close();
  });

  test("M1-14 claiming an available handle creates the page and lands in the editor", async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const handle = `zq-cl-${rand()}`;
    const { userId } = await signIn(context, `e2e-cl-ok-${rand()}@example.com`);
    const page = await context.newPage();
    await page.goto(url("app", "/claim"));
    await handleInput(page).fill(handle);
    await expect(status(page)).toHaveText(`${handle}.hydlnk.com is available`);
    await page.getByRole("button", { name: "Claim it" }).click();
    await page.waitForURL("http://app.localhost:3000/editor", { timeout: 30_000 });

    const pages = await pagesOf(userId);
    expect(pages.map((p) => p.handle)).toEqual([handle]);

    const check = await page.goto(url("app", `/api/handles/check?handle=${handle}`));
    expect(await check?.json()).toEqual({ handle, status: "taken" });

    // Revisiting /claim goes straight on to the editor.
    await page.goto(url("app", "/claim"));
    await page.waitForURL("http://app.localhost:3000/editor");
    await context.close();
  });

  test("M1-14 unusable handles show the inline status and create no page", async ({ browser }) => {
    const context = await browser.newContext();
    const { userId } = await signIn(context, `e2e-cl-bad-${rand()}@example.com`);
    const page = await context.newPage();
    await page.goto(url("app", "/claim"));

    const cases: [string, string][] = [
      ["mara", MESSAGES.taken],
      ["www", MESSAGES.reserved],
      ["ab", MESSAGES.short],
      ["-x1", MESSAGES.invalid],
    ];
    for (const [handle, message] of cases) {
      await handleInput(page).fill(handle);
      await page.getByRole("button", { name: "Claim it" }).click();
      await expect(status(page)).toHaveText(message);
      await expect(handleInput(page)).toBeFocused();
      expect(new URL(page.url()).pathname).toBe("/claim");
    }
    expect(await pagesOf(userId)).toHaveLength(0);
    await context.close();
  });

  test("M1-14 a handle taken between the link request and the click ends on /claim with a notice", async ({
    page,
    browser,
  }) => {
    const handle = `zq-lost-${rand()}`;
    const email = `e2e-lost-${rand()}@example.com`;
    trackEmail(email);

    await page.goto(url("app", `/signup?handle=${handle}`));
    await expect(page.locator("#su-handle-status")).toHaveText(`${handle}.hydlnk.com is available`);
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByRole("button", { name: "Email me a sign-in link" }).click();
    await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
    const link = signInLinkFrom((await getMessage((await waitForMessages(email, 1))[0]!.ID)).HTML);

    // Somebody else claims it first.
    const rival = await makeUser("rival");
    await insertPage(rival.id, handle);

    const device = await browser.newContext();
    const landing = await device.newPage();
    await landing.goto(link);
    await landing.waitForURL(/\/claim/, { timeout: 30_000 });
    expect(new URL(landing.url()).pathname).toBe("/claim");

    const notice = landing
      .getByRole("status")
      .filter({ hasText: "was taken while you were signing up" });
    await expect(notice).toHaveText(
      `${handle}.hydlnk.com was taken while you were signing up. Pick another.`,
    );
    await expect(handleInput(landing)).toHaveValue(handle);
    await expect(landing.locator("#cl-handle-status")).toHaveText(MESSAGES.taken);

    const userId = await userIdByEmail(email);
    expect(userId).toBeTruthy();
    const accounts = await adminClient().from("accounts").select("id").eq("id", userId!);
    expect(accounts.data).toHaveLength(1);
    expect(await pagesOf(userId!)).toHaveLength(0);

    // The user can pick another handle right here.
    const other = `zq-won-${rand()}`;
    await handleInput(landing).fill(other);
    await landing.getByRole("button", { name: "Claim it" }).click();
    await landing.waitForURL("http://app.localhost:3000/editor", { timeout: 30_000 });
    expect((await pagesOf(userId!)).map((p) => p.handle)).toEqual([other]);
    await device.close();
  });

  test("M1-14 an address that signs in without a handle lands on /claim with no notice", async ({
    browser,
  }) => {
    const context = await browser.newContext();
    await signIn(context, `e2e-cl-new-${rand()}@example.com`);
    const page = await context.newPage();
    await page.goto(url("app", "/"));
    await page.waitForURL("http://app.localhost:3000/claim");
    await expect(page.getByRole("heading", { name: "Pick your handle" })).toBeVisible();
    await expect(page.getByText("was taken while you were signing up")).toHaveCount(0);
    await expect(handleInput(page)).toHaveValue("");
    await context.close();
  });

  test("M1-14 'Sign out' signs the visitor out (a POST button, not a link)", async ({
    browser,
  }) => {
    const context = await browser.newContext();
    await signIn(context, `e2e-cl-out-${rand()}@example.com`);
    const page = await context.newPage();
    await page.goto(url("app", "/claim"));
    await expect(page.getByRole("link", { name: "Sign out" })).toHaveCount(0);
    await page.getByRole("button", { name: "Sign out" }).click();
    await page.waitForURL("http://app.localhost:3000/login");
    await context.close();
  });

  test("M1-14 layout: phone has the slim bar and a 48px full-width button; desktop has the panel left", async ({
    browser,
    isMobile,
  }) => {
    const context = await browser.newContext({
      viewport: isMobile ? { width: 390, height: 844 } : { width: 1440, height: 900 },
      isMobile,
      hasTouch: isMobile,
    });
    await signIn(context, `e2e-cl-lay-${rand()}@example.com`);
    const page = await context.newPage();
    await page.goto(url("app", "/claim"));
    await expect(page.getByRole("button", { name: "Claim it" })).toBeVisible();

    const button = page.getByRole("button", { name: "Claim it" });
    const bbox = (await button.boundingBox())!;
    const aside = (await page.locator("aside").boundingBox())!;
    const column = (await page.locator("main > div").boundingBox())!;

    if (isMobile) {
      await expectNoHorizontalScroll(page);
      await expectTapTargets(page);
      expect(aside.height).toBeLessThan(80); // the slim logo bar
      expect(Math.round(bbox.width)).toBe(Math.round(column.width));
      expect(Math.round(bbox.height)).toBe(48);
    } else {
      expect(aside.x).toBeLessThan(column.x); // brand panel left, form right
      expect(aside.height).toBeGreaterThan(600);
      const signedIn = (await page.getByText(/^Signed in as/).boundingBox())!;
      expect(signedIn.y).toBeGreaterThan(bbox.y + bbox.height);
    }
    await context.close();
  });
});
