import { chromium, expect, test } from "@playwright/test";
import { adminClient } from "../fixtures/auth";
import { cleanupUsers, desktopOnly } from "../fixtures/data";
import { expireOwnerPages } from "../fixtures/expire";
import { expectNoHorizontalScroll, expectTapTargets } from "../helpers";
import { PRODUCTION_BUILD } from "../fixtures/http";
import { addDomainRow, hostnameFor } from "../m4/domains-core-helpers";
import { eventsOf } from "../m4/analytics-ingest-helpers";
import { getTenant } from "../m8/render-helpers";
import {
  IPHONE_UA,
  docOf,
  getClick,
  getPage,
  link,
  livePage,
  startStub,
  waitForClicks,
  type Stub,
} from "./links-helpers";

/**
 * M9-31 redirect mode, end to end: the live page of a Pro account that sends visitors straight to one
 * link answers GET and HEAD with a 302 to the click redirect (relative Location built from two ids,
 * the tenant's security headers, no cookie), on a handle host and on a verified custom host; a Free
 * page, an unpublished page, a suspended owner, an unknown host, /og and POST / are unchanged; a
 * downgrade serves the page again; and in a browser the visitor lands on the destination with the
 * tags, counted once, with no page view.
 */

test.afterAll(async () => {
  await cleanupUsers();
});
test.describe.configure({ timeout: 120_000 });

const TARGET = "lnkredirect01";
const OTHER = "lnkother00001";
const PAGE_UTM = { source: "hydlnk", medium: "link-in-bio", campaign: "spring" };
const TAGS = "?utm_source=hydlnk&utm_medium=link-in-bio&utm_campaign=spring";

let stub: Stub;
test.beforeAll(async () => {
  stub = await startStub();
});
test.afterAll(async () => {
  await stub.close();
});

const blocks = () => [
  link(TARGET, stub.url("/landing"), { label: "My shop" }),
  link(OTHER, stub.url("/other"), { label: "Other link" }),
];

async function redirectPage(
  label: string,
  plan: "free" | "pro" | "studio" = "pro",
  extra: Record<string, unknown> = {},
) {
  return livePage(
    label,
    docOf(blocks(), { utm: PAGE_UTM, redirect: { linkId: TARGET }, ...extra }),
    { plan },
  );
}

const SECURITY = [
  "content-security-policy",
  "x-content-type-options",
  "referrer-policy",
  "x-frame-options",
] as const;

test.describe("M9-31 what the live address answers", () => {
  test("M9-31 GET and HEAD of a Pro page in redirect mode answer 302 to the relative click path, with the tenant's security headers, no cookie and no body", async ({}, info) => {
    test.skip(!desktopOnly(info), "pure HTTP: one project is enough");
    const live = await redirectPage("rd1");
    const normal = await getTenant((await livePage("rd1n", docOf(blocks()))).handle);
    expect(normal.status).toBe(200);

    for (const method of ["GET", "HEAD"]) {
      const response = await getPage(live.host, { method });
      expect(response.status, method).toBe(302);
      expect(response.location, method).toBe(`/r/${live.pageId}/${TARGET}`);
      expect(response.body, method).toBe("");
      expect(response.setCookies).toEqual([]);
      expect([301, 308]).not.toContain(response.status);
      expect(String(response.headers["cache-control"] ?? "")).not.toContain("immutable");
      for (const name of SECURITY) expect(response.headers[name], name).toBe(normal.headers[name]);
      expect(String(response.headers["content-security-policy"])).toContain("form-action 'none'");
      expect(response.headers["x-frame-options"]).toBe("DENY");
    }

    // On a production build (CI's shards) the 302 is stored like the page: the second GET is a cache
    // HIT with the same status and Location, the evidence the M9-31 spike asked for.
    if (PRODUCTION_BUILD) {
      const again = await getPage(live.host);
      expect(again.status).toBe(302);
      expect(again.location).toBe(`/r/${live.pageId}/${TARGET}`);
      expect(String(again.headers["x-nextjs-cache"])).toBe("HIT");
      expect(String(again.headers["cache-control"])).toMatch(/s-maxage=/);
    }
  });

  test("M9-31 no header, query string or Host value changes the Location", async ({}, info) => {
    test.skip(!desktopOnly(info), "pure HTTP: one project is enough");
    const live = await redirectPage("rd2");
    const expected = `/r/${live.pageId}/${TARGET}`;
    for (const path of [
      "/?to=https://evil.example",
      "/?utm_source=evil&url=//evil.example",
      "/?redirect=/r/x/y",
    ]) {
      const response = await getPage(live.host, {
        path,
        headers: {
          referer: "https://evil.example/",
          "x-forwarded-host": "evil.example",
          "x-original-host": "evil.example",
        },
      });
      expect(response.status, path).toBe(302);
      expect(response.location, path).toBe(expected);
    }
  });

  test("M9-31 following it: /r/<pageId>/<linkId> answers 302 to the destination with the tags and counts one click", async ({}, info) => {
    test.skip(!desktopOnly(info), "pure HTTP: one project is enough");
    const live = await redirectPage("rd3");
    const first = await getPage(live.host);
    const second = await getClick(live, TARGET);
    expect(first.location).toBe(`/r/${live.pageId}/${TARGET}`);
    expect(second.status).toBe(302);
    expect(second.location).toBe(`${stub.url("/landing")}${TAGS}`);
    const clicks = await waitForClicks(live.pageId, 1);
    expect(clicks.map((row) => row.block_id)).toEqual([TARGET]);
    // No page view is recorded: no page is shown and no beacon runs.
    expect((await eventsOf(live.pageId)).filter((row) => row.type === "view")).toEqual([]);
  });

  test("M9-31 a verified custom host answers the same redirect", async ({}, info) => {
    test.skip(!desktopOnly(info), "pure HTTP: one project is enough");
    const live = await redirectPage("rd4", "studio");
    const hostname = hostnameFor("rd");
    await addDomainRow({ pageId: live.pageId, hostname, status: "verified" });
    for (const method of ["GET", "HEAD"]) {
      const response = await getPage(`${hostname}:3000`, { method });
      expect(response.status, method).toBe(302);
      expect(response.location).toBe(`/r/${live.pageId}/${TARGET}`);
      expect(response.setCookies).toEqual([]);
      expect(response.headers["x-frame-options"]).toBe("DENY");
    }
  });

  test("M9-31 a Free page that holds redirect, a page that is not published, a suspended owner and an unknown host are unchanged", async ({}, info) => {
    test.skip(!desktopOnly(info), "pure HTTP: one project is enough");
    // A Free account that somehow has `redirect` in its published document (a downgrade): the page shows.
    const free = await redirectPage("rd5", "free");
    const shown = await getPage(free.host);
    expect(shown.status).toBe(200);
    expect(shown.location).toBeNull();
    expect(shown.body).toContain("data-page-root");

    const unpublished = await livePage("rd5u", docOf(blocks()), { published: false });
    const placeholder = await getPage(unpublished.host);
    expect(placeholder.status).toBe(200);
    expect(placeholder.location).toBeNull();

    const suspended = await livePage("rd5s", docOf(blocks(), { redirect: { linkId: TARGET } }), {
      plan: "pro",
      suspended: true,
    });
    const gone = await getPage(suspended.host);
    expect(gone.status).toBe(404);
    expect(gone.location).toBeNull();

    expect((await getPage("nobody-rd5.example.org:3000")).status).toBe(404);
  });

  test("M9-31 a target that cannot be resolved (a locked link, a link that is gone) is ignored: the page renders normally", async ({}, info) => {
    test.skip(!desktopOnly(info), "pure HTTP: one project is enough");
    const locked = await livePage(
      "rd6",
      docOf(
        [
          link(TARGET, stub.url("/landing"), { lock: { kind: "age" } }),
          link(OTHER, stub.url("/other")),
        ],
        { redirect: { linkId: TARGET } },
      ),
      { plan: "pro" },
    );
    const gone = await livePage("rd6g", docOf(blocks(), { redirect: { linkId: "lnkgone00001" } }), {
      plan: "pro",
    });
    for (const live of [locked, gone]) {
      const response = await getPage(live.host);
      expect(response.status).toBe(200);
      expect(response.location).toBeNull();
    }
  });

  test("M9-31 /og still answers the PNG and POST / is still 405 with Allow: GET, HEAD", async ({}, info) => {
    test.skip(!desktopOnly(info), "pure HTTP: one project is enough");
    const live = await redirectPage("rd7");
    const og = await getTenant(live.handle, "/og");
    expect(og.status).toBe(200);
    expect(String(og.headers["content-type"])).toBe("image/png");
    const posted = await getPage(live.host, { method: "POST" });
    expect(posted.status).toBe(405);
    expect(posted.headers.allow).toBe("GET, HEAD");
  });

  test("M9-31 a downgrade serves the page again, and upgrading brings the redirect back", async ({
    browser,
  }, info) => {
    test.skip(!desktopOnly(info), "pure HTTP: one project is enough");
    const live = await redirectPage("rd8");
    expect((await getPage(live.host)).status).toBe(302);

    const admin = adminClient();
    expect(
      (await admin.from("accounts").update({ paid_plan: "free" }).eq("id", live.userId)).error,
    ).toBeNull();
    await expireOwnerPages(browser, live.userId);
    const downgraded = await getPage(live.host);
    expect(downgraded.status).toBe(200);
    expect(downgraded.location).toBeNull();

    expect(
      (await admin.from("accounts").update({ paid_plan: "pro" }).eq("id", live.userId)).error,
    ).toBeNull();
    await expireOwnerPages(browser, live.userId);
    expect((await getPage(live.host)).status).toBe(302);
  });
});

test.describe("M9-31 in a browser", () => {
  test("M9-31 a visitor lands on the destination with the tags, the destination sees them once, and the click is counted with no page view", async ({
    page,
  }) => {
    const live = await redirectPage("rd9");
    const before = stub.hits.length;
    await page.goto(live.url);
    await page.waitForURL((u) => u.host === `${stub.host}:${stub.port}`);
    expect(new URL(page.url()).pathname).toBe("/landing");
    expect(new URL(page.url()).search).toBe(TAGS);
    expect(stub.hits.slice(before).map((hit) => hit.url)).toEqual([`/landing${TAGS}`]);
    const clicks = await waitForClicks(live.pageId, 1);
    expect(clicks.map((row) => row.block_id)).toEqual([TARGET]);
    expect((await eventsOf(live.pageId)).filter((row) => row.type === "view")).toEqual([]);
  });

  test("M9-31 with the mode off the page renders as before: no sideways scroll, every link 44px tall", async ({
    page,
  }) => {
    const live = await livePage("rd10", docOf(blocks(), { utm: PAGE_UTM }), { plan: "pro" });
    await page.goto(live.url);
    await expect(page.locator(`.pg-link[data-block-id="${TARGET}"]`)).toBeVisible();
    expect(new URL(page.url()).host).toBe(new URL(live.url).host);
    await expectNoHorizontalScroll(page);
    await expectTapTargets(page, ".pg-blocks");
  });

  test("M9-31 a phone and a desktop context both follow it, also on a verified custom host", async ({
    browser,
  }, info) => {
    test.skip(!desktopOnly(info), "one project is enough for the custom host");
    const live = await redirectPage("rd11", "studio");
    const hostname = hostnameFor("rd");
    await addDomainRow({ pageId: live.pageId, hostname, status: "verified" });
    const mapped = await chromium.launch({
      args: [`--host-resolver-rules=MAP ${hostname} 127.0.0.1`],
    });
    try {
      for (const userAgent of [IPHONE_UA, undefined]) {
        const page = await mapped.newPage({ ...(userAgent ? { userAgent } : {}) });
        await page.goto(`http://${hostname}:3000/`);
        await page.waitForURL((u) => u.host === `${stub.host}:${stub.port}`);
        expect(new URL(page.url()).search).toBe(TAGS);
        await page.close();
      }
    } finally {
      await mapped.close();
    }
    void browser;
  });
});
