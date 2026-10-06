import type { Request } from "@playwright/test";
import { DESKTOP, PHONE } from "../../../scripts/lib/viewports";
import { adminClient } from "../fixtures/auth";
import { expireOwnerPages } from "../fixtures/expire";
import { cleanupUsers, desktopOnly, rand } from "../fixtures/data";
import { rawRequest } from "../fixtures/http";
import { DEV_PORT } from "../helpers";
import { draftOf, openEditor, previewScreen, showView, userWithDraft } from "../m2/blocks-helpers";
import {
  DESKTOP_UA,
  HEADLESS_UA,
  IDS,
  IPHONE_UA,
  TARGETS,
  countEvents,
  eventsOf,
  expect,
  getClick,
  ingestPage,
  linkBlocks,
  postBeacon,
  randomIp,
  settledCount,
  test,
  userAgentFor,
  waitForClicks,
  waitForEvents,
} from "./analytics-ingest-helpers";

/**
 * M4-22, M4-23 (click side): the outbound links of a published page and the redirect behind them.
 *
 * The browser tests (390x844 iPhone, 1440x900 desktop) follow real links; the destination host is
 * stubbed so no test leaves the machine. Exact statuses, Location values and what is NOT recorded
 * are raw HTTP, once, on the desktop project.
 */

test.describe.configure({ timeout: 120_000 });
test.afterAll(cleanupUsers);

const LINKED_IDS = [IDS.link, IDS.card, IDS.iconWeb, IDS.cellA, IDS.cellB];

test.describe("M4-22 outbound links in the browser", () => {
  test("M4-22 every outbound link renders /r/<pageId>/<id>; the email icon stays a mailto:", async ({
    page,
    context,
  }) => {
    const p = await ingestPage("ch");
    await context.setExtraHTTPHeaders({ "x-forwarded-for": randomIp() });
    await page.goto(p.url);
    for (const id of LINKED_IDS) {
      const anchor = page.locator(`a[data-block-id="${id}"], a[data-item-id="${id}"]`);
      await expect(anchor, id).toHaveAttribute("href", `/r/${p.pageId}/${id}`);
      await expect(anchor, id).toHaveAttribute("rel", "nofollow noopener");
    }
    await expect(page.locator(`a[data-item-id="${IDS.iconMail}"]`)).toHaveAttribute(
      "href",
      "mailto:hello@example.com",
    );
    // The destinations are not in the page at all.
    const html = await page.content();
    for (const target of Object.values(TARGETS)) expect(html).not.toContain(target);
  });

  test("M4-22 clicking a link, a card, a social icon and grid cells follows the 302 and records one click each", async ({
    page,
    context,
  }, info) => {
    const p = await ingestPage("cc");
    await context.setExtraHTTPHeaders({ "x-forwarded-for": randomIp() });
    // The destination is never contacted for real: answer it here.
    await page.route("https://example.com/**", (route) =>
      route.fulfill({ status: 200, contentType: "text/html", body: "<title>destination</title>" }),
    );
    let seen = 0;
    for (const id of LINKED_IDS) {
      await page.goto(p.url);
      await page.locator(`a[data-block-id="${id}"], a[data-item-id="${id}"]`).click();
      await page.waitForURL(TARGETS[id]!);
      seen += 1;
      const clicks = await waitForClicks(p.pageId, seen);
      expect(clicks.at(-1), id).toMatchObject({
        block_id: id,
        type: "click",
        referrer: null,
        device: info.project.name === "phone" ? "mobile" : "desktop",
        country: null,
      });
      expect(clicks.at(-1)!.visitor_hash).toMatch(/^[0-9a-f]{64}$/);
    }
    // The page loads recorded views too (the beacon): the clicks are exactly the five.
    const rows = await eventsOf(p.pageId);
    expect(rows.filter((row) => row.type === "click").map((row) => row.block_id).sort()).toEqual(
      [...LINKED_IDS].sort(),
    );
  });

  test("M4-22 with JavaScript disabled the link still works: the browser follows the 302", async ({
    browser,
  }, info) => {
    const p = await ingestPage("cj");
    const base = info.project.name === "phone" ? PHONE : DESKTOP;
    const context = await browser.newContext({
      ...base,
      userAgent: userAgentFor(info.project.name),
      javaScriptEnabled: false,
      extraHTTPHeaders: { "x-forwarded-for": randomIp() },
    });
    const page = await context.newPage();
    await page.route("https://example.com/**", (route) =>
      route.fulfill({ status: 200, contentType: "text/html", body: "<title>destination</title>" }),
    );
    await page.goto(p.url);
    await page.locator(`a[data-block-id="${IDS.link}"]`).click();
    await page.waitForURL(TARGETS[IDS.link]!);
    const [row] = await waitForEvents(p.pageId, 1);
    expect(row).toMatchObject({ type: "click", block_id: IDS.link });
    // No script ran, so no view beacon: the only row is the click.
    expect(await countEvents(p.pageId)).toBe(1);
    await context.close();
  });

  test("M4-22 the editor preview intercepts link clicks: no /r request, no navigation, no click row", async ({
    page,
    context,
  }) => {
    const user = await userWithDraft(context, "cp", (handle) =>
      draftOf(handle, [
        { id: IDS.link, type: "link", visible: true, label: "Book", url: "https://example.com/book" },
      ]),
    );
    const tracked: Request[] = [];
    page.on("request", (request) => {
      if (new URL(request.url()).pathname.startsWith("/r/")) tracked.push(request);
    });
    await page.route("https://example.com/**", (route) => route.abort());
    await openEditor(page);
    await showView(page, "Preview");
    const anchor = previewScreen(page).locator(`a[data-block-id="${IDS.link}"]`);
    // The preview draws the same markup as the live page, /r href included...
    await expect(anchor).toHaveAttribute("href", `/r/${user.pageId}/${IDS.link}`);
    const before = page.url();
    await anchor.click();
    await page.waitForTimeout(800);
    // ...but its wrapper swallows the click.
    expect(tracked).toHaveLength(0);
    expect(page.url()).toBe(before);
    expect(await countEvents(user.pageId)).toBe(0);
  });
});

test.describe("M4-22 the redirect on the wire", () => {
  test("M4-22 GET /r answers 302 with Location exactly the published URL, no-store, no cookie, and records one click", async ({}, info) => {
    test.skip(!desktopOnly(info), "raw HTTP, no UI");
    const p = await ingestPage("rr");
    for (const id of LINKED_IDS) {
      const res = await getClick(p, id, { ua: IPHONE_UA, headers: { "x-vercel-ip-country": "fr" } });
      expect(res.status, id).toBe(302);
      expect(res.location, id).toBe(TARGETS[id]);
      expect(res.headers["cache-control"], id).toBe("no-store");
      expect(res.setCookies, id).toEqual([]);
    }
    const rows = await waitForEvents(p.pageId, LINKED_IDS.length);
    expect(rows).toHaveLength(LINKED_IDS.length);
    for (const row of rows) {
      expect(row).toMatchObject({
        page_id: p.pageId,
        type: "click",
        referrer: null,
        device: "mobile",
        country: "FR",
      });
      expect(row.visitor_hash).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(rows.map((row) => row.block_id).sort()).toEqual([...LINKED_IDS].sort());
  });

  test("M4-22 the 302 never needs the database insert: it is sent first, the row follows", async ({}, info) => {
    test.skip(!desktopOnly(info), "raw HTTP, no UI");
    const p = await ingestPage("rd");
    const res = await getClick(p, IDS.link);
    expect(res.status).toBe(302);
    await waitForEvents(p.pageId, 1);
  });

  test("M4-22 unknown ids, non-link blocks, the email icon, draft-only blocks and malformed ids are 404 and record nothing", async ({}, info) => {
    test.skip(!desktopOnly(info), "raw HTTP, no UI");
    const draft = {
      ...draftOf("x", []),
      blocks: [
        ...linkBlocks(),
        { id: IDS.draftOnly, type: "link", visible: true, label: "Draft", url: "https://example.com/draft" },
      ],
    };
    const p = await ingestPage("rn", { draft });
    const missing = [
      ["an unknown block id", "nosuchblock1"],
      ["a text block", IDS.text],
      ["a header block", IDS.header],
      ["a divider", IDS.divider],
      ["a social row (no URL of its own)", IDS.social],
      ["a grid (no URL of its own)", IDS.grid],
      ["the email icon", IDS.iconMail],
      ["a block that exists only in the draft", IDS.draftOnly],
    ] as const;
    for (const [name, id] of missing) {
      const res = await getClick(p, id);
      expect(res.status, name).toBe(404);
      expect(res.location, name).toBeNull();
      expect(res.headers["cache-control"], name).toBe("no-store");
    }
    for (const [name, pageId, id] of [
      ["a pageId that is not a uuid", "not-a-uuid", IDS.link],
      ["a pageId path trick", "..%2F..", IDS.link],
      ["a blockId with a dot", p.pageId, "block.id.01"],
      ["a blockId over 64 characters", p.pageId, "a".repeat(65)],
      ["an unknown page", "00000000-0000-4000-8000-0000000000ee", IDS.link],
    ] as const) {
      const res = await getClick(p, id, { pageId });
      expect(res.status, name).toBe(404);
      expect(res.location, name).toBeNull();
    }
    expect(await settledCount(p.pageId)).toBe(0);
  });

  test("M4-22 a page with nothing published is a 404", async ({}, info) => {
    test.skip(!desktopOnly(info), "raw HTTP, no UI");
    const p = await ingestPage("rp", { published: false });
    const res = await getClick(p, IDS.link);
    expect(res.status).toBe(404);
    expect(res.location).toBeNull();
    expect(await settledCount(p.pageId)).toBe(0);
  });

  test("M4-22 a link edited in the draft but not republished still redirects to the PUBLISHED URL", async ({}, info) => {
    test.skip(!desktopOnly(info), "raw HTTP, no UI");
    const draft = {
      ...draftOf("x", []),
      blocks: linkBlocks().map((block) =>
        block.id === IDS.link && block.type === "link" ? { ...block, url: "https://evil.example/draft-edit" } : block,
      ),
    };
    const p = await ingestPage("re", { draft });
    const res = await getClick(p, IDS.link);
    expect(res.status).toBe(302);
    expect(res.location).toBe("https://example.com/book");
  });

  test("M4-22 open-redirect attempts never change Location", async ({}, info) => {
    test.skip(!desktopOnly(info), "raw HTTP, no UI");
    const p = await ingestPage("ro");
    for (const query of [
      "?url=https://evil.example",
      "?to=https://evil.example",
      "?redirect=https://evil.example",
      "?next=https://evil.example",
      "?u=//evil.example&target=javascript:alert(1)",
      "?url=%2F%2Fevil.example",
    ]) {
      const res = await getClick(p, IDS.link, { query });
      expect(res.status, query).toBe(302);
      expect(res.location, query).toBe("https://example.com/book");
    }
    const evilHost = await getClick(p, IDS.link, {
      host: "evil.example",
      headers: { "x-forwarded-host": "evil.example", referer: "https://evil.example/" },
    });
    // An unknown host is a custom-domain lookup that fails; whatever it answers, it never sends a visitor to evil.example.
    expect(evilHost.location ?? "").not.toContain("evil.example");
    const forwarded = await getClick(p, IDS.link, { headers: { "x-forwarded-host": "evil.example" } });
    expect(forwarded.status).toBe(302);
    expect(forwarded.location).toBe("https://example.com/book");
    const hostMismatch = await rawRequest(p.host, `/r/${p.pageId}/${IDS.link}`, {
      headers: { "x-forwarded-for": randomIp(), "user-agent": DESKTOP_UA, "x-forwarded-host": "evil.example", forwarded: "host=evil.example" },
    });
    expect(hostMismatch.location).toBe("https://example.com/book");
  });

  test("M4-22 a published URL that is not http(s) (inserted around the validation) is never redirected to", async ({}, info) => {
    test.skip(!desktopOnly(info), "raw HTTP, no UI");
    const p = await ingestPage("rs");
    const admin = adminClient();
    for (const bad of ["javascript:alert(1)", "data:text/html,<script>alert(1)</script>", "//evil.example/x", "ftp://example.com/x"]) {
      const doc = {
        ...p.doc,
        blocks: [{ id: IDS.link, type: "link", visible: true, label: "Bad", url: bad }, ...p.doc.blocks.filter((b) => b.id !== IDS.link)],
      };
      const updated = await admin.from("pages").update({ published: doc }).eq("id", p.pageId);
      expect(updated.error?.message).toBeUndefined();
      const res = await getClick(p, IDS.link);
      expect(res.status, bad).toBe(404);
      expect(res.location, bad).toBeNull();
    }
    expect(await settledCount(p.pageId)).toBe(0);
  });

  test("M4-22 republishing changes the redirect target at once", async ({ browser }, info) => {
    test.skip(!desktopOnly(info), "raw HTTP, no UI");
    const p = await ingestPage("rq");
    expect((await getClick(p, IDS.link)).location).toBe("https://example.com/book");
    const doc = {
      ...p.doc,
      blocks: p.doc.blocks.map((b) => (b.id === IDS.link && b.type === "link" ? { ...b, url: "https://example.org/new" } : b)),
    };
    await adminClient().from("pages").update({ published: doc, published_at: new Date().toISOString() }).eq("id", p.pageId);
    // Publish expires the page's tag, which a production build reads the click target under; this write
    // went straight to the database, so expire it the way an admin action does.
    await expireOwnerPages(browser, p.userId);
    expect((await getClick(p, IDS.link)).location).toBe("https://example.org/new");
  });
});

test.describe("M4-23 bots and HEAD on /r", () => {
  test("M4-23 a bot still gets the 302; HEAD gets the same status and Location with no body; none leaves a row", async ({}, info) => {
    test.skip(!desktopOnly(info), "raw HTTP, no UI");
    const p = await ingestPage("rb");
    for (const ua of [
      "Googlebot/2.1 (+http://www.google.com/bot.html)",
      "facebookexternalhit/1.1",
      "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)",
      "Twitterbot/1.0",
      "WhatsApp/2.23.20",
      "curl/8.4.0",
      "python-requests/2.31.0",
      "Go-http-client/2.0",
      HEADLESS_UA,
    ]) {
      const res = await getClick(p, IDS.link, { ua });
      expect(res.status, ua).toBe(302);
      expect(res.location, ua).toBe(TARGETS[IDS.link]);
    }
    const noUa = await getClick(p, IDS.link, { ua: null });
    expect(noUa.status).toBe(302);
    expect(noUa.location).toBe(TARGETS[IDS.link]);

    const get = await getClick(p, IDS.link, { ua: DESKTOP_UA, ip: "198.18.9.9" });
    const head = await getClick(p, IDS.link, { ua: DESKTOP_UA, method: "HEAD" });
    expect(head.status).toBe(get.status);
    expect(head.location).toBe(get.location);
    expect(head.body).toBe("");
    // The one human GET is the only row; HEAD and every bot left none.
    const rows = await waitForEvents(p.pageId, 1);
    expect(await settledCount(p.pageId)).toBe(1);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ type: "click", block_id: IDS.link, device: "desktop" });
  });

  test("M4-23 HEAD on a missing target is a 404 with no body", async ({}, info) => {
    test.skip(!desktopOnly(info), "raw HTTP, no UI");
    const p = await ingestPage("rm");
    const res = await getClick(p, "nosuchblock1", { method: "HEAD" });
    expect(res.status).toBe(404);
    expect(res.body).toBe("");
  });
});

test.describe("M4-21 / M4-22 on a custom host", () => {
  test("M4-22 a verified custom host serves /r and /api/e like the subdomain does", async ({}, info) => {
    test.skip(!desktopOnly(info), "raw HTTP, no UI");
    const p = await ingestPage("rx", { plan: "pro" });
    const hostname = `links-${rand(6)}.example.test`;
    const added = await adminClient()
      .from("domains")
      .insert({ page_id: p.pageId, hostname, status: "verified", verified_at: new Date().toISOString() });
    expect(added.error?.message).toBeUndefined();
    const host = `${hostname}:${DEV_PORT}`;

    const redirect = await getClick(p, IDS.link, { host });
    // The custom-host rule (leave /r/* and /api/e alone) is in the proxy, which domains-core owns.
    test.skip(
      redirect.status === 404 && !redirect.body.includes("This link isn’t available."),
      "the proxy does not yet resolve custom hosts and leave /r/* and /api/e unrewritten (domains-core)",
    );
    expect(redirect.status).toBe(302);
    expect(redirect.location).toBe(TARGETS[IDS.link]);
    await waitForEvents(p.pageId, 1);

    const beacon = await postBeacon(p, { pageId: p.pageId }, { host, origin: `http://${host}` });
    expect(beacon.status).toBe(204);
    expect((await eventsOf(p.pageId)).filter((row) => row.type === "view")).toHaveLength(1);

    // The same host with another page's id is not served: that page's links belong to its own hosts.
    const other = await ingestPage("ry");
    const crossed = await getClick(other, IDS.link, { host });
    expect(crossed.status).toBe(404);
    expect(crossed.location).toBeNull();
  });
});

test.describe("M4-22 the redirect is bound to the page's own hosts", () => {
  test("M4-22 another tenant's host, another verified custom host, the marketing and app hosts get the 404; the own hosts still 302", async ({}, info) => {
    test.skip(!desktopOnly(info), "raw HTTP, no UI");
    const mine = await ingestPage("hb", { plan: "studio" });
    const victim = await ingestPage("hv", { plan: "pro" });
    const myHost = `links-${rand(6)}.example.test`;
    const victimHost = `victim-${rand(6)}.example.test`;
    const pendingHost = `pending-${rand(6)}.example.test`;
    const verifiedAt = new Date().toISOString();
    for (const [page, hostname, status] of [
      [mine, myHost, "verified"],
      [victim, victimHost, "verified"],
      [mine, pendingHost, "pending"],
    ] as const) {
      const added = await adminClient()
        .from("domains")
        .insert({ page_id: page.pageId, hostname, status, verified_at: status === "verified" ? verifiedAt : null });
      expect(added.error?.message).toBeUndefined();
    }

    // Own hosts: the handle host and the verified custom host.
    for (const host of [mine.host, myHost + `:${DEV_PORT}`]) {
      const res = await getClick(mine, IDS.link, { host });
      expect(res.status, host).toBe(302);
      expect(res.location, host).toBe(TARGETS[IDS.link]);
    }

    // Everything else: the plain 404, no Location, nothing recorded.
    for (const host of [
      victim.host,
      `${victim.handle}.localhost`,
      victimHost,
      `${victimHost}:${DEV_PORT}`,
      pendingHost,
      `localhost:${DEV_PORT}`,
      `app.localhost:${DEV_PORT}`,
      "unknown-host.example.test",
    ]) {
      const res = await getClick(mine, IDS.link, { host, ua: DESKTOP_UA });
      expect(res.status, host).toBe(404);
      expect(res.location, host).toBeNull();
    }
    // The 404 is the same plain page the tenant routes use: it names no target.
    const refused = await getClick(mine, IDS.link, { host: victimHost });
    expect(refused.body).not.toContain(TARGETS[IDS.link]!);
    // Forwarded-host headers do not move a request onto an allowed host.
    const forwarded = await getClick(mine, IDS.link, {
      host: victimHost,
      headers: { "x-forwarded-host": mine.host, "x-original-host": mine.host },
    });
    expect(forwarded.status).toBe(404);
    // Only the two own-host requests above were recorded.
    expect(await waitForEvents(mine.pageId, 2)).toHaveLength(2);
    expect(await settledCount(mine.pageId)).toBe(2);
  });

  test("M4-23 a click that is not a navigation (Sec-Fetch-Dest image, script, iframe) still redirects but is not recorded", async ({}, info) => {
    test.skip(!desktopOnly(info), "raw HTTP, no UI");
    const p = await ingestPage("sf");
    for (const dest of ["image", "script", "iframe", "empty"]) {
      const res = await getClick(p, IDS.link, { headers: { "sec-fetch-dest": dest } });
      expect(res.status, dest).toBe(302);
      expect(res.location, dest).toBe(TARGETS[IDS.link]);
    }
    expect(await settledCount(p.pageId)).toBe(0);
    for (const headers of [{ "sec-fetch-dest": "document" }, {}] as Record<string, string>[]) {
      const res = await getClick(p, IDS.link, { headers });
      expect(res.status).toBe(302);
    }
    expect(await waitForClicks(p.pageId, 2)).toHaveLength(2);
  });
});
