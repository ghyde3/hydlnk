import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { expectNoHorizontalScroll, expectTapTargets, url } from "../helpers";
import { adminClient, generateTokenHash, openCallback } from "../fixtures/auth";
import { uniq } from "../fixtures/data";
import { authCookies, authUser, requestLinkByApi, restAs, sessionOf } from "../fixtures/http";
import { signInLinkFor } from "../fixtures/mailpit";

const CALLBACK = url("app", "/auth/callback");
const ROOT = url("app", "/");
const addr = (label: string, project: string) => `${uniq(label)}-${project}@example.com`;

/** Opens `target` and returns every URL of the navigation chain (redirects included) with its status. */
async function visit(page: Page, target: string) {
  const response = await page.goto(target);
  const chain: { url: string; status: number }[] = [];
  const request = response!.request();
  chain.unshift({ url: request.url(), status: response!.status() });
  for (let prev = request.redirectedFrom(); prev; prev = prev.redirectedFrom()) {
    chain.unshift({ url: prev.url(), status: (await prev.response())?.status() ?? 0 });
  }
  return { response: response!, chain, finalUrl: page.url() };
}

const hasSession = async (context: BrowserContext) => (await authCookies(context)).length > 0;

test.describe("M1-04 auth callback signs in from the emailed link in any browser", () => {
  test("M1-04 the emailed link signs in the same context, session survives a reload", async ({
    page,
    context,
  }, testInfo) => {
    const email = addr("cb-same", testInfo.project.name);
    await requestLinkByApi(email);
    const link = await signInLinkFor(email);
    expect(link.startsWith(CALLBACK)).toBe(true);

    const { chain, finalUrl } = await visit(page, link);
    // callback -> "/" (the landing) -> wherever the auth gate sends this account.
    expect(chain[0]!.status).toBe(303);
    expect(chain.map((hop) => hop.url)).toContain(ROOT);
    expect(new URL(finalUrl).host).toBe("app.localhost:3000");
    expect(new URL(finalUrl).pathname).not.toBe("/login");

    const session = await sessionOf(context);
    expect(await authUser(session.access_token)).toEqual({ status: 200, email });

    await page.reload();
    expect(new URL(page.url()).pathname).not.toBe("/login");
    expect(await hasSession(context)).toBe(true);
    expect((await authUser((await sessionOf(context)).access_token)).email).toBe(email);
  });

  test("M1-04 a link opened in a brand-new context (a different browser) also signs in", async ({
    browser,
  }, testInfo) => {
    const email = addr("cb-other", testInfo.project.name);
    await requestLinkByApi(email); // "requested" in one browser ...
    const link = await signInLinkFor(email);

    const fresh = await browser.newContext(); // ... opened in another one, with no cookies at all
    try {
      expect(await hasSession(fresh)).toBe(false);
      const page = await fresh.newPage();
      await page.goto(link);
      expect(await hasSession(fresh)).toBe(true);
      expect((await authUser((await sessionOf(fresh)).access_token)).email).toBe(email);
    } finally {
      await fresh.close();
    }
  });

  test("M1-04 a used link and a link with one altered character end on /login?error=link_invalid", async ({
    page,
    context,
    browser,
  }, testInfo) => {
    const { hashedToken } = await generateTokenHash(addr("cb-bad", testInfo.project.name));
    await openCallback(context, hashedToken); // uses it up
    expect(await hasSession(context)).toBe(true);

    for (const [label, token] of [
      ["already used", hashedToken],
      ["altered", `${hashedToken.slice(0, -1)}${hashedToken.endsWith("0") ? "1" : "0"}`],
    ] as const) {
      const fresh = await browser.newContext();
      try {
        const p = await fresh.newPage();
        const response = await p.goto(`${CALLBACK}?token_hash=${token}&type=email`);
        expect(response!.status(), label).toBe(200);
        await expect(p, label).toHaveURL(url("app", "/login?error=link_invalid"));
        await expect(
          p.getByText("That sign-in link expired or was already used. Request a new one."),
        ).toBeVisible();
        expect(await hasSession(fresh), label).toBe(false);
      } finally {
        await fresh.close();
      }
    }
    void page;
  });

  test("M1-04 a callback without parameters redirects to /login", async ({ page }) => {
    const { finalUrl, chain } = await visit(page, CALLBACK);
    expect(chain[0]!.status).toBeGreaterThanOrEqual(300);
    expect(finalUrl).toBe(url("app", "/login"));
  });

  for (const evil of [
    "next=https://evil.example",
    "next=//evil.example",
    "next=/\\evil.example",
    "next=javascript:alert(1)",
    "redirect_to=https://evil.example",
  ]) {
    test(`M1-04 open redirect: ${evil} never steers the destination`, async ({
      page,
    }, testInfo) => {
      const { hashedToken } = await generateTokenHash(addr("cb-evil", testInfo.project.name));
      const { chain, finalUrl } = await visit(
        page,
        `${CALLBACK}?token_hash=${hashedToken}&type=email&${evil.replace("\\", "%5C")}`,
      );
      expect(chain[1]!.url).toBe(ROOT); // the callback's own redirect: exactly the landing
      expect(new URL(finalUrl).host).toBe("app.localhost:3000");
    });
  }

  test("M1-04 /auth/callback exists on the app host only", async ({ page }) => {
    for (const host of [null, "mara"]) {
      const response = await page.goto(url(host, "/auth/callback"));
      expect(response!.status(), String(host)).toBe(404);
    }
  });

  test.describe("phone layout", () => {
    test.skip(({ isMobile }) => !isMobile, "phone project only");
    test("M1-04 at 390x844 the link_invalid notice sits above the form in #B23A2B", async ({
      page,
    }) => {
      await page.goto(url("app", "/login?error=link_invalid"));
      await expectNoHorizontalScroll(page);
      await expectTapTargets(page);
      const notice = page.getByText(
        "That sign-in link expired or was already used. Request a new one.",
      );
      await expect(notice).toBeVisible();
      expect(await notice.evaluate((el) => getComputedStyle(el).color)).toBe("rgb(178, 58, 43)");
      const box = await notice.boundingBox();
      const input = await page.getByLabel("Email", { exact: true }).boundingBox();
      expect(box!.y + box!.height).toBeLessThanOrEqual(input!.y);
      expect(box!.x + box!.width).toBeLessThanOrEqual(390);
    });
  });

  test.describe("desktop layout", () => {
    test.skip(({ isMobile }) => isMobile, "desktop project only");
    test("M1-04 at 1440x900 the notice is inside the form column above the Email field", async ({
      page,
    }) => {
      await page.goto(url("app", "/login?error=link_invalid"));
      const notice = await page
        .getByText("That sign-in link expired or was already used. Request a new one.")
        .boundingBox();
      const column = await page.locator("main > div").boundingBox();
      const input = await page.getByLabel("Email", { exact: true }).boundingBox();
      expect(notice!.x).toBeGreaterThanOrEqual(column!.x);
      expect(notice!.x + notice!.width).toBeLessThanOrEqual(column!.x + column!.width + 1);
      expect(notice!.y + notice!.height).toBeLessThanOrEqual(input!.y);
    });
  });
});

test.describe("M1-05 account row is created server-side on first sign-in", () => {
  const accountRows = async (userId: string) =>
    (await adminClient().from("accounts").select("*").eq("id", userId)).data ?? [];

  test("M1-05 a brand-new address ends with exactly one free account row; signing in again changes nothing", async ({
    page,
    context,
  }, testInfo) => {
    const email = addr("acct", testInfo.project.name);
    await requestLinkByApi(email);
    await page.goto(await signInLinkFor(email));
    const session = await sessionOf(context);
    const userId = session.user!.id;

    const rows = await accountRows(userId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: userId,
      plan: "free",
      stripe_customer_id: null,
      suspended_at: null,
    });

    // Idempotent: sign out, set the plan with the secret key, sign in again with another link.
    await context.clearCookies();
    await adminClient().from("accounts").update({ paid_plan: "pro" }).eq("id", userId);
    const before = (await accountRows(userId))[0];
    const { hashedToken } = await generateTokenHash(email);
    await openCallback(context, hashedToken);
    expect(await hasSession(context)).toBe(true);
    const after = await accountRows(userId);
    expect(after).toHaveLength(1);
    expect(after[0]).toEqual(before);
    expect(after[0]!.plan).toBe("pro");
  });

  test("M1-05 the callback itself recreates a missing row (secret-key code, id from the verified session)", async ({
    context,
  }, testInfo) => {
    const { userId, hashedToken } = await generateTokenHash(addr("acct-cb", testInfo.project.name));
    await adminClient().from("accounts").delete().eq("id", userId);
    expect(await accountRows(userId)).toHaveLength(0);
    await openCallback(context, hashedToken);
    const rows = await accountRows(userId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ plan: "free", stripe_customer_id: null, suspended_at: null });
  });

  test("M1-05 self-healing: loading a signed-in app page recreates a deleted row", async ({
    page,
    context,
  }, testInfo) => {
    const { userId, hashedToken } = await generateTokenHash(
      addr("acct-heal", testInfo.project.name),
    );
    await openCallback(context, hashedToken);
    await adminClient().from("accounts").delete().eq("id", userId);
    expect(await accountRows(userId)).toHaveLength(0);
    await page.goto(url("app", "/"));
    await expect.poll(async () => (await accountRows(userId)).length).toBe(1);
    expect((await accountRows(userId))[0]).toMatchObject({ plan: "free" });
  });

  test("M1-05 abuse through PostgREST: no insert, update or delete of accounts; reads see only your own row", async ({
    context,
  }, testInfo) => {
    const email = addr("acct-abuse", testInfo.project.name);
    const { userId, hashedToken } = await generateTokenHash(email);
    await openCallback(context, hashedToken);
    const token = (await sessionOf(context)).access_token;
    const admin = adminClient();
    const other = "00000000-0000-4000-8000-0000000000a1"; // mara

    // INSERT with no existing row: rejected, nothing created.
    await admin.from("accounts").delete().eq("id", userId);
    const insert = await restAs(token, "/accounts", {
      method: "POST",
      body: { id: userId, plan: "studio" },
    });
    expect([401, 403]).toContain(insert.status);
    expect((insert.body as { code?: string }).code).toBe("42501");
    expect(await accountRows(userId)).toHaveLength(0);

    await admin.from("accounts").insert({ id: userId });
    const baseline = (await accountRows(userId))[0]!;

    for (const patch of [
      { plan: "studio" },
      { stripe_customer_id: "cus_x" },
      { suspended_at: null },
    ]) {
      const res = await restAs(token, `/accounts?id=eq.${userId}`, {
        method: "PATCH",
        body: patch,
      });
      const rejected = [401, 403].includes(res.status);
      const touchedNothing = res.status < 300 && Array.isArray(res.body) && res.body.length === 0;
      expect(rejected || touchedNothing, `PATCH ${JSON.stringify(patch)} -> ${res.status}`).toBe(
        true,
      );
    }
    const del = await restAs(token, `/accounts?id=eq.${userId}`, { method: "DELETE" });
    expect(
      [401, 403].includes(del.status) ||
        (del.status < 300 && Array.isArray(del.body) && del.body.length === 0),
    ).toBe(true);
    expect((await accountRows(userId))[0]).toEqual(baseline);

    const own = await restAs(token, "/accounts?select=*");
    expect(own.status).toBe(200);
    expect((own.body as { id: string }[]).map((r) => r.id)).toEqual([userId]);
    const foreign = await restAs(token, `/accounts?select=*&id=eq.${other}`);
    expect(foreign).toEqual({ status: 200, body: [] });
  });
});
