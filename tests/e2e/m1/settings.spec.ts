import { expect, test, type Locator, type Page } from "@playwright/test";
import { expectNoHorizontalScroll, expectTapTargets, url } from "../helpers";
import { adminClient, publishableKey, supabaseUrl, userClient } from "../fixtures/auth";
import { axeViolations } from "../fixtures/a11y";
import {
  cleanupUsers,
  desktopOnly,
  phoneOnly,
  rand,
  signedInUser,
  trackUser,
} from "../fixtures/data";
import { rawRequest, sessionOf } from "../fixtures/http";

/**
 * M1-20 (Settings & billing: Account section) and M1-22 (delete account). Phone = 390x844,
 * desktop = 1440x900.
 */

test.afterAll(cleanupUsers);

const css = (locator: Locator, property: string) =>
  locator.evaluate((el, prop) => getComputedStyle(el).getPropertyValue(prop), property);

const settings = () => url("app", "/settings");
const dialogOf = (page: Page) => page.getByRole("dialog", { name: "Delete your account?" });

test.describe("M1-20 Settings & billing: Account section", () => {
  test("M1-20 header, Account card, read-only fields and buttons", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "desktop layout");
    const user = await signedInUser(context, { label: "set" });
    await page.goto(settings());
    await expect(page).toHaveTitle("Settings & billing — HYDLNK");

    const crumb = page.locator("main > header p");
    await expect(crumb).toHaveText("Account");
    expect(await css(crumb, "font-family")).toMatch(/Geist.?Mono/);
    const h1 = page.getByRole("heading", { level: 1 });
    await expect(h1).toHaveText("Settings & billing");
    expect(await css(h1, "font-size")).toBe("22px");
    expect(await css(h1, "font-weight")).toBe("700");

    // The Account card: Milestone 4 adds the plan band, usage, plans and pages cards above it.
    const card = page.locator("main section", {
      has: page.getByRole("heading", { level: 2, name: "Account" }),
    });
    await expect(card).toHaveCount(1);
    expect(await css(card, "background-color")).toBe("rgb(255, 255, 255)");
    expect(await css(card, "border-top-width")).toBe("1px");
    expect(await css(card, "border-top-color")).toBe("rgb(226, 223, 217)");
    expect(await css(card, "border-top-left-radius")).toBe("6px");
    // Wider than 920 would break the cap; narrower means something else shrinks the card.
    expect((await card.boundingBox())!.width).toBe(920);

    const h2 = card.getByRole("heading", { level: 2, name: "Account" });
    expect(await css(h2, "font-size")).toBe("14px");
    expect(await css(h2, "font-weight")).toBe("600");

    const email = card.locator("dd", { hasText: user.email });
    await expect(email).toHaveText(user.email);
    await expect(card.locator("dt", { hasText: "Email" })).toBeVisible();
    const handle = card.locator("dd", { hasText: user.handle });
    await expect(handle).toHaveText(`${user.handle}.hydlnk.com`);
    expect(await css(handle, "font-family")).toMatch(/Geist.?Mono/);
    expect(await css(handle, "font-size")).toBe("14px");
    expect(await css(handle.locator("span span"), "color")).toBe("rgb(122, 118, 111)");
    await expect(handle.locator("span span")).toHaveText(".hydlnk.com");
    await expect(card.getByRole("button", { name: /change/i })).toHaveCount(0);
    await expect(card.locator("dl input")).toHaveCount(0);

    const signOut = card.getByRole("button", { name: "Sign out" });
    const del = card.getByRole("button", { name: "Delete account" });
    expect((await signOut.boundingBox())!.height).toBe(44);
    expect((await del.boundingBox())!.height).toBe(44);
    expect(await css(signOut, "border-top-color")).toBe("rgb(201, 197, 190)");
    expect(await css(signOut, "background-color")).toBe("rgb(255, 255, 255)");
    expect(await css(del, "border-top-color")).toBe("rgb(232, 196, 189)");
    expect(await css(del, "color")).toBe("rgb(178, 58, 43)");
    expect(await css(del, "background-color")).toBe("rgb(255, 255, 255)");

    // The rule above the buttons.
    const rule = card.locator("div.border-t");
    expect(await css(rule, "border-top-width")).toBe("1px");
    expect(await css(rule, "border-top-color")).toBe("rgb(226, 223, 217)");

    // Desktop: fields side by side (flex-basis 260px), Sign out left, Delete account far right.
    const emailBox = (await email.locator("..").boundingBox())!;
    const handleBox = (await handle.locator("..").boundingBox())!;
    expect(Math.abs(emailBox.y - handleBox.y)).toBeLessThan(1);
    expect(handleBox.x).toBeGreaterThan(emailBox.x + emailBox.width - 1);
    expect(await css(email.locator(".."), "flex-basis")).toBe("260px");
    expect(await css(handle.locator(".."), "flex-basis")).toBe("260px");
    const cardBox = (await card.boundingBox())!;
    const signBox = (await signOut.boundingBox())!;
    const delBox = (await del.boundingBox())!;
    expect(Math.abs(signBox.y - delBox.y)).toBeLessThan(1);
    expect(signBox.x).toBeLessThan(cardBox.x + 40);
    expect(delBox.x + delBox.width).toBeGreaterThan(cardBox.x + cardBox.width - 40);
    await expectNoHorizontalScroll(page);
  });

  test("M1-20 phone: stacked fields and full-width stacked buttons, Account tab active", async ({
    page,
    context,
  }, info) => {
    test.skip(!phoneOnly(info), "phone layout");
    const user = await signedInUser(context, { label: "set" });
    await page.goto(settings());
    await expectNoHorizontalScroll(page);
    await expectTapTargets(page);

    const email = page.locator("dd", { hasText: user.email }).locator("..");
    const handle = page.locator("dd", { hasText: user.handle }).locator("..");
    const emailBox = (await email.boundingBox())!;
    const handleBox = (await handle.boundingBox())!;
    expect(handleBox.y).toBeGreaterThan(emailBox.y + emailBox.height - 1);
    expect(Math.abs(handleBox.x - emailBox.x)).toBeLessThan(1);

    const card = page.locator("main section", {
      has: page.getByRole("heading", { level: 2, name: "Account" }),
    });
    const cardBox = (await card.boundingBox())!;
    const signOut = (await page.getByRole("button", { name: "Sign out" }).boundingBox())!;
    const del = (await page.getByRole("button", { name: "Delete account" }).boundingBox())!;
    expect(signOut.width).toBeGreaterThan(cardBox.width - 40);
    expect(del.width).toBeCloseTo(signOut.width, 0);
    expect(del.y).toBeGreaterThan(signOut.y + signOut.height - 1);
    expect(Math.abs(del.x - signOut.x)).toBeLessThan(1);

    const tabs = page.getByRole("navigation", { name: "App sections" });
    await expect(tabs.locator("a[aria-current='page']")).toHaveText("Account");
  });

  test("M1-20 each signed-in user sees only their own email and handle; a Google account shows its email", async ({
    page,
    context,
    browser,
  }, info) => {
    test.skip(!desktopOnly(info), "reads the desktop layout");
    const a = await signedInUser(context, { label: "sa" });
    const otherContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const otherPage = await otherContext.newPage();
    const b = await signedInUser(otherContext, { label: "sb" });

    await page.goto(settings());
    await otherPage.goto(settings());
    await expect(page.locator("main dl")).toContainText(a.email);
    await expect(page.locator("main dl")).toContainText(`${a.handle}.hydlnk.com`);
    await expect(page.locator("main dl")).not.toContainText(b.email);
    await expect(page.locator("main dl")).not.toContainText(b.handle);
    await expect(otherPage.locator("main dl")).toContainText(b.email);
    await expect(otherPage.locator("main dl")).not.toContainText(a.email);
    await otherContext.close();

    // An account created through Google: its Google email is the session email.
    const googleEmail = `e2e-goog-${rand()}@example.com`;
    const created = await adminClient().auth.admin.createUser({
      email: googleEmail,
      email_confirm: true,
      app_metadata: { provider: "google", providers: ["google"] },
      user_metadata: { full_name: "Google Person" },
    });
    expect(created.error).toBeNull();
    const googleContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const googlePage = await googleContext.newPage();
    await signedInUser(googleContext, { label: "go", email: googleEmail });
    await googlePage.goto(settings());
    await expect(googlePage.locator("main dl")).toContainText(googleEmail);
    await googleContext.close();
    trackUser(created.data.user!.id);
  });

  test("M1-20 Sign out ends the session and lands on /login", async ({ page, context }, info) => {
    test.skip(!desktopOnly(info), "desktop layout");
    await signedInUser(context, { label: "so" });
    await page.goto(settings());
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(url("app", "/login"));
    await page.goto(url("app", "/editor"));
    await expect(page).toHaveURL(url("app", "/login"));
  });
});

test.describe("M1-22 delete account", () => {
  test("M1-22 dialog: copy, disabled until the handle matches, Escape and Cancel, focus trap and return", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "desktop layout");
    const user = await signedInUser(context, { label: "del" });
    await page.goto(settings());

    const trigger = page.locator("main").getByRole("button", { name: "Delete account" });
    await trigger.click();
    const dialog = dialogOf(page);
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute("aria-modal", "true");
    await expect(dialog.getByRole("heading", { name: "Delete your account?" })).toBeVisible();
    await expect(dialog).toContainText(
      `This deletes ${user.handle}.hydlnk.com, its analytics and your saved themes. This can’t be undone.`,
    );
    const field = dialog.getByLabel("Type your handle to confirm");
    await expect(field).toBeVisible();
    await expect(field).toBeFocused();
    const confirm = dialog.getByRole("button", { name: "Delete account" });
    await expect(confirm).toBeDisabled();
    await field.fill(user.handle.slice(0, -1));
    await expect(confirm).toBeDisabled();
    await field.fill(user.handle);
    await expect(confirm).toBeEnabled();
    await field.fill(`${user.handle}x`);
    await expect(confirm).toBeDisabled();

    // Focus is trapped inside while the dialog is open.
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press("Tab");
      expect(await page.evaluate(() => !!document.activeElement?.closest("dialog"))).toBe(true);
    }
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press("Shift+Tab");
      expect(await page.evaluate(() => !!document.activeElement?.closest("dialog"))).toBe(true);
    }

    // Escape closes with nothing changed, focus returns to the trigger.
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();

    // Cancel closes too, and the field is empty again on reopen.
    await trigger.click();
    await dialog.getByLabel("Type your handle to confirm").fill(user.handle);
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
    await trigger.click();
    await expect(dialog.getByLabel("Type your handle to confirm")).toHaveValue("");
    await page.keyboard.press("Escape");

    const { data } = await adminClient().from("pages").select("id").eq("owner_id", user.userId);
    expect(data).toHaveLength(1);
    expect((await adminClient().auth.admin.getUserById(user.userId)).data.user).not.toBeNull();
  });

  test("M1-22 confirming deletes the user, their data and releases the handle", async ({
    page,
    context,
    browser,
  }, info) => {
    test.skip(!desktopOnly(info), "desktop layout");
    const admin = adminClient();
    const user = await signedInUser(context, { label: "del", plan: "pro" });
    // Rows that hang off the user: a saved theme, a domain, analytics for the page.
    const theme = await admin
      .from("themes")
      .insert({ owner_id: user.userId, name: "zq theme", tokens: {} });
    expect(theme.error).toBeNull();
    const domain = await admin
      .from("domains")
      .insert({ page_id: user.pageId, hostname: `zq-del-${rand()}.example.test` });
    expect(domain.error).toBeNull();
    // daily_stats is written by the rollup job only: log an event on a quiet past day, roll it up.
    const event = await admin.from("events").insert([
      { page_id: user.pageId, type: "view", visitor_hash: "zq-test", ts: new Date().toISOString() },
      { page_id: user.pageId, type: "view", visitor_hash: "zq-test", ts: "2026-01-15T12:00:00Z" },
    ]);
    expect(event.error).toBeNull();
    const rollup = await admin.rpc("rollup_daily_stats", { p_day: "2026-01-15" });
    expect(rollup.error).toBeNull();
    expect(
      (await admin.from("daily_stats").select("page_id").eq("page_id", user.pageId)).data,
    ).toHaveLength(1);

    const tenant = await browser.newPage();
    expect((await tenant.goto(url(user.handle)))!.status()).toBe(200);

    const session = await sessionOf(context);
    await page.goto(settings());
    await page.locator("main").getByRole("button", { name: "Delete account" }).click();
    const dialog = dialogOf(page);
    await dialog.getByLabel("Type your handle to confirm").fill(user.handle);
    await dialog.getByRole("button", { name: "Delete account" }).click();

    await expect(page).toHaveURL(/^http:\/\/app\.localhost:3000\/login/);

    // The session is gone: the captured refresh token cannot be exchanged, /editor sends to /login.
    const refresh = await fetch(`${supabaseUrl()}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST",
      headers: { apikey: publishableKey(), "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: session.refresh_token }),
    });
    expect(refresh.status).not.toBe(200);
    await page.goto(url("app", "/editor"));
    await expect(page).toHaveURL(url("app", "/login"));

    // The published page is gone right away (the dev server caches nothing; the production cache is
    // expired by the delete itself, see tests/e2e/m2/publish-cache.spec.ts), before the handle is re-claimed.
    expect((await tenant.goto(url(user.handle)))!.status()).toBe(404);

    // Data is gone.
    expect((await admin.auth.admin.getUserById(user.userId)).data.user).toBeNull();
    const none = async (table: string, column: string, value: string) => {
      const { count, error } = await admin
        .from(table)
        .select("*", { count: "exact", head: true })
        .eq(column, value);
      expect(error).toBeNull();
      return count;
    };
    expect(await none("accounts", "id", user.userId)).toBe(0);
    expect(await none("pages", "owner_id", user.userId)).toBe(0);
    expect(await none("themes", "owner_id", user.userId)).toBe(0);
    expect(await none("domains", "page_id", user.pageId)).toBe(0);
    expect(await none("events", "page_id", user.pageId)).toBe(0);
    expect(await none("daily_stats", "page_id", user.pageId)).toBe(0);

    // Handle released: it checks as available, another user can take it, the tenant host 404s.
    const check = await page.goto(url("app", `/api/handles/check?handle=${user.handle}`));
    expect(await check!.json()).toMatchObject({ handle: user.handle, status: "available" });
    const newcomer = await admin.auth.admin.createUser({
      email: `e2e-new-${rand()}@example.com`,
      email_confirm: true,
    });
    trackUser(newcomer.data.user!.id);
    const claimed = await admin.from("pages").insert({
      owner_id: newcomer.data.user!.id,
      handle: user.handle,
      draft: (await admin.from("pages").select("draft").eq("handle", "mara").single()).data!.draft,
    });
    expect(claimed.error).toBeNull();
    await admin.from("pages").delete().eq("handle", user.handle);
    await tenant.close();
  });

  test("M1-22 /login shows 'Your account was deleted.' as a status notice after deletion", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "desktop layout");
    const user = await signedInUser(context, { label: "del" });
    await page.goto(settings());
    await page.locator("main").getByRole("button", { name: "Delete account" }).click();
    const dialog = dialogOf(page);
    await dialog.getByLabel("Type your handle to confirm").fill(user.handle);
    await dialog.getByRole("button", { name: "Delete account" }).click();
    await expect(page).toHaveURL(/^http:\/\/app\.localhost:3000\/login/);
    await expect(
      page.getByRole("status").filter({ hasText: "Your account was deleted." }),
    ).toBeVisible();
  });

  test("M1-22 abuse: a payload naming another user's id deletes only the session user", async ({
    page,
    context,
    browser,
  }, info) => {
    test.skip(!desktopOnly(info), "desktop layout");
    const admin = adminClient();
    const a = await signedInUser(context, { label: "dxa" });
    const otherContext = await browser.newContext();
    const b = await signedInUser(otherContext, { label: "dxb" });
    await otherContext.close();

    await page.goto(settings());
    await page.locator("main").getByRole("button", { name: "Delete account" }).click();
    const dialog = dialogOf(page);
    await dialog.getByLabel("Type your handle to confirm").fill(a.handle);
    // Smuggle B's identifiers into the submitted form data.
    await page.evaluate((victim) => {
      const form = document.querySelector("dialog form")!;
      for (const name of ["id", "userId", "user_id", "owner_id", "email", "handle"]) {
        const input = document.createElement("input");
        input.type = "hidden";
        input.name = name;
        input.value = name === "email" ? "x" : victim;
        form.appendChild(input);
      }
    }, b.userId);
    await dialog.getByRole("button", { name: "Delete account" }).click();
    await expect(page).toHaveURL(/^http:\/\/app\.localhost:3000\/login/);

    expect((await admin.auth.admin.getUserById(a.userId)).data.user).toBeNull();
    expect((await admin.auth.admin.getUserById(b.userId)).data.user).not.toBeNull();
    expect((await admin.from("pages").select("id").eq("id", b.pageId)).data).toHaveLength(1);
    expect((await admin.from("accounts").select("id").eq("id", b.userId)).data).toHaveLength(1);
  });

  test("M1-22 abuse: a wrong confirmation is rejected on the server and deletes nothing", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "desktop layout");
    const user = await signedInUser(context, { label: "dxc" });
    await page.goto(settings());
    await page.locator("main").getByRole("button", { name: "Delete account" }).click();
    const dialog = dialogOf(page);
    const field = dialog.getByLabel("Type your handle to confirm");
    await field.fill("not-my-handle");
    const confirm = dialog.getByRole("button", { name: "Delete account" });
    await expect(confirm).toBeDisabled();
    // Bypass the disabled guard rail: the server must still refuse.
    await confirm.evaluate((el) => ((el as HTMLButtonElement).disabled = false));
    await confirm.click();
    await expect(dialog.getByRole("alert")).toBeVisible();
    await expect(page).toHaveURL(settings());
    expect((await adminClient().auth.admin.getUserById(user.userId)).data.user).not.toBeNull();
    expect(
      (await adminClient().from("pages").select("id").eq("id", user.pageId)).data,
    ).toHaveLength(1);
  });

  test("M1-22 abuse: a replayed delete request without a session deletes nothing", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "desktop layout");
    const user = await signedInUser(context, { label: "dxd" });
    await page.goto(settings());

    // Record the Server Action request the dialog sends, but never let it reach the server.
    let recorded: { headers: Record<string, string>; body: string } | undefined;
    await page.route("**/settings", async (route) => {
      const request = route.request();
      if (request.method() === "POST" && request.headers()["next-action"]) {
        recorded = { headers: request.headers(), body: request.postData() ?? "" };
        await route.abort();
      } else {
        await route.continue();
      }
    });
    await page.locator("main").getByRole("button", { name: "Delete account" }).click();
    const dialog = dialogOf(page);
    await dialog.getByLabel("Type your handle to confirm").fill(user.handle);
    await dialog.getByRole("button", { name: "Delete account" }).click();
    await expect.poll(() => recorded).toBeTruthy();
    await page.unroute("**/settings");

    const headers: Record<string, string> = {};
    for (const name of ["next-action", "content-type", "accept", "next-router-state-tree"]) {
      if (recorded!.headers[name]) headers[name] = recorded!.headers[name]!;
    }
    // No cookies: this caller has no session. node:http, because fetch would not send our Host.
    const response = await rawRequest("app.localhost:3000", "/settings", {
      method: "POST",
      headers: { ...headers, origin: "http://app.localhost:3000" },
      body: recorded!.body,
    });
    const location = String(response.headers.location ?? "");
    const actionRedirect = String(response.headers["x-action-redirect"] ?? "");
    expect(
      response.status === 401 || location.includes("/login") || actionRedirect.includes("/login"),
      `status ${response.status}, location "${location}", x-action-redirect "${actionRedirect}"`,
    ).toBe(true);
    expect((await adminClient().auth.admin.getUserById(user.userId)).data.user).not.toBeNull();
    expect(
      (await adminClient().from("pages").select("id").eq("id", user.pageId)).data,
    ).toHaveLength(1);
  });

  test("M1-22 abuse: the direct API with the user's JWT cannot delete the account, page or auth user", async ({
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "no UI involved");
    const admin = adminClient();
    const user = await signedInUser(context, { label: "dxe" });
    const { access_token } = await sessionOf(context);
    const headers = {
      apikey: publishableKey(),
      Authorization: `Bearer ${access_token}`,
      Prefer: "return=representation",
    };

    for (const [table, column, value] of [
      ["accounts", "id", user.userId],
      ["pages", "id", user.pageId],
    ] as const) {
      const response = await fetch(`${supabaseUrl()}/rest/v1/${table}?${column}=eq.${value}`, {
        method: "DELETE",
        headers,
      });
      const body = (await response.text()).trim();
      const rejected = response.status >= 400;
      const deletedNothing = response.ok && (body === "" || body === "[]");
      expect(rejected || deletedNothing, `${table}: ${response.status} ${body}`).toBe(true);
    }

    const adminDelete = await fetch(`${supabaseUrl()}/auth/v1/admin/users/${user.userId}`, {
      method: "DELETE",
      headers,
    });
    expect([401, 403]).toContain(adminDelete.status);

    // Everything is still there, read with the secret key. (And as the user, under RLS.)
    expect((await admin.auth.admin.getUserById(user.userId)).data.user).not.toBeNull();
    expect((await admin.from("accounts").select("id").eq("id", user.userId)).data).toHaveLength(1);
    expect((await admin.from("pages").select("id").eq("id", user.pageId)).data).toHaveLength(1);
    const own = await userClient(access_token).from("pages").select("id");
    expect(own.data).toHaveLength(1);
  });

  test("M1-22 phone: dialog fits the viewport with full-width stacked buttons", async ({
    page,
    context,
  }, info) => {
    test.skip(!phoneOnly(info), "phone layout");
    const user = await signedInUser(context, { label: "del" });
    await page.goto(settings());
    await page.locator("main").getByRole("button", { name: "Delete account" }).click();
    const dialog = dialogOf(page);
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Type your handle to confirm").fill(user.handle);
    await expectNoHorizontalScroll(page);
    await expectTapTargets(page, "dialog");
    const box = (await dialog.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    expect(box.y + box.height).toBeLessThanOrEqual(844);
    const cancel = (await dialog.getByRole("button", { name: "Cancel" }).boundingBox())!;
    const confirm = (await dialog.getByRole("button", { name: "Delete account" }).boundingBox())!;
    expect(cancel.width).toBeGreaterThan(box.width - 50);
    expect(confirm.width).toBeCloseTo(cancel.width, 0);
    expect(Math.abs(confirm.x - cancel.x)).toBeLessThan(1);
    expect(Math.abs(confirm.y - cancel.y)).toBeGreaterThanOrEqual(44);
  });

  test("M1-22 desktop: dialog centered at max-width 440px over a dimmed backdrop", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "desktop layout");
    await signedInUser(context, { label: "del" });
    await page.goto(settings());
    await page.locator("main").getByRole("button", { name: "Delete account" }).click();
    const dialog = dialogOf(page);
    await expect(dialog).toBeVisible();
    const box = (await dialog.boundingBox())!;
    expect(box.width).toBeLessThanOrEqual(440);
    expect(box.width).toBeGreaterThan(400);
    expect(Math.abs(box.x + box.width / 2 - 720)).toBeLessThan(2);
    expect(Math.abs(box.y + box.height / 2 - 450)).toBeLessThan(2);
    const backdrop = await dialog.evaluate(
      (el) => getComputedStyle(el, "::backdrop").backgroundColor,
    );
    const alpha = Number(/(?:\/|,)\s*([\d.]+)\)$/.exec(backdrop)?.[1]);
    expect(alpha, backdrop).toBeGreaterThanOrEqual(0.3);
    expect(alpha, backdrop).toBeLessThan(1);
    expect(await axeViolations(page)).toEqual([]);
  });
});
