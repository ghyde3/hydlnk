import { expect, test, type Locator, type Page } from "@playwright/test";
import { adminClient, userClient } from "../fixtures/auth";
import { accessTokenFor, cleanupUsers, desktopOnly, phoneOnly, rand } from "../fixtures/data";
import { expectNoHorizontalScroll, url } from "../helpers";
import { draftWith, emptyUser, saveIndicator } from "../m2/editor-helpers";
import {
  addBlock,
  draftOf,
  openEditor,
  previewScreen,
  publishDocOf,
  publishedPage,
  rowOf,
  userWithDraft,
} from "../m2/blocks-helpers";
import {
  SOCIAL_PLATFORMS,
  SOCIAL_PLATFORM_LABELS,
  type Block,
  type SocialIcon,
} from "@/lib/document";
import { siGithub, siReddit } from "simple-icons";

/**
 * M9-03 and M9-04 on a real page: the six new social platforms (Reddit, Snapchat, Pinterest,
 * Discord, Twitch, Spotify) and the real brand marks. A page published with the secret key (so the
 * public side does not depend on the editor), then the editor itself for the picker, and the abuse
 * cases through the owner's own JWT and the publishable key.
 */

test.afterAll(cleanupUsers);

const NEW_SIX = ["reddit", "snapchat", "pinterest", "discord", "twitch", "spotify"] as const;
const BRAND_LINK_ICONS = [
  "instagram",
  "tiktok",
  "youtube",
  "x",
  "facebook",
  "linkedin",
  "github",
  "threads",
] as const;

const ID_A = "social-row-m9a";
const ID_B = "social-row-m9b";
const ID_LINKS = "link-block-m9";

const iconId = (block: "a" | "b", n: number) => `ico-${block}-${String(n).padStart(4, "0")}`;

function icon(platform: string, id: string, url?: string): SocialIcon {
  return (
    platform === "email"
      ? { id, platform, address: "hello@maraokafor.example" }
      : { id, platform, url: url ?? `https://example.com/${platform}/mara` }
  ) as SocialIcon;
}

/** Block A: the six new platforms, Instagram and Email. Block B: the other brands and Website. */
function fixtureBlocks(): Block[] {
  const a = [...NEW_SIX, "instagram", "email"].map((p, i) => icon(p, iconId("a", i)));
  const b = ["tiktok", "youtube", "x", "facebook", "linkedin", "github", "threads", "website"].map(
    (p, i) => icon(p, iconId("b", i)),
  );
  return [
    { id: ID_A, type: "social", visible: true, icons: a },
    { id: ID_B, type: "social", visible: true, icons: b },
    ...BRAND_LINK_ICONS.map((name, i): Block => ({
      id: `${ID_LINKS}-${i}`,
      type: "link",
      visible: true,
      label: `Find me on ${name}`,
      url: `https://example.com/${name}`,
      icon: { type: "builtin", name },
    })),
  ] as Block[];
}

const css = (locator: Locator, property: string) =>
  locator.evaluate((el, prop) => getComputedStyle(el).getPropertyValue(prop), property);

async function settled(page: Page) {
  await page.waitForLoadState("networkidle");
  await expect(page.locator("[data-page-root]")).toBeVisible();
}

test.describe("M9-03 / M9-04 the social row and the link icons on a published page", () => {
  test("M9-03 eight icons wrap, every one is 44x44 and named by its platform, and goes through /r", async ({
    page,
  }, info) => {
    const live = await publishedPage("sp1", publishDocOf(fixtureBlocks()));
    await page.goto(live.url);
    await settled(page);
    await expectNoHorizontalScroll(page);

    for (const blockId of [ID_A, ID_B]) {
      const anchors = page.locator(`[data-block-id="${blockId}"] a.pg-social-link`);
      await expect(anchors).toHaveCount(8);
      const rects = await anchors.evaluateAll((els) =>
        els.map((el) => {
          const r = el.getBoundingClientRect();
          return { x: r.x, y: r.y, w: r.width, h: r.height };
        }),
      );
      for (const r of rects) {
        expect(r.w).toBeGreaterThanOrEqual(43.5);
        expect(r.h).toBeGreaterThanOrEqual(43.5);
      }
      const ys = new Set(rects.map((r) => Math.round(r.y)));
      if (phoneOnly(info)) {
        // 8 x 44px and 7 gaps of 10px do not fit in 390px minus the page padding: the row wraps.
        expect(ys.size).toBeGreaterThan(1);
      } else {
        expect(ys.size).toBe(1);
        // Centered in the 480px column: the block is as wide as the column, and the icons sit in its middle.
        const column = await page.locator(`[data-block-id="${blockId}"]`).evaluate((el) => {
          const r = el.getBoundingClientRect();
          return { left: r.left, width: r.width };
        });
        const left = Math.min(...rects.map((r) => r.x));
        const right = Math.max(...rects.map((r) => r.x + r.w));
        expect(Math.abs((left + right) / 2 - (column.left + column.width / 2))).toBeLessThanOrEqual(
          2,
        );
        expect(column.width).toBeLessThanOrEqual(480);
        expect(column.width).toBeGreaterThan(300);
      }

      const icons = (live.doc.blocks.find((b) => b.id === blockId) as { icons: SocialIcon[] })
        .icons;
      for (const [index, item] of icons.entries()) {
        const anchor = anchors.nth(index);
        await expect(anchor).toHaveAttribute("aria-label", SOCIAL_PLATFORM_LABELS[item.platform]);
        await expect(anchor).toHaveAttribute(
          "href",
          item.platform === "email"
            ? "mailto:hello@maraokafor.example"
            : `/r/${live.pageId}/${item.id}`,
        );
      }
    }
  });

  test("M9-04 a brand mark takes its anchor's color, is filled with no stroke and is drawn inside its box", async ({
    page,
  }) => {
    const live = await publishedPage("sp2", publishDocOf(fixtureBlocks()));
    await page.goto(live.url);
    await settled(page);

    const glyphs = page.locator(".pg-social-link");
    const count = await glyphs.count();
    expect(count).toBe(16);
    let brand = 0;
    let outline = 0;
    for (let i = 0; i < count; i++) {
      const anchor = glyphs.nth(i);
      const svg = anchor.locator("svg.pg-social-glyph");
      const color = await css(anchor, "color");
      const isBrand = await svg.evaluate((el) => el.classList.contains("pg-social-glyph-brand"));
      if (isBrand) {
        brand += 1;
        expect(await css(svg, "fill")).toBe(color);
        expect(await css(svg, "stroke")).toBe("none");
        // The path's bounding box lies inside the 24x24 box, and so inside the 18px glyph.
        const bbox = await svg.locator("path").evaluate((p) => {
          const b = (p as unknown as SVGGraphicsElement).getBBox();
          return { x: b.x, y: b.y, r: b.x + b.width, b: b.y + b.height };
        });
        expect(bbox.x).toBeGreaterThanOrEqual(-0.01);
        expect(bbox.y).toBeGreaterThanOrEqual(-0.01);
        expect(bbox.r).toBeLessThanOrEqual(24.01);
        expect(bbox.b).toBeLessThanOrEqual(24.01);
        const box = await svg.boundingBox();
        expect(Math.round(box!.width)).toBe(18);
        expect(Math.round(box!.height)).toBe(18);
        expect(await svg.locator("path").count()).toBe(1);
      } else {
        outline += 1;
        expect(await css(svg, "fill")).toBe("none");
        expect(await css(svg, "stroke")).toBe(color);
      }
    }
    expect([brand, outline]).toEqual([14, 2]);
    // The drawn paths are the library's, written into the document (no request for an icon).
    const html = await page.content();
    expect(html).toContain(siReddit.path);
    expect(html).toContain(siGithub.path);
  });

  test("M9-04 the eight brand link icons are filled marks at the start edge of their buttons; the others keep their outline", async ({
    page,
  }) => {
    const blocks: Block[] = [
      ...fixtureBlocks().filter((b) => b.type === "link"),
      {
        id: `${ID_LINKS}-gen`,
        type: "link",
        visible: true,
        label: "Mail me",
        url: "https://example.com/mail",
        icon: { type: "builtin", name: "mail" },
      } as Block,
    ];
    const live = await publishedPage("sp3", publishDocOf(blocks));
    await page.goto(live.url);
    await settled(page);
    await expectNoHorizontalScroll(page);
    const anchors = page.locator("a.pg-link");
    await expect(anchors).toHaveCount(9);
    for (let i = 0; i < 9; i++) {
      const anchor = anchors.nth(i);
      const svg = anchor.locator("svg.pg-link-icon");
      const color = await css(anchor, "color");
      const rect = await svg.boundingBox();
      const frame = await anchor.boundingBox();
      expect(Math.round(rect!.width)).toBe(20);
      expect(rect!.x - frame!.x).toBeLessThan(40);
      expect((await anchor.boundingBox())!.height).toBeGreaterThanOrEqual(43.5);
      if (i < 8) {
        expect(await css(svg, "fill")).toBe(color);
        expect(await css(svg, "stroke")).toBe("none");
      } else {
        expect(await css(svg, "fill")).toBe("none");
        expect(await css(svg, "stroke")).toBe(color);
      }
    }
  });
});

test.describe("M9-03 the click redirect for the new icons", () => {
  test("M9-03 GET /r/<pageId>/<icon id> is a 302 to the published URL with one click row; draft-only, hidden and foreign ids are 404", async ({
    page,
  }) => {
    const live = await publishedPage("sp4", publishDocOf(fixtureBlocks()));
    // A draft with one more icon, and a hidden block, that the published document does not have.
    const draftOnly = icon("twitch", "ico-draft-only", "https://twitch.example/draft");
    const draft = draftOf(live.handle, [
      ...fixtureBlocks(),
      { id: "social-hidden-m9", type: "social", visible: false, icons: [draftOnly] },
    ]);
    const write = await adminClient().from("pages").update({ draft }).eq("id", live.pageId);
    expect(write.error).toBeNull();
    const other = await publishedPage("sp4b", publishDocOf(fixtureBlocks()));

    const events = async (blockId: string) => {
      const { data, error } = await adminClient()
        .from("events")
        .select("type, block_id")
        .eq("page_id", live.pageId)
        .eq("block_id", blockId);
      if (error) throw new Error(error.message);
      return data;
    };

    for (const [index, platform] of NEW_SIX.entries()) {
      const id = iconId("a", index);
      const response = await page.request.get(`${live.url}r/${live.pageId}/${id}`, {
        maxRedirects: 0,
        headers: { "user-agent": (await page.evaluate(() => navigator.userAgent)) ?? "" },
      });
      expect(response.status(), platform).toBe(302);
      expect(response.headers().location).toBe(`https://example.com/${platform}/mara`);
      expect(response.headers()["cache-control"]).toBe("no-store");
      expect(response.headers()["set-cookie"]).toBeUndefined();
      await expect.poll(async () => (await events(id)).length, { timeout: 15_000 }).toBe(1);
      expect((await events(id))[0]).toMatchObject({ type: "click", block_id: id });
    }

    for (const target of [
      `${live.url}r/${live.pageId}/ico-draft-only`,
      `${live.url}r/${live.pageId}/not-an-icon-id`,
      `${other.url}r/${live.pageId}/${iconId("a", 0)}`,
    ]) {
      const response = await page.request.get(target, { maxRedirects: 0 });
      expect(response.status(), target).toBe(404);
    }
    await page.waitForTimeout(500);
    expect(await events("ico-draft-only")).toEqual([]);
  });
});

test.describe("M9-03 abuse: a draft written as raw JSON with the owner's own JWT", () => {
  test("M9-03 javascript:, data:, //host, credentials, a 4,000-character URL and a line break are refused at Publish, the icon is named, nothing is published", async ({
    page,
    context,
  }) => {
    const bad: string[] = [
      "javascript:alert(1)",
      "data:text/html,x",
      "//evil.example",
      "https://user@host.example/",
      `https://example.com/${"a".repeat(4000)}`,
      "https://example.com/a\nb",
    ];
    const icons = NEW_SIX.map((p, i) => icon(p, `ico-abuse-000${i}`, bad[i]!));
    const user = await userWithDraft(context, "sp5", (handle) =>
      draftOf(handle, [{ id: "Sx4kT9pLq2Wa", type: "social", visible: true, icons }]),
    );
    // The publishable key and the owner's JWT, as curl would use them: RLS lets the owner write it.
    const client = userClient(await accessTokenFor(user.email));
    const draft = draftOf(user.handle, [
      { id: "Sx4kT9pLq2Wa", type: "social", visible: true, icons },
    ]);
    const write = await client.from("pages").update({ draft }).eq("id", user.pageId);
    expect(write.error).toBeNull();

    await openEditor(page);
    await page.getByRole("button", { name: "Publish", exact: true }).first().click();
    const alert = page.getByRole("alert").filter({ hasText: "before publishing" });
    await expect(alert).toBeVisible();
    for (const item of icons) {
      await expect(
        rowOf(page, "Sx4kT9pLq2Wa").locator(`[data-item-id="${item.id}"]`),
      ).toHaveAttribute("data-invalid", "true");
    }
    const stored = await adminClient()
      .from("pages")
      .select("published, published_at")
      .eq("id", user.pageId)
      .single();
    expect(stored.data).toEqual({ published: null, published_at: null });
    const body = await (await page.request.get(url(user.handle))).text();
    expect(body).not.toContain("pg-social-link");
    expect(body).not.toContain("evil.example");
    expect(body).not.toContain("javascript:");
  });
});

test.describe("M9-03 / M9-04 the editor", () => {
  test("M9-03 the Platform select lists the sixteen in order; Add icon walks the list; each row shows its mark", async ({
    page,
    context,
  }) => {
    await userWithDraft(context, "sp6");
    await openEditor(page);
    const { row, panel } = await addBlock(page, "social");
    const groups = panel.getByRole("group");
    const select = groups.first().getByRole("combobox", { name: "Platform" });
    const options = await select.locator("option").allTextContents();
    expect(options).toEqual(SOCIAL_PLATFORMS.map((p) => SOCIAL_PLATFORM_LABELS[p]));

    const add = panel.getByRole("button", { name: "Add icon" });
    for (let n = 2; n <= 8; n++) await add.click();
    await expect(groups).toHaveCount(8);
    const values = await panel
      .getByRole("combobox", { name: "Platform" })
      .evaluateAll((els) => els.map((el) => (el as HTMLSelectElement).value));
    expect(values).toEqual(SOCIAL_PLATFORMS.slice(0, 8));

    // Each row's tile draws the platform's mark, decorative, 18px in a 24px tile.
    const tiles = panel.getByTestId("social-tile");
    await expect(tiles).toHaveCount(8);
    for (const tile of await tiles.all()) {
      await expect(tile).toHaveAttribute("aria-hidden", "true");
      expect((await tile.boundingBox())!.width).toBe(24);
      await expect(tile.locator("svg path")).not.toHaveCount(0);
    }
    expect(await tiles.nth(0).locator("path").getAttribute("d")).not.toBe(
      await tiles.nth(1).locator("path").getAttribute("d"),
    );

    // Email to a new platform clears the address and shows the URL field; and back.
    const last = groups.last();
    await last.getByRole("combobox", { name: "Platform" }).selectOption("email");
    await last.getByLabel("Email address").fill("hello@maraokafor.example");
    await last.getByRole("combobox", { name: "Platform" }).selectOption("reddit");
    await expect(last.getByLabel("Email address")).toHaveCount(0);
    await expect(last.locator('input[type="url"]')).toHaveValue("");
    await last.locator('input[type="url"]').fill("https://www.reddit.com/user/mara");
    await expect(tiles.last().locator("path")).toHaveAttribute("d", siReddit.path);
    await expect(row).toContainText("Reddit");
    await expectNoHorizontalScroll(page);
  });

  test("M9-03 the editor preview and the published page draw the same social blocks", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "the bezel preview is the 760px-and-up layout");
    const blocks = fixtureBlocks();
    const user = await userWithDraft(context, "sp7", (handle) => draftOf(handle, blocks));
    await openEditor(page);
    const outer = async (scope: Locator, id: string) =>
      scope.locator(`[data-block-id="${id}"]`).evaluate((el) => el.outerHTML);
    const preview = previewScreen(page);
    const ids = [ID_A, ID_B, `${ID_LINKS}-0`, `${ID_LINKS}-5`];
    const inEditor: string[] = [];
    for (const id of ids) inEditor.push(await outer(preview, id));

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
    for (const [index, id] of ids.entries()) {
      expect(await outer(page.locator("body"), id), id).toBe(inEditor[index]);
    }
  });
});

test.describe("M9-03 the Editor refuses a new icon that points at a blocked site", () => {
  test("M9-03 a discord and a spotify icon at a listed domain show 'That site is blocked' under the icon's row and are not saved", async ({
    page,
    context,
  }) => {
    const domain = `sp-${rand(8)}.example`;
    const inserted = await adminClient().from("blocked_domains").insert({ domain, reason: "e2e" });
    expect(inserted.error).toBeNull();
    try {
      const blockId = "Sx4kT9pLq2Wa";
      const user = await emptyUser(context, "sp8", {
        draft: draftWith("x", [
          {
            id: blockId,
            type: "social",
            visible: true,
            icons: [
              icon("discord", "ico-blk-discord", "https://discord.example/invite"),
              icon("spotify", "ico-blk-spotif", "https://open.spotify.example/artist"),
            ],
          },
        ]),
      });
      await openEditor(page);
      await rowOf(page, blockId).locator("button[aria-expanded]").first().click();
      const before = (
        await adminClient().from("pages").select("draft").eq("id", user.pageId).single()
      ).data!.draft;
      for (const id of ["ico-blk-discord", "ico-blk-spotif"]) {
        const field = rowOf(page, blockId).locator(
          `[data-item-id="${id}"] input[data-field="url"]`,
        );
        await field.fill(`https://${domain}/x`);
        await expect(
          rowOf(page, blockId)
            .locator(`[data-item-id="${id}"]`)
            .getByText("That site is blocked. Use a different link."),
        ).toBeVisible({ timeout: 15_000 });
        await field.fill(`https://ok-${rand(4)}.example/x`);
        await expect(
          rowOf(page, blockId).getByText("That site is blocked. Use a different link."),
        ).toHaveCount(0, { timeout: 15_000 });
      }
      await expect(saveIndicator(page)).not.toHaveAttribute("data-save-status", "blocked");
      expect(before).toBeTruthy();
    } finally {
      await adminClient().from("blocked_domains").delete().eq("domain", domain);
    }
  });
});
