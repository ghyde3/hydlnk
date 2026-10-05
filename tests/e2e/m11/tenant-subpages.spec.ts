import { chromium, expect, test, type Page } from "@playwright/test";
import { adminClient } from "../fixtures/auth";
import { cleanupUsers, desktopOnly, insertPage, makeUser, rand } from "../fixtures/data";
import { rawRequest } from "../fixtures/http";
import { setOwnerSuspended } from "../fixtures/expire";
import { expectNoHorizontalScroll, expectTapTargets, url } from "../helpers";
import { addDomainRow, hostnameFor } from "../m4/domains-core-helpers";
import { emptyUser, openEditor, pageRow } from "../m2/editor-helpers";
import {
  BACK_PAGE_LINK,
  DIRECTIONS,
  HOME_PAGE_LINK,
  ITEMS,
  locsOf,
  makeLiveSite,
  type LiveSite,
} from "./tenant-helpers";

/**
 * M11-05, M11-06, M11-07, M11-10: a site's sub-pages on the live hosts. Every test makes its own user
 * and site; mara's rows are only read. The browser tests run at both viewports (phone 390x844 and
 * desktop 1440x900); the HTTP ones (an explicit Host header, what the proxy reads) run once.
 */

test.afterAll(cleanupUsers);
test.describe.configure({ timeout: 120_000 });

const get = (host: string, path = "/", opts: Parameters<typeof rawRequest>[2] = {}) =>
  rawRequest(host, path, opts);
const tenantHost = (site: Pick<LiveSite, "handle">) => `${site.handle}.localhost:3000`;
const h1s = (html: string) => [...html.matchAll(/<h1[^>]*>([^<]*)<\/h1>/g)].map((m) => m[1]);

async function expectSubPageLayout(page: Page) {
  await expectNoHorizontalScroll(page);
  await expectTapTargets(page, ".pg-menu, .pg-blocks, .pg-sitehead");
}

test.describe("M11-05 a whole-site Publish from the editor", () => {
  test("M11-05 publishes Home and two sub-pages together; both open, the menu and a page link navigate", async ({
    page,
    context,
  }) => {
    // The user's site starts as drafts only: nothing is live until the real Publish button is pressed.
    const site = await makeLiveSite("pub", { live: false, homePublished: false });
    const { signInAs } = await import("../fixtures/auth");
    await signInAs(context, site.user.email);

    await openEditor(page);
    await page.getByRole("button", { name: "Publish", exact: true }).first().click();
    await expect
      .poll(async () => (await pageRow(site.pageId)).published !== null, { timeout: 30_000 })
      .toBe(true);

    const { data } = await adminClient()
      .from("site_pages")
      .select("id, live_path, published_at")
      .eq("page_id", site.pageId);
    expect(data?.map((row) => row.live_path).sort()).toEqual([DIRECTIONS.path, ITEMS.path]);
    expect(data?.every((row) => row.published_at !== null)).toBe(true);

    // Home, with the menu (Home first) and the page link.
    await page.goto(`http://${tenantHost(site)}/`);
    const menu = page.locator("nav.pg-menu");
    await expect(menu.locator("a")).toHaveText(["Home", ITEMS.title, DIRECTIONS.title]);
    await expect(menu.locator('[aria-current="page"]')).toHaveText("Home");
    await expectNoHorizontalScroll(page);
    await expectTapTargets(page, ".pg-menu, .pg-blocks");

    // By the menu: the items page, with its title as the one h1.
    await menu.getByRole("link", { name: ITEMS.title }).click();
    await expect(page).toHaveURL(new RegExp(`/${ITEMS.path}$`));
    await expect(page.locator("h1")).toHaveCount(1);
    await expect(page.locator("h1")).toHaveText(ITEMS.title);
    await expect(page).toHaveTitle(`${ITEMS.title} · ${site.name}`);
    await expect(page.locator("nav.pg-menu [aria-current='page']")).toHaveText(ITEMS.title);
    await expectSubPageLayout(page);

    // By a page link on the items page: back to Home.
    await page.getByRole("link", { name: BACK_PAGE_LINK.label }).click();
    await expect(page).toHaveURL(`http://${tenantHost(site)}/`);
    // By a page link on Home: to the items page; then the site header: to Home again.
    await page.getByRole("link", { name: HOME_PAGE_LINK.label }).click();
    await expect(page).toHaveURL(new RegExp(`/${ITEMS.path}$`));
    await page.locator(".pg-sitehead-link").click();
    await expect(page).toHaveURL(`http://${tenantHost(site)}/`);

    // The other page opens too.
    await page.goto(`http://${tenantHost(site)}/${DIRECTIONS.path}`);
    await expect(page.locator("h1")).toHaveText(DIRECTIONS.title);
    await expectSubPageLayout(page);
  });
});

test.describe("M11-08 deleting a page of the menu from the editor", () => {
  test("M11-08 delete takes the page out of Home's draft menu, the live route answers 404 and the live menu drops it", async ({
    page,
    context,
  }) => {
    const site = await makeLiveSite("del");
    const { signInAs } = await import("../fixtures/auth");
    await signInAs(context, site.user.email);
    const host = tenantHost(site);

    // Before: the page is live and in the live menu (Home's published menu names it).
    expect((await get(host, `/${ITEMS.path}`)).status).toBe(200);
    expect((await get(host, "/")).body).toContain(ITEMS.title);
    const navOf = async () =>
      ((await pageRow(site.pageId)).draft as { nav?: { items?: string[] } }).nav?.items ?? [];
    expect(await navOf()).toContain(site.itemsId);

    await openEditor(page);
    await page.getByTestId("page-row").filter({ hasText: ITEMS.title }).click();
    await expect(page.getByTestId("page-in-menu")).toHaveAttribute("aria-pressed", "true");
    await page.getByTestId("delete-page").click();
    await page.getByTestId("delete-page-dialog").getByTestId("delete-page-confirm").click();
    await expect(page.getByTestId("page-row").filter({ hasText: ITEMS.title })).toHaveCount(0);

    // Home's draft menu no longer lists it (the autosave of Home), and the row is gone.
    await expect.poll(navOf, { timeout: 15_000 }).toEqual([site.directionsId]);
    const rows = await adminClient().from("site_pages").select("id").eq("page_id", site.pageId);
    expect(rows.data?.map((row) => row.id)).toEqual([site.directionsId]);

    // Live, on the very next request: the page is 404 and the menu lists only the other page.
    expect((await get(host, `/${ITEMS.path}`)).status).toBe(404);
    const home = await get(host, "/");
    expect(home.status).toBe(200);
    const menu = home.body.match(/<nav[^>]*class="pg-menu"[\s\S]*?<\/nav>/)?.[0] ?? "";
    expect(menu).toContain(DIRECTIONS.title);
    expect(menu).not.toContain(ITEMS.title);
    expect(menu).not.toContain(`href="/${ITEMS.path}"`);
  });
});

test.describe("M11-06 mara's seeded sub-pages", () => {
  test("M11-06 /items and /directions open, with the menu on Home and on each page", async ({
    page,
  }) => {
    await page.goto(url("mara", "/"));
    const menu = page.locator("nav.pg-menu");
    await expect(menu.locator("a")).toHaveText(["Home", "Prints and gear", "Directions"]);
    await expectNoHorizontalScroll(page);

    for (const [path, title] of [
      ["items", "Prints and gear"],
      ["directions", "Directions"],
    ] as const) {
      await page.goto(url("mara", `/${path}`));
      await expect(page.locator("h1")).toHaveCount(1);
      await expect(page.locator("h1")).toHaveText(title);
      await expect(page.locator('nav.pg-menu [aria-current="page"]')).toHaveText(title);
      await expect(page.locator(".pg-sitehead-link")).toHaveAttribute("href", "/");
      await expect(page.locator("footer a[href*='/report']")).toBeVisible();
      await expectSubPageLayout(page);
    }
    // The menu wraps instead of scrolling: at 390px every entry is still inside the page.
    await page.goto(url("mara", "/items"));
    await page.locator("nav.pg-menu").getByRole("link", { name: "Directions" }).click();
    await expect(page).toHaveURL(url("mara", "/directions"));
  });

  test("M11-06 tenant pages ship no library script: one same-origin script and nothing third-party", async ({
    page,
  }, info) => {
    test.skip(!desktopOnly(info), "one project is enough");
    await page.goto(url("mara", "/items"));
    const sources = await page
      .locator("script[src]")
      .evaluateAll((els) => els.map((el) => (el as HTMLScriptElement).getAttribute("src")));
    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatch(/^\/_t\/p\.[0-9a-f]+\.js$/);
    // And no framework payload.
    expect(await page.locator("script:not([src])").count()).toBe(0);
  });

  test("M11-06 over HTTP: the real paths, /og and the reserved paths", async ({}, info) => {
    test.skip(!desktopOnly(info), "pure HTTP: one project is enough");
    const items = await get("mara.localhost:3000", "/items");
    expect(items.status).toBe(200);
    expect(h1s(items.body)).toEqual(["Prints and gear"]);
    expect(items.body).toContain('<link rel="canonical" href="http://mara.localhost:3000/items">');
    expect(items.body).toContain("<title>Prints and gear · Mara Okafor</title>");
    expect(items.headers["content-security-policy"]).toBeTruthy();
    expect((await get("mara.localhost:3000", "/directions")).status).toBe(200);
    expect((await get("mara.localhost:3000", "/og")).headers["content-type"]).toContain(
      "image/png",
    );
    expect((await get("mara.localhost:3000", "/")).status).toBe(200);
    // The routes that used to be (and still are) the plain 404 on a tenant host.
    for (const path of ["/api", "/r", "/app", "/sitemap", "/robots", "/hl-query-count"]) {
      expect((await get("mara.localhost:3000", path)).status, path).toBe(404);
    }
    // The internal route is never reachable by typing it.
    expect((await get("mara.localhost:3000", "/t/mara/p/items")).status).toBe(404);
    // Only GET and HEAD.
    expect((await get("mara.localhost:3000", "/items", { method: "POST" })).status).toBe(404);
  });
});

test.describe("M11-06 a path that is not a live page answers the branded 404", () => {
  test("M11-06 invented, unpublished, uppercase, two-segment and deleted paths", async ({}, info) => {
    test.skip(!desktopOnly(info), "pure HTTP: one project is enough");
    const site = await makeLiveSite("nf", { plan: "pro" });
    const draftOnly = await adminClient()
      .from("site_pages")
      .insert({
        page_id: site.pageId,
        draft: { path: "later", title: "Later", description: "", blocks: [] },
      })
      .select("id")
      .single();
    expect(draftOnly.error).toBeNull();

    expect((await get(tenantHost(site), `/${ITEMS.path}`)).status).toBe(200);
    for (const path of [
      "/nope",
      `/${rand(8)}`,
      "/later", // created, never published
      "/Items",
      "/ITEMS",
      "/items/extra",
      "/a/b/c",
      "/items.html",
      "/api",
      "/og/extra",
    ]) {
      const response = await get(tenantHost(site), path);
      expect(response.status, path).toBe(404);
      expect(response.body, path).toContain(
        "This page doesn’t exist or hasn’t been published yet.",
      );
      expect(response.body, path).not.toContain(ITEMS.title);
    }

    // A trailing slash is normalised by the framework before the proxy: a redirect to the page itself.
    const slash = await get(tenantHost(site), `/${ITEMS.path}/`);
    expect([slash.status, slash.location]).toEqual([308, `/${ITEMS.path}`]);

    // Deleting a live page makes it a 404 at once (the server route clears the cache; here the row).
    await adminClient().from("site_pages").delete().eq("id", site.itemsId);
    expect((await get(tenantHost(site), `/${ITEMS.path}`)).status).toBe(404);
    // Home no longer draws it in the menu, and its page link draws nothing.
    const home = await get(tenantHost(site), "/");
    expect(home.body).not.toContain(ITEMS.title);
    expect(home.body).not.toContain(HOME_PAGE_LINK.label);
    expect(home.body).toContain(DIRECTIONS.title);
  });

  test("M11-06 a site with nothing published, an unclaimed handle", async ({}, info) => {
    test.skip(!desktopOnly(info), "pure HTTP: one project is enough");
    const site = await makeLiveSite("np", { live: false, homePublished: false });
    expect((await get(tenantHost(site), `/${ITEMS.path}`)).status).toBe(404);
    expect((await get(`zq-nobody-${rand(6)}.localhost:3000`, "/items")).status).toBe(404);
  });
});

test.describe("M11-06 a verified custom domain serves the sub-pages", () => {
  test("M11-06 the same pages by Host header, an invented path 404s, a pending domain serves nothing", async ({}, info) => {
    test.skip(!desktopOnly(info), "pure HTTP: one project is enough");
    const site = await makeLiveSite("cd", { plan: "studio" });
    const live = hostnameFor("live");
    const pending = hostnameFor("pend");
    await addDomainRow({ pageId: site.pageId, hostname: live, status: "verified" });
    await addDomainRow({ pageId: site.pageId, hostname: pending, status: "pending" });

    const home = await get(live, "/");
    expect(home.status).toBe(200);
    expect(home.body).toContain('<nav class="pg-menu"');

    const items = await get(live, `/${ITEMS.path}`);
    expect(items.status).toBe(200);
    expect(h1s(items.body)).toEqual([ITEMS.title]);
    // The canonical is the custom domain (the site's primary host), on the same scheme and port.
    expect(items.body).toContain(`<link rel="canonical" href="http://${live}:3000/${ITEMS.path}">`);
    expect(items.body).toContain(`http://${live}:3000/og?v=`);
    expect(items.body).toContain(`${ITEMS.title} · ${site.name}`);
    // The handle host names the same primary host.
    const onHandle = await get(tenantHost(site), `/${ITEMS.path}`);
    expect(onHandle.body).toContain(
      `<link rel="canonical" href="http://${live}:3000/${ITEMS.path}">`,
    );

    expect((await get(live, `/${DIRECTIONS.path}`)).status).toBe(200);
    for (const path of ["/nope", "/Items", "/items/x", "/api", "/og/x"]) {
      expect((await get(live, path)).status, path).toBe(404);
    }
    expect((await get(live, "/og")).headers["content-type"]).toContain("image/png");
    // A pending domain, an unknown host: the one plain 404 whatever the path.
    expect((await get(pending, `/${ITEMS.path}`)).status).toBe(404);
    expect((await get(hostnameFor("unknown"), `/${ITEMS.path}`)).status).toBe(404);
    // The tracking routes still reach the app on a resolved custom host.
    expect((await get(live, `/r/${site.pageId}/${ITEMS.blockId}`)).status).toBe(302);
  });

  test("M11-06 in a browser the hostname shows the sub-page and the menu, at both viewports", async ({}, info) => {
    const site = await makeLiveSite("cdb", { plan: "studio" });
    const live = hostnameFor("brow");
    await addDomainRow({ pageId: site.pageId, hostname: live, status: "verified" });
    const browser = await chromium.launch({
      args: [`--host-resolver-rules=MAP ${live} 127.0.0.1`],
    });
    try {
      const context = await browser.newContext({
        viewport: info.project.use.viewport ?? undefined,
        deviceScaleFactor: info.project.use.deviceScaleFactor,
        isMobile: info.project.use.isMobile,
        hasTouch: info.project.use.hasTouch,
      });
      const page = await context.newPage();
      await page.goto(`http://${live}:3000/`);
      await page.locator("nav.pg-menu").getByRole("link", { name: ITEMS.title }).click();
      await expect(page).toHaveURL(`http://${live}:3000/${ITEMS.path}`);
      await expect(page.locator("h1")).toHaveText(ITEMS.title);
      await expectSubPageLayout(page);
    } finally {
      await browser.close();
    }
  });
});

test.describe("M11-06 redirect mode and a suspended owner apply to every page", () => {
  test("M11-06 suspended: every page of the site is 'isn't available'; unsuspended it is back", async ({
    browser,
  }, info) => {
    test.skip(!desktopOnly(info), "pure HTTP: one project is enough");
    const site = await makeLiveSite("su");
    expect((await get(tenantHost(site), `/${ITEMS.path}`)).status).toBe(200);
    await setOwnerSuspended(browser, site.user.id, true);
    for (const path of ["/", `/${ITEMS.path}`, `/${DIRECTIONS.path}`]) {
      const response = await get(tenantHost(site), path);
      expect(response.status, path).toBe(404);
      expect(response.body, path).toContain("This page isn’t available.");
      expect(response.body, path).not.toContain(site.name);
    }
    await setOwnerSuspended(browser, site.user.id, false);
    expect((await get(tenantHost(site), `/${ITEMS.path}`)).status).toBe(200);
  });

  test("M11-06 redirect mode: a live sub-page sends the visitor through the click redirect, an invented path is still a 404", async ({}, info) => {
    test.skip(!desktopOnly(info), "pure HTTP: one project is enough");
    const site = await makeLiveSite("rd", { plan: "pro" });
    const admin = adminClient();
    const home = await admin.from("pages").select("published").eq("id", site.pageId).single();
    const published = home.data!.published as { blocks: { id: string; type: string }[] };
    const link = published.blocks.find((block) => block.type === "link")!;
    const update = await admin
      .from("pages")
      .update({ published: { ...published, redirect: { linkId: link.id } } })
      .eq("id", site.pageId);
    expect(update.error).toBeNull();
    for (const path of ["/", `/${ITEMS.path}`]) {
      const response = await get(tenantHost(site), path);
      expect(response.status, path).toBe(302);
      expect(response.location, path).toBe(`/r/${site.pageId}/${link.id}`);
    }
    expect((await get(tenantHost(site), "/nope")).status).toBe(404);
  });
});

test.describe("M11-10 sitemap, robots and the head", () => {
  test("M11-10 a handle host lists Home and its live sub-pages; robots names the sitemap", async ({}, info) => {
    test.skip(!desktopOnly(info), "pure HTTP: one project is enough");
    const site = await makeLiveSite("sm", { plan: "pro" });
    // A page that is not live stays out of the sitemap.
    await adminClient()
      .from("site_pages")
      .insert({
        page_id: site.pageId,
        draft: { path: "later", title: "Later", description: "", blocks: [] },
      });
    const sitemap = await get(tenantHost(site), "/sitemap.xml");
    expect(sitemap.status).toBe(200);
    expect(sitemap.headers["content-type"]).toContain("application/xml");
    const origin = `http://${tenantHost(site)}`;
    expect(locsOf(sitemap.body)).toEqual([
      `${origin}/`,
      `${origin}/${DIRECTIONS.path}`,
      `${origin}/${ITEMS.path}`,
    ]);
    const robots = await get(tenantHost(site), "/robots.txt");
    expect(robots.status).toBe(200);
    expect(robots.body).toContain(`Sitemap: ${origin}/sitemap.xml`);
    expect(robots.body).toContain("Disallow: /r/");
  });

  test("M11-10 mara's sitemap, a custom domain's sitemap on the primary host, and the marketing sitemap unchanged", async ({}, info) => {
    test.skip(!desktopOnly(info), "pure HTTP: one project is enough");
    const mara = await get("mara.localhost:3000", "/sitemap.xml");
    expect(locsOf(mara.body)).toEqual([
      "http://mara.localhost:3000/",
      "http://mara.localhost:3000/directions",
      "http://mara.localhost:3000/items",
    ]);

    const site = await makeLiveSite("smc", { plan: "studio" });
    const live = hostnameFor("map");
    await addDomainRow({ pageId: site.pageId, hostname: live, status: "verified" });
    const custom = await get(live, "/sitemap.xml");
    expect(custom.status).toBe(200);
    expect(locsOf(custom.body)).toEqual([
      `http://${live}:3000/`,
      `http://${live}:3000/${DIRECTIONS.path}`,
      `http://${live}:3000/${ITEMS.path}`,
    ]);
    // The handle host of the same site lists the primary host too.
    expect(locsOf((await get(tenantHost(site), "/sitemap.xml")).body)[0]).toBe(
      `http://${live}:3000/`,
    );
    expect((await get(live, "/robots.txt")).body).toContain(
      `Sitemap: http://${live}:3000/sitemap.xml`,
    );
    // An unknown host and a pending one have no sitemap.
    expect((await get(hostnameFor("nobody"), "/sitemap.xml")).status).toBe(404);
    expect((await get(hostnameFor("nobody"), "/robots.txt")).body).not.toContain("Sitemap:");

    // The marketing sitemap is the marketing pages, never a site's.
    const marketing = await get("localhost:3000", "/sitemap.xml");
    expect(marketing.status).toBe(200);
    expect(locsOf(marketing.body)[0]).toBe("http://localhost:3000/");
    expect(marketing.body).not.toContain("mara.localhost");
    expect((await get("app.localhost:3000", "/sitemap.xml")).status).toBe(404);
  });

  test("M11-10 an unpublished or suspended site has no sitemap", async ({ browser }, info) => {
    test.skip(!desktopOnly(info), "pure HTTP: one project is enough");
    const site = await makeLiveSite("smn", { homePublished: false });
    expect((await get(tenantHost(site), "/sitemap.xml")).status).toBe(404);
    const live = await makeLiveSite("smx");
    await setOwnerSuspended(browser, live.user.id, true);
    expect((await get(tenantHost(live), "/sitemap.xml")).status).toBe(404);
    await setOwnerSuspended(browser, live.user.id, false);
  });

  test("M11-10 the head of a sub-page never names the private site name", async ({}, info) => {
    test.skip(!desktopOnly(info), "pure HTTP: one project is enough");
    const site = await makeLiveSite("hd");
    const privateName = `Private ${rand(8)}`;
    await adminClient().from("pages").update({ name: privateName }).eq("id", site.pageId);
    for (const path of ["/", `/${ITEMS.path}`]) {
      expect((await get(tenantHost(site), path)).body, path).not.toContain(privateName);
    }
    const items = (await get(tenantHost(site), `/${ITEMS.path}`)).body;
    expect(items).toContain(`<title>${ITEMS.title} · ${site.name}</title>`);
    expect(items).toContain(`<meta name="description" content="About ${ITEMS.title}">`);
    expect(items).toContain(
      '<meta property="og:image" content="http://' + tenantHost(site) + "/og?v=",
    );
  });
});

test.describe("M11-06 the beacon names the sub-page", () => {
  test("M11-06 a sub-page's script carries its id, Home's does not", async ({}, info) => {
    test.skip(!desktopOnly(info), "pure HTTP: one project is enough");
    const site = await makeLiveSite("bc");
    const items = (await get(tenantHost(site), `/${ITEMS.path}`)).body;
    expect(items).toContain(`data-page-id="${site.pageId}" data-sub-page-id="${site.itemsId}"`);
    expect((await get(tenantHost(site), "/")).body).not.toContain("data-sub-page-id");
  });

  test("M11-06 in the browser the beacon of a sub-page sends {pageId, subPageId, referrer}", async ({
    page,
  }) => {
    const site = await makeLiveSite("bcb");
    const bodies: string[] = [];
    await page.route("**/api/e", async (route) => {
      bodies.push(route.request().postData() ?? "");
      await route.fulfill({ status: 204, body: "" });
    });
    await page.goto(`http://${tenantHost(site)}/${ITEMS.path}`);
    await expect.poll(() => bodies.length, { timeout: 10_000 }).toBe(1);
    expect(JSON.parse(bodies[0]!)).toEqual({
      pageId: site.pageId,
      subPageId: site.itemsId,
      referrer: "",
    });
    bodies.length = 0;
    await page.goto(`http://${tenantHost(site)}/`);
    await expect.poll(() => bodies.length, { timeout: 10_000 }).toBe(1);
    expect(JSON.parse(bodies[0]!)).toEqual({ pageId: site.pageId, referrer: "" });
  });
});

test.describe("M11-05 behaviour after a publish", () => {
  test("M11-05 editing a published page's draft changes nothing live; a page created later is not live", async ({}, info) => {
    test.skip(!desktopOnly(info), "pure HTTP: one project is enough");
    const site = await makeLiveSite("ed", { plan: "pro" });
    const admin = adminClient();
    await admin
      .from("site_pages")
      .update({ draft: { path: ITEMS.path, title: "Edited title", description: "", blocks: [] } })
      .eq("id", site.itemsId);
    const items = (await get(tenantHost(site), `/${ITEMS.path}`)).body;
    expect(h1s(items)).toEqual([ITEMS.title]);
    const created = await admin.from("site_pages").insert({
      page_id: site.pageId,
      draft: { path: "fresh", title: "Fresh", description: "", blocks: [] },
    });
    expect(created.error).toBeNull();
    expect((await get(tenantHost(site), "/fresh")).status).toBe(404);
  });

  test("M11-05 another user's unpublished site stays dark: sign-up users with no sub-pages are unchanged", async ({}, info) => {
    test.skip(!desktopOnly(info), "pure HTTP: one project is enough");
    const user = await makeUser("plain");
    const handle = `zq-plain-${rand(5)}`;
    await insertPage(user.id, handle, {});
    const response = await get(`${handle}.localhost:3000`, "/items");
    expect(response.status).toBe(404);
    // A site that is not a user's of this run: unrelated 404 panel, never a draft.
    expect(response.body).not.toContain("Zq ");
  });
});

// Keeps the helper import used when the editor flow above is the only consumer.
void emptyUser;
