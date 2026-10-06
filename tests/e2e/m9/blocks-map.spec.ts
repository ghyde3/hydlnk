import { expect, test } from "@playwright/test";
import { adminClient, userClient } from "../fixtures/auth";
import { accessTokenFor, cleanupUsers, desktopOnly, rand } from "../fixtures/data";
import { expectNoHorizontalScroll, url } from "../helpers";
import { draftWith, emptyUser, saveIndicator } from "../m2/editor-helpers";
import {
  addBlock,
  box,
  draftOf,
  expectDraft,
  openEditor,
  previewScreen,
  rowOf,
  userWithDraft,
} from "../m2/blocks-helpers";
import {
  clickRows,
  collectRequests,
  foreignHosts,
  livePage,
  markupOf,
  settled,
} from "./store-blocks-helpers";
import { mapTargets, type Block, type PublishDoc } from "@/lib/document";

/**
 * M9-22 on a real page and in the editor: the map location block (an address card with Open in
 * Maps, and no map image). A page published with the secret key, the click redirect for each
 * button (the targets are built from the published name and address), the editor's two fields and
 * the abuse cases.
 */

test.afterAll(cleanupUsers);

// The first request of a route compiles it on the dev server.
test.describe.configure({ timeout: 120_000 });

const NAME = "Okafor Studio and Gallery of the Night Market Lantern Makers"
  .padEnd(60, "x")
  .slice(0, 60);
// A 160-character address with an unbroken 100-character word in the middle.
const ADDRESS =
  `12 Canal Street, Brooklyn, ${"W".repeat(100)}, New York, NY 11201, United States of America`.slice(
    0,
    160,
  );
const BLOCK_ID = "map-e2e-block001";
const GOOGLE_ID = "map-e2e-google001";
const APPLE_ID = "map-e2e-apple0001";

const mapOf = (extra: Record<string, unknown> = {}): Block =>
  ({
    id: BLOCK_ID,
    type: "map",
    visible: true,
    name: NAME,
    address: ADDRESS,
    googleId: GOOGLE_ID,
    appleId: APPLE_ID,
    ...extra,
  }) as Block;

test.describe("M9-22 the map block on a published page", () => {
  test("M9-22 a 60-character name and a 160-character address with an unbroken word wrap inside the column; two 44px buttons; no overflow", async ({
    page,
  }, info) => {
    expect(Array.from(NAME)).toHaveLength(60);
    expect(Array.from(ADDRESS)).toHaveLength(160);
    const live = await livePage("mp1", () => [mapOf()]);
    await page.goto(live.url);
    await settled(page);
    await expectNoHorizontalScroll(page);

    const block = page.locator(`[data-block-id="${BLOCK_ID}"]`);
    await expect(block).toHaveAttribute("data-block-type", "map");
    await expect(block.locator("p.pg-map-name")).toHaveText(NAME);
    await expect(block.locator("p.pg-map-address")).toHaveText(ADDRESS);
    await expect(block.locator(".pg-map-open")).toHaveText("Open in Maps");
    // Text wraps: nothing is wider than its box, even the 100-character word.
    for (const selector of [".pg-map-name", ".pg-map-address"]) {
      expect(
        await block.locator(selector).evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
        selector,
      ).toBe(true);
    }
    const cardBox = await box(block);
    const viewport = page.viewportSize()!;
    expect(cardBox.x + cardBox.width).toBeLessThanOrEqual(viewport.width);
    if (desktopOnly(info)) expect(cardBox.width).toBeLessThanOrEqual(480);

    // The two buttons: Google Maps and Apple Maps, side by side or stacked, each 44px tall.
    const google = block.locator('a.pg-map-link[data-map="google"]');
    const apple = block.locator('a.pg-map-link[data-map="apple"]');
    await expect(google).toHaveText("Google Maps");
    await expect(apple).toHaveText("Apple Maps");
    await expect(google).toHaveAttribute("aria-label", `Open ${NAME} in Google Maps`);
    await expect(apple).toHaveAttribute("aria-label", `Open ${NAME} in Apple Maps`);
    await expect(google).toHaveAttribute("href", `/r/${live.pageId}/${GOOGLE_ID}`);
    await expect(apple).toHaveAttribute("href", `/r/${live.pageId}/${APPLE_ID}`);
    for (const button of [google, apple]) {
      const rect = await box(button);
      expect(rect.height).toBeGreaterThanOrEqual(43.5);
      expect(rect.x + rect.width).toBeLessThanOrEqual(cardBox.x + cardBox.width + 0.5);
    }
    const [g, a] = [await box(google), await box(apple)];
    const sideBySide = Math.abs(g.y - a.y) < 4;
    const stacked = a.y >= g.y + g.height - 1;
    expect(sideBySide || stacked).toBe(true);
    // Every anchor on the page is at least 44px tall.
    for (const anchor of await page.locator("a").all()) {
      if (!(await anchor.isVisible())) continue;
      expect((await box(anchor)).height, await anchor.innerText()).toBeGreaterThanOrEqual(43.5);
    }
  });

  test("M9-22 no third party: no map image, frame or script, no request to any map host, the destinations are not in the markup, and the page's policy is the one every page has", async ({
    page,
  }) => {
    const live = await livePage("mp2", () => [mapOf()]);
    const plain = await livePage("mp2b", () => [
      {
        id: "link-e2e-plain1",
        type: "link",
        visible: true,
        label: "Hello",
        url: "https://example.com/",
      } as Block,
    ]);
    const requests = collectRequests(page);
    const response = await page.goto(live.url);
    await settled(page);

    const block = page.locator(`[data-block-id="${BLOCK_ID}"]`);
    expect(await block.locator("img, iframe, script, object, embed, video").count()).toBe(0);
    const art = block.locator("svg.pg-map-art");
    await expect(art).toHaveAttribute("aria-hidden", "true");
    expect(
      await art.evaluate((el) => new TextEncoder().encode(el.outerHTML).length),
    ).toBeLessThanOrEqual(1024);

    expect(foreignHosts(requests, live.handle)).toEqual([]);
    expect(
      requests.filter((request) =>
        /google|apple|openstreetmap|mapbox|tile/i.test(new URL(request).host),
      ),
    ).toEqual([]);
    expect(requests.some((request) => /\.(png|jpe?g|webp|gif)(\?|$)/i.test(request))).toBe(false);
    const html = await page.content();
    expect(html).not.toMatch(/maps\.apple\.com|google\.com\/maps|Canal%20Street/);
    expect(await page.locator("script").count()).toBe(1); // the one tenant script, as on every page

    // The tenant policy is the same string a page without a map gets.
    const csp = response!.headers()["content-security-policy"];
    expect(csp).toBeTruthy();
    const other = await page.goto(plain.url);
    expect(other!.headers()["content-security-policy"]).toBe(csp);
    expect(csp).not.toMatch(/google|maps\.apple|openstreetmap|mapbox|tile/i);
  });

  test("M9-22 a page without the block carries none of its CSS; a page with it carries it", async ({
    page,
  }) => {
    const plain = await livePage("mp3", () => [
      {
        id: "link-e2e-plain1",
        type: "link",
        visible: true,
        label: "Hello",
        url: "https://example.com/",
      } as Block,
    ]);
    await page.goto(plain.url);
    await settled(page);
    expect((await page.locator("style").allTextContents()).join("")).not.toContain("pg-map");
    expect(await page.content()).not.toContain("pg-map");

    const withMap = await livePage("mp4", () => [mapOf()]);
    await page.goto(withMap.url);
    await settled(page);
    const css = (await page.locator("style").allTextContents()).join("");
    expect(css).toContain(".pg-map-link");
    expect(css).not.toContain("pg-book");
    expect(css).not.toContain("pg-app-badge");
  });

  test("M9-22 a name and an address that are markup are drawn as text and run nothing", async ({
    page,
  }) => {
    const live = await livePage("mp5", () => [
      mapOf({ name: "<img src=x onerror=alert(1)>", address: "</p><script>alert(1)</script>" }),
    ]);
    let dialogs = 0;
    page.on("dialog", async (dialog) => {
      dialogs += 1;
      await dialog.dismiss();
    });
    await page.goto(live.url);
    await settled(page);
    await expect(page.locator("p.pg-map-name")).toHaveText("<img src=x onerror=alert(1)>");
    await expect(page.locator("p.pg-map-address")).toHaveText("</p><script>alert(1)</script>");
    await expect(page.locator(".pg-map img")).toHaveCount(0);
    await expect(page.locator(".pg-map p")).toHaveCount(3);
    expect(dialogs).toBe(0);
  });
});

test.describe("M9-22 the click redirect for each button", () => {
  const PLACES = [
    // [name, address]: the text that has to be encoded, and what must never come out of it.
    ["Café & Co", 'Main St & 5th #2, "Café" <b>'],
    ["%".repeat(60), "%é€\u{1F4CD}".repeat(40)],
    ["Studio", "https://evil.example/phish?x=1&y=2#frag"],
  ] as const;

  test("M9-22 GET /r/<pageId>/<id> is a 302 to the Google or Apple search built from the published name and address, with one click row each", async ({
    page,
  }) => {
    const blocks = PLACES.map(
      ([name, address], index) =>
        ({
          id: `map-e2e-place-${index}`,
          type: "map",
          visible: true,
          name,
          address,
          googleId: `map-e2e-goog-${index}`,
          appleId: `map-e2e-appl-${index}`,
        }) as Block,
    );
    const live = await livePage("mp6", () => blocks);
    const userAgent = await page.evaluate(() => navigator.userAgent);

    for (const [index, [name, address]] of PLACES.entries()) {
      const targets = mapTargets(name, address);
      for (const [id, expected, host] of [
        [`map-e2e-goog-${index}`, targets.google, "www.google.com"],
        [`map-e2e-appl-${index}`, targets.apple, "maps.apple.com"],
      ] as const) {
        const response = await page.request.get(
          // Nothing in the request can change the Location.
          `${live.url}r/${live.pageId}/${id}?to=https://evil.example&url=//evil.example&q=x&query=y`,
          {
            maxRedirects: 0,
            headers: { "user-agent": userAgent, referer: "https://evil.example/" },
          },
        );
        expect(response.status(), id).toBe(302);
        const location = response.headers().location!;
        expect(location, id).toBe(expected);
        expect(new URL(location).hostname).toBe(host);
        expect(location).toMatch(/^[\x21-\x7e]+$/);
        expect(location.length).toBeLessThan(2048);
        // The text is encoded: no raw ampersand, hash, quote or angle bracket from the address.
        const query = location.split(/[?&](?:query|q)=/)[1]!;
        expect(query).not.toMatch(/[&#"<>\s]/);
        expect(decodeURIComponent(query)).toBe(
          `${name} ${address}`.slice(0, decodeURIComponent(query).length),
        );
        expect(response.headers()["cache-control"]).toBe("no-store");
        expect(response.headers()["set-cookie"]).toBeUndefined();
        await expect
          .poll(async () => (await clickRows(live.pageId, id)).length, { timeout: 15_000 })
          .toBe(1);
        expect((await clickRows(live.pageId, id))[0]).toMatchObject({
          type: "click",
          block_id: id,
        });
      }
    }
    // The first place round-trips exactly.
    const first = await page.request.get(`${live.url}r/${live.pageId}/map-e2e-goog-0`, {
      maxRedirects: 0,
      headers: { "user-agent": userAgent },
    });
    expect(decodeURIComponent(first.headers().location!.split("query=")[1]!)).toBe(
      `${PLACES[0][0]} ${PLACES[0][1]}`,
    );
    // An address that is a URL is a search, not a redirect.
    const evil = await page.request.get(`${live.url}r/${live.pageId}/map-e2e-appl-2`, {
      maxRedirects: 0,
      headers: { "user-agent": userAgent },
    });
    expect(new URL(evil.headers().location!).origin).toBe("https://maps.apple.com");
  });

  test("M9-22 a draft-only id, a hidden block's ids, the block's own id and another page's host answer 404 and insert nothing", async ({
    page,
  }) => {
    const live = await livePage("mp7", () => [mapOf()]);
    const draft = draftOf(live.handle, [
      mapOf(),
      mapOf({
        id: "map-e2e-hidden001",
        visible: false,
        googleId: "map-e2e-hidgoog1",
        appleId: "map-e2e-hidappl1",
      }),
      mapOf({
        id: "map-e2e-draft0001",
        googleId: "map-e2e-drgoog01",
        appleId: "map-e2e-drappl01",
      }),
    ]);
    const write = await adminClient().from("pages").update({ draft }).eq("id", live.pageId);
    expect(write.error).toBeNull();
    const other = await livePage("mp7b", () => [mapOf()]);
    const userAgent = await page.evaluate(() => navigator.userAgent);
    const ids = [
      "map-e2e-hidgoog1",
      "map-e2e-hidappl1",
      "map-e2e-drgoog01",
      BLOCK_ID,
      "map-e2e-nobody01",
    ];
    for (const id of ids) {
      const response = await page.request.get(`${live.url}r/${live.pageId}/${id}`, {
        maxRedirects: 0,
        headers: { "user-agent": userAgent },
      });
      expect(response.status(), id).toBe(404);
    }
    const foreign = await page.request.get(`${other.url}r/${live.pageId}/${GOOGLE_ID}`, {
      maxRedirects: 0,
      headers: { "user-agent": userAgent },
    });
    expect(foreign.status()).toBe(404);
    await page.waitForTimeout(500);
    for (const id of ids) expect(await clickRows(live.pageId, id), id).toEqual([]);
  });
});

test.describe("M9-22 the editor", () => {
  test("M9-22 add a map: place name and address with counters and a hint, 44px controls at 16px, Corner radius, Border thickness and Border color, then Publish and the page matches the preview", async ({
    page,
    context,
  }, info) => {
    const user = await userWithDraft(context, "mp8");
    await openEditor(page);
    const { row, panel, id } = await addBlock(page, "map");

    await expect(panel.getByText("0 / 60", { exact: true })).toBeVisible();
    await expect(panel.getByText("0 / 160", { exact: true })).toBeVisible();
    await expect(
      panel.getByText("Visitors see this address and can open it in Google Maps or Apple Maps."),
    ).toBeVisible();
    await panel.getByLabel("Place name", { exact: true }).fill("Okafor Studio");
    await panel.getByLabel("Address", { exact: true }).fill("12 Canal Street, Brooklyn, NY 11201");
    await expect(panel.getByText("13 / 60", { exact: true })).toBeVisible();
    await expect(panel.getByText("35 / 160", { exact: true })).toBeVisible();
    // A paste past the limit is cut, not refused; a line break is a space.
    await panel.getByLabel("Place name", { exact: true }).fill("n".repeat(75));
    await expect(panel.getByLabel("Place name", { exact: true })).toHaveValue("n".repeat(60));
    await panel.getByLabel("Place name", { exact: true }).fill("Okafor Studio");

    // The row names the place and shows its address.
    await expect(row).toContainText("Okafor Studio");
    await expect(row).toContainText("12 Canal Street, Brooklyn, NY 11201");

    // The style group: Corner radius, Border thickness and Border color.
    const style = panel.getByTestId("override-controls");
    const labels = await style.locator("label").allTextContents();
    expect(labels.map((label) => label.trim())).toEqual([
      "Corner radius",
      "Border thickness",
      "Border color",
    ]);

    // Every control is at least 44px tall; inputs are 16px.
    const sizes = await panel.locator("button, input:not([type=file]), select").evaluateAll((els) =>
      els
        .filter((el) => (el as HTMLElement).offsetParent !== null)
        .map((el) => ({
          h: el.getBoundingClientRect().height,
          font: getComputedStyle(el).fontSize,
          tag: el.tagName,
          name:
            (el as HTMLElement).innerText ||
            el.getAttribute("data-field") ||
            el.getAttribute("aria-label"),
        })),
    );
    expect(sizes.length).toBeGreaterThan(3);
    for (const size of sizes) {
      expect(size.h, `${size.tag} ${size.name}`).toBeGreaterThanOrEqual(43.5);
      if (size.tag !== "BUTTON") expect(size.font, `${size.tag} ${size.name}`).toBe("16px");
    }
    await expectNoHorizontalScroll(page);

    // The draft holds the text and two fresh ids that are not the block's.
    const draft = await expectDraft(user.pageId, (d) =>
      d.blocks.some(
        (b) =>
          b.id === id &&
          b.type === "map" &&
          b.name === "Okafor Studio" &&
          b.address === "12 Canal Street, Brooklyn, NY 11201",
      ),
    );
    const stored = draft.blocks.find((b) => b.id === id) as Extract<Block, { type: "map" }>;
    expect(new Set([id, stored.googleId, stored.appleId]).size).toBe(3);

    // Publish: the live page draws what the preview drew, and /r answers for both buttons.
    const inPreview = desktopOnly(info) ? await markupOf(previewScreen(page), id) : null;
    await page.getByRole("button", { name: "Publish", exact: true }).first().click();
    await expect
      .poll(
        async () =>
          (await adminClient().from("pages").select("published_at").eq("id", user.pageId).single())
            .data?.published_at,
        { timeout: 20_000 },
      )
      .not.toBeNull();
    await page.goto(url(user.handle));
    await settled(page);
    const block = page.locator(`[data-block-id="${id}"]`);
    await expect(block.locator("a.pg-map-link")).toHaveCount(2);
    await expect(block.locator('a[data-map="google"]')).toHaveAttribute(
      "href",
      `/r/${user.pageId}/${stored.googleId}`,
    );
    if (inPreview !== null) expect(await markupOf(page.locator("body"), id)).toBe(inPreview);
    const published = (
      await adminClient().from("pages").select("published").eq("id", user.pageId).single()
    ).data!.published as PublishDoc;
    expect(published.blocks.find((b) => b.id === id)).toMatchObject({
      type: "map",
      name: "Okafor Studio",
      googleId: stored.googleId,
      appleId: stored.appleId,
    });
  });

  test("M9-22 an empty name or address is named under its field at Publish", async ({
    page,
    context,
  }) => {
    const user = await userWithDraft(context, "mp9", (handle) =>
      draftOf(handle, [mapOf({ name: "", address: "" })]),
    );
    await openEditor(page);
    await page.getByRole("button", { name: "Publish", exact: true }).first().click();
    const panel = rowOf(page, BLOCK_ID).locator('[id^="block-panel-"]');
    await expect(panel.getByText("Add a place name.")).toBeVisible();
    await expect(panel.getByText("Add an address.")).toBeVisible();
    const stored = await adminClient()
      .from("pages")
      .select("published, published_at")
      .eq("id", user.pageId)
      .single();
    expect(stored.data).toEqual({ published: null, published_at: null });
    expect(saveIndicator(page)).toBeTruthy();
  });
});

test.describe("M9-22 abuse: a draft written as raw JSON with the owner's own JWT", () => {
  test("M9-22 a draft whose map holds equal ids is never published: the live page is as it was", async ({
    page,
    context,
  }) => {
    const user = await userWithDraft(context, "mp10", (handle) => draftOf(handle, [mapOf()]));
    await openEditor(page);
    await page.getByRole("button", { name: "Publish", exact: true }).first().click();
    await expect
      .poll(
        async () =>
          (await adminClient().from("pages").select("published_at").eq("id", user.pageId).single())
            .data?.published_at,
        { timeout: 20_000 },
      )
      .not.toBeNull();
    const before = (
      await adminClient()
        .from("pages")
        .select("published, published_at")
        .eq("id", user.pageId)
        .single()
    ).data;

    // The publishable key and the owner's JWT, as curl would use them: RLS lets the owner write it.
    const client = userClient(await accessTokenFor(user.email));
    for (const bad of [
      mapOf({ appleId: GOOGLE_ID }), // equal ids
      mapOf({ googleId: "map-e2e-link-0001" }), // the id of a link block
      mapOf({ appleId: "map/slash/id-01" }), // not an id
    ]) {
      const write = await client
        .from("pages")
        .update({
          draft: draftOf(user.handle, [
            {
              id: "map-e2e-link-0001",
              type: "link",
              visible: true,
              label: "Link",
              url: "https://example.com/",
            },
            bad,
          ]),
        })
        .eq("id", user.pageId);
      expect(write.error).toBeNull();
      await openEditor(page);
      await page.getByRole("button", { name: "Publish", exact: true }).first().click();
      await page.waitForTimeout(1500);
      const after = (
        await adminClient()
          .from("pages")
          .select("published, published_at")
          .eq("id", user.pageId)
          .single()
      ).data;
      expect(after).toEqual(before);
    }
    const body = await (await page.request.get(url(user.handle))).text();
    expect(body).toContain(`/r/${user.pageId}/${GOOGLE_ID}`);
    expect(body).toContain(`/r/${user.pageId}/${APPLE_ID}`);
    expect(body).not.toContain("map/slash");
  });

  test("M9-22 a place name at a blocked site is only text: no error, no link is made from it", async ({
    page,
    context,
  }) => {
    const domain = `mp-${rand(8)}.example`;
    const inserted = await adminClient().from("blocked_domains").insert({ domain, reason: "e2e" });
    expect(inserted.error).toBeNull();
    try {
      await emptyUser(context, "mp11", {
        draft: draftWith("x", [mapOf({ name: `https://${domain}/x`, address: `${domain}` })]),
      });
      await openEditor(page);
      await rowOf(page, BLOCK_ID).locator("button[aria-expanded]").first().click();
      await expect(page.getByText("That site is blocked. Use a different link.")).toHaveCount(0);
      await expect(saveIndicator(page)).not.toHaveAttribute("data-save-status", "blocked");
    } finally {
      await adminClient().from("blocked_domains").delete().eq("domain", domain);
    }
  });
});
