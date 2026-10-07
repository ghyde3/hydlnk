import { expect, test } from "@playwright/test";
import { cleanupUsers, desktopOnly } from "../fixtures/data";
import { appRaw, authCookies, cookieHeader } from "../fixtures/http";
import { url } from "../helpers";
import { APP_ORIGIN, signInAsAdmin, signInAsUser } from "../m5/admin-helpers";
import { endGiftApi, giftApi, giftAudit, giftPath, giftRow } from "./admin-gift-helpers";

/**
 * M13-07 who can reach the gift screen and its two routes. Signed out: the sign-in page (screen),
 * 401 (routes). A signed-in non-admin: the app's 404 (screen, the same page as an unknown route),
 * 403 (routes), and nothing changes. A cross-origin POST is refused. An unknown account is a 404.
 */

test.describe.configure({ timeout: 120_000 });
test.afterAll(cleanupUsers);

test.beforeEach(({}, info) => {
  test.skip(!desktopOnly(info), "access rules, nothing depends on the viewport");
});

async function post(
  context: Parameters<typeof authCookies>[0] | null,
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
) {
  const cookie = context ? cookieHeader(await authCookies(context)) : undefined;
  return appRaw(path, {
    method: "POST",
    cookie,
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

test("M13-07 signed out goes to sign-in and the routes answer 401", async () => {
  const target = "00000000-0000-4000-8000-0000000000aa";
  const screen = await appRaw(giftPath(target));
  expect(screen.status).toBe(307);
  expect(new URL(screen.location ?? "", APP_ORIGIN).pathname).toBe("/login");
  expect((await post(null, giftApi(target), { plan: "pro" })).status).toBe(401);
  expect((await post(null, endGiftApi(target), {})).status).toBe(401);
});

test("M13-07 a signed-in non-admin gets the app's 404 on the screen and 403 on the routes, and nothing changes", async ({
  page,
  context,
}) => {
  const user = await signInAsUser(context, "gftna");
  await page.goto(url("app", "/no-such-route-m1307"));
  await expect(page.getByText("That page doesn’t exist.")).toBeVisible({ timeout: 30_000 });
  const unknownText = (await page.locator("body").innerText()).trim();
  const response = await page.goto(url("app", giftPath(user.userId)));
  expect(response?.status()).toBe(404);
  await expect(page.getByText("That page doesn’t exist.")).toBeVisible({ timeout: 30_000 });
  expect((await page.locator("body").innerText()).trim()).toBe(unknownText);

  const gift = await post(context, giftApi(user.userId), { plan: "studio" });
  expect(gift.status).toBe(403);
  const end = await post(context, endGiftApi(user.userId), {});
  expect(end.status).toBe(403);
  expect(await giftRow(user.userId)).toMatchObject({ plan: "free", gift_plan: null });
  expect(await giftAudit(user.userId)).toEqual([]);
});

test("M13-07 an admin: a cross-origin POST is 403, a non-JSON body 415, an unknown account 404, a gift to oneself is allowed and audited once", async ({
  context,
}) => {
  const admin = await signInAsAdmin(context, "gftacc");
  const cross = await post(
    context,
    giftApi(admin.userId),
    { plan: "pro" },
    {
      origin: "http://evil.example",
    },
  );
  expect(cross.status).toBe(403);
  expect(await giftAudit(admin.userId)).toEqual([]);

  const cookie = cookieHeader(await authCookies(context));
  const text = await appRaw(giftApi(admin.userId), {
    method: "POST",
    cookie,
    headers: { "content-type": "text/plain" },
    body: "plan=pro",
  });
  expect(text.status).toBe(415);

  const none = await post(context, giftApi("00000000-0000-4000-8000-0000000000bb"), {
    plan: "pro",
  });
  expect(none.status).toBe(404);

  const ok = await post(context, giftApi(admin.userId), { plan: "pro", reason: "self" });
  expect(ok.status).toBe(200);
  expect((await giftAudit(admin.userId)).map((r) => r.action)).toEqual(["gift_plan"]);
  const end = await post(context, endGiftApi(admin.userId), {});
  expect(end.status).toBe(200);
  expect(JSON.parse(end.body)).toMatchObject({ ok: true, changed: true });
  const again = await post(context, endGiftApi(admin.userId), {});
  expect(JSON.parse(again.body)).toMatchObject({ ok: true, changed: false });
  expect((await giftAudit(admin.userId)).map((r) => r.action)).toEqual(["gift_plan", "end_gift"]);
});
