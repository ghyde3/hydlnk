import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { adminClient } from "../fixtures/auth";
import {
  accessTokenFor,
  addPage,
  cleanupUsers,
  desktopOnly,
  pageCountForHandle,
  pagesOf,
  rand,
  signedInUser,
} from "../fixtures/data";
import {
  appRaw,
  authCookies,
  cookieHeader,
  rawRequest,
  restAs,
  type RawResponse,
} from "../fixtures/http";
import { expectNoHorizontalScroll, expectTapTargets, url } from "../helpers";

/**
 * M4-18 (create another page within the plan's limit) and M4-19 (delete a page).
 *
 * Abuse cases are exercised over HTTP, the way curl would, with the signed-in session cookie (the
 * routes) or the user's JWT and the publishable key (PostgREST). They are not viewport dependent,
 * so they run on one project. The flows are one smoke each on both projects (phone 390x844,
 * desktop 1440x900): they render, the main interaction works end to end, nothing scrolls sideways
 * and every tap target is 44px. The limit table itself (Pro 2 and 3, Studio 15 and 16, concurrent
 * creates, the delete cases with a Vercel stub) is tests/unit/limits-pages.test.ts; the database
 * backstop is supabase/tests/database/092-plan-limits.test.sql.
 */

test.afterAll(cleanupUsers);

// The shared dev server compiles each route on first use and is busy with other agents' specs.
test.describe.configure({ timeout: 150_000 });

const box = async (locator: Locator) => (await locator.boundingBox())!;
const switcher = (page: Page) => page.getByRole("button", { name: /^Switch page, current:/ });
const switcherName = (handle: string) => `Switch page, current: ${handle}.hydlnk.com`;
const tenantStatus = async (handle: string) =>
  (await rawRequest(`${handle}.localhost:3000`, "/")).status;

/** One request to the app host as the signed-in context (cookie header) or with no session. */
async function api(
  context: BrowserContext | null,
  method: string,
  path: string,
  body?: unknown,
  opts: { headers?: Record<string, string>; extraCookie?: string; raw?: string } = {},
): Promise<RawResponse & { json: Record<string, unknown> | null }> {
  const cookies = context ? cookieHeader(await authCookies(context)) : "";
  const cookie = [cookies, opts.extraCookie].filter(Boolean).join("; ");
  const res = await appRaw(path, {
    method,
    cookie: cookie || undefined,
    headers: { "content-type": "application/json", ...opts.headers },
    body: opts.raw ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
  let json: Record<string, unknown> | null = null;
  try {
    json = JSON.parse(res.body) as Record<string, unknown>;
  } catch {
    json = null;
  }
  return { ...res, json };
}

async function pageRow(pageId: string) {
  const { data, error } = await adminClient()
    .from("pages")
    .select("id, owner_id, handle")
    .eq("id", pageId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

const newHandle = (label: string) => `zq-${label}-${rand(5)}`;

// ---------------------------------------------------------------------------------------------
// M4-18: the server-only create
// ---------------------------------------------------------------------------------------------

test.describe("M4-18 create a page: server-only, within the plan's limit", () => {
  test("M4-18 /pages/new and POST /api/pages refuse a request with no session and create nothing", async ({}, info) => {
    test.skip(!desktopOnly(info), "not viewport dependent");
    const handle = newHandle("ns");
    const screen = await appRaw("/pages/new");
    expect(screen.status).toBeGreaterThanOrEqual(300);
    expect(screen.status).toBeLessThan(400);
    expect(screen.location).toMatch(/login/);
    expect(screen.body).not.toContain("You’ve used");

    const post = await api(null, "POST", "/api/pages", { handle });
    expect(post.status).toBe(401);
    expect(post.json).toEqual({ error: "unauthenticated" });
    expect(await pageCountForHandle(handle)).toBe(0);
  });

  test("M4-18 the route ignores any owner in the body, refuses cross-origin and non-JSON, and sets the hl-page cookie host-only", async ({
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "not viewport dependent");
    const user = await signedInUser(context, { label: "pc", plan: "pro" });
    const victim = await signedInUser(await context.browser()!.newContext(), { label: "pv" });

    const crossOrigin = await api(
      context,
      "POST",
      "/api/pages",
      { handle: newHandle("co") },
      { headers: { origin: "http://evil.example" } },
    );
    expect(crossOrigin.status).toBe(403);
    expect(crossOrigin.json).toEqual({ error: "forbidden_origin" });

    const notJson = await api(context, "POST", "/api/pages", undefined, {
      headers: { "content-type": "text/plain" },
      raw: "handle=abc",
    });
    expect(notJson.status).toBe(415);
    const badBody = await api(context, "POST", "/api/pages", undefined, { raw: "{not json" });
    expect(badBody.status).toBe(400);

    // 'www' is reserved: 422 and nothing is created.
    const www = await api(context, "POST", "/api/pages", { handle: "www" });
    expect(www.status).toBe(422);
    expect(www.json).toMatchObject({ error: "reserved" });
    expect(await pageCountForHandle("www")).toBe(0);
    const reservedCase = await api(context, "POST", "/api/pages", { handle: "WWW" });
    expect(reservedCase.status).toBe(422);
    const taken = await api(context, "POST", "/api/pages", { handle: victim.handle });
    expect(taken.status).toBe(409);
    expect(taken.json).toMatchObject({ error: "taken" });
    expect((await pagesOf(user.userId)).length).toBe(1);

    // A body that names another owner is ignored: the page is the session user's.
    const handle = newHandle("ow");
    const made = await api(context, "POST", "/api/pages", {
      handle,
      owner_id: victim.userId,
      ownerId: victim.userId,
    });
    expect(made.status).toBe(201);
    expect(made.json).toMatchObject({ handle });
    const created = await pageRow(made.json!.pageId as string);
    expect(created).toMatchObject({ owner_id: user.userId, handle });
    expect((await pagesOf(victim.userId)).length).toBe(1);

    // The cookie names the new page and has no Domain attribute: tenant hosts never receive it.
    const setCookie = made.setCookies.find((c) => c.startsWith("hl-page="));
    expect(setCookie).toContain(`hl-page=${made.json!.pageId}`);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).not.toMatch(/Domain=/i);
  });

  test("M4-18 past the limit the route answers 403 page_limit with the plan's message and creates nothing", async ({
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "not viewport dependent");
    const pro = await signedInUser(context, { label: "pl", plan: "pro" });
    await addPage(pro.userId, newHandle("pl2"));
    await addPage(pro.userId, newHandle("pl3"));

    const handle = newHandle("pl4");
    const refused = await api(context, "POST", "/api/pages", { handle });
    expect(refused.status).toBe(403);
    expect(refused.json).toEqual({
      error: "page_limit",
      message: "You’ve used 3 of 3 pages. Studio includes 15.",
    });
    expect(await pageCountForHandle(handle)).toBe(0);
    expect((await pagesOf(pro.userId)).length).toBe(3);

    const freeContext = await context.browser()!.newContext();
    const free = await signedInUser(freeContext, { label: "pf" });
    const refusedFree = await api(freeContext, "POST", "/api/pages", { handle: newHandle("pf") });
    expect(refusedFree.status).toBe(403);
    expect(refusedFree.json).toEqual({
      error: "page_limit",
      message: "Free includes 1 page. Pro includes 3.",
    });
    expect((await pagesOf(free.userId)).length).toBe(1);
    await freeContext.close();
  });

  test("M4-18 a direct POST /rest/v1/pages with the user's JWT and the publishable key is refused whatever the count", async ({
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "not viewport dependent");
    // 1 of 3 on Pro, 1 of 1 on Free: both refused (create is server-only, no insert grant exists).
    const pro = await signedInUser(context, { label: "pj", plan: "pro" });
    const proToken = await accessTokenFor(pro.email);
    const proHandle = newHandle("pjx");
    const proInsert = await restAs(proToken, "/pages", {
      method: "POST",
      body: { owner_id: pro.userId, handle: proHandle, draft: { version: 1 } },
    });
    expect([401, 403]).toContain(proInsert.status);
    expect(await pageCountForHandle(proHandle)).toBe(0);

    const freeContext = await context.browser()!.newContext();
    const free = await signedInUser(freeContext, { label: "pk" });
    const freeToken = await accessTokenFor(free.email);
    const freeHandle = newHandle("pkx");
    const freeInsert = await restAs(freeToken, "/pages", {
      method: "POST",
      body: { owner_id: free.userId, handle: freeHandle, draft: { version: 1 } },
    });
    expect([401, 403]).toContain(freeInsert.status);
    expect(await pageCountForHandle(freeHandle)).toBe(0);

    // The user's own page is untouched and still the only one.
    expect((await pagesOf(free.userId)).length).toBe(1);
    expect((await pagesOf(pro.userId)).length).toBe(1);

    // Neither can a user delete a page through PostgREST (the grant does not exist).
    const deleted = await restAs(proToken, `/pages?id=eq.${pro.pageId}`, { method: "DELETE" });
    const deletedRows = Array.isArray(deleted.body) ? deleted.body.length : 0;
    expect([401, 403].includes(deleted.status) || deletedRows === 0).toBe(true);
    expect(await pageRow(pro.pageId)).not.toBeNull();
    await freeContext.close();
  });
});

// ---------------------------------------------------------------------------------------------
// M4-18: the screen and the switcher
// ---------------------------------------------------------------------------------------------

test.describe("M4-18 New page screen and the page switcher", () => {
  test("M4-18 Pro: the switcher's New page opens /pages/new, a handle creates the page and lands on /editor", async ({
    context,
    page,
  }, info) => {
    const user = await signedInUser(context, { label: "np", plan: "pro" });
    await page.goto(url("app", "/editor"));
    await expect(switcher(page)).toHaveAttribute("aria-label", switcherName(user.handle));

    // The menu opens below its button and every row is at least 44px.
    await switcher(page).click();
    const menu = page.getByRole("menu", { name: "Pages" });
    await expect(menu).toBeVisible();
    const newItem = menu.getByRole("menuitem", { name: "New page" });
    await expect(newItem).toBeVisible();
    await expect(newItem).not.toHaveAttribute("aria-disabled", "true");
    expect((await box(menu)).y).toBeGreaterThanOrEqual(
      (await box(switcher(page))).y + (await box(switcher(page))).height - 1,
    );
    for (const row of await menu.getByRole("menuitemradio").all()) {
      expect((await box(row)).height).toBeGreaterThanOrEqual(44);
    }
    expect((await box(newItem)).height).toBeGreaterThanOrEqual(44);
    await expectNoHorizontalScroll(page);

    await newItem.click();
    await expect(page).toHaveURL(url("app", "/pages/new"));
    await expect(page.getByRole("heading", { level: 1, name: "New page" })).toBeVisible();
    await expect(page.locator("[data-usage]")).toHaveText("You’ve used 1 of 3 pages");

    const input = page.getByLabel("Handle", { exact: true });
    const create = page.getByRole("button", { name: "Create page" });
    await expect(input).toBeVisible();
    expect((await box(input)).height).toBeGreaterThanOrEqual(44);
    expect((await box(create)).height).toBeGreaterThanOrEqual(44);
    await expectNoHorizontalScroll(page);
    await expectTapTargets(page);
    if (!desktopOnly(info)) {
      // Phone: the button spans the form's width, like the field's row.
      const field = await box(page.locator("#np-handle").locator(".."));
      const button = await box(create);
      expect(Math.abs(button.width - field.width)).toBeLessThan(2);
    } else {
      // Desktop: the screen sits in the main column to the right of the 240px sidebar.
      expect(
        (await box(page.getByRole("heading", { level: 1, name: "New page" }))).x,
      ).toBeGreaterThanOrEqual(240);
    }

    // A reserved handle is refused inline and creates nothing.
    await input.fill("www");
    await expect(page.locator("#np-handle-status")).toContainText(
      /reserved|isn’t available|can’t be used/i,
    );
    await create.click();
    await expect(page).toHaveURL(url("app", "/pages/new"));
    expect(await pageCountForHandle("www")).toBe(0);

    const handle = newHandle("np2");
    await input.fill(handle);
    await expect(page.locator("#np-handle-status")).toHaveText(`${handle}.hydlnk.com is available`);
    await create.click();
    await page.waitForURL(url("app", "/editor"));
    await expect(switcher(page)).toHaveAttribute("aria-label", switcherName(handle));

    const rows = await pagesOf(user.userId);
    expect(rows.map((r) => r.handle).sort()).toEqual([user.handle, handle].sort());
    const created = rows.find((r) => r.handle === handle)!;
    // hl-page names the new page on the app host and is never sent to the tenant host.
    const appCookies = await context.cookies(url("app"));
    expect(appCookies.find((c) => c.name === "hl-page")?.value).toBe(created.id);
    expect((await context.cookies(url(handle))).some((c) => c.name === "hl-page")).toBe(false);
    // An empty draft, not published: the placeholder shows until the owner publishes.
    expect(created.published_at).toBeNull();
    expect((created.draft as { blocks: unknown[] }).blocks).toEqual([]);
  });

  test("M4-18 keyboard: the arrow keys reach New page after the pages and wrap, and Enter opens /pages/new", async ({
    context,
    page,
  }) => {
    const user = await signedInUser(context, { label: "nk", plan: "pro" });
    await addPage(user.userId, newHandle("nk2"));
    await page.goto(url("app", "/editor"));
    await switcher(page).click();
    const menu = page.getByRole("menu", { name: "Pages" });
    const radios = menu.getByRole("menuitemradio");
    const newItem = menu.getByRole("menuitem", { name: "New page" });
    await expect(radios).toHaveCount(2);
    await expect(radios.nth(0)).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(radios.nth(1)).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(newItem).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(radios.nth(0)).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(newItem).toBeFocused();
    await page.keyboard.press("End");
    await expect(newItem).toBeFocused();
    await page.keyboard.press("Home");
    await expect(radios.nth(0)).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(url("app", "/pages/new"));
    await expect(page.locator("[data-usage]")).toHaveText("You’ve used 2 of 3 pages");
  });

  test("M4-18 at the page limit the New page item is disabled with the plan's message and See plans, and sends nothing", async ({
    context,
    page,
  }) => {
    const user = await signedInUser(context, { label: "nl" });
    const calls: string[] = [];
    page.on("request", (request) => {
      if (/\/api\/pages|\/pages\/new/.test(request.url()))
        calls.push(request.method() + request.url());
    });

    await page.goto(url("app", "/editor"));
    await switcher(page).click();
    const menu = page.getByRole("menu", { name: "Pages" });
    const newItem = menu.getByRole("menuitem", { name: "New page" });
    await expect(newItem).toHaveAttribute("aria-disabled", "true");
    await expect(menu).toContainText("Free includes 1 page. Pro includes 3.");
    const seePlans = menu.getByRole("menuitem", { name: "See plans" });
    await expect(seePlans).toHaveAttribute("href", "/settings#plans");
    expect((await box(seePlans)).height).toBeGreaterThanOrEqual(44);
    expect((await box(newItem)).height).toBeGreaterThanOrEqual(44);
    await expectNoHorizontalScroll(page);

    await newItem.click({ force: true });
    await page.waitForTimeout(300);
    await expect(page).toHaveURL(url("app", "/editor"));
    expect(calls).toEqual([]);

    // The screen itself says the same and offers no form that would only be refused.
    await page.goto(url("app", "/pages/new"));
    await expect(page.locator("[data-usage]")).toHaveText("You’ve used 1 of 1 pages");
    await expect(page.getByRole("status")).toHaveText("Free includes 1 page. Pro includes 3.");
    await expect(page.getByRole("link", { name: "See plans" })).toHaveAttribute(
      "href",
      "/settings#plans",
    );
    await expect(page.getByRole("button", { name: "Create page" })).toHaveCount(0);
    await expectNoHorizontalScroll(page);
    await expectTapTargets(page);
    expect((await pagesOf(user.userId)).length).toBe(1);
  });
});

// ---------------------------------------------------------------------------------------------
// M4-19: delete
// ---------------------------------------------------------------------------------------------

test.describe("M4-19 delete a page: the server-only action", () => {
  test("M4-19 abuse: no session is 401, another account's page is 404, a wrong confirmation is 400, and nothing is deleted", async ({
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "not viewport dependent");
    const owner = await signedInUser(context, { label: "da", plan: "pro" });
    const second = await addPage(owner.userId, newHandle("da2"));
    const otherContext = await context.browser()!.newContext();
    const other = await signedInUser(otherContext, { label: "db" });
    const del = (
      ctx: BrowserContext | null,
      id: string,
      body: unknown,
      opts?: Parameters<typeof api>[4],
    ) => api(ctx, "DELETE", `/api/pages/${id}`, body, opts);

    // No session.
    const anonymous = await del(null, second, { confirm: "x" });
    expect(anonymous.status).toBe(401);
    expect(await pageRow(second)).not.toBeNull();

    // Another account's page (also with the right handle typed): 404, identical to an unknown id.
    const foreign = await del(context, other.pageId, { confirm: other.handle });
    expect(foreign.status).toBe(404);
    const unknown = await del(context, "00000000-0000-4000-8000-00000000dead", { confirm: "x" });
    expect(unknown.status).toBe(404);
    expect(foreign.json).toEqual(unknown.json);
    const malformed = await del(context, "not-a-uuid", { confirm: "x" });
    expect(malformed.status).toBe(404);
    expect(await pageRow(other.pageId)).not.toBeNull();

    // The signed-in user cannot delete without the typed handle, whatever the dialog does.
    const noBody = await del(context, second, undefined, { raw: "{}" });
    expect(noBody.status).toBe(400);
    expect(noBody.json).toMatchObject({ error: "confirmation_mismatch" });
    const wrong = await del(context, second, { confirm: "wrong" });
    expect(wrong.status).toBe(400);
    expect(wrong.json).toMatchObject({ error: "confirmation_mismatch" });
    const upper = await del(context, second, { confirm: owner.handle });
    expect(upper.status).toBe(400);
    const crossOrigin = await del(
      context,
      second,
      { confirm: "x" },
      {
        headers: { origin: "http://evil.example" },
      },
    );
    expect(crossOrigin.status).toBe(403);
    const notJson = await del(context, second, undefined, {
      headers: { "content-type": "text/plain" },
      raw: "confirm=x",
    });
    expect(notJson.status).toBe(415);
    expect(await pageRow(second)).not.toBeNull();

    // The owner with the right text: deleted; the hl-page cookie that named it is cleared.
    const secondHandle = (await pageRow(second))!.handle as string;
    const ok = await del(
      context,
      second,
      { confirm: secondHandle },
      { extraCookie: `hl-page=${second}` },
    );
    expect(ok.status).toBe(200);
    expect(ok.json).toEqual({ handle: secondHandle, remaining: 1, redirectTo: null });
    expect(await pageRow(second)).toBeNull();
    const cleared = ok.setCookies.find((c) => c.startsWith("hl-page="));
    expect(cleared).toMatch(/hl-page=;|Max-Age=0|Expires=Thu, 01 Jan 1970/i);
    expect(await pageRow(owner.pageId)).not.toBeNull();
    await otherContext.close();
  });

  test("M4-19 DELETE /rest/v1/pages with the owner's JWT and the publishable key deletes nothing", async ({
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "not viewport dependent");
    const owner = await signedInUser(context, { label: "dr", plan: "pro" });
    const token = await accessTokenFor(owner.email);
    const res = await restAs(token, `/pages?id=eq.${owner.pageId}`, { method: "DELETE" });
    const deletedRows = Array.isArray(res.body) ? res.body.length : 0;
    expect([401, 403].includes(res.status) || deletedRows === 0).toBe(true);
    expect(await pageRow(owner.pageId)).not.toBeNull();
  });
});

test.describe("M4-19 Settings & billing: the Pages card and the delete dialog", () => {
  const pagesCard = (page: Page) =>
    page.locator("main section", { has: page.getByRole("heading", { level: 2, name: "Pages" }) });

  test("M4-19 Delete page: dialog, typed confirmation, Escape and Cancel return focus, then the page is gone everywhere", async ({
    context,
    page,
  }, info) => {
    const user = await signedInUser(context, { label: "dd", plan: "pro" });
    const keep = newHandle("ddk");
    const keepId = await addPage(user.userId, keep);
    // Warm the public page, so a stale cached copy would show up after the delete.
    expect(await tenantStatus(user.handle)).toBe(200);

    await page.goto(url("app", "/settings"));
    const card = pagesCard(page);
    await expect(card).toBeVisible();
    const row = card.locator(`[data-page-row="${user.handle}"]`);
    await expect(row).toContainText(`${user.handle}.hydlnk.com`);
    await expect(row.locator("[data-page-status]")).toHaveText("Live");
    await expect(card.locator(`[data-page-row="${keep}"] [data-page-status]`)).toHaveText(
      "Not published",
    );
    await expectNoHorizontalScroll(page);
    await expectTapTargets(page);

    const trigger = row.getByRole("button", { name: "Delete page" });
    await trigger.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute("aria-modal", "true");
    await expect(
      dialog.getByRole("heading", { name: `Delete ${user.handle}.hydlnk.com?` }),
    ).toBeVisible();
    await expect(dialog).toContainText(
      "This deletes the page, its analytics and its custom domains. This can’t be undone.",
    );
    const field = dialog.getByLabel("Type the handle to confirm");
    const confirm = dialog.getByRole("button", { name: "Delete page" });
    const cancel = dialog.getByRole("button", { name: "Cancel" });
    await expect(field).toBeFocused();
    await expect(confirm).toBeDisabled();
    await field.fill("not-it");
    await expect(confirm).toBeDisabled();

    // Layout: phone buttons are full width and stacked; desktop is centred, 440px at most.
    await expectNoHorizontalScroll(page);
    await expectTapTargets(page, "dialog");
    const dialogBox = await box(dialog);
    const viewport = page.viewportSize()!;
    if (desktopOnly(info)) {
      expect(dialogBox.width).toBeLessThanOrEqual(441);
      expect(Math.abs(dialogBox.x + dialogBox.width / 2 - viewport.width / 2)).toBeLessThan(3);
      const backdrop = await dialog.evaluate(
        (el) => getComputedStyle(el, "::backdrop").backgroundColor,
      );
      expect(backdrop).not.toBe("rgba(0, 0, 0, 0)");
    } else {
      const c = await box(confirm);
      const x = await box(cancel);
      expect(c.width).toBeGreaterThan(dialogBox.width - 60);
      expect(Math.abs(c.width - x.width)).toBeLessThan(2);
      expect(Math.max(c.y, x.y)).toBeGreaterThan(Math.min(c.y, x.y) + 40); // stacked
    }

    // Escape closes it and focus goes back to the trigger; so does Cancel.
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
    await trigger.click();
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel("Type the handle to confirm")).toHaveValue("");
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
    expect(await pageRow(user.pageId)).not.toBeNull();

    // Confirming deletes it.
    await trigger.click();
    await dialog.getByLabel("Type the handle to confirm").fill(user.handle);
    await expect(dialog.getByRole("button", { name: "Delete page" })).toBeEnabled();
    await dialog.getByRole("button", { name: "Delete page" }).click();
    // The first DELETE compiles its route in the dev server: allow for that.
    await expect(dialog).toBeHidden({ timeout: 60_000 });
    await expect(card.locator(`[data-page-row="${user.handle}"]`)).toHaveCount(0, {
      timeout: 30_000,
    });
    await expect(card.locator(`[data-page-row="${keep}"]`)).toBeVisible();

    expect(await pageRow(user.pageId)).toBeNull();
    expect(await pageRow(keepId)).not.toBeNull();
    // The public page answers 404 at once and the handle is free again.
    expect(await tenantStatus(user.handle)).toBe(404);
    const check = await appRaw(`/api/handles/check?handle=${user.handle}`);
    expect(JSON.parse(check.body)).toEqual({ handle: user.handle, status: "available" });
    // The sidebar plan card (desktop) counts one page fewer.
    if (desktopOnly(info)) {
      await page.reload();
      await expect(page.getByRole("region", { name: "Plan", exact: true })).toContainText(
        "1 of 3 pages",
      );
    }
    // A new page can be created again.
    const again = await api(context, "POST", "/api/pages", { handle: newHandle("dd3") });
    expect(again.status).toBe(201);
  });

  test("M4-19 deleting the account's last page lands on /claim", async ({ context, page }) => {
    const user = await signedInUser(context, { label: "dl" });
    await page.goto(url("app", "/settings"));
    const row = pagesCard(page).locator(`[data-page-row="${user.handle}"]`);
    await row.getByRole("button", { name: "Delete page" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Type the handle to confirm").fill(user.handle);
    await dialog.getByRole("button", { name: "Delete page" }).click();
    await expect(page).toHaveURL(url("app", "/claim"), { timeout: 60_000 });
    await expect(page.getByRole("heading", { name: "Pick your handle" })).toBeVisible();
    expect(await pageRow(user.pageId)).toBeNull();
    expect(await tenantStatus(user.handle)).toBe(404);
  });

  test("M4-19 a failed custom-domain removal keeps the dialog open with the server's sentence and deletes nothing", async ({
    context,
    page,
  }) => {
    const user = await signedInUser(context, { label: "df", plan: "pro" });
    await addPage(user.userId, newHandle("dfk"));
    await page.route("**/api/pages/*", async (route) => {
      if (route.request().method() !== "DELETE") return route.continue();
      await route.fulfill({
        status: 502,
        contentType: "application/json",
        body: JSON.stringify({
          error: "domain_removal_failed",
          message: "Couldn’t remove its custom domain. Try again.",
        }),
      });
    });
    await page.goto(url("app", "/settings"));
    const row = pagesCard(page).locator(`[data-page-row="${user.handle}"]`);
    await row.getByRole("button", { name: "Delete page" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Type the handle to confirm").fill(user.handle);
    await dialog.getByRole("button", { name: "Delete page" }).click();
    await expect(dialog.getByRole("alert")).toHaveText(
      "Couldn’t remove its custom domain. Try again.",
    );
    await expect(dialog).toBeVisible();
    await expect(row).toBeVisible();
    expect(await pageRow(user.pageId)).not.toBeNull();
    await expectNoHorizontalScroll(page);
  });
});
