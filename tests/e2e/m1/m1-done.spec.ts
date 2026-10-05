import { mkdirSync } from "node:fs";
import { expect, test, type Browser } from "@playwright/test";
import { adminClient } from "../fixtures/auth";
import { cleanupUsers, rand, trackEmail } from "../fixtures/data";
import { rawRequest, sessionOf } from "../fixtures/http";
import { getMessage, messagesTo, signInLinkFrom, waitForMessages } from "../fixtures/mailpit";
import { expectNoHorizontalScroll, url } from "../helpers";

/**
 * M1-28, the milestone's done-when flow, through the real UI at both viewports (phone 390x844 and
 * desktop 1440x900, run in parallel, so every run and project gets its own handle and address):
 *
 *   unclaimed 404 -> landing claim form -> signup (available) -> emailed link opened in a new
 *   browser context -> editor shows the handle -> database rows -> tenant placeholder (no cookies)
 *   -> a second visitor cannot take it -> sign out (tenant stays up) -> log in again from /login with
 *   a fresh link -> delete the account -> tenant 404 and the handle is free again.
 *
 * Step 9 of the feature (production: the magic-link template applied in the Supabase dashboard,
 * then a throwaway handle claimed on https://hydlnk.com and deleted) is manual and stays
 * unchecked: Supabase's built-in production mail reaches only team addresses, about 2 per hour.
 */

const RUN = rand(5);

test.afterAll(cleanupUsers);

/** A signed-out browser context (a fresh device) with the project's viewport. */
const freshDevice = (browser: Browser) => browser.newContext();

test("M1-28 signing up gives you handle.hydlnk.com showing a placeholder page", async ({
  page,
  browser,
}, testInfo) => {
  // The second sign-in link for one address needs Supabase's 60 s resend window to pass (the
  // production rate limit is deliberately kept in the local config), so this flow takes a while.
  test.setTimeout(240_000);

  const tag = testInfo.project.name === "phone" ? "p" : "d";
  const handle = `zq-e2e-${RUN}-${tag}`;
  const email = `e2e-${RUN}-${tag}@example.com`;
  const rival = `e2e-${RUN}-${tag}-v2@example.com`;
  const display = `${handle}.hydlnk.com`;
  const viewportWidth = page.viewportSize()!.width;
  trackEmail(email);

  const admin = adminClient();
  const accounts = (userId: string) => admin.from("accounts").select("id, plan").eq("id", userId);
  const pages = (userId: string) =>
    admin.from("pages").select("handle, owner_id, published, published_at").eq("owner_id", userId);

  // 1. Unclaimed: the tenant host answers 404.
  const unclaimed = await page.goto(url(handle));
  expect(unclaimed?.status()).toBe(404);

  // 2. The landing page's hero form hands the handle to signup, which says it is available.
  await page.goto(url());
  await expect(page.locator("form[data-ready='true']")).toHaveCount(2);
  const hero = page
    .locator("form")
    .filter({ has: page.getByLabel("Choose your handle") })
    .first();
  await hero.getByLabel("Choose your handle").fill(handle);
  await hero.getByRole("button", { name: "Claim it" }).click();
  await expect(page).toHaveURL(url("app", `/signup?handle=${handle}`));
  await expect(page.getByText(`${display} is available`)).toBeVisible();

  // 3. Email me a sign-in link, read it from the inbox, open it in a new browser context.
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
  const sentAt = Date.now();
  const [firstMessage] = await waitForMessages(email, 1);
  const firstLink = signInLinkFrom((await getMessage(firstMessage!.ID)).HTML);

  const device = await freshDevice(browser);
  const editor = await device.newPage();
  expect(editor.viewportSize()).toEqual(page.viewportSize());
  await editor.goto(firstLink);
  await editor.waitForURL(url("app", "/editor"), { timeout: 30_000 });
  const switcher = editor
    .getByRole("button", { name: `Switch site, current: ${display}` })
    .filter({ visible: true });
  await expect(switcher).toHaveCount(1);
  await expect(switcher).toContainText(display);

  // 4. Database: one free account, one unpublished page owned by that user.
  const userId = (await sessionOf(device)).user?.id;
  expect(userId, "the session names the new user").toBeTruthy();
  expect((await accounts(userId!)).data).toEqual([{ id: userId, plan: "free" }]);
  expect((await pages(userId!)).data).toEqual([
    { handle, owner_id: userId, published: null, published_at: null },
  ]);

  // 5. The tenant host now serves the placeholder at once: no stale 404, no cookies either way.
  const served = await rawRequest(`${handle}.localhost:3000`, "/");
  expect(served.status).toBe(200);
  expect(served.setCookies).toEqual([]);
  expect(served.body).toContain("Nothing published here yet.");
  const tenant = await device.newPage();
  const tenantResponse = await tenant.goto(url(handle));
  expect(tenantResponse?.status()).toBe(200);
  // The device is signed in on the app host; the tenant host must never receive that session.
  expect((await tenantResponse!.request().allHeaders()).cookie ?? "").not.toContain("sb-");
  expect(await tenantResponse!.headerValue("set-cookie")).toBeNull();
  await expect(tenant.getByRole("heading", { level: 1 })).toHaveText(handle);
  await expectNoHorizontalScroll(tenant);
  mkdirSync("tmp/screens", { recursive: true });
  await tenant.screenshot({ path: `tmp/screens/m1-done-placeholder-${viewportWidth}.png` });
  await tenant.close();

  // 6. A second visitor cannot take it: the endpoint says taken, signup refuses it, no email goes out.
  const check = await rawRequest("app.localhost:3000", `/api/handles/check?handle=${handle}`);
  expect(JSON.parse(check.body)).toEqual({ handle, status: "taken" });
  const visitor = await (await freshDevice(browser)).newPage();
  await visitor.goto(url("app", `/signup?handle=${handle}`));
  await expect(visitor.getByText("That one’s taken. Try another.")).toBeVisible();
  await visitor.getByLabel("Email", { exact: true }).fill(rival);
  await visitor.getByRole("button", { name: "Email me a sign-in link" }).click();
  await expect(visitor.getByText("That one’s taken. Try another.")).toBeVisible();
  await expect(visitor.getByRole("heading", { name: "Check your email" })).toHaveCount(0);
  await visitor.waitForTimeout(1_500);
  expect(await messagesTo(rival)).toHaveLength(0);
  await visitor.context().close();

  // 7. Sign out from /settings: back on /login, tenant page still up. Then log in again from
  //    /login with a fresh link: the editor (not /claim), still one account and one page.
  await editor.goto(url("app", "/settings"));
  await editor.locator("main").getByRole("button", { name: "Sign out" }).click();
  await expect(editor).toHaveURL(url("app", "/login"));
  expect((await rawRequest(`${handle}.localhost:3000`, "/")).status).toBe(200);

  // Supabase sends one link per address per 60 s; wait out the window the way a user would.
  const wait = sentAt + 62_000 - Date.now();
  if (wait > 0) await editor.waitForTimeout(wait);
  await editor.getByLabel("Email", { exact: true }).fill(email);
  await editor.getByRole("button", { name: "Email me a sign-in link" }).click();
  await expect(editor.getByRole("heading", { name: "Check your email" })).toBeVisible();
  const [, secondMessage] = (await waitForMessages(email, 2)).sort((a, b) =>
    a.Created.localeCompare(b.Created),
  );
  expect(secondMessage, "a second message arrived").toBeTruthy();
  const secondLink = signInLinkFrom((await getMessage(secondMessage!.ID)).HTML);
  expect(secondLink).not.toBe(firstLink);
  await editor.goto(secondLink);
  await editor.waitForURL(url("app", "/editor"), { timeout: 30_000 });
  await expect(switcher).toHaveCount(1);
  expect((await accounts(userId!)).data).toHaveLength(1);
  expect((await pages(userId!)).data).toHaveLength(1);

  // 8. Clean-up through the product: delete the account, typing the handle.
  await editor.goto(url("app", "/settings"));
  await editor.locator("main").getByRole("button", { name: "Delete account" }).click();
  const dialog = editor.getByRole("dialog", { name: "Delete your account?" });
  await dialog.getByLabel("Type your handle to confirm").fill(handle);
  await dialog.getByRole("button", { name: "Delete account" }).click();
  await expect(editor).toHaveURL(/^http:\/\/app\.localhost:3000\/login/);
  await expect(
    editor.getByRole("status").filter({ hasText: "Your account was deleted." }),
  ).toBeVisible();
  expect((await rawRequest(`${handle}.localhost:3000`, "/")).status).toBe(404);
  const freed = await rawRequest("app.localhost:3000", `/api/handles/check?handle=${handle}`);
  expect(JSON.parse(freed.body)).toEqual({ handle, status: "available" });
  expect((await accounts(userId!)).data).toEqual([]);
  expect((await pages(userId!)).data).toEqual([]);
  await device.close();
});
