import { chromium, expect, test } from "@playwright/test";
import { cleanupUsers, desktopOnly } from "../fixtures/data";
import { expectNoHorizontalScroll, expectTapTargets } from "../helpers";
import { addDomainRow, hostnameFor } from "../m4/domains-core-helpers";
import {
  IPHONE_UA,
  docOf,
  getClick,
  getPage,
  link,
  livePage,
  settledClicks,
  startStub,
  waitForClicks,
  type Stub,
} from "./links-helpers";
import type { Block } from "@/lib/document";

/**
 * M9-27 UTM tags added to outgoing links at redirect time, end to end: `curl -I` on each `/r/` path
 * (the Location the redirect answers), what the page's markup holds (no tag), the click row (no tag
 * stored), and a browser tap that lands on a stub destination whose query holds the tags, on a
 * handle host and on a verified custom host.
 */

test.afterAll(async () => {
  await cleanupUsers();
});
test.describe.configure({ timeout: 120_000 });

const PAGE_UTM = { source: "hydlnk", medium: "link-in-bio", campaign: "spring" };

const ID = {
  plain: "lnkplain0001",
  own: "lnkown000001",
  off: "lnkoff000001",
  partner: "lnkpartner01",
  icon: "icoinsta0001",
  mail: "icomail00001",
  social: "socialrow001",
  textLink: "txtlink00001",
  text: "txtblock0001",
};

const URL_OF = {
  plain: "https://shop.example/plain?id=1#top",
  own: "https://shop.example/own",
  off: "https://shop.example/off",
  partner: "https://shop.example/partner?utm_source=partner",
  icon: "https://instagram.com/maraokafor",
  textLink: "https://shop.example/in-text",
};

function blocks(): Block[] {
  return [
    link(ID.plain, URL_OF.plain),
    link(ID.own, URL_OF.own, { utm: { source: "newsletter" } }),
    link(ID.off, URL_OF.off, { utm: { off: true } }),
    link(ID.partner, URL_OF.partner),
    {
      id: ID.social,
      type: "social",
      visible: true,
      icons: [
        { id: ID.icon, platform: "instagram", url: URL_OF.icon },
        { id: ID.mail, platform: "email", address: "hello@example.com" },
      ],
    } as Block,
    {
      id: ID.text,
      type: "text",
      visible: true,
      text: "Read the shop page",
      marks: [{ type: "link", id: ID.textLink, start: 9, end: 18, url: URL_OF.textLink }],
    } as Block,
  ];
}

test.describe("M9-27 Location at the click redirect", () => {
  test("M9-27 curl -I on each /r/ path returns the expected Location; the markup holds no tag and the mailto icon is unchanged", async ({}, info) => {
    test.skip(!desktopOnly(info), "pure HTTP: one project is enough");
    const live = await livePage("utm1", docOf(blocks(), { utm: PAGE_UTM }));

    const expected: [string, string][] = [
      [
        ID.plain,
        "https://shop.example/plain?id=1&utm_source=hydlnk&utm_medium=link-in-bio&utm_campaign=spring#top",
      ],
      [
        ID.own,
        "https://shop.example/own?utm_source=newsletter&utm_medium=link-in-bio&utm_campaign=spring",
      ],
      [ID.off, URL_OF.off],
      [
        ID.partner,
        "https://shop.example/partner?utm_source=partner&utm_medium=link-in-bio&utm_campaign=spring",
      ],
      [
        ID.icon,
        "https://instagram.com/maraokafor?utm_source=hydlnk&utm_medium=link-in-bio&utm_campaign=spring",
      ],
      [
        ID.textLink,
        "https://shop.example/in-text?utm_source=hydlnk&utm_medium=link-in-bio&utm_campaign=spring",
      ],
    ];
    for (const [id, location] of expected) {
      for (const method of ["GET", "HEAD"]) {
        const response = await getClick(live, id, { method });
        expect(response.status, `${method} ${id}`).toBe(302);
        expect(response.location, `${method} ${id}`).toBe(location);
        expect(response.headers["cache-control"]).toBe("no-store");
        expect(response.setCookies).toEqual([]);
      }
    }

    // The email icon is a mailto link, not a tracked one: it never goes through /r/.
    expect((await getClick(live, ID.mail)).status).toBe(404);

    // The page's markup: every web link is still /r/..., with no tag in it, and the mailto is as before.
    const html = (await getPage(live.host, { ua: IPHONE_UA })).body;
    expect(html).not.toContain("utm_");
    expect(html).toContain(`href="/r/${live.pageId}/${ID.plain}"`);
    expect(html).toContain(`href="/r/${live.pageId}/${ID.icon}"`);
    expect(html).toContain('href="mailto:hello@example.com"');
    expect(html).not.toContain("shop.example");
  });

  test("M9-27 with nothing set the Location is exactly the published URL, and nothing from the request changes it", async ({}, info) => {
    test.skip(!desktopOnly(info), "pure HTTP: one project is enough");
    const live = await livePage("utm2", docOf(blocks()));
    for (const [id, published] of [
      [ID.plain, URL_OF.plain],
      [ID.partner, URL_OF.partner],
      [ID.icon, URL_OF.icon],
      [ID.textLink, URL_OF.textLink],
    ] as const) {
      const response = await getClick(live, id);
      expect(response.location, id).toBe(published);
    }
    // A query string, utm parameters and the open-redirect parameters of M4-22 never change it.
    for (const query of [
      "?utm_source=evil&utm_medium=evil&utm_campaign=evil",
      "?url=https://evil.example&to=https://evil.example&next=//evil.example",
    ]) {
      const response = await getClick(live, ID.plain, {
        query,
        headers: { referer: "https://evil.example/" },
      });
      expect(response.location, query).toBe(URL_OF.plain);
    }
    // And with page defaults set the same requests still give the tagged published URL, not the request's.
    const tagged = await livePage("utm2b", docOf(blocks(), { utm: PAGE_UTM }));
    for (const query of ["?utm_source=evil", "?to=https://evil.example"]) {
      const response = await getClick(tagged, ID.plain, { query });
      expect(response.location, query).toContain("utm_source=hydlnk");
      expect(response.location, query).not.toContain("evil");
    }
  });

  test("M9-27 the click row recorded is unchanged: one row per click, the link id, and no tag value anywhere in it", async ({}, info) => {
    test.skip(!desktopOnly(info), "pure HTTP: one project is enough");
    const live = await livePage("utm3", docOf(blocks(), { utm: PAGE_UTM }));
    const response = await getClick(live, ID.own);
    expect(response.status).toBe(302);
    const rows = await waitForClicks(live.pageId, 1);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.block_id).toBe(ID.own);
    expect(Object.keys(rows[0]!).sort()).toEqual(
      [
        "block_id",
        "country",
        "device",
        "id",
        "page_id",
        "referrer",
        "ts",
        "type",
        "visitor_hash",
      ].sort(),
    );
    expect(JSON.stringify(rows)).not.toMatch(/utm|hydlnk|newsletter|spring/);
    // A HEAD records nothing.
    await getClick(live, ID.own, { method: "HEAD" });
    expect(await settledClicks(live.pageId)).toBe(1);
  });

  test("M9-27 a stored value that fails the pattern cannot inject a parameter or a header (a document that bypassed Publish)", async ({}, info) => {
    test.skip(!desktopOnly(info), "pure HTTP: one project is enough");
    const doc = docOf(blocks());
    // The strict schema would refuse these, so the document is written as a database client could.
    const tampered = {
      ...doc,
      utm: { source: "a&utm_medium=evil", medium: "ok", campaign: "x\r\nSet-Cookie: y=1" },
    };
    const live = await livePage("utm4", tampered as never);
    const response = await getClick(live, ID.plain);
    // The page itself is not served (its document fails the published schema): the click is a 404 too.
    expect([302, 404]).toContain(response.status);
    if (response.status === 302) {
      expect(response.location).not.toContain("evil");
      expect(response.setCookies).toEqual([]);
    }
    expect(JSON.stringify(response.headers)).not.toContain("Set-Cookie: y=1");
  });
});

test.describe("M9-27 a tap lands on a destination with the tags", () => {
  let stub: Stub;
  test.beforeAll(async () => {
    stub = await startStub();
  });
  test.afterAll(async () => {
    await stub.close();
  });

  test("M9-27 nothing visible changes, no anchor carries a tag, and a tap on a link lands on the stub with the tags once", async ({
    page,
  }) => {
    const destination = stub.url("/landing");
    const live = await livePage(
      "utm5",
      docOf(
        [
          link(ID.plain, destination),
          link(ID.own, stub.url("/own"), { utm: { source: "newsletter" } }),
        ],
        { utm: PAGE_UTM },
      ),
    );
    await page.goto(live.url);
    await expect(page.locator(`.pg-link[data-block-id="${ID.plain}"]`)).toBeVisible();
    // Nothing visible changes: no tag in any anchor, no sideways scroll, every anchor 44px tall.
    const hrefs = await page
      .locator("a")
      .evaluateAll((anchors) => anchors.map((a) => a.getAttribute("href") ?? ""));
    for (const href of hrefs) expect(href).not.toContain("utm_");
    await expectNoHorizontalScroll(page);
    await expectTapTargets(page, ".pg-blocks");

    const before = stub.hits.length;
    await page.locator(`.pg-link[data-block-id="${ID.plain}"]`).click();
    await page.waitForURL((u) => u.host === `${stub.host}:${stub.port}`);
    expect(new URL(page.url()).pathname).toBe("/landing");
    expect(new URL(page.url()).search).toBe(
      "?utm_source=hydlnk&utm_medium=link-in-bio&utm_campaign=spring",
    );
    const hits = stub.hits.slice(before);
    expect(hits.map((hit) => hit.url)).toEqual([
      "/landing?utm_source=hydlnk&utm_medium=link-in-bio&utm_campaign=spring",
    ]);

    // The link with its own source: its own value and the page's other two.
    await page.goBack();
    await page.locator(`.pg-link[data-block-id="${ID.own}"]`).click();
    await page.waitForURL((u) => u.pathname === "/own");
    expect(new URL(page.url()).search).toBe(
      "?utm_source=newsletter&utm_medium=link-in-bio&utm_campaign=spring",
    );
  });

  test("M9-27 the same tap on a verified custom host lands on the stub with the tags", async ({}, info) => {
    test.skip(!desktopOnly(info), "one project is enough for a custom host");
    const live = await livePage(
      "utm6",
      docOf([link(ID.plain, stub.url("/custom"))], { utm: PAGE_UTM }),
      { plan: "studio" },
    );
    const hostname = hostnameFor("utm");
    await addDomainRow({ pageId: live.pageId, hostname, status: "verified" });
    // The raw request first: the redirect answers on the custom host with the tags.
    const raw = await getClick(live, ID.plain, { host: `${hostname}:3000` });
    expect(raw.status).toBe(302);
    expect(raw.location).toBe(
      `${stub.url("/custom")}?utm_source=hydlnk&utm_medium=link-in-bio&utm_campaign=spring`,
    );

    const browser = await chromium.launch({
      args: [`--host-resolver-rules=MAP ${hostname} 127.0.0.1`],
    });
    try {
      const page = await browser.newPage({ userAgent: IPHONE_UA });
      await page.goto(`http://${hostname}:3000/`);
      await page.locator(`.pg-link[data-block-id="${ID.plain}"]`).click();
      await page.waitForURL((u) => u.host === `${stub.host}:${stub.port}`);
      expect(new URL(page.url()).search).toBe(
        "?utm_source=hydlnk&utm_medium=link-in-bio&utm_campaign=spring",
      );
    } finally {
      await browser.close();
    }
  });
});
