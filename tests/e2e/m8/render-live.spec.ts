import { expect, test } from "@playwright/test";
import { adminClient } from "../fixtures/auth";
import { cleanupUsers, desktopOnly, rand } from "../fixtures/data";
import { emptyUser } from "../m2/editor-helpers";
import { expectNoHorizontalScroll, expectTapTargets } from "../helpers";
import {
  FRAMEWORK_MARKERS,
  armFailure,
  bodyOf,
  customHostOf,
  getCustom,
  getTenant,
  link,
  liveUser,
  rawBuffer,
  SERVER_PORT,
  tenantUrl,
} from "./render-helpers";

/**
 * M8-02 and M8-03: the live page and every state a tenant host answers are finished HTML built by
 * the route handlers in src/app/(tenant): no framework runtime, no `/_next/` URL, one script on a
 * published page and none anywhere else, the same bytes on a handle host and a custom host, GET and
 * HEAD only. Runs against the shared dev server, or a production build with HL_PROD_PORT.
 */

test.afterAll(cleanupUsers);
test.describe.configure({ timeout: 120_000 });

const NO_FRAMEWORK = (html: string, label: string) => {
  for (const marker of FRAMEWORK_MARKERS) expect(html, `${label}: ${marker}`).not.toContain(marker);
};

const scriptCount = (html: string) => (html.match(/<script/g) ?? []).length;

test.describe("M8-02 the published page is finished HTML", () => {
  test("M8-02 a handle host answers one complete document with one deferred script and no framework", async ({ context }, info) => {
    test.skip(!desktopOnly(info), "HTTP-level");
    const user = await liveUser(context, "lv1", {
      blocks: [link("lnk-lv1-0001", "Book now"), link("lnk-lv1-0002", "Prices")],
    });
    const res = await getTenant(user.handle);
    expect(res.status).toBe(200);
    expect(String(res.headers["content-type"])).toBe("text/html; charset=utf-8");
    const html = res.text;
    expect(html.startsWith('<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">')).toBe(true);
    NO_FRAMEWORK(html, "page");
    expect(html).not.toMatch(/<link[^>]+rel="stylesheet"/);
    expect(scriptCount(html)).toBe(1);
    expect(html).toMatch(/<script src="\/_t\/p\.[0-9a-f]{12}\.js"[^>]* data-page-id="[0-9a-f-]{36}" defer><\/script>/);
    expect((html.match(/<style>/g) ?? []).length).toBe(1);
    expect(html).toContain(`<title>Zq lv1 - links</title>`);
    expect(html).toContain('<meta name="description" content="Bio of lv1">');
    expect(html).toContain(`<meta property="og:url" content="http://${user.handle}.localhost:${SERVER_PORT}/">`);
    expect(html).toContain("Made with HYDLNK");
    expect(html).toContain("Report this page");
    // Neither response sets a cookie.
    expect(res.headers["set-cookie"]).toBeUndefined();
  });

  test("M8-02 the same page on a verified custom host is the same <body> bytes, with og:url naming that host", async ({ context }, info) => {
    test.skip(!desktopOnly(info), "HTTP-level");
    const user = await liveUser(context, "lv2", { plan: "studio" });
    const host = await customHostOf(user.pageId);
    const onHandle = await getTenant(user.handle);
    const onCustom = await getCustom(host);
    expect(onCustom.status).toBe(200);
    expect(bodyOf(onCustom.text)).toBe(bodyOf(onHandle.text));
    expect(onCustom.text).toContain(`<meta property="og:url" content="http://${host}:${SERVER_PORT}/">`);
    expect(onCustom.text).toContain(`http://${host}:${SERVER_PORT}/og?v=`);
    // The og:image URL answers on that host.
    const og = await getCustom(host, "/og");
    expect(og.status).toBe(200);
    expect(String(og.headers["content-type"])).toBe("image/png");
  });

  test("M8-02 GET and HEAD only: HEAD has the status and headers of GET and no body; every other method is 405", async ({ context }, info) => {
    test.skip(!desktopOnly(info), "HTTP-level");
    const user = await liveUser(context, "lv3", { plan: "studio" });
    const host = await customHostOf(user.pageId);
    for (const send of [
      (method: string) => rawBuffer(`${user.handle}.localhost:${SERVER_PORT}`, "/", { method }),
      (method: string) => getCustom(host, "/", { method }),
    ]) {
      const get = await send("GET");
      const head = await send("HEAD");
      expect(head.status).toBe(get.status);
      expect(head.body.length).toBe(0);
      for (const name of ["content-type", "content-security-policy", "x-frame-options", "x-content-type-options"]) {
        expect(head.headers[name], name).toBe(get.headers[name]);
      }
      for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
        const res = await send(method);
        expect(res.status, method).toBe(405);
        expect(res.headers.allow, method).toBe("GET, HEAD");
        expect(res.text, method).not.toContain("data-page-root");
      }
    }
  });

  test("M8-02 one document for every visitor: cookies, user agents and an RSC header change nothing, and nothing of the draft shows", async ({ context }, info) => {
    test.skip(!desktopOnly(info), "HTTP-level");
    const user = await liveUser(context, "lv4");
    // A draft edit that is not published.
    const draft = JSON.parse(JSON.stringify(user.draft));
    draft.profile.bio = "DRAFT-ONLY-BIO-zq";
    draft.blocks.push(link("lnk-lv4-draft", "DRAFT-ONLY-LINK-zq"));
    await adminClient().from("pages").update({ draft }).eq("id", user.pageId);

    const plain = await getTenant(user.handle);
    const variants: Array<Record<string, string>> = [
      { cookie: "sb-localhost-auth-token=%7B%22access_token%22%3A%22x%22%7D" },
      { "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)" },
      { "accept-language": "de-DE,de;q=0.9" },
      { authorization: "Bearer not-a-real-token" },
      { "x-forwarded-for": "203.0.113.9" },
      { "next-router-state-tree": "%5B%22%22%5D", "next-router-prefetch": "1" },
    ];
    for (const headers of variants) {
      const res = await getTenant(user.handle, "/", headers);
      expect(res.status, JSON.stringify(headers)).toBe(200);
      expect(res.text, JSON.stringify(headers)).toBe(plain.text);
      expect(res.headers["set-cookie"], JSON.stringify(headers)).toBeUndefined();
      expect(String(res.headers.vary ?? "").toLowerCase(), JSON.stringify(headers)).not.toMatch(/cookie|user-agent|accept-language|authorization/);
    }
    expect(plain.text).not.toContain("DRAFT-ONLY");
    // A request with the header RSC: 1 never gets a flight payload any more: it is the same HTML (Next.js
    // first answers such a request with a 307 to `?_rsc`, which carries no body, and the redirect target is the page).
    const rsc = await getTenant(user.handle, "/", { rsc: "1" });
    expect([200, 307]).toContain(rsc.status);
    expect(String(rsc.headers["content-type"] ?? "")).not.toContain("text/x-component");
    expect(rsc.text).not.toContain("DRAFT-ONLY");
    const settled = rsc.status === 307 ? await getTenant(user.handle, String(rsc.headers.location), { rsc: "1" }) : rsc;
    expect(settled.status).toBe(200);
    expect(settled.text).toBe(plain.text);
    NO_FRAMEWORK(settled.text, "rsc");
    // The query string is not part of the page.
    const queried = await getTenant(user.handle, "/?utm_source=a&x=1");
    expect(queried.text).toBe(plain.text);
  });

  test("M8-02 /t/{handle} and /sites/{pageId} typed directly are 404 on every kind of host", async ({ context }, info) => {
    test.skip(!desktopOnly(info), "HTTP-level");
    const user = await liveUser(context, "lv5", { plan: "studio" });
    const host = await customHostOf(user.pageId);
    const attempts: Array<[string, string]> = [
      [`${user.handle}.localhost:${SERVER_PORT}`, `/t/${user.handle}`],
      [`${user.handle}.localhost:${SERVER_PORT}`, `/sites/${user.pageId}`],
      [`localhost:${SERVER_PORT}`, `/t/${user.handle}`],
      [`localhost:${SERVER_PORT}`, `/sites/${user.pageId}`],
      [`${host}:${SERVER_PORT}`, `/t/${user.handle}`],
      [`${host}:${SERVER_PORT}`, `/sites/${user.pageId}`],
    ];
    for (const [target, path] of attempts) {
      const res = await rawBuffer(target, path);
      expect(res.status, `${target}${path}`).toBe(404);
      expect(res.text, `${target}${path}`).not.toContain("data-page-root");
      expect(res.text, `${target}${path}`).not.toContain(user.draft.profile.name);
    }
  });

  test("M8-02 a pending domain, a *.vercel.app host and an unknown host are the plain 404 with no tenant data", async ({ context }, info) => {
    test.skip(!desktopOnly(info), "HTTP-level");
    const user = await liveUser(context, "lv6", { plan: "studio" });
    const hosts = [
      `zq-pend-${rand(5)}.example.test`,
      `zq-${rand(6)}.vercel.app`,
      `nobody-${rand(6)}.example.org`,
    ];
    await (await import("../m4/domains-core-helpers")).addDomainRow({
      pageId: user.pageId,
      hostname: hosts[0]!,
      status: "pending",
    });
    for (const host of hosts) {
      const res = await getCustom(host);
      expect(res.text, host).not.toContain(user.draft.profile.name);
      expect(res.text, host).not.toContain(user.handle);
      // A deployment host serves the marketing site (which draws demo pages of its own), never a tenant's page (M4-09).
      if (host.endsWith(".vercel.app")) continue;
      expect(res.text, host).not.toContain("data-page-root");
      expect(res.status, host).toBe(404);
      expect(res.text, host).toContain("Page not found");
    }
  });
});

test.describe("M8-03 every state a tenant host answers is plain finished HTML", () => {
  test("M8-03 a crawl of every state: no framework, no /_next/, no script (the page alone has one)", async ({ context }, info) => {
    test.skip(!desktopOnly(info), "HTTP-level");
    const published = await liveUser(context, "cr1");
    const placeholder = await emptyUser(context, "cr2");
    const suspended = await liveUser(context, "cr3");
    await adminClient()
      .from("accounts")
      .update({ suspended_at: new Date().toISOString() })
      .eq("id", suspended.id);
    const unclaimed = `zq-nobody-${rand(6)}`;
    const states: Array<[string, () => Promise<{ status: number; text: string }>, number, number]> = [
      ["a published page", () => getTenant(published.handle), 200, 1],
      ["a claimed handle with nothing published", () => getTenant(placeholder.handle), 200, 0],
      ["an unclaimed handle", () => getTenant(unclaimed), 404, 0],
      ["a reserved handle", () => rawBuffer(`admin.localhost:${SERVER_PORT}`, "/"), 404, 0],
      ["an invalid handle", () => rawBuffer(`ab.localhost:${SERVER_PORT}`, "/"), 404, 0],
      ["a suspended owner", () => getTenant(suspended.handle), 404, 0],
      ["/anything", () => getTenant(published.handle, "/anything"), 404, 0],
      ["/a/b/c", () => getTenant(published.handle, "/a/b/c"), 404, 0],
      ["a custom host with no domains row", () => getCustom(`nobody-${rand(6)}.example.org`, "/sites/unknown"), 404, 0],
    ];
    for (const [label, get, status, scripts] of states) {
      const res = await get();
      expect(res.status, label).toBe(status);
      NO_FRAMEWORK(res.text, label);
      expect(scriptCount(res.text), `${label}: <script> elements`).toBe(scripts);
      expect(res.text, label).not.toMatch(/<link[^>]+rel="stylesheet"/);
      if (status === 404) expect(res.text, label).toMatch(/<meta name="robots" content="noindex">/);
    }

    // A 500: one failed read, if the server was started with the test flag.
    const failing = `zq-failing-${rand(5)}`;
    if (await armFailure(failing)) {
      const res = await getTenant(failing);
      expect(res.status).toBe(500);
      NO_FRAMEWORK(res.text, "the 500");
      expect(scriptCount(res.text)).toBe(0);
      expect(res.text).toContain("Something went wrong. Try again.");
    }
  });

  test("M8-03 claimed but unpublished: 200, the handle as the one h1, noindex, no script, no request but the document and the favicon", async ({ context, page }) => {
    const user = await emptyUser(context, "ph1");
    const requests: string[] = [];
    page.on("request", (request) => requests.push(new URL(request.url()).pathname));
    const response = await page.goto(tenantUrl(user.handle));
    expect(response?.status()).toBe(200);
    await page.waitForLoadState("networkidle");
    expect(await page.title()).toBe(`${user.handle}.hydlnk.com`);
    await expect(page.locator("h1")).toHaveCount(1);
    await expect(page.locator("h1")).toHaveText(user.handle);
    await expect(page.getByText("Nothing published here yet.")).toBeVisible();
    expect(await page.locator('meta[name="robots"]').getAttribute("content")).toBe("noindex");
    expect(await page.locator("script").count()).toBe(0);
    expect(requests.filter((path) => path !== "/icon.svg" && path !== "/")).toEqual([]);
    const html = await page.content();
    expect(html).not.toContain("--hl-");
    expect(await page.locator(".tenant-root").getAttribute("style")).toContain("--t-bg");
    await expectNoHorizontalScroll(page);
  });

  test("M8-03 the 404 panels: copy, links, status and no echo of an invalid address", async ({ page }) => {
    const unclaimed = `zq-free-${rand(5)}`;
    let response = await page.goto(tenantUrl(unclaimed));
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("This address isn’t claimed.");
    const claim = page.getByRole("link", { name: `Claim ${unclaimed}` });
    await expect(claim).toHaveAttribute("href", new RegExp(`/signup\\?handle=${unclaimed}$`));
    await expect(page.getByRole("link", { name: "Go to hydlnk.com" })).toBeVisible();
    expect(await page.locator('meta[name="robots"]').getAttribute("content")).toBe("noindex");
    expect(await page.locator("script").count()).toBe(0);

    response = await page.goto(`http://admin.localhost:${SERVER_PORT}/`);
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("That address is reserved.");
    await expect(page.getByRole("link", { name: /Claim/ })).toHaveCount(0);

    response = await page.goto(`http://ab.localhost:${SERVER_PORT}/`);
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("That address isn’t valid.");
    expect(await page.content()).not.toMatch(/>ab</);

    response = await page.goto(tenantUrl("mara", "/anything"));
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Page not found");
    await expect(page.getByText("This page doesn’t exist or hasn’t been published yet.")).toBeVisible();
  });

  test("M8-03 a suspended owner's page is the 404 'This page isn’t available.' on a handle host and on a custom host, with nothing of the page", async ({ context }, info) => {
    test.skip(!desktopOnly(info), "HTTP-level");
    const owner = await liveUser(context, "sp1", { bio: "SECRET-BIO-zq", plan: "studio" });
    const host = await customHostOf(owner.pageId);
    await adminClient()
      .from("accounts")
      .update({ suspended_at: new Date().toISOString() })
      .eq("id", owner.id);
    for (const get of [() => getTenant(owner.handle), () => getCustom(host)]) {
      const res = await get();
      expect(res.status).toBe(404);
      expect(res.text).toContain("This page isn’t available.");
      expect(res.text).toContain("It has been taken offline.");
      expect(res.text).not.toContain("SECRET-BIO-zq");
      expect(res.text).not.toContain(owner.draft.profile.name);
      expect(res.text).not.toContain("Claim");
      for (const tag of ['property="og:', 'name="twitter:', 'name="description"']) {
        expect(res.text).not.toContain(tag);
      }
    }
  });
});

test.describe("M8-02 and M8-03 layout at 390x844 and 1440x900", () => {
  test("M8-02 the live page: no horizontal scroll, 44px tap targets, a centered column of at most 480px, the background fills the viewport", async ({ context, page }, info) => {
    const user = await liveUser(context, "ly1", {
      blocks: [link("lnk-ly1-0001", "Book now"), link("lnk-ly1-0002", "Prices and packages")],
    });
    const response = await page.goto(tenantUrl(user.handle));
    expect(response?.status()).toBe(200);
    await expectNoHorizontalScroll(page);
    await expectTapTargets(page);
    const column = await page.locator(".pg-column").boundingBox();
    const viewport = page.viewportSize()!;
    if (viewport.width >= 1000) {
      expect(column!.width).toBeLessThanOrEqual(480);
      expect(Math.abs(column!.x + column!.width / 2 - viewport.width / 2)).toBeLessThan(4);
    } else {
      expect(column!.width).toBeLessThanOrEqual(viewport.width);
    }
    const root = await page.locator("[data-page-root]").boundingBox();
    expect(root!.width).toBeGreaterThanOrEqual(viewport.width - 1);
    expect(root!.height).toBeGreaterThanOrEqual(viewport.height - 1);
    // The badge and the report link are tappable and do not overlap.
    const links = await page.locator(".pg-footer-link").all();
    expect(links.length).toBe(2);
    const [a, b] = await Promise.all(links.map((el) => el.boundingBox()));
    const overlap = !(a!.x + a!.width <= b!.x || b!.x + b!.width <= a!.x || a!.y + a!.height <= b!.y || b!.y + b!.height <= a!.y);
    expect(overlap).toBe(false);
    expect(info.project.name).toMatch(/phone|desktop/);
  });

  test("M8-02 with JavaScript off every block is visible, links follow /r/, and the report link is there", async ({ browser, context }) => {
    const user = await liveUser(context, "js1", {
      blocks: [link("lnk-js1-0001", "Book now", "https://example.com/booking")],
    });
    const offline = await browser.newContext({ javaScriptEnabled: false });
    const page = await offline.newPage();
    await page.goto(tenantUrl(user.handle));
    await expect(page.getByRole("link", { name: "Book now" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Report this page" })).toBeVisible();
    const href = await page.getByRole("link", { name: "Book now" }).getAttribute("href");
    expect(href).toBe(`/r/${user.pageId}/lnk-js1-0001`);
    const res = await rawBuffer(`${user.handle}.localhost:${SERVER_PORT}`, href!);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("https://example.com/booking");
    await offline.close();
  });

  test("M8-03 each panel is a centered column with no horizontal scroll and links at least 44px tall", async ({ page }) => {
    for (const target of [
      tenantUrl(`zq-panel-${rand(5)}`),
      `http://admin.localhost:${SERVER_PORT}/`,
      `http://ab.localhost:${SERVER_PORT}/`,
      tenantUrl("mara", "/anything"),
    ]) {
      await page.goto(target);
      await expectNoHorizontalScroll(page);
      await expectTapTargets(page);
      const h1 = await page.getByRole("heading", { level: 1 }).boundingBox();
      const width = page.viewportSize()!.width;
      expect(Math.abs(h1!.x + h1!.width / 2 - width / 2), target).toBeLessThan(12);
    }
  });
});

test.describe("M8-03 a failure is the 500 panel", () => {
  test.describe.configure({ mode: "serial" });
  test("M8-03 with one failed read: status 500, no-store, noindex, the sentence, a reference; the next request is normal", async ({ context }, info) => {
    test.skip(!desktopOnly(info), "one failure at a time");
    const user = await liveUser(context, "fl1");
    // The hook only exists on a server started with HYDLNK_QUERY_COUNTER=1 (the production-build harness).
    test.skip(!(await armFailure(user.handle)), "start the server with HYDLNK_QUERY_COUNTER=1");
    const res = await getTenant(user.handle);
    expect(res.status).toBe(500);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.text).toMatch(/<meta name="robots" content="noindex">/);
    expect(res.text).toContain("Something went wrong. Try again.");
    expect(res.text).toMatch(/Reference: [a-z0-9]{8}/);
    expect(res.text).not.toMatch(/ECONN|Injected|Error:|at \S+ \(/);
    expect(res.text).not.toContain(user.draft.profile.name);
    NO_FRAMEWORK(res.text, "the 500");
    expect(scriptCount(res.text)).toBe(0);

    // The next request after the failure serves the page (the failed entry is expired a few milliseconds after
    // the response is sent; see src/lib/tenant-render/failure.ts).
    await new Promise((resolve) => setTimeout(resolve, 200));
    const next = await getTenant(user.handle);
    expect(next.status).toBe(200);
    expect(next.text).toContain(user.draft.profile.name);
  });

  test("M8-03 in a browser the Retry control is a plain link to the same URL and works with scripts blocked", async ({ context, page }, info) => {
    test.skip(!desktopOnly(info), "one failure at a time");
    const user = await liveUser(context, "fl2", { blocks: [link("lnk-fl2-0001", "Book now")] });
    test.skip(!(await armFailure(user.handle)), "start the server with HYDLNK_QUERY_COUNTER=1");
    await page.route("**/*.js", (route) => route.abort());
    const response = await page.goto(tenantUrl(user.handle));
    expect(response?.status()).toBe(500);
    await expect(page.getByTestId("error-message")).toHaveText("Something went wrong. Try again.");
    await expect(page.getByTestId("error-reference")).toHaveText(/^Reference: [a-z0-9]{8}$/);
    const retry = page.getByRole("link", { name: "Retry" });
    await expect(retry).toHaveAttribute("href", "");
    expect((await retry.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await expectNoHorizontalScroll(page);
    await retry.click();
    await expect(page.getByRole("link", { name: "Book now" })).toBeVisible();
  });
});
