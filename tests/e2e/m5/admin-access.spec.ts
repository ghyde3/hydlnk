import { expect, test } from "@playwright/test";
import { adminClient, publishableKey, supabaseUrl } from "../fixtures/auth";
import {
  cleanupUsers,
  desktopOnly,
  makeUser,
  rand,
  signIn,
  trackUser,
  uniq,
} from "../fixtures/data";
import { appRaw, authCookies, cookieHeader, rawRequest, sessionOf } from "../fixtures/http";
import { LOCAL_ADMIN_CLAIM } from "@/lib/admin/principal";
import { expectNoHorizontalScroll, expectTapTargets, url } from "../helpers";
import {
  dismissPath,
  json,
  postApp,
  sessionCookie,
  signInAsAdmin,
  signInAsUser,
  suspendedAt,
  suspendPath,
  unsuspendPath,
  setSuspended,
} from "./admin-helpers";

/**
 * M5-04: the admin area at /admin on the app host is for admins only. Admin identity is the
 * verified session (ADMIN_USER_IDS; the local marker only on a localhost root domain), never a
 * request field. Specs here prove the access rules with the real server; the registry of admin
 * actions is covered in tests/unit/admin-actions-guard.test.ts.
 */

test.describe.configure({ timeout: 120_000 });
test.afterAll(cleanupUsers);

const ADMIN_PATHS = [
  "/admin",
  "/admin/reports",
  "/admin/pages",
  "/admin/traffic",
  "/admin/blocked-links",
] as const;

test.describe("M5-04 admin access", () => {
  test("M5-04 signed out: every admin path redirects to sign-in", async ({}, info) => {
    test.skip(!desktopOnly(info), "no UI involved");
    for (const path of ADMIN_PATHS) {
      const res = await appRaw(path);
      expect(res.status, path).toBe(307);
      expect(new URL(res.location ?? "", "http://app.localhost:3000").pathname, path).toBe(
        "/login",
      );
      expect(res.location ?? "", "no return-URL parameter").not.toContain("?");
    }
  });

  test("M5-04 a signed-in non-admin gets the 404 of an unknown route on every admin path", async ({
    page,
    context,
  }) => {
    await signInAsUser(context, "nonadm");
    await page.goto(url("app", "/no-such-route-m504"));
    const unknownText = (await page.locator("body").innerText()).trim();
    for (const path of ADMIN_PATHS) {
      const response = await page.goto(url("app", path));
      expect(response?.status(), path).toBe(404);
      expect((await page.locator("body").innerText()).trim(), path).toBe(unknownText);
    }
    expect(unknownText.length).toBeGreaterThan(0);
  });

  test("M5-04 a signed-in admin gets 200 on every admin path", async ({ page, context }) => {
    await signInAsAdmin(context);
    for (const path of ADMIN_PATHS) {
      const response = await page.goto(url("app", path));
      expect(response?.status(), path).toBe(200);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    }
  });

  test("M5-04 the same paths on a tenant host are the tenant 404", async ({}, info) => {
    test.skip(!desktopOnly(info), "no UI involved");
    for (const path of ADMIN_PATHS) {
      const res = await rawRequest("mara.localhost:3000", path);
      expect(res.status, path).toBe(404);
      expect(res.body, path).toContain("Page not found");
      expect(res.body, path).not.toContain("Reports");
    }
  });

  test("M5-04 the Admin link is in the app shell for admins only", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "desktop sidebar");
    await signInAsUser(context, "nolink");
    await page.goto(url("app", "/editor"));
    await expect(page.locator("[data-admin-link]")).toHaveCount(0);
    await context.clearCookies();

    await signInAsAdmin(context, "link");
    await page.goto(url("app", "/editor"));
    const link = page.locator("aside [data-admin-link]");
    await expect(link).toBeVisible();
    await link.click();
    await expect(page).toHaveURL(url("app", "/admin"));
  });

  test("M5-04 the identity is the verified session: a forged cookie, user-editable claims and a string flag in app_metadata do not make an admin, even in a freshly issued JWT", async ({
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "no UI involved");
    const forged = await appRaw("/admin/reports", {
      cookie: "sb-127-auth-token=base64-eyJhY2Nlc3NfdG9rZW4iOiJub3BlIn0",
    });
    expect([307, 404]).toContain(forged.status);

    // The claims are in place BEFORE the sign-in, so the JWT the server verifies carries them.
    const admin = adminClient();
    const email = `zq-forge-${rand()}@example.com`;
    const handle = uniq("forge").slice(0, 28);
    const created = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
      // user_metadata is the one a user can edit themselves; it must never count.
      user_metadata: { [LOCAL_ADMIN_CLAIM]: true, admin: true, role: "admin" },
      // The marker must be the boolean true: a string is not it.
      app_metadata: { [LOCAL_ADMIN_CLAIM]: "true", role: "admin", admin: true },
    });
    expect(created.error).toBeNull();
    trackUser(created.data.user!.id);
    await signIn(context, email, { handle });
    const session = await sessionOf(context);
    const claims = JSON.parse(
      Buffer.from(session.access_token.split(".")[1]!, "base64url").toString(),
    );
    expect(claims.user_metadata[LOCAL_ADMIN_CLAIM]).toBe(true);
    expect(claims.app_metadata[LOCAL_ADMIN_CLAIM]).toBe("true");
    const cookie = await sessionCookie(context);
    for (const path of ["/admin", "/admin/reports"]) {
      expect((await appRaw(path, { cookie })).status, path).toBe(404);
    }

    // The user editing their own metadata with their own JWT, then signing in again, is no admin.
    const edit = await fetch(`${supabaseUrl()}/auth/v1/user`, {
      method: "PUT",
      headers: {
        apikey: publishableKey(),
        Authorization: `Bearer ${session.access_token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ data: { [LOCAL_ADMIN_CLAIM]: true } }),
    });
    expect(edit.status).toBeLessThan(500);
    await context.clearCookies();
    await signIn(context, email, { handle });
    expect((await appRaw("/admin", { cookie: await sessionCookie(context) })).status).toBe(404);
    // And the mutation routes agree: 403, nothing suspended.
    const target = await makeUser("tgf");
    expect(
      (await postApp(suspendPath(target.id), { cookie: await sessionCookie(context) })).status,
    ).toBe(403);
    expect(await suspendedAt(target.id)).toBeNull();
  });
});

test.describe("M5-04 direct-API abuse of the admin mutations", () => {
  test("M5-04 an unauthenticated POST is 401 and a signed-in non-admin's is 403, and the target is unchanged", async ({
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "no UI involved");
    const target = await makeUser("tgt");
    const suspendedTarget = await makeUser("tgs", { suspended: true });
    const nonAdmin = await signInAsUser(context, "abuse");
    const cookie = await sessionCookie(context);
    const before = await suspendedAt(suspendedTarget.id);
    expect(before).not.toBeNull();

    const attempts: [string, string][] = [
      ["suspend", suspendPath(target.id)],
      ["unsuspend", unsuspendPath(suspendedTarget.id)],
      ["dismiss", dismissPath("00000000-0000-4000-8000-000000000a01")],
    ];
    for (const [name, path] of attempts) {
      const anonymous = await postApp(path);
      expect(anonymous.status, `${name} without a session`).toBe(401);
      const signedIn = await postApp(path, { cookie });
      expect(signedIn.status, `${name} as a non-admin`).toBe(403);
      expect(json(signedIn).error, name).toBe("forbidden");
    }
    // The user suspending themselves, or an admin-looking body, is still a plain 403.
    expect(
      (await postApp(suspendPath(nonAdmin.userId), { cookie, body: '{"id":"x","admin":true}' }))
        .status,
    ).toBe(403);

    expect(await suspendedAt(target.id)).toBeNull();
    expect(await suspendedAt(suspendedTarget.id)).toBe(before);
    expect(await suspendedAt(nonAdmin.userId)).toBeNull();
  });

  test("M5-04 an admin route also refuses a cross-origin request, a non-JSON body and a bad id", async ({
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "no UI involved");
    const target = await makeUser("tgx");
    await signInAsAdmin(context, "adx");
    const cookie = await sessionCookie(context);

    const crossOrigin = await postApp(suspendPath(target.id), {
      cookie,
      origin: "https://evil.example",
    });
    expect(crossOrigin.status).toBe(403);
    expect(json(crossOrigin).error).toBe("forbidden_origin");
    const notJson = await postApp(suspendPath(target.id), { cookie, contentType: "text/plain" });
    expect(notJson.status).toBe(415);
    const badId = await postApp("/api/admin/accounts/not-a-uuid/suspend", { cookie });
    expect(badId.status).toBe(400);
    const missing = await postApp(suspendPath("00000000-0000-4000-8000-0000000000ff"), { cookie });
    expect(missing.status).toBe(404);
    expect(await suspendedAt(target.id)).toBeNull();
  });

  test("M5-04 a GET on an admin mutation route is not a way in", async ({ context }, info) => {
    test.skip(!desktopOnly(info), "no UI involved");
    const target = await makeUser("tgg");
    await signInAsAdmin(context, "adg");
    const cookie = cookieHeader(await authCookies(context));
    const res = await appRaw(suspendPath(target.id), { cookie });
    expect([404, 405]).toContain(res.status);
    expect(await suspendedAt(target.id)).toBeNull();
    await setSuspended(target.id, false);
  });
});

test.describe("M5-04 admin shell layout", () => {
  test("M5-04 at 390x844 /admin has the segmented section nav, no horizontal scroll and 44px targets", async ({
    page,
    context,
  }, info) => {
    test.skip(info.project.name !== "phone", "phone layout");
    await signInAsAdmin(context, "adp");
    await page.goto(url("app", "/admin"));
    const nav = page.getByRole("navigation", { name: "Admin sections" });
    await expect(nav).toBeVisible();
    await expect(nav.getByRole("link")).toHaveText([
      "Reports",
      "Pages",
      "Traffic",
      "Blocked links",
    ]);
    await expectNoHorizontalScroll(page);
    await expectTapTargets(page);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    // The charcoal top bar is there, the sidebar is not.
    await expect(page.locator("aside")).toBeHidden();
    // The nav carries the current section.
    await nav.getByRole("link", { name: "Reports" }).click();
    await expect(page).toHaveURL(url("app", "/admin/reports"));
    await expect(nav.getByRole("link", { name: "Reports" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expectNoHorizontalScroll(page);
  });

  test("M5-04 at 1440x900 /admin has the 240px charcoal sidebar and the header bar with the mono breadcrumb and 22px title", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "desktop layout");
    await signInAsAdmin(context, "add");
    await page.goto(url("app", "/admin/reports"));
    const sidebar = page.locator("aside");
    await expect(sidebar).toBeVisible();
    const box = await sidebar.boundingBox();
    expect(Math.round(box?.width ?? 0)).toBe(240);
    expect(await sidebar.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(
      "rgb(28, 27, 26)",
    );
    const nav = sidebar.getByRole("navigation", { name: "Admin" });
    await expect(nav.getByRole("link")).toHaveText([
      "Reports",
      "Pages",
      "Traffic",
      "Blocked links",
    ]);
    await expect(nav.getByRole("link", { name: "Reports" })).toHaveAttribute(
      "aria-current",
      "page",
    );

    const header = page.locator("main > header").first();
    const breadcrumb = header.locator("p").first();
    await expect(breadcrumb).toHaveText("admin / reports");
    expect(await breadcrumb.evaluate((el) => getComputedStyle(el).fontFamily)).toMatch(/mono/i);
    const h1 = header.getByRole("heading", { level: 1, name: "Reports" });
    expect(await h1.evaluate((el) => getComputedStyle(el).fontSize)).toBe("22px");
    expect(await h1.evaluate((el) => getComputedStyle(el).fontWeight)).toBe("700");
    await expectNoHorizontalScroll(page);
  });
});
