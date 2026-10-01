import { expect, test } from "@playwright/test";
import { expectNoHorizontalScroll, expectTapTargets, url } from "../helpers";
import { adminClient, generateTokenHash, openCallback, signInAs } from "../fixtures/auth";
import { uniq } from "../fixtures/data";
import {
  appRaw,
  authCookies,
  authUser,
  cookieHeader,
  exchangeRefreshToken,
  sessionOf,
} from "../fixtures/http";

const addr = (label: string, project: string) => `${uniq(label)}-${project}@example.com`;
const handleFor = (label: string, project: string) => `${uniq(label)}-${project[0]}`.slice(0, 30);

test.describe("M1-21 sign out ends the session", () => {
  test("M1-21 Sign out on /settings ends on /login, clears the cookies and revokes the refresh token", async ({
    page,
    context,
  }, testInfo) => {
    const handle = handleFor("so", testInfo.project.name);
    await signInAs(context, addr("so", testInfo.project.name), { handle });
    const before = await sessionOf(context);
    expect((await authUser(before.access_token)).status).toBe(200);

    await page.goto(url("app", "/settings"));
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(url("app", "/login"));
    expect(await authCookies(context)).toEqual([]);

    // Back button straight after signing out (M1-21 step 4, M1-07 step 5): the /settings entry is
    // not restored from a cache; the gate sends the visitor to /login and no app content shows.
    await page.goBack();
    await expect(page).toHaveURL(url("app", "/login"));
    await expect(page.getByRole("heading", { level: 1, name: "Log in" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign out" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Settings & billing" })).toHaveCount(0);

    // The app no longer opens for this context.
    await page.goto(url("app", "/editor"));
    await expect(page).toHaveURL(url("app", "/login"));

    // Server-side revocation: the refresh token captured before cannot be exchanged any more.
    const refreshed = await exchangeRefreshToken(before.refresh_token);
    expect(refreshed.status).toBe(400);
    expect(JSON.stringify(refreshed.body).toLowerCase()).toMatch(/refresh token|refresh_token/);

    // Back button: no cached app content, just /login again.
    await page.goBack();
    await expect(page).toHaveURL(url("app", "/login"));
    await expect(page.getByRole("button", { name: "Sign out" })).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 1, name: "Log in" })).toBeVisible();

    // Signing out does not unclaim the handle: the tenant page is still served.
    const tenant = await page.goto(url(handle));
    expect(tenant!.status()).toBe(200);
  });

  test("M1-21 sign out is a POST: GET on sign-out URLs is a 404 or 405 and the session stays intact", async ({
    context,
  }, testInfo) => {
    await signInAs(context, addr("so-get", testInfo.project.name));
    const session = await sessionOf(context);
    const cookie = cookieHeader(await context.cookies("http://app.localhost:3000"));
    for (const path of [
      "/signout",
      "/sign-out",
      "/logout",
      "/auth/signout",
      "/auth/sign-out",
      "/auth/logout",
      "/api/auth/signout",
      "/api/signout",
    ]) {
      const res = await appRaw(path, { cookie });
      expect([404, 405], path).toContain(res.status);
    }
    expect((await authUser(session.access_token)).status).toBe(200);
    expect((await authCookies(context)).length).toBeGreaterThan(0);
    const ping = await appRaw("/", { cookie });
    expect(ping.location ?? "").not.toMatch(/\/login$/);
  });

  test("M1-21 an unauthenticated sign-out lands on /login with no error page", async ({
    page,
    context,
  }, testInfo) => {
    await signInAs(context, addr("so-anon", testInfo.project.name), {
      handle: handleFor("sa", testInfo.project.name),
    });
    await page.goto(url("app", "/settings"));
    await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
    await context.clearCookies(); // the session is gone before the button is pressed
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(url("app", "/login"));
    await expect(page.getByRole("heading", { level: 1, name: "Log in" })).toBeVisible();
  });

  test("M1-21 the Sign out control on /claim (no page yet) does the same", async ({
    page,
    context,
  }, testInfo) => {
    const email = addr("so-claim", testInfo.project.name);
    await signInAs(context, email);
    const before = await sessionOf(context);
    await page.goto(url("app", "/claim"));
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(url("app", "/login"));
    expect(await authCookies(context)).toEqual([]);
    expect((await exchangeRefreshToken(before.refresh_token)).status).toBe(400);
    await page.goto(url("app", "/claim"));
    await expect(page).toHaveURL(url("app", "/login"));
  });

  test("M1-21 signing in again with a fresh link lands on /editor with one account row and one page row", async ({
    page,
    context,
  }, testInfo) => {
    const email = addr("so-again", testInfo.project.name);
    const { userId } = await signInAs(context, email, {
      handle: handleFor("sg", testInfo.project.name),
    });
    await page.goto(url("app", "/settings"));
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(url("app", "/login"));

    const { hashedToken } = await generateTokenHash(email);
    await openCallback(context, hashedToken);
    await page.goto(url("app", "/"));
    await expect(page).toHaveURL(url("app", "/editor"));

    const admin = adminClient();
    expect((await admin.from("accounts").select("id").eq("id", userId)).data).toHaveLength(1);
    expect((await admin.from("pages").select("id").eq("owner_id", userId)).data).toHaveLength(1);
  });

  test.describe("phone layout", () => {
    test.skip(({ isMobile }) => !isMobile, "phone project only");
    test("M1-21 at 390x844 /settings has no horizontal scroll, 44px targets and a full-width Sign out", async ({
      page,
      context,
    }, testInfo) => {
      await signInAs(context, addr("so-phone", testInfo.project.name), {
        handle: handleFor("sp", testInfo.project.name),
      });
      await page.goto(url("app", "/settings"));
      const button = page.getByRole("button", { name: "Sign out" });
      await expect(button).toBeVisible();
      await expectNoHorizontalScroll(page);
      await expectTapTargets(page);
      const box = await button.boundingBox();
      const card = await button
        .locator("xpath=ancestor::*[contains(@class,'border-t')][1]")
        .boundingBox();
      expect(box!.width).toBeGreaterThanOrEqual((card?.width ?? 390) - 2);
    });
  });

  test.describe("desktop layout", () => {
    test.skip(({ isMobile }) => isMobile, "desktop project only");
    test("M1-21 at 1440x900 Sign out sits at the left of the account actions row", async ({
      page,
      context,
    }, testInfo) => {
      await signInAs(context, addr("so-wide", testInfo.project.name), {
        handle: handleFor("sw", testInfo.project.name),
      });
      await page.goto(url("app", "/settings"));
      const button = page.getByRole("button", { name: "Sign out" });
      await expect(button).toBeVisible();
      const row = button.locator("xpath=ancestor::*[contains(@class,'border-t')][1]");
      const rowBox = await row.boundingBox();
      const box = await button.boundingBox();
      expect(box!.x - rowBox!.x).toBeLessThan(24);
      expect(box!.width).toBeLessThan(rowBox!.width / 2);
    });
  });
});
