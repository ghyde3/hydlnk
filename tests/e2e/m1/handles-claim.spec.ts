import { expect, test } from "@playwright/test";
import { url } from "../helpers";
import { claimHandleWithClient, emptyPageDraft } from "@/lib/handles/claim-core";
import { adminClient } from "../fixtures/auth";
import {
  cleanupUsers,
  makeUser,
  pageCountForHandle,
  pagesOf,
  rand,
  signIn,
} from "../fixtures/data";

/**
 * M1-09: the server-only claim. The logic runs here against the real local database with the
 * secret key (claim-core takes the client as a parameter; production calls it through
 * src/lib/handles/claim.ts with the server-only admin client). The HTTP face (POST
 * /api/handles/claim) is driven through a signed-in browser context.
 */
test.describe("M1-09 server-only handle claim", () => {
  test.skip(({ isMobile }) => isMobile, "API-level checks run once, in the desktop project");
  test.afterAll(cleanupUsers);

  const claim = (userId: string, handle: string) =>
    claimHandleWithClient(adminClient(), userId, handle);

  test("M1-09 claims the first page: owner, normalized handle, empty draft, unpublished", async () => {
    const user = await makeUser("claim");
    const handle = `zq-ok-${rand()}`;
    const result = await claim(user.id, handle.toUpperCase());
    expect(result).toMatchObject({ ok: true, handle });

    const pages = await pagesOf(user.id);
    expect(pages).toHaveLength(1);
    expect(pages[0]).toMatchObject({
      owner_id: user.id,
      handle,
      published: null,
      published_at: null,
    });
    expect(pages[0]!.draft).toEqual(emptyPageDraft(handle));
    expect(pages[0]!.draft).toMatchObject({
      version: 1,
      profile: { displayName: handle, bio: "", avatarUrl: null },
      themeId: null,
      tokens: {},
      blocks: [],
    });
  });

  test("M1-09 typed rejections write nothing", async () => {
    const user = await makeUser("reject");
    const taken = `zq-tk-${rand()}`;
    const other = await makeUser("reject-owner");
    expect(await claim(other.id, taken)).toMatchObject({ ok: true });

    const cases: [string, string][] = [
      ["", "short"],
      ["ab", "short"],
      ["a".repeat(31), "too_long"],
      ["-mara", "invalid"],
      ["xn--pple-43d", "invalid"],
      ["WWW", "reserved"],
      ["Admin", "reserved"],
      ["billing", "reserved"],
      [taken, "taken"],
      ["mara", "taken"],
    ];
    for (const [handle, error] of cases) {
      expect(await claim(user.id, handle), `claim(${handle})`).toEqual({ ok: false, error });
    }
    expect(await pagesOf(user.id)).toHaveLength(0);

    const ghost = crypto.randomUUID();
    expect(await claim(ghost, `zq-gh-${rand()}`)).toEqual({ ok: false, error: "no_account" });

    const suspended = await makeUser("suspended", { suspended: true });
    expect(await claim(suspended.id, `zq-su-${rand()}`)).toEqual({ ok: false, error: "suspended" });
    expect(await pagesOf(suspended.id)).toHaveLength(0);
  });

  test("M1-09 the page limit follows the plan: free 1, pro 3, studio 15", async () => {
    const free = await makeUser("free");
    expect(await claim(free.id, `zq-f1-${rand()}`)).toMatchObject({ ok: true });
    expect(await claim(free.id, `zq-f2-${rand()}`)).toEqual({ ok: false, error: "page_limit" });

    const pro = await makeUser("pro", { plan: "pro" });
    for (let i = 1; i <= 3; i++) {
      expect(await claim(pro.id, `zq-p${i}-${rand()}`), `pro claim ${i}`).toMatchObject({
        ok: true,
      });
    }
    expect(await claim(pro.id, `zq-p4-${rand()}`)).toEqual({ ok: false, error: "page_limit" });
    expect(await pagesOf(pro.id)).toHaveLength(3);

    const studio = await makeUser("studio", { plan: "studio" });
    for (let i = 1; i <= 15; i++) {
      expect(await claim(studio.id, `zq-s${i}-${rand()}`), `studio claim ${i}`).toMatchObject({
        ok: true,
      });
    }
    expect(await claim(studio.id, `zq-s16-${rand()}`)).toEqual({ ok: false, error: "page_limit" });
    expect(await pagesOf(studio.id)).toHaveLength(15);
  });

  test("M1-09 race: 10 parallel claims of one handle by 10 accounts leave one row", async () => {
    const handle = `zq-race-${rand()}`;
    const users = await Promise.all(Array.from({ length: 10 }, (_, i) => makeUser(`race${i}`)));
    const results = await Promise.all(users.map((u) => claim(u.id, handle)));

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok && r.error === "taken")).toHaveLength(9);
    expect(await pageCountForHandle(handle)).toBe(1);
  });

  test("M1-09 race: 2 parallel claims by one free account leave exactly one row", async () => {
    const user = await makeUser("race-one");
    const a = `zq-ra-${rand()}`;
    const b = `zq-rb-${rand()}`;
    const results = await Promise.all([claim(user.id, a), claim(user.id, b)]);

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok && r.error === "page_limit")).toHaveLength(1);
    expect(await pagesOf(user.id)).toHaveLength(1);
  });

  test("M1-09 case safety: MARA cannot coexist with mara", async () => {
    const user = await makeUser("case", { plan: "pro" });
    const { error } = await adminClient()
      .from("pages")
      .insert({ owner_id: user.id, handle: "MARA", draft: emptyPageDraft("mara") });
    // Refused by the database. Today the lowercase-only format check (23514) fires before the
    // unique index (23505); either way no differently-cased duplicate can exist.
    expect(error).not.toBeNull();
    expect(["23505", "23514"]).toContain(error!.code);
    expect(await pageCountForHandle("MARA")).toBe(0);
    expect(await pageCountForHandle("mara")).toBe(1);
  });
});

test.describe("M1-09 POST /api/handles/claim", () => {
  test.skip(({ isMobile }) => isMobile, "API-level checks run once, in the desktop project");
  test.afterAll(cleanupUsers);

  const post = (page: import("@playwright/test").Page, body: unknown) =>
    page.evaluate(async (payload) => {
      const res = await fetch("/api/handles/claim", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      return { status: res.status, json: (await res.json().catch(() => null)) as unknown };
    }, body);

  test("M1-09 unauthenticated call returns 401 and writes no row", async ({ page }) => {
    const handle = `zq-un-${rand()}`;
    await page.goto(url("app", "/api/handles/check?handle=x"));
    const res = await post(page, { handle });
    expect(res.status).toBe(401);
    expect(await pageCountForHandle(handle)).toBe(0);
  });

  test("M1-09 the owner is the session user: owner_id in the body is ignored", async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const email = `zq-own-${rand()}@example.com`;
    const me = await signIn(context, email);
    const victim = await makeUser("victim");
    const handle = `zq-ow-${rand()}`;

    await page.goto(url("app", "/api/handles/check?handle=x"));
    const res = await post(page, { handle, owner_id: victim.id });
    expect(res.status).toBe(201);
    expect(res.json).toEqual({ handle });

    const mine = await pagesOf(me.userId);
    expect(mine.map((p) => p.handle)).toEqual([handle]);
    expect(await pagesOf(victim.id)).toHaveLength(0);

    // Rejections map to HTTP statuses, not 500s.
    expect((await post(page, { handle: `zq-two-${rand()}` })).status).toBe(403);
    await context.close();
  });

  test("M1-09 rejections over HTTP: invalid, reserved, taken, non-JSON", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await signIn(context, `zq-http-${rand()}@example.com`);
    await page.goto(url("app", "/api/handles/check?handle=x"));

    expect((await post(page, { handle: "ab" })).status).toBe(422);
    expect((await post(page, { handle: "www" })).json).toEqual({ error: "reserved" });
    expect(await post(page, { handle: "mara" })).toMatchObject({
      status: 409,
      json: { error: "taken" },
    });
    expect((await post(page, {})).status).toBe(422);
    const form = await page.evaluate(async () => {
      const res = await fetch("/api/handles/claim", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "handle=zq-form-1",
      });
      return res.status;
    });
    expect(form).toBe(415);
    await context.close();
  });
});
