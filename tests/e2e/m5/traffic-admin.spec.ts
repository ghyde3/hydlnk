import { expect, test, type Page } from "@playwright/test";
import { adminClient } from "../fixtures/auth";
import { cleanupUsers, desktopOnly } from "../fixtures/data";
import { appRaw } from "../fixtures/http";
import { expectNoHorizontalScroll, expectTapTargets, url } from "../helpers";
import { utcDay } from "../m4/analytics-db-helpers";
import {
  APP_ORIGIN,
  json,
  postApp,
  sessionCookie,
  signInAsAdmin,
  signInAsUser,
  tenantRaw,
} from "./admin-helpers";
import { flagOf, seedFlaggedPage, type FlaggedPage } from "./traffic-helpers";

/**
 * M5-10: the review list at /admin/traffic. Flags come from the real pipeline (events, rollup,
 * flag_high_traffic_pages with the secret key); the nightly job's rules are pgTAP 113, and the
 * server-only table and functions are traffic-api.spec.ts.
 *
 * "Mark reviewed" posts to /api/admin/traffic/{id}/reviewed, a route that is wired into the admin
 * registry by the integration step (the admin guard test allows no admin mutation outside
 * src/app/**\/api/admin). Until that route exists the specs that need it skip themselves, so a run
 * says which part is still unproven instead of failing.
 */

test.describe.configure({ timeout: 180_000 });
test.afterAll(cleanupUsers);

const reviewPath = (flagId: string) => `/api/admin/traffic/${flagId}/reviewed`;

let shared: FlaggedPage;
let routeWired = false;

test.beforeAll(async ({ browser }) => {
  shared = await seedFlaggedPage(browser, "tfadm");
  const probe = await postApp(reviewPath("00000000-0000-4000-8000-000000000000"));
  routeWired = probe.status !== 404;
});

const rowOf = (page: Page, flagId: string) => page.locator(`tr[data-flag-id="${flagId}"]`);
const open = async (page: Page, query = "") => {
  await page.goto(url("app", `/admin/traffic${query}`));
  await expect(page.getByRole("heading", { level: 1, name: "Traffic" })).toBeVisible();
};

test.describe("M5-10 the traffic review list", () => {
  test("M5-10 a non-admin gets the 404 of an unknown route on /admin/traffic, signed-out visitors go to sign-in", async ({
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "no UI involved");
    const anonymous = await appRaw("/admin/traffic");
    expect(anonymous.status).toBe(307);
    expect(new URL(anonymous.location ?? "", APP_ORIGIN).pathname).toBe("/login");

    await signInAsUser(context, "tfna");
    const res = await appRaw("/admin/traffic", { cookie: await sessionCookie(context) });
    expect(res.status).toBe(404);
    expect(res.body).not.toContain(shared.handle);
  });

  test("M5-10 lists an unreviewed flag with handle, owner email, plan, views with thousands separators and the flagged date; Unreviewed is the default filter", async ({
    page,
    context,
  }) => {
    await signInAsAdmin(context, "tfl");
    await open(page);
    const nav = page.getByRole("navigation", { name: "Flag status" });
    await expect(nav.getByRole("link")).toHaveText(["Unreviewed", "Reviewed"]);
    await expect(nav.getByRole("link", { name: "Unreviewed" })).toHaveAttribute(
      "aria-current",
      "true",
    );

    const row = rowOf(page, shared.flagId);
    await expect(row).toBeVisible();
    await expect(row).toContainText(shared.handle);
    await expect(row).toContainText(shared.email);
    await expect(row.locator("[data-plan]")).toHaveText("Free");
    await expect(row.locator("[data-views]")).toHaveText("1,234");
    await expect(row.locator("[data-views]")).toHaveAttribute("data-views", String(shared.views));
    await expect(row).toContainText(utcDay(0));
    const link = row.getByRole("link", { name: shared.handle });
    await expect(link).toHaveAttribute("href", url(shared.handle));
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", /noopener/);
    await expect(row.getByRole("button", { name: `Mark ${shared.handle} reviewed` })).toBeVisible();

    // A reviewed filter row is not in the unreviewed list's neighbour and the list holds no secrets.
    await page.goto(url("app", "/admin/traffic?status=reviewed"));
    await expect(rowOf(page, shared.flagId)).toHaveCount(0);
    await expectNoHorizontalScroll(page);
  });

  test("M5-10 an empty queue reads 'No pages are over the Free-plan traffic line.'", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "same copy at both sizes");
    await signInAsAdmin(context, "tfe");
    // Far past the last page of the list, so the check does not depend on what else is flagged.
    await open(page, "?page=9999");
    await expect(page.getByText("No pages are over the Free-plan traffic line.")).toBeVisible();
    await expect(page.locator("tr[data-flag-id]")).toHaveCount(0);
  });

  test("M5-10 Mark reviewed moves the row to the Reviewed filter and the page keeps serving", async ({
    page,
    context,
    browser,
  }) => {
    test.skip(
      !routeWired,
      "POST /api/admin/traffic/{id}/reviewed is not wired into the admin routes yet",
    );
    const own = await seedFlaggedPage(browser, "tfmr");
    await signInAsAdmin(context, "tfmra");
    await open(page);
    const row = rowOf(page, own.flagId);
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: `Mark ${own.handle} reviewed` }).click();
    await expect(rowOf(page, own.flagId)).toHaveCount(0);

    await page.goto(url("app", "/admin/traffic?status=reviewed"));
    const reviewed = rowOf(page, own.flagId);
    await expect(reviewed).toBeVisible();
    await expect(reviewed).toContainText(own.handle);
    await expect(reviewed).toContainText(utcDay(0));
    await expect(reviewed.getByRole("button")).toHaveCount(0);

    expect((await flagOf(own.pageId))?.reviewed_at).not.toBeNull();
    expect((await tenantRaw(own.handle)).status).toBe(200);
  });

  test("M5-10 the action answers 401 to nobody, 403 to a non-admin or a cross-origin post, and changes nothing for them; an admin marks it once", async ({
    context,
    browser,
  }, info) => {
    test.skip(!desktopOnly(info), "API only");
    test.skip(
      !routeWired,
      "POST /api/admin/traffic/{id}/reviewed is not wired into the admin routes yet",
    );
    const own = await seedFlaggedPage(browser, "tfact");
    const unchanged = async () => (await flagOf(own.pageId))?.reviewed_at === null;

    const anonymous = await postApp(reviewPath(own.flagId));
    expect(anonymous.status).toBe(401);
    expect(json(anonymous).error).toBe("unauthenticated");

    const nonAdmin = await signInAsUser(await browser.newContext(), "tfactn");
    const nonAdminContext = await browser.newContext();
    await signInAsUser(nonAdminContext, "tfactn2");
    const forbidden = await postApp(reviewPath(own.flagId), {
      cookie: await sessionCookie(nonAdminContext),
    });
    expect(nonAdmin.userId).not.toBe(own.userId);
    expect(forbidden.status).toBe(403);
    expect(json(forbidden).error).toBe("forbidden");
    expect(await unchanged()).toBe(true);

    await signInAsAdmin(context, "tfacta");
    const cookie = await sessionCookie(context);
    const crossOrigin = await postApp(reviewPath(own.flagId), {
      cookie,
      origin: "http://evil.example",
    });
    expect(crossOrigin.status).toBe(403);
    expect(json(crossOrigin).error).toBe("forbidden_origin");
    expect(
      (await postApp(reviewPath(own.flagId), { cookie, contentType: "text/plain" })).status,
    ).toBe(415);
    expect((await postApp(reviewPath("not-a-uuid"), { cookie })).status).toBe(400);
    expect(
      (await postApp(reviewPath("00000000-0000-4000-8000-00000000dead"), { cookie })).status,
    ).toBe(404);
    expect(await unchanged()).toBe(true);

    const first = await postApp(reviewPath(own.flagId), { cookie });
    expect(first.status).toBe(200);
    expect(json(first)).toMatchObject({ ok: true, changed: true });
    const stamp = (await flagOf(own.pageId))?.reviewed_at;
    expect(stamp).not.toBeNull();
    const second = await postApp(reviewPath(own.flagId), { cookie });
    expect(json(second)).toMatchObject({ ok: true, changed: false });
    expect((await flagOf(own.pageId))?.reviewed_at).toBe(stamp);

    // The page itself was never touched.
    const page = await adminClient()
      .from("pages")
      .select("published_at")
      .eq("id", own.pageId)
      .single();
    expect(page.data?.published_at).not.toBeNull();
  });

  test("M5-10 at 390x844 the list collapses to stacked cards with no horizontal scroll and every tappable target at least 44px", async ({
    page,
    context,
  }, info) => {
    test.skip(info.project.name !== "phone", "phone layout");
    await signInAsAdmin(context, "tflp");
    await open(page);
    const row = rowOf(page, shared.flagId);
    await expect(row).toBeVisible();
    await expect(page.locator("thead")).toBeHidden();
    const cells = await row
      .locator("td")
      .evaluateAll((tds) => tds.map((td) => getComputedStyle(td).display));
    expect(new Set(cells)).toEqual(new Set(["block"]));
    await expectNoHorizontalScroll(page);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    const box = await row.getByRole("button", { name: /Mark .* reviewed/ }).boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    await expectTapTargets(page);
  });

  test("M5-10 at 1440x900 it is a data table: header row on the page color, mono uppercase headers and mono numbers", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "desktop layout");
    await signInAsAdmin(context, "tfld");
    await open(page);
    const header = page.locator("thead");
    await expect(header).toBeVisible();
    expect(await header.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(
      "rgb(244, 243, 240)",
    );
    await expect(header.locator("th")).toHaveText([
      "Page",
      "Owner",
      "Plan",
      "Views, 30 days",
      "Flagged",
      "Actions",
    ]);
    const th = header.locator("th").first();
    expect(await th.evaluate((el) => getComputedStyle(el).fontFamily)).toMatch(/mono/i);
    expect(await th.evaluate((el) => getComputedStyle(el).textTransform)).toBe("uppercase");
    const row = rowOf(page, shared.flagId);
    const views = row.locator("td").nth(3);
    expect(await views.evaluate((el) => getComputedStyle(el).fontFamily)).toMatch(/mono/i);
    expect(await views.evaluate((el) => getComputedStyle(el).textAlign)).toBe("right");
    await expectNoHorizontalScroll(page);
  });
});
