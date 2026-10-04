import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { cleanupUsers, desktopOnly, rand, signIn } from "../fixtures/data";
import { authCookies, cookieHeader } from "../fixtures/http";
import { requireLocalEnv } from "../fixtures/stripe-stub";
import { markDnsReady } from "../fixtures/vercel-stub";
import { rawBuffer, SERVER_PORT, type RawBufferResponse } from "../m2/publish-helpers";
import { adminClient } from "../fixtures/auth";
import {
  addDomainRow,
  domainRowOf,
  hostnameFor,
  makeSite,
  publishedPage,
  resetCooldown,
  type Site,
} from "../m4/domains-core-helpers";
import { cardOf } from "../m4/domains-ui-helpers";

/**
 * M8-10 and M8-11 against a production build, where the custom-domain lookup is remembered (a minute
 * for a verified host, ten seconds for none) and every domain change expires the remembered answer:
 *
 *   NEXT_PUBLIC_ROOT_DOMAIN=localhost:3100 HYDLNK_QUERY_COUNTER=1 pnpm build
 *   NEXT_PUBLIC_ROOT_DOMAIN=localhost:3100 HYDLNK_QUERY_COUNTER=1 ./node_modules/.bin/next start -p 3100
 *   HL_PROD_PORT=3100 pnpm exec playwright test tests/e2e/m8/levers-domain-cache.spec.ts --project=desktop
 *
 * The test flag HYDLNK_QUERY_COUNTER=1 is what makes the proxy answer `x-hl-domain-cache: HIT|MISS`.
 * Sign-in goes to the dev server unless HL_DEV_PORT names the production port as well (HL_DEV_PORT=3100
 * with the dev server stopped); the session cookie is host-only, not per port, so both work. Started
 * without the flag and run with HL_COUNTER_OFF=1, the last test proves the header is never sent.
 * `next dev` never caches the lookup, so none of this can be seen there (the unit tests in
 * tests/unit/m8-levers-domain-*.test.ts prove the logic with fake clocks).
 *
 * Every hostname is the test's own and unique; the Vercel stub (the one the M4 specs use) stands in
 * for the domains API. Requests are plain HTTP with a Host header; the changes themselves are made
 * the way a customer makes them, in the browser on the app host of the production server.
 */

test.skip(!process.env.HL_PROD_PORT, "needs a production build: set HL_PROD_PORT (see the header)");
test.describe.configure({ mode: "serial", timeout: 150_000 });
test.afterAll(cleanupUsers);

const COUNTER_OFF = process.env.HL_COUNTER_OFF === "1";
const APP_HOST = `app.localhost:${SERVER_PORT}`;
const APP = `http://${APP_HOST}`;
const HEADER = "x-hl-domain-cache";

const get = (host: string, path = "/", opts: Parameters<typeof rawBuffer>[2] = {}) =>
  rawBuffer(host, path, opts);
const state = (res: RawBufferResponse) => String(res.headers[HEADER] ?? "");
const plain404 = (res: RawBufferResponse, ...secrets: string[]) => {
  expect(res.status).toBe(404);
  expect(res.headers["set-cookie"]).toBeUndefined();
  for (const secret of secrets) expect(res.text).not.toContain(secret);
};

/** A verified domain row for `site`, the way the sweep or "Check DNS now" leaves it. */
const verifiedHost = async (site: Site, label: string): Promise<string> => {
  const host = hostnameFor(label);
  await addDomainRow({ pageId: site.pageId, hostname: host, status: "verified" });
  return host;
};

async function ownerContext(
  browser: Browser,
  site: Site,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  await signIn(context, site.user.email);
  return { context, page: await context.newPage() };
}

const sweep = () =>
  rawBuffer(APP_HOST, "/api/cron/verify-domains", {
    method: "POST",
    headers: { authorization: `Bearer ${requireLocalEnv("CRON_SECRET")}` },
  });

const DOMAINS = `${APP}/domains`;

async function addThroughTheScreen(page: Page, host: string, pageId?: string) {
  await page.goto(DOMAINS);
  const form = page.locator("[data-custom-domain-card]");
  await form.getByLabel("Domain", { exact: true }).fill(host);
  if (pageId) await form.getByLabel("Serves").selectOption(pageId);
  await form.getByRole("button", { name: "Add domain" }).click();
  await expect(cardOf(page, host)).toBeVisible();
}

/** Marks the DNS ready at the stub and presses "Check DNS now": the card goes live. */
async function goLive(page: Page, host: string) {
  await markDnsReady(host);
  const card = cardOf(page, host);
  await card.getByRole("button", { name: "Check DNS now" }).click();
  await expect(card.locator("[data-domain-chip]")).toHaveText("Live · SSL issued");
}

async function removeThroughTheScreen(page: Page, host: string) {
  await page.goto(DOMAINS);
  const card = cardOf(page, host);
  await card.getByRole("button", { name: "Remove domain" }).click();
  await card
    .locator("[data-remove-confirm]")
    .getByRole("button", { name: "Remove domain" })
    .click();
  await expect(card).toHaveCount(0);
}

test.beforeAll(async ({}, info) => {
  if (!desktopOnly(info) || COUNTER_OFF) return;
  const probe = await get(hostnameFor("probe"));
  expect(
    state(probe),
    "the server answers no x-hl-domain-cache: start the production build with HYDLNK_QUERY_COUNTER=1",
  ).toBe("MISS");
});

test.describe("M8-10 the production build remembers the lookup", () => {
  test("M8-10 a verified host is a MISS and then a HIT with the same page; an unknown host is a MISS and then a HIT 404", async ({}, info) => {
    test.skip(!desktopOnly(info) || COUNTER_OFF, "one project; needs the counter flag");
    const site = await makeSite("c1", "pro");
    const host = await verifiedHost(site, "c1");
    const first = await get(host);
    const second = await get(host);
    expect([first.status, second.status]).toEqual([200, 200]);
    expect(first.text).toContain(site.name);
    expect(second.text).toContain(site.name);
    expect([state(first), state(second)]).toEqual(["MISS", "HIT"]);

    const nobody = hostnameFor("c1none");
    const cold = await get(nobody);
    const warm = await get(nobody);
    expect([cold.status, warm.status]).toEqual([404, 404]);
    expect([state(cold), state(warm)]).toEqual(["MISS", "HIT"]);
  });

  test("M8-10 a draft-only page, a pending row, no row and a *.vercel.app host are the same 404 with no tenant data, cold and warm", async ({}, info) => {
    test.skip(!desktopOnly(info) || COUNTER_OFF, "one project; needs the counter flag");
    const live = await makeSite("c2", "studio");
    const draft = await makeSite("c2d", "studio");
    await adminClient()
      .from("pages")
      .update({ published: null, published_at: null })
      .eq("id", draft.pageId);
    const pending = hostnameFor("c2p");
    await addDomainRow({ pageId: live.pageId, hostname: pending, status: "pending" });
    const draftHost = await verifiedHost(draft, "c2d");
    const unknown = hostnameFor("c2u");
    const vercelApp = `zq-c2-${rand(6)}.vercel.app`;
    await addDomainRow({ pageId: live.pageId, hostname: vercelApp, status: "verified" });

    for (const [name, host] of [
      ["pending", pending],
      ["draft-only", draftHost],
      ["no row", unknown],
    ] as const) {
      const cold = await get(host);
      const warm = await get(host);
      for (const [when, res] of [
        ["cold", cold],
        ["warm", warm],
      ] as const) {
        plain404(res, live.name, draft.name, live.handle, draft.handle);
        // The plain tenant 404 (M8-03 step 3): finished HTML with this heading, no framework payload.
        expect(res.text, `${name} ${when}`).toContain("Page not found");
      }
      expect(state(cold), `${name} cold`).toBe("MISS");
      expect(state(warm), `${name} warm`).toBe("HIT");
    }
    // A deployment host is never a custom domain, whatever a row says: no lookup, no tenant data, no header.
    const deployment = await get(vercelApp);
    expect(deployment.text).not.toContain(live.name);
    expect(deployment.text).not.toContain(live.handle);
    expect(state(deployment)).toBe("");
  });

  test("M8-10 on a warm host: /r/* and /api/e pass through, everything else is 404 with no Set-Cookie even with an sb-* cookie", async ({}, info) => {
    test.skip(!desktopOnly(info) || COUNTER_OFF, "one project; needs the counter flag");
    const site = await makeSite("c3", "pro");
    const host = await verifiedHost(site, "c3");
    await get(host); // warm
    const cookie = "sb-127-auth-token=base64-eyJhY2Nlc3NfdG9rZW4iOiJ4In0; sb-127-auth-token.0=x";

    const click = await get(host, `/r/${site.pageId}/Bt5rJ1fGz6Os`, { cookie });
    expect(click.status).toBe(302);
    expect(state(click)).toBe("HIT");
    expect(click.headers["set-cookie"]).toBeUndefined();
    const beacon = await get(host, "/api/e", {
      method: "POST",
      cookie,
      headers: { "content-type": "text/plain;charset=UTF-8", origin: `http://${host}` },
      body: JSON.stringify({ pageId: site.pageId, referrer: "" }),
    });
    expect(beacon.status).toBe(204);
    expect(state(beacon)).toBe("HIT");

    for (const method of ["GET", "POST"]) {
      for (const path of [
        "/login",
        "/signup",
        "/settings",
        "/domains",
        "/analytics",
        "/auth/callback",
        "/api/stripe/webhook",
        "/anything-else",
      ]) {
        const res = await get(host, path, {
          cookie,
          method,
          ...(method === "POST"
            ? { body: "{}", headers: { "content-type": "application/json" } }
            : {}),
        });
        // A page answers GET and HEAD only (M8-02 answers any other method with a 405 before the lookup, which
        // older builds answer with the 404): either way no cookie is set and no tenant data is in the body.
        if (method === "GET") {
          plain404(res, site.name);
          expect(state(res), `${method} ${path}`).toBe("HIT");
        } else {
          expect([404, 405], `${method} ${path}`).toContain(res.status);
          expect(res.headers["set-cookie"], `${method} ${path}`).toBeUndefined();
          expect(res.text).not.toContain(site.name);
        }
      }
    }
    const page = await get(host, "/", { cookie });
    expect(page.status).toBe(200);
    expect(page.headers["set-cookie"]).toBeUndefined();
    expect(page.text).toContain(site.name);
  });

  test("M8-10 case, port and a trailing dot share one entry; two hostnames never cross; X-Forwarded-Host changes nothing", async ({}, info) => {
    test.skip(!desktopOnly(info) || COUNTER_OFF, "one project; needs the counter flag");
    const a = await makeSite("c4a", "pro");
    const b = await makeSite("c4b", "pro");
    const hostA = await verifiedHost(a, "c4a");
    const hostB = await verifiedHost(b, "c4b");

    expect(state(await get(hostA.toUpperCase()))).toBe("MISS");
    for (const spelling of [
      hostA,
      `${hostA}:${SERVER_PORT}`,
      `${hostA}.`,
      `${hostA.toUpperCase()}.:${SERVER_PORT}`,
    ]) {
      const res = await get(spelling);
      expect(res.status, spelling).toBe(200);
      expect(res.text, spelling).toContain(a.name);
      expect(state(res), spelling).toBe("HIT");
    }

    // Interleaved, cold and warm: each host answers its own page and never the other's.
    for (const [host, mine, other] of [
      [hostB, b, a],
      [hostA, a, b],
      [hostB, b, a],
      [hostA, a, b],
    ] as const) {
      const res = await get(host);
      expect(res.text).toContain(mine.name);
      expect(res.text).not.toContain(other.name);
    }
    // A header naming a known host does not take an unknown host's 404 away, nor give it the other's page.
    const spoofed = await get(hostnameFor("c4x"), "/", {
      headers: { "x-forwarded-host": hostA, "x-original-host": hostA, forwarded: `host=${hostA}` },
    });
    plain404(spoofed, a.name, b.name);
  });

  test("M8-10 nothing about the page is in the lookup: a draft-only page's host is 404, and the first request after Publish serves it with the hostname still a HIT", async ({
    browser,
  }, info) => {
    test.skip(!desktopOnly(info) || COUNTER_OFF, "one project; needs the counter flag");
    const site = await makeSite("c6", "pro");
    await adminClient()
      .from("pages")
      .update({ published: null, published_at: null })
      .eq("id", site.pageId);
    const host = await verifiedHost(site, "c6");
    plain404(await get(host), site.name, site.handle);
    const warm = await get(host);
    plain404(warm, site.name, site.handle);
    expect(state(warm)).toBe("HIT"); // the mapping is remembered; the page route says 404

    const newName = `Published ${rand(5)}`;
    const { context, page } = await ownerContext(browser, site);
    try {
      await page.goto(`${APP}/editor`);
      const nameField = page.getByLabel("Display name", { exact: true });
      await expect(nameField).toBeVisible();
      await nameField.fill(newName);
      await page
        .getByTestId("workspace-toolbar")
        .getByRole("button", { name: "Publish", exact: true })
        .click();
      await expect(page.locator("[data-publish-status]")).toHaveText("Published");
      const first = await get(host);
      expect(first.status).toBe(200);
      expect(first.text).toContain(newName);
      expect(state(first)).toBe("HIT"); // Publish expired the page, not the hostname
    } finally {
      await context.close();
    }
  });

  test("M8-10 (flag off) a production build without HYDLNK_QUERY_COUNTER never sends the header", async ({}, info) => {
    test.skip(
      !desktopOnly(info) || !COUNTER_OFF,
      "run with HL_COUNTER_OFF=1 against a server started without the flag",
    );
    const site = await makeSite("c5", "pro");
    const host = await verifiedHost(site, "c5");
    for (const path of ["/", "/", "/og", "/login", `/r/${site.pageId}/Bt5rJ1fGz6Os`]) {
      expect(state(await get(host, path)), path).toBe("");
    }
    expect(state(await get(hostnameFor("c5none")))).toBe("");
  });
});

test.describe("M8-11 every domain change is the next request's truth", () => {
  test("M8-11 a hostname that answered 404 (its ten-second 'none' entry) serves the page on the first request after the sweep verified it", async ({}, info) => {
    test.skip(!desktopOnly(info) || COUNTER_OFF, "one project; needs the counter flag");
    const site = await makeSite("e1", "pro");
    const host = hostnameFor("e1");
    const id = await addDomainRow({ pageId: site.pageId, hostname: host, status: "pending" });
    plain404(await get(host), site.name);
    const warm = await get(host);
    plain404(warm, site.name);
    expect(state(warm)).toBe("HIT"); // it sits in the 'none' entry

    await markDnsReady(host);
    await resetCooldown(id);
    const swept = await sweep();
    expect(swept.status, swept.text).toBe(200);
    expect((await domainRowOf(id))!.status).toBe("verified");

    const first = await get(host);
    expect(first.status).toBe(200);
    expect(first.text).toContain(site.name);
    expect(state(first)).toBe("MISS"); // the entry was expired, not outlived
  });

  test("M8-11 re-pointing the domain to another of the account's pages serves that page's content on the first request", async ({
    browser,
  }, info) => {
    test.skip(!desktopOnly(info) || COUNTER_OFF, "one project; needs the counter flag");
    const site = await makeSite("e2", "studio");
    const secondName = `Zq second ${rand(4)}`;
    const secondId = await publishedPage(site.user.id, `zq-e2b-${rand(5)}`, secondName);
    const host = await verifiedHost(site, "e2");
    expect((await get(host)).text).toContain(site.name);
    expect(state(await get(host))).toBe("HIT");

    const { context, page } = await ownerContext(browser, site);
    try {
      await page.goto(DOMAINS);
      const card = cardOf(page, host);
      await card.getByLabel("Serves").selectOption(secondId);
      await expect(card.getByText("Saved", { exact: true })).toBeVisible();
      const first = await get(host);
      expect(first.status).toBe(200);
      expect(first.text).toContain(secondName);
      expect(first.text).not.toContain(site.name);
      expect(state(first)).toBe("MISS");
    } finally {
      await context.close();
    }
  });

  test("M8-11 removing the domain answers 404 on the first request (M4-17 step 2), and the 404 names no one", async ({
    browser,
  }, info) => {
    test.skip(!desktopOnly(info) || COUNTER_OFF, "one project; needs the counter flag");
    const site = await makeSite("e3", "pro");
    const host = await verifiedHost(site, "e3");
    await get(host);
    expect(state(await get(host))).toBe("HIT");

    const { context, page } = await ownerContext(browser, site);
    try {
      await removeThroughTheScreen(page, host);
      const gone = await get(host);
      plain404(gone, site.name, site.handle);
    } finally {
      await context.close();
    }
  });

  test("M8-04 a custom host's cached page follows getPrimaryDomain: removing the primary domain changes og:url on the first request", async ({
    browser,
  }, info) => {
    test.skip(!desktopOnly(info) || COUNTER_OFF, "one project; needs the counter flag");
    const site = await makeSite("e3p", "studio");
    const primary = await verifiedHost(site, "e3pa");
    await new Promise((resolve) => setTimeout(resolve, 30)); // verified_at orders the two: `primary` is the older
    const other = await verifiedHost(site, "e3pb");
    const ogUrl = (res: RawBufferResponse) => /property="og:url" content="([^"]+)"/.exec(res.text)?.[1] ?? "";

    const warm = await get(other);
    expect(warm.status).toBe(200);
    expect(ogUrl(warm)).toContain(primary);
    const cached = await get(other);
    expect(String(cached.headers["x-nextjs-cache"])).toBe("HIT");
    expect(ogUrl(cached)).toContain(primary);

    const { context, page } = await ownerContext(browser, site);
    try {
      await removeThroughTheScreen(page, primary);
    } finally {
      await context.close();
    }
    // The page's tag was expired with the domain row: the very next request names the remaining domain.
    const after = await get(other);
    expect(after.status).toBe(200);
    expect(ogUrl(after)).toContain(other);
    expect(ogUrl(after)).not.toContain(primary);
  });

  test("M8-11 deleting the page answers 404 on the first request", async ({ browser }, info) => {
    test.skip(!desktopOnly(info) || COUNTER_OFF, "one project; needs the counter flag");
    const site = await makeSite("e4", "studio");
    await publishedPage(site.user.id, `zq-e4b-${rand(5)}`, `Zq other ${rand(4)}`); // the account keeps a page
    const host = await verifiedHost(site, "e4");
    await get(host);
    expect(state(await get(host))).toBe("HIT");

    const { context } = await ownerContext(browser, site);
    try {
      const cookie = cookieHeader(await authCookies(context));
      const deleted = await rawBuffer(APP_HOST, `/api/pages/${site.pageId}`, {
        method: "DELETE",
        cookie,
        headers: { "content-type": "application/json", origin: APP },
        body: JSON.stringify({ confirm: site.handle }),
      });
      expect(deleted.status, deleted.text).toBe(200);
      plain404(await get(host), site.name, site.handle);
    } finally {
      await context.close();
    }
  });

  test("M8-11 deleting the account answers 404 on the first request", async ({ browser }, info) => {
    test.skip(!desktopOnly(info) || COUNTER_OFF, "one project; needs the counter flag");
    const site = await makeSite("e5", "pro");
    const host = await verifiedHost(site, "e5");
    await get(host);
    expect(state(await get(host))).toBe("HIT");

    const { context, page } = await ownerContext(browser, site);
    try {
      await page.goto(`${APP}/settings`);
      await page.locator("main").getByRole("button", { name: "Delete account" }).click();
      const dialog = page.getByRole("dialog", { name: "Delete your account?" });
      await dialog.getByLabel("Type your handle to confirm").fill(site.handle);
      await dialog.getByRole("button", { name: "Delete account" }).click();
      await expect(page).toHaveURL(/\/login/);
      plain404(await get(host), site.name, site.handle);
    } finally {
      await context.close();
    }
  });

  test("M8-11 a stale pending row removed by the sweep answers 404, and a later add of the same hostname works and serves", async ({
    browser,
  }, info) => {
    test.skip(!desktopOnly(info) || COUNTER_OFF, "one project; needs the counter flag");
    const site = await makeSite("e6", "pro");
    const host = hostnameFor("e6");
    const id = await addDomainRow({
      pageId: site.pageId,
      hostname: host,
      status: "pending",
      createdAt: new Date(Date.now() - 8 * 86_400_000).toISOString(),
    });
    plain404(await get(host), site.name);
    const swept = await sweep();
    expect(swept.status, swept.text).toBe(200);
    expect(await domainRowOf(id)).toBeNull(); // released: Vercel first, then the row
    plain404(await get(host), site.name);

    const { context, page } = await ownerContext(browser, site);
    try {
      await addThroughTheScreen(page, host);
      await goLive(page, host);
      const first = await get(host);
      expect(first.status).toBe(200);
      expect(first.text).toContain(site.name);
      expect(state(first)).toBe("MISS");
    } finally {
      await context.close();
    }
  });

  test("M8-11 other people's data: A's removed hostname is never A's again; B adds and verifies it and the first request serves B's page, then B's second page", async ({
    browser,
  }, info) => {
    test.skip(!desktopOnly(info) || COUNTER_OFF, "one project; needs the counter flag");
    const a = await makeSite("e7a", "pro");
    const b = await makeSite("e7b", "studio");
    const b2Name = `Zq b-two ${rand(4)}`;
    const b2 = await publishedPage(b.user.id, `zq-e7b2-${rand(5)}`, b2Name);
    const host = await verifiedHost(a, "e7");
    const other = hostnameFor("e7other");

    expect((await get(host)).text).toContain(a.name);
    expect(state(await get(host))).toBe("HIT");

    const ctxA = await ownerContext(browser, a);
    const ctxB = await ownerContext(browser, b);
    try {
      // A removes it: the very next request is a 404 with neither A's name nor handle in it.
      await removeThroughTheScreen(ctxA.page, host);
      const afterRemoval = await get(host);
      plain404(afterRemoval, a.name, a.handle);
      // A hostname remembered for A is never answered for another hostname.
      plain404(await get(other), a.name, b.name);

      // B adds and verifies the same hostname for B's page.
      await addThroughTheScreen(ctxB.page, host, b.pageId);
      expect((await get(host)).status).toBe(404); // pending: still nobody's
      await goLive(ctxB.page, host);
      const first = await get(host);
      expect(first.status).toBe(200);
      expect(first.text).toContain(b.name);
      expect(first.text).not.toContain(a.name);

      // Re-pointed to B's second page: the first request after it serves that page, never A's.
      const card = cardOf(ctxB.page, host);
      await card.getByLabel("Serves").selectOption(b2);
      await expect(card.getByText("Saved", { exact: true })).toBeVisible();
      const repointed = await get(host);
      expect(repointed.text).toContain(b2Name);
      expect(repointed.text).not.toContain(a.name);
      expect(repointed.text).not.toContain(b.name);
      expect(state(repointed)).toBe("MISS");
      // And a host that was never anyone's stays a 404 throughout.
      plain404(await get(other), a.name, b.name, b2Name);
    } finally {
      await ctxA.context.close();
      await ctxB.context.close();
    }
  });
});
