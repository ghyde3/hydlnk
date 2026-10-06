import { expect, test } from "@playwright/test";
import { url, expectNoHorizontalScroll, expectTapTargets } from "../helpers";
import { emptyDraft } from "@/lib/document";
import { claimHandleWithClient } from "@/lib/handles/claim-core";
import { adminClient, deleteUser } from "../fixtures/auth";
import { cleanupUsers, makeUser, rand } from "../fixtures/data";
import { NEVER_STORED, PRODUCTION_BUILD, rawRequest } from "../fixtures/http";

/**
 * M1-15: a tenant host serves a placeholder for a claimed-but-unpublished handle and a 404 for an
 * unclaimed one. Header-level checks talk to 127.0.0.1 with an explicit Host header (exact
 * headers, any casing); everything visual goes through Chromium.
 */

async function claimed(label: string) {
  const owner = await makeUser(label);
  const handle = `zq-${label}-${rand()}`;
  const result = await claimHandleWithClient(adminClient(), owner.id, handle);
  expect(result).toMatchObject({ ok: true });
  return { owner, handle };
}

test.afterAll(cleanupUsers);

/**
 * A production build (CI's browser suite, M9-13; or HL_PROD_PORT) caches what a tenant host answers:
 * an unclaimed handle's 404 for 5 seconds and a malformed host's for a day (`s-maxage`, M2-26), and
 * a claimed page until its tag expires. `next dev` caches nothing. So the 404's Cache-Control is
 * `no-store` or `no-cache` there (M1-15's wording, kept) and a short shared-cache lifetime here, and a
 * claim or an account deletion made straight in the database (as these specs do) shows only once
 * the cached answer expires: the real claim and delete call `invalidateHandle`.
 */
const NOT_FOUND_CACHE = PRODUCTION_BUILD ? /^s-maxage=\d+(,|$)/ : NEVER_STORED;

test.describe("M1-15 placeholder for a claimed handle", () => {
  test("M1-15 serves 200 with title, one h1, the line and noindex", async ({ page }) => {
    const { handle } = await claimed("ph");
    const response = await page.goto(url(handle));
    expect(response?.status()).toBe(200);
    await expect(page).toHaveTitle(`${handle}.hydlnk.com`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(handle);
    await expect(page.getByText("Nothing published here yet.")).toBeVisible();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex");
  });

  test("M1-15 is a tenant page: system-default tokens, no HYDLNK UI, system fonts, no other host", async ({
    page,
  }) => {
    const { handle } = await claimed("tk");
    const hosts = new Set<string>();
    page.on("request", (request) => hosts.add(new URL(request.url()).host));
    await page.goto(url(handle));
    await expect(page.getByText("Nothing published here yet.")).toBeVisible();

    const res = await rawRequest(`${handle}.localhost:3000`, "/");
    expect(res.status).toBe(200);
    expect(res.body).toMatch(/class="tenant-root[^"]*"[^>]*style="[^"]*--t-bg:#F7F7F5/);
    expect(res.body).not.toContain("--hl-");
    expect(res.body.toLowerCase()).not.toContain("1c1b1a");
    expect(res.body).not.toMatch(/<aside|<nav|tab-?bar|sidebar/i);
    expect(res.body).not.toContain("fonts.googleapis.com");

    expect([...hosts]).toEqual([`${handle}.localhost:3000`]);
    const fontFamily = await page.locator("h1").evaluate((el) => getComputedStyle(el).fontFamily);
    expect(fontFamily).toMatch(/system-ui|sans-serif/);
  });

  test("M1-15 renders only published: the draft never reaches the response", async () => {
    const { handle } = await claimed("dr");
    const draft = emptyDraft(handle);
    draft.profile.name = "DRAFT-MARKER-7f3a";
    draft.profile.bio = "DRAFT-MARKER-7f3a";
    const { error } = await adminClient().from("pages").update({ draft }).eq("handle", handle);
    expect(error).toBeNull();

    const res = await rawRequest(`${handle}.localhost:3000`, "/");
    expect(res.status).toBe(200);
    expect(res.body).not.toContain("DRAFT-MARKER-7f3a");
    expect(res.body).toContain("Nothing published here yet.");
  });

  test("M1-15 no cookies in or out, auth cookies change nothing, app routes are 404, host casing is ignored", async () => {
    const { handle } = await claimed("ck");
    const host = `${handle}.localhost:3000`;
    const plain = await rawRequest(host, "/");
    expect(plain.status).toBe(200);
    expect(plain.headers["set-cookie"]).toBeUndefined();

    const withCookie = await rawRequest(host, "/", {
      headers: {
        Cookie: "sb-127-auth-token=base64-eyJhY2Nlc3NfdG9rZW4iOiJ4In0; hl-pending-handle=zq-x",
      },
    });
    expect(withCookie.status).toBe(200);
    expect(withCookie.headers["set-cookie"]).toBeUndefined();
    const text = (html: string) => html.replace(/<script[\s\S]*?<\/script>/g, "");
    expect(text(withCookie.body)).toBe(text(plain.body));

    for (const path of ["/login", "/signup", "/claim", "/editor", "/settings", "/auth/callback"]) {
      const res = await rawRequest(host, path);
      expect(res.status, path).toBe(404);
      expect(res.headers["set-cookie"], path).toBeUndefined();
    }

    const upper = await rawRequest(host.toUpperCase(), "/");
    expect(upper.status).toBe(200);
    expect(upper.body).toContain("Nothing published here yet.");
  });

  test("M1-15 layout: one centered column, 16px text, no horizontal scroll", async ({
    page,
    isMobile,
  }) => {
    const { handle } = await claimed("ly");
    await page.goto(url(handle));
    await expect(page.getByText("Nothing published here yet.")).toBeVisible();
    await expectNoHorizontalScroll(page);

    const note = page.getByText("Nothing published here yet.");
    const size = await note.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(size).toBeGreaterThanOrEqual(16);
    const bodySize = await page
      .locator("body")
      .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(bodySize).toBeGreaterThanOrEqual(16);

    const main = (await page.locator("main").boundingBox())!;
    const viewport = page.viewportSize()!;
    if (isMobile) {
      expect(main.x).toBeGreaterThanOrEqual(16); // side padding
      expect(main.x + main.width).toBeLessThanOrEqual(viewport.width - 16);
    } else {
      expect(main.width).toBeLessThanOrEqual(480); // the default theme's maxWidth
      expect(Math.abs(main.x + main.width / 2 - viewport.width / 2)).toBeLessThanOrEqual(2);
    }
  });
});

test.describe("M1-15 404 for an unclaimed handle", () => {
  test("M1-15 returns 404 with no-store semantics, noindex and the claim links", async ({
    page,
  }) => {
    const handle = `zq-none-${rand()}`;
    const res = await rawRequest(`${handle}.localhost:3000`, "/");
    expect(res.status).toBe(404);
    expect(res.headers["cache-control"]).toMatch(NOT_FOUND_CACHE);
    expect(res.headers["set-cookie"]).toBeUndefined();
    expect(res.body).toContain('<meta name="robots" content="noindex"');

    const response = await page.goto(url(handle));
    expect(response?.status()).toBe(404);
    await expect(page.getByText("This address isn’t claimed.")).toBeVisible();
    const claim = page.getByRole("link", { name: `Claim ${handle}` });
    await expect(claim).toHaveAttribute(
      "href",
      `http://app.localhost:3000/signup?handle=${handle}`,
    );
    const home = page.getByRole("link", { name: "Go to hydlnk.com" });
    await expect(home).toHaveAttribute("href", "http://localhost:3000/");

    // HYDLNK UI styling: page #F4F3F0, ink text.
    const bg = await page.locator("main").evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(bg).toBe("rgb(244, 243, 240)");
    const ink = await page.locator("h1").evaluate((el) => getComputedStyle(el).color);
    expect(ink).toBe("rgb(28, 27, 26)");
  });

  test("M1-15 claim then reload: the placeholder appears at once; deleting the owner brings the 404 back", async ({
    page,
  }) => {
    const handle = `zq-flip-${rand()}`;
    const host = `${handle}.localhost:3000`;
    await page.goto(url(handle));
    expect((await rawRequest(host, "/")).status).toBe(404);

    const owner = await makeUser("flip");
    expect(await claimHandleWithClient(adminClient(), owner.id, handle)).toMatchObject({
      ok: true,
    });
    // `next dev` answers at once. A production build may still hold the 5 second cached 404 of the
    // first request above (the claim here did not go through the action that expires it): reload
    // until the placeholder replaces it, which takes at most one expiry and a regeneration.
    await expect
      .poll(async () => (await page.reload())?.status(), {
        timeout: PRODUCTION_BUILD ? 30_000 : 5_000,
        intervals: [500, 1_000, 2_000],
      })
      .toBe(200);
    await expect(page.getByText("Nothing published here yet.")).toBeVisible();

    await deleteUser(owner.id);
    // The 404 back "at once" is the dev server's: a production build keeps the cached placeholder
    // until its tag expires, which the delete-account action does (checked end to end in
    // tests/unit/delete-account-cache.test.ts and the Milestone 4 account deletion specs).
    if (!PRODUCTION_BUILD) {
      const after = await rawRequest(host, "/");
      expect(after.status).toBe(404);
      expect(after.body).toContain("This address isn’t claimed.");
    }
  });

  test("M1-15 two labels, a malformed label and a reserved handle are plain 404s without cookies", async () => {
    for (const host of ["a.b.localhost:3000", "-x1.localhost:3000", "api.localhost:3000"]) {
      const res = await rawRequest(host, "/");
      expect(res.status, host).toBe(404);
      expect(res.headers["cache-control"], host).toMatch(NOT_FOUND_CACHE);
      expect(res.headers["set-cookie"], host).toBeUndefined();
      expect(res.body, host).not.toContain("This address isn’t claimed.");
    }
  });

  test("M1-15 layout: stacked full-width 44px links on the phone, a 480px centered column on desktop", async ({
    page,
    isMobile,
  }) => {
    const handle = `zq-lay-${rand()}`;
    await page.goto(url(handle));
    await expect(page.getByText("This address isn’t claimed.")).toBeVisible();
    await expectNoHorizontalScroll(page);

    const claim = (await page.getByRole("link", { name: `Claim ${handle}` }).boundingBox())!;
    const home = (await page.getByRole("link", { name: "Go to hydlnk.com" }).boundingBox())!;
    const column = (await page.locator(".tenant-unclaimed-column").boundingBox())!;
    const viewport = page.viewportSize()!;

    expect(home.y).toBeGreaterThan(claim.y + claim.height - 1); // stacked
    for (const box of [claim, home]) {
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(Math.round(box.width)).toBe(Math.round(column.width)); // full width of the column
    }
    if (isMobile) {
      await expectTapTargets(page);
      const size = await page
        .getByText("Nobody has a page here yet.")
        .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
      expect(size).toBeGreaterThanOrEqual(16);
      expect(column.x).toBeGreaterThanOrEqual(16);
    } else {
      expect(column.width).toBeLessThanOrEqual(480);
      expect(Math.abs(column.x + column.width / 2 - viewport.width / 2)).toBeLessThanOrEqual(2);
    }
  });
});
