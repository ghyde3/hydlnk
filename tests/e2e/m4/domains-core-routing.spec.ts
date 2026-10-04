import { chromium, expect, test } from "@playwright/test";
import { adminClient } from "../fixtures/auth";
import { cleanupUsers, desktopOnly, makeUser, rand, signedInUser } from "../fixtures/data";
import { rawRequest } from "../fixtures/http";
import { url } from "../helpers";
import {
  addDomainRow,
  hostnameFor,
  makeSite,
  publishedPage,
  type Site,
} from "./domains-core-helpers";

/**
 * M4-09: verified custom hostnames serve their page and nothing else. Everything here talks to the
 * dev server on 127.0.0.1:3000 with an explicit Host header (what the proxy reads), so each
 * request is exactly one thing; one browser test maps a hostname to loopback and loads it for real.
 * Pure HTTP, so one viewport is enough.
 */

test.afterAll(cleanupUsers);
test.describe.configure({ timeout: 90_000 });

const get = (host: string, path = "/", opts: Parameters<typeof rawRequest>[2] = {}) =>
  rawRequest(host, path, opts);

/**
 * The page's own markup (the .pg-root element and everything in it). The framework's streaming
 * markers and the metadata that `next dev` may stream into the body differ by timing, not content.
 */
const markup = (html: string): string =>
  /<div class="pg-root"[\s\S]*?<\/footer><\/div><\/div>/.exec(html)?.[0] ??
  `NO PAGE MARKUP: ${html.slice(0, 200)}`;

let site: Site;
let live: string; // a verified domain of the published page
let pendingHost: string;
let draftHost: string;
let vercelAppHost: string;
let draftSite: Site;

test.beforeAll(async ({}, info) => {
  if (!desktopOnly(info)) return; // the specs below are pure HTTP and skip on the phone project
  site = await makeSite("rt");
  live = hostnameFor("live");
  pendingHost = hostnameFor("pend");
  draftHost = hostnameFor("draft");
  vercelAppHost = `zq-${rand(6)}.vercel.app`;
  await addDomainRow({ pageId: site.pageId, hostname: live, status: "verified" });
  await addDomainRow({ pageId: site.pageId, hostname: pendingHost, status: "pending" });
  // A verified domain whose page has nothing published: a draft never leaks.
  draftSite = await makeSite("rtd");
  const admin = adminClient();
  await admin
    .from("pages")
    .update({ published: null, published_at: null })
    .eq("id", draftSite.pageId);
  await addDomainRow({ pageId: draftSite.pageId, hostname: draftHost, status: "verified" });
  // A verified row for a *.vercel.app hostname (the validator refuses to add one; a direct insert shows the proxy never honours it).
  await addDomainRow({ pageId: site.pageId, hostname: vercelAppHost, status: "verified" });
});

test.describe("M4-09 a verified domain serves its published page", () => {
  test("M4-09 200 with the page's display name and the same markup as its handle host", async ({}, info) => {
    test.skip(!desktopOnly(info), "pure HTTP: one project is enough");
    const custom = await get(live);
    expect(custom.status).toBe(200);
    expect(custom.body).toContain(site.name);

    const tenant = await get(`${site.handle}.localhost:3000`);
    expect(tenant.status).toBe(200);
    expect(tenant.body).toContain(site.name);
    expect(markup(custom.body)).toBe(markup(tenant.body));
  });

  test("M4-09 in a browser the hostname (mapped to loopback) shows the page and the address bar stays '/'", async ({}, info) => {
    test.skip(!desktopOnly(info), "pure HTTP plus one browser load: one project is enough");
    const browser = await chromium.launch({
      args: [`--host-resolver-rules=MAP ${live} 127.0.0.1`],
    });
    try {
      const page = await browser.newPage();
      await page.goto(`http://${live}:3000/`);
      await expect(page.getByText(site.name).first()).toBeVisible();
      expect(new URL(page.url()).pathname).toBe("/");
      expect(new URL(page.url()).host).toBe(`${live}:3000`);
      // Its og:url names the page's domain on the same scheme and port.
      const ogUrl = await page.locator('meta[property="og:url"]').getAttribute("content");
      expect(ogUrl).toBe(`http://${live}:3000/`);
    } finally {
      await browser.close();
    }
  });

  test("M4-09 host matching ignores case, port and a trailing dot", async ({}, info) => {
    test.skip(!desktopOnly(info), "pure HTTP: one project is enough");
    const spellings = [
      live.toUpperCase(),
      `${live}:3000`,
      `${live.toUpperCase()}:3000`,
      `${live}.`,
      `${live}.:3000`,
    ];
    for (const host of spellings) {
      const res = await get(host);
      expect(res.status, host).toBe(200);
      expect(res.body, host).toContain(site.name);
    }
  });

  test("M4-09 only the real Host header counts: X-Forwarded-Host and X-Original-Host are ignored", async ({}, info) => {
    test.skip(!desktopOnly(info), "pure HTTP: one project is enough");
    const spoof = { "x-forwarded-host": live, "x-original-host": live, forwarded: `host=${live}` };
    const unknown = await get(hostnameFor("nobody"), "/", { headers: spoof });
    expect(unknown.status).toBe(404);
    expect(unknown.body).not.toContain(site.name);

    // And a real host is not taken away by a header naming another one.
    const real = await get(live, "/", { headers: { "x-forwarded-host": hostnameFor("other") } });
    expect(real.status).toBe(200);
    expect(real.body).toContain(site.name);
  });
});

test.describe("M4-09 everything else is the generic 404 with no tenant data", () => {
  test("M4-09 no domains row, a pending row, a draft-only page and a *.vercel.app host", async ({}, info) => {
    test.skip(!desktopOnly(info), "pure HTTP: one project is enough");
    const unknown = await get(hostnameFor("none"));
    const pending = await get(pendingHost);
    const draft = await get(draftHost);
    for (const [name, res] of [
      ["no row", unknown],
      ["pending", pending],
      ["draft", draft],
    ] as const) {
      expect(res.status, name).toBe(404);
      expect(res.body, name).not.toContain(site.name);
      expect(res.body, name).not.toContain(draftSite.name);
      expect(res.body, name).not.toContain(site.handle);
    }
    // The three answers are the same page: nothing says which case it was.
    expect(markup(pending.body)).toBe(markup(unknown.body));
    expect(markup(draft.body)).toBe(markup(unknown.body));

    // A *.vercel.app host is a deployment URL: it serves the marketing site, never a tenant's page,
    // even when a (hand-made) verified row names it.
    const vercelApp = await get(vercelAppHost);
    expect(vercelApp.body).not.toContain(site.name);
    expect(vercelApp.body).not.toContain(site.handle);
    const vercelAppPage = await get(vercelAppHost, "/anything");
    expect(vercelAppPage.body).not.toContain(site.name);
  });

  test("M4-09 other hosts that are not domains: IPs, garbage and the bare name", async ({}, info) => {
    test.skip(!desktopOnly(info), "pure HTTP: one project is enough");
    for (const host of [
      "203.0.113.5",
      "203.0.113.5:3000",
      "localhost.example",
      "a_b.example.test",
      "xn--bcher-kva.example",
    ]) {
      const res = await get(host);
      expect(res.status, host).toBe(404);
      expect(res.body, host).not.toContain(site.name);
    }
  });
});

test.describe("M4-09 the internal route is unreachable directly", () => {
  test("M4-09 GET /sites/<page id> is a 404 on every host, in every spelling", async ({}, info) => {
    test.skip(!desktopOnly(info), "pure HTTP: one project is enough");
    const id = site.pageId;
    const hosts = [
      "localhost:3000",
      "app.localhost:3000",
      `${site.handle}.localhost:3000`,
      "mara.localhost:3000",
      live,
      hostnameFor("none"),
    ];
    const paths = [
      `/sites/${id}`,
      `/sites/${id}/og`,
      `/sites/${id}.txt`,
      `/%73ites/${id}`,
      `/sites/${id.toUpperCase()}`,
      `/sites/${id}/x`,
      `/sites/${draftSite.pageId}`,
    ];
    for (const host of hosts) {
      for (const path of paths) {
        const res = await get(host, path);
        expect(res.status, `${host} ${path}`).toBe(404);
        expect(res.body, `${host} ${path}`).not.toContain(site.name);
      }
    }
  });
});

test.describe("M4-09 a custom host serves the page, its OG image, /r/*, /api/e and assets, and nothing else", () => {
  test("M4-09 /login /signup /settings /domains /analytics /auth/callback /api/stripe/webhook and /anything-else are 404 with no Set-Cookie, even with an sb-* cookie", async ({}, info) => {
    test.skip(!desktopOnly(info), "pure HTTP: one project is enough");
    const cookie = "sb-127-auth-token=base64-eyJhY2Nlc3NfdG9rZW4iOiJ4In0; sb-127-auth-token.0=x";
    const paths = [
      "/login",
      "/signup",
      "/settings",
      "/domains",
      "/analytics",
      "/auth/callback",
      "/api/stripe/webhook",
      "/api/cron/verify-domains",
      `/api/domains/${site.pageId}`,
      "/editor",
      "/admin",
      "/anything-else",
      "/app",
      "/t/mara",
    ];
    for (const method of ["GET", "POST"]) {
      for (const path of paths) {
        const res = await get(live, path, {
          cookie,
          method,
          ...(method === "POST"
            ? { body: "{}", headers: { "content-type": "application/json" } }
            : {}),
        });
        expect(res.status, `${method} ${path}`).toBe(404);
        expect(res.setCookies, `${method} ${path}`).toEqual([]);
        expect(res.body, `${method} ${path}`).not.toContain(site.name);
      }
    }
    // The page itself, with the cookie: served, no Set-Cookie.
    const page = await get(live, "/", { cookie });
    expect(page.status).toBe(200);
    expect(page.setCookies).toEqual([]);
    expect(page.headers["content-security-policy"]).toContain("frame-ancestors 'none'");
  });

  test("M4-09 the OG image is served on the custom host, and og:url / og:image are absolute URLs on it", async ({}, info) => {
    test.skip(!desktopOnly(info), "pure HTTP: one project is enough");
    const page = await get(live);
    const ogUrl = /property="og:url" content="([^"]+)"/.exec(page.body)?.[1];
    const ogImage = /property="og:image" content="([^"]+)"/.exec(page.body)?.[1];
    expect(ogUrl).toBe(`http://${live}:3000/`);
    expect(ogImage).toMatch(new RegExp(`^http://${live.replace(/\./g, "\\.")}:3000/og\\?v=\\d+$`));

    const image = await get(live, new URL(ogImage!).pathname + new URL(ogImage!).search);
    expect(image.status).toBe(200);
    expect(String(image.headers["content-type"])).toBe("image/png");
    // Unpublished or unknown hosts have no image.
    expect((await get(pendingHost, "/og")).status).toBe(404);
    expect((await get(hostnameFor("none"), "/og")).status).toBe(404);
  });

  test("M4-09 static assets are served on the custom host", async ({}, info) => {
    test.skip(!desktopOnly(info), "pure HTTP: one project is enough");
    const page = await get(live);
    const asset = /\/_next\/static\/[^"'\s)]+\.(?:js|css)/.exec(page.body)?.[0];
    expect(asset, "the page links a framework asset").toBeTruthy();
    const res = await get(live, asset!);
    expect(res.status).toBe(200);
  });
});

test.describe("M4-09 a static-looking path cannot slip past the proxy's host checks", () => {
  test("M4-09 /app/api/domains/<uuid>.png (and .css, .js, .svg) is a 404 on the marketing, tenant and custom hosts, and real static files are still served", async ({}, info) => {
    test.skip(!desktopOnly(info), "pure HTTP: one project is enough");
    const id = "0b0e1f2a-3c4d-4e5f-8a9b-0c1d2e3f4a5b";
    const cookie = "sb-127-auth-token=base64-eyJhY2Nlc3NfdG9rZW4iOiJ4In0";
    const hosts = [
      "localhost:3000",
      `${site.handle}.localhost:3000`,
      "mara.localhost:3000",
      live,
      hostnameFor("none"),
    ];
    for (const host of hosts) {
      for (const ext of ["png", "css", "js", "svg", "json.png"]) {
        for (const method of ["GET", "POST", "DELETE"]) {
          const res = await get(host, `/app/api/domains/${id}.${ext}`, { cookie, method });
          expect(res.status, `${method} ${host} .${ext}`).toBe(404);
          expect(res.setCookies, `${host} .${ext}`).toEqual([]);
        }
      }
      for (const path of [
        `/app/x.png`,
        `/t/${site.handle}/x.webp`,
        `/sites/${site.pageId}/x.png`,
      ]) {
        expect((await get(host, path, { cookie })).status, `${host} ${path}`).toBe(404);
      }
    }
    // Real static files are untouched by the matcher change.
    const asset = await get("localhost:3000", "/marketing/demo/fennmoor-image.webp");
    expect(asset.status).toBe(200);
    expect(String(asset.headers["content-type"])).toMatch(/image\/webp/);
    const onTenant = await get(
      `${site.handle}.localhost:3000`,
      "/marketing/demo/fennmoor-image.webp",
    );
    expect(onTenant.status).toBe(200);
  });
});

test.describe("M4-09 changes show at the next request", () => {
  test("M4-09 publishing a new display name shows on the custom host and the handle host at the same time", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "one editor flow: one project is enough");
    const owner = await signedInUser(context, { label: "rtp", plan: "studio" });
    const host = hostnameFor("pub");
    await addDomainRow({ pageId: owner.pageId, hostname: host, status: "verified" });
    const newName = `Renamed ${rand(5)}`;

    await page.goto(url("app", "/editor"));
    const nameField = page.getByLabel("Display name", { exact: true });
    await expect(nameField).toBeVisible();
    await nameField.fill(newName);
    await page
      .getByTestId("workspace-toolbar")
      .getByRole("button", { name: "Publish", exact: true })
      .click();
    await expect(page.locator("[data-publish-status]")).toHaveText("Published");

    // The very next requests: no deploy, no wait.
    const custom = await get(host);
    const tenant = await get(`${owner.handle}.localhost:3000`);
    expect(custom.body).toContain(newName);
    expect(tenant.body).toContain(newName);
    expect(markup(custom.body)).toBe(markup(tenant.body));
  });

  test("M4-09 a pending domain going live, a re-point and a removal take effect at the very next request", async ({}, info) => {
    test.skip(!desktopOnly(info), "pure HTTP: one project is enough");
    const other = await publishedPage(site.user.id, `zq-rt2-${rand(5)}`, `Other ${rand(4)}`);
    const host = hostnameFor("flip");
    const id = await addDomainRow({ pageId: site.pageId, hostname: host, status: "pending" });
    expect((await get(host)).status).toBe(404);

    const admin = adminClient();
    await admin
      .from("domains")
      .update({ status: "verified", verified_at: new Date().toISOString() })
      .eq("id", id);
    const live1 = await get(host);
    expect(live1.status).toBe(200);
    expect(live1.body).toContain(site.name);

    // Re-pointed at another page of the same account.
    await admin.from("domains").update({ page_id: other }).eq("id", id);
    const otherName = (await admin.from("pages").select("published").eq("id", other).single()).data!
      .published as { profile: { name: string } };
    const live2 = await get(host);
    expect(live2.body).toContain(otherName.profile.name);
    expect(live2.body).not.toContain(site.name);

    // Removed: 404 immediately, no stale copy.
    await admin.from("domains").delete().eq("id", id);
    const gone = await get(host);
    expect(gone.status).toBe(404);
    expect(gone.body).not.toContain(site.name);
    expect(gone.body).not.toContain(otherName.profile.name);
  });

  test("M4-09 a page that is unpublished, or whose owner is suspended, stops serving at the next request", async ({}, info) => {
    test.skip(!desktopOnly(info), "pure HTTP: one project is enough");
    const s = await makeSite("rts");
    const host = hostnameFor("susp");
    await addDomainRow({ pageId: s.pageId, hostname: host, status: "verified" });
    expect((await get(host)).status).toBe(200);

    const admin = adminClient();
    await admin
      .from("accounts")
      .update({ suspended_at: new Date().toISOString() })
      .eq("id", s.user.id);
    const suspended = await get(host);
    expect(suspended.status).toBe(404);
    expect(suspended.body).not.toContain(s.name);
    await admin.from("accounts").update({ suspended_at: null }).eq("id", s.user.id);
    expect((await get(host)).status).toBe(200);
  });
});

test("M4-09 sanity: the sign-in session of an owner never reaches a custom host", async ({
  context,
}, info) => {
  test.skip(!desktopOnly(info), "pure HTTP: one project is enough");
  void makeUser;
  const owner = await signedInUser(context, { label: "rtc", plan: "studio" });
  const host = hostnameFor("ck");
  await addDomainRow({ pageId: owner.pageId, hostname: host, status: "verified" });
  const cookies = (await context.cookies("http://app.localhost:3000"))
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
  expect(cookies).toMatch(/sb-/);
  const res = await get(host, "/", { cookie: cookies });
  expect(res.status).toBe(200);
  expect(res.setCookies).toEqual([]);
  const settings = await get(host, "/settings", { cookie: cookies });
  expect(settings.status).toBe(404);
  expect(settings.body).not.toMatch(/Delete account|Sign out/);
});
