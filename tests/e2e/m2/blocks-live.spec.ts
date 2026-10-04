import { expect, test, type Page } from "@playwright/test";
import { expectNoHorizontalScroll, expectTapTargets } from "../helpers";
import { cleanupUsers, desktopOnly, phoneOnly } from "../fixtures/data";
import type { Block, GridCell, SocialIcon } from "@/lib/document";
import type { TokenOverrides } from "@/lib/theme";
import { box, css, publishDocOf, publishedPage, uploadImage } from "./blocks-helpers";

/**
 * M2-15 .. M2-21, the public side: each block type as the live page draws it (a page published with
 * the secret key, so nothing here depends on the editor), at 390x844 and 1440x900.
 *
 * The colors below are a Noir-like theme, passed as page token overrides, so every assertion
 * compares a computed color with a token value.
 */

test.afterAll(cleanupUsers);

const NOIR: TokenOverrides = {
  bg: "#16120E",
  surface: "#221B13",
  text: "#EFE8DC",
  textMuted: "#A79E90",
  accent: "#C9A86A",
  buttonBg: "#C9A86A",
  buttonText: "#15110B",
  border: "#3A342D",
  fontHeading: "Instrument Serif",
  fontBody: "Geist",
  radius: 12,
  borderWidth: 1,
  buttonStyle: "fill",
};
const RGB = {
  surface: "rgb(34, 27, 19)",
  text: "rgb(239, 232, 220)",
  muted: "rgb(167, 158, 144)",
  accent: "rgb(201, 168, 106)",
  buttonText: "rgb(21, 17, 11)",
  border: "rgb(58, 52, 45)",
};

let counter = 0;
const bid = () => `blk-live-${String(++counter).padStart(4, "0")}`;
const link = (label: string, extra: Partial<Extract<Block, { type: "link" }>> = {}): Block => ({
  id: bid(),
  type: "link",
  visible: true,
  label,
  url: "https://maraokafor.example/book",
  ...extra,
});
const icon = (platform: SocialIcon["platform"], n: number): SocialIcon =>
  platform === "email"
    ? {
        id: `ico-live-${String(n).padStart(4, "0")}`,
        platform,
        address: "hello@maraokafor.example",
      }
    : {
        id: `ico-live-${String(n).padStart(4, "0")}`,
        platform,
        url: `https://example.com/${platform}`,
      };
const cell = (n: number, title: string, subtitle = "Subtitle"): GridCell => ({
  id: `cel-live-${String(n).padStart(4, "0")}`,
  title,
  subtitle,
  url: `https://maraokafor.example/${n}`,
});

function trackDialogs(page: Page): string[] {
  const dialogs: string[] = [];
  page.on("dialog", (dialog) => {
    dialogs.push(dialog.message());
    void dialog.dismiss();
  });
  return dialogs;
}

/** Hosts of every request the page makes. */
function trackHosts(page: Page): Set<string> {
  const hosts = new Set<string>();
  page.on("request", (request) => hosts.add(new URL(request.url()).host));
  return hosts;
}

const column = (page: Page) => box(page.locator("main"));

// ------------------------------------------------------------------------------------------------

test.describe("M2-15 link button", () => {
  test("M2-15 renders an anchor with the label, the validated url and rel, filling the column", async ({
    page,
  }, testInfo) => {
    const dialogs = trackDialogs(page);
    const evil = "<img src=x onerror=alert(1)>";
    const doc = publishDocOf([link("Portrait sessions - fall dates"), link(evil)], {
      tokens: NOIR,
    });
    const live = await publishedPage("lk", doc);
    await page.goto(live.url);
    const first = page.locator("a[data-block-type=link]").first();
    await expect(first).toHaveText("Portrait sessions - fall dates");
    // The link goes through the click redirect (M4-22): the destination is not in the markup.
    await expect(first).toHaveAttribute("href", `/r/${live.pageId}/${doc.blocks[0]!.id}`);
    await expect(first).toHaveAttribute("rel", "nofollow noopener");
    expect(await css(first, "display")).toBe("flex");
    expect(await css(first, "justify-content")).toBe("center");
    expect(await css(first, "text-align")).toBe("center");
    expect(parseFloat(await css(first, "min-height"))).toBe(58);
    const col = await column(page);
    const rect = await box(first);
    expect(Math.abs(rect.width - col.width)).toBeLessThanOrEqual(1);
    if (desktopOnly(testInfo)) expect(rect.width).toBeLessThanOrEqual(480);

    // Hostile label: visible text, no element, no dialog.
    await expect(page.locator("a[data-block-type=link]").nth(1)).toHaveText(evil);
    await expect(page.locator("main img")).toHaveCount(0);
    await page.waitForTimeout(400);
    expect(dialogs).toEqual([]);
  });

  test("M2-15 the five button styles render five distinct looks; a block override beats the token", async ({
    page,
  }) => {
    const styles = ["fill", "outline", "soft", "shadow", "pill"] as const;
    const blocks = styles.map((style) =>
      link(`Style ${style}`, { overrides: { buttonStyle: style } }),
    );
    // Token style fill; the link without an override must stay fill, the pill override must win.
    const live = await publishedPage(
      "ls",
      publishDocOf([...blocks, link("No override")], { tokens: NOIR }),
    );
    await page.goto(live.url);

    type Look = { bg: string; border: string; shadow: string; radius: string; color: string };
    const looks = {} as Record<(typeof styles)[number] | "none", Look>;
    for (const style of [...styles, "none"] as const) {
      const label = style === "none" ? "No override" : `Style ${style}`;
      looks[style] = await page.getByText(label, { exact: true }).evaluate((el) => {
        const s = getComputedStyle(el);
        return {
          bg: s.backgroundColor,
          border: s.borderTopColor,
          shadow: s.boxShadow,
          radius: s.borderTopLeftRadius,
          color: s.color,
        };
      });
    }
    expect(looks.fill).toMatchObject({ bg: RGB.accent, color: RGB.buttonText, radius: "12px" });
    expect(looks.outline.bg).toBe("rgba(0, 0, 0, 0)");
    expect(looks.outline.border).toBe(RGB.accent);
    expect(looks.soft.bg).not.toBe("rgba(0, 0, 0, 0)");
    expect(looks.soft.bg).not.toBe(RGB.accent);
    // Soft is the accent at 16% alpha (M3-11; the Milestone 2 renderer drew 18%).
    expect(looks.soft.bg).toMatch(/0\.16|\/ 0\.16/);
    expect(looks.shadow.shadow).not.toBe("none");
    expect(looks.pill.radius).toBe("999px");
    expect(looks.pill.bg).toBe(RGB.accent);
    expect(looks.none).toEqual(looks.fill);
    expect(looks.fill.shadow).toBe("none");
    // Distinct computed styles.
    const signatures = new Set(styles.map((s) => JSON.stringify(looks[s])));
    expect(signatures.size).toBe(5);
  });

  test("M2-15 the radius and borderWidth tokens apply, and a block overrides.radius wins", async ({
    page,
  }) => {
    const live = await publishedPage(
      "lr",
      publishDocOf([link("Token shape"), link("Block shape", { overrides: { radius: 4 } })], {
        tokens: { ...NOIR, radius: 20, borderWidth: 3 },
      }),
    );
    await page.goto(live.url);
    const token = page.getByText("Token shape", { exact: true });
    expect(await css(token, "border-top-left-radius")).toBe("20px");
    expect(await css(token, "border-top-width")).toBe("3px");
    const block = page.getByText("Block shape", { exact: true });
    expect(await css(block, "border-top-left-radius")).toBe("4px");
  });

  for (const [density, minHeight] of [
    ["compact", 48],
    ["regular", 58],
    ["airy", 64],
  ] as const) {
    test(`M2-15 at density ${density} the button is at least 44px tall (min-height ${minHeight}px)`, async ({
      page,
    }) => {
      const live = await publishedPage(
        `ld${density[0]}`,
        publishDocOf([link("Density")], { tokens: { density } }),
      );
      await page.goto(live.url);
      const anchor = page.locator("a[data-block-type=link]");
      expect(parseFloat(await css(anchor, "min-height"))).toBe(minHeight);
      expect((await box(anchor)).height).toBeGreaterThanOrEqual(44);
    });
  }

  test("M2-15 an 80-character label wraps inside the button, whether it has spaces or not", async ({
    page,
  }) => {
    const spaced =
      "Book the long portrait session with the studio and the whole team this autumn!!".padEnd(
        80,
        "!",
      );
    const unbroken = "x".repeat(80);
    expect(Array.from(spaced)).toHaveLength(80);
    const live = await publishedPage(
      "lw",
      publishDocOf([link(spaced), link(unbroken)], { tokens: NOIR }),
    );
    await page.goto(live.url);
    for (const anchor of await page.locator("a[data-block-type=link]").all()) {
      const rect = await box(anchor);
      expect(rect.height).toBeGreaterThanOrEqual(44);
      const fits = await anchor.evaluate((el) => el.scrollWidth <= el.clientWidth + 1);
      expect(fits).toBe(true);
    }
    await expectNoHorizontalScroll(page);
    await expectTapTargets(page, "[data-page-root]");
  });
});

// ------------------------------------------------------------------------------------------------

test.describe("M2-16 header, text and divider", () => {
  const longText = `${"Sentence number one goes on for a good while. ".repeat(14)}`.slice(0, 600);

  test("M2-16 header is an h2 in the heading font, text is a muted pre-line p, divider is a 60% hr", async ({
    page,
  }) => {
    const dialogs = trackDialogs(page);
    const doc = publishDocOf(
      [
        { id: bid(), type: "header", visible: true, text: "<script>alert(1)</script>" },
        {
          id: bid(),
          type: "text",
          visible: true,
          text: "javascript:alert(1) and https://example.com\nsecond line",
        },
        { id: bid(), type: "divider", visible: true },
      ],
      { tokens: NOIR },
    );
    const live = await publishedPage("hd", doc);
    await page.goto(live.url);

    const header = page.locator("h2[data-block-type=header]");
    await expect(header).toHaveText("<script>alert(1)</script>");
    const rootHeading = await page
      .locator("[data-page-root]")
      .evaluate((el) => (el as HTMLElement).style.getPropertyValue("--t-font-heading"));
    expect(await css(header, "font-family")).toBe(rootHeading);
    expect(await css(header, "text-align")).toBe("center");

    const text = page.locator("p[data-block-type=text]");
    expect(await css(text, "color")).toBe(RGB.muted);
    expect(await css(text, "white-space")).toBe("pre-line");
    await expect(text.locator("a")).toHaveCount(0);
    await expect(text).toHaveText("javascript:alert(1) and https://example.com\nsecond line");
    const tops = await text.evaluate((el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      return new Set(Array.from(range.getClientRects()).map((r) => Math.round(r.top))).size;
    });
    expect(tops).toBeGreaterThanOrEqual(2);

    const hr = page.locator("hr[data-block-type=divider]");
    const col = await column(page);
    const rect = await box(hr);
    expect(Math.abs(rect.width - col.width * 0.6)).toBeLessThanOrEqual(1);
    expect(rect.height).toBe(1);
    expect(Math.abs(rect.x + rect.width / 2 - (col.x + col.width / 2))).toBeLessThanOrEqual(1);
    expect(await css(hr, "background-color")).toBe(RGB.border);

    await page.waitForTimeout(400);
    expect(dialogs).toEqual([]);
  });

  test("M2-16 a 600-character text wraps inside the column and stays within 480px", async ({
    page,
  }) => {
    const live = await publishedPage(
      "ht",
      publishDocOf(
        [
          { id: bid(), type: "header", visible: true, text: "H".repeat(80) },
          { id: bid(), type: "text", visible: true, text: longText },
          { id: bid(), type: "text", visible: true, text: "u".repeat(300) },
          { id: bid(), type: "divider", visible: true },
        ],
        { tokens: NOIR },
      ),
    );
    await page.goto(live.url);
    await expectNoHorizontalScroll(page);
    const col = await column(page);
    expect(col.width).toBeLessThanOrEqual(480);
    for (const block of await page.locator("main > [data-block-id]").all()) {
      const rect = await box(block);
      expect(rect.x).toBeGreaterThanOrEqual(col.x - 1);
      expect(rect.x + rect.width).toBeLessThanOrEqual(col.x + col.width + 1);
    }
  });

  test("M2-16 the align token left-aligns the header and text", async ({ page }) => {
    const live = await publishedPage(
      "hl",
      publishDocOf(
        [
          { id: bid(), type: "header", visible: true, text: "Left header" },
          { id: bid(), type: "text", visible: true, text: "Left text" },
        ],
        { tokens: { align: "left" } },
      ),
    );
    await page.goto(live.url);
    expect(await css(page.locator("h2[data-block-type=header]"), "text-align")).toBe("left");
    expect(await css(page.locator("p[data-block-type=text]"), "text-align")).toBe("left");
    expect(await css(page.locator("h1"), "text-align")).toBe("left");
  });
});

// ------------------------------------------------------------------------------------------------

test.describe("M2-17 social icons", () => {
  test("M2-17 a nav of 44px circular anchors named after the platform, with an 18px inline svg, no remote requests", async ({
    page,
  }) => {
    const hosts = trackHosts(page);
    const platforms = [
      "instagram",
      "tiktok",
      "youtube",
      "x",
      "facebook",
      "linkedin",
      "github",
      "threads",
    ] as const;
    const live = await publishedPage(
      "so",
      publishDocOf(
        [
          {
            id: bid(),
            type: "social",
            visible: true,
            icons: [...platforms.slice(0, 4), "email" as const].map((p, i) => icon(p, i + 1)),
          },
        ],
        { tokens: NOIR },
      ),
    );
    await page.goto(live.url);
    const nav = page.getByRole("navigation", { name: "Social" });
    await expect(nav).toBeVisible();
    const anchors = nav.locator("a");
    await expect(anchors).toHaveCount(5);
    expect(
      await anchors.evaluateAll((els) => els.map((el) => el.getAttribute("aria-label"))),
    ).toEqual(["Instagram", "TikTok", "YouTube", "X", "Email"]);
    expect(await anchors.last().getAttribute("href")).toBe("mailto:hello@maraokafor.example");
    expect(await anchors.first().getAttribute("href")).toBe(`/r/${live.pageId}/ico-live-0001`);
    for (const anchor of await anchors.all()) {
      const rect = await box(anchor);
      expect(rect.width).toBe(44);
      expect(rect.height).toBe(44);
      expect(await css(anchor, "border-top-left-radius")).toBe("50%");
      expect(await css(anchor, "border-top-width")).toBe("1px");
      expect(await css(anchor, "border-top-color")).toBe(RGB.border);
      expect(await css(anchor, "color")).toBe(RGB.text);
      const svg = await box(anchor.locator("svg"));
      expect(svg.width).toBe(18);
      expect(svg.height).toBe(18);
      expect(await css(anchor.locator("svg"), "stroke")).toBe(RGB.text);
    }
    expect(await css(nav, "column-gap")).toBe("10px");
    expect(await css(nav, "flex-wrap")).toBe("wrap");
    // The page's own host and nothing else: since M8-01 the theme fonts come from our own host, so a
    // tenant page no longer asks Google for a stylesheet or for font files.
    expect([...hosts]).toEqual([new URL(live.url).host]);
  });

  test("M2-17 eight icons wrap on a phone and are centered in the column on a desktop", async ({
    page,
  }, testInfo) => {
    const platforms = [
      "instagram",
      "tiktok",
      "youtube",
      "x",
      "facebook",
      "linkedin",
      "github",
      "threads",
    ] as const;
    const live = await publishedPage(
      "s8",
      publishDocOf([
        {
          id: bid(),
          type: "social",
          visible: true,
          icons: platforms.map((p, i) => icon(p, i + 1)),
        },
      ]),
    );
    await page.goto(live.url);
    const anchors = page.locator("nav[aria-label=Social] a");
    await expect(anchors).toHaveCount(8);
    const rects = await anchors.evaluateAll((els) =>
      els.map((el) => el.getBoundingClientRect().toJSON()),
    );
    for (const rect of rects) {
      expect(rect.width).toBeGreaterThanOrEqual(44);
      expect(rect.height).toBeGreaterThanOrEqual(44);
    }
    await expectNoHorizontalScroll(page);
    await expectTapTargets(page, "nav[aria-label=Social]");
    const rows = new Set(rects.map((r) => Math.round(r.top)));
    const col = await column(page);
    if (phoneOnly(testInfo)) {
      expect(rows.size).toBeGreaterThanOrEqual(2);
      // 10px gap between rows too.
      const [firstRow, secondRow] = [...rows].sort((a, b) => a - b);
      expect(secondRow! - firstRow! - 44).toBe(10);
    } else {
      expect(rows.size).toBe(1);
      const left = rects[0]!.left - col.x;
      const right = col.x + col.width - rects[rects.length - 1]!.right;
      expect(Math.abs(left - right)).toBeLessThanOrEqual(1);
    }
  });
});

// ------------------------------------------------------------------------------------------------

test.describe("M2-18 two-column grid", () => {
  test("M2-18 two columns, an odd last cell leaves the row half empty, cells carry their ids", async ({
    page,
  }) => {
    const live = await publishedPage(
      "gr",
      publishDocOf(
        [
          {
            id: bid(),
            type: "grid",
            visible: true,
            cells: [cell(1, "Prints"), cell(2, "Workshops"), cell(3, "Gift cards")],
          },
        ],
        { tokens: NOIR },
      ),
    );
    await page.goto(live.url);
    const grid = page.locator("[data-block-type=grid]");
    const tracks = (await css(grid, "grid-template-columns")).split(" ");
    expect(tracks).toHaveLength(2);
    expect(tracks[0]).toBe(tracks[1]);
    expect(await css(grid, "column-gap")).toBe("10px");
    const cells = grid.locator("a");
    expect(
      await cells.evaluateAll((els) => els.map((el) => el.getAttribute("data-item-id"))),
    ).toEqual(["cel-live-0001", "cel-live-0002", "cel-live-0003"]);
    const [a, b, c] = (await cells.all()).map((handle) => box(handle));
    const [ra, rb, rc] = await Promise.all([a!, b!, c!]);
    expect(ra.y).toBe(rb.y);
    expect(rc.y).toBeGreaterThan(ra.y);
    expect(rc.x).toBe(ra.x);
    expect(rc.width).toBeCloseTo(ra.width, 0);
    const gridBox = await box(grid);
    expect(rc.x + rc.width).toBeLessThan(gridBox.x + gridBox.width - 10);
    for (const handle of await cells.all()) {
      expect((await box(handle)).height).toBeGreaterThanOrEqual(44);
      expect(await css(handle, "border-top-width")).toBe("1px");
      expect(await css(handle, "border-top-color")).toBe(RGB.border);
      expect(await css(handle, "border-top-left-radius")).toBe("12px");
    }
    const title = cells.first().locator("span").first();
    expect(await css(title, "font-size")).toBe("15px");
    expect(await css(title, "font-weight")).toBe("500");
    const subtitle = cells.first().locator("span").nth(1);
    expect(await css(subtitle, "font-size")).toBe("13px");
    expect(await css(subtitle, "color")).toBe(RGB.muted);
  });

  test("M2-18 long unbroken titles and subtitles wrap, and the grid fills the column", async ({
    page,
  }) => {
    const live = await publishedPage(
      "gl",
      publishDocOf([
        {
          id: bid(),
          type: "grid",
          visible: true,
          cells: [
            cell(
              1,
              "Supercalifragilisticexpialidocious",
              "Thequickbrownfoxjumpsoverthelazydogagainandagain",
            ),
            cell(2, "T".repeat(40), "S".repeat(60)),
          ],
        },
      ]),
    );
    await page.goto(live.url);
    await expectNoHorizontalScroll(page);
    await expectTapTargets(page, "[data-block-type=grid]");
    for (const handle of await page.locator("[data-block-type=grid] a").all()) {
      expect(await handle.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    }
    const col = await column(page);
    const grid = await box(page.locator("[data-block-type=grid]"));
    expect(Math.abs(grid.width - col.width)).toBeLessThanOrEqual(1);
    expect(col.width).toBeLessThanOrEqual(480);
  });
});

// ------------------------------------------------------------------------------------------------

test.describe("M2-19 embeds", () => {
  const youtube = (): Block => ({
    id: bid(),
    type: "embed",
    visible: true,
    url: "https://www.youtube.com/watch?v=aqz-KE-bpKQ",
    caption: "Behind the lens, ep. 4",
  });
  const spotify = (kind: string, caption = "Studio playlist"): Block => ({
    id: bid(),
    type: "embed",
    visible: true,
    url: `https://open.spotify.com/${kind}/37i9dQZF1DXcBWIGoYBM5M`,
    caption,
  });

  test("M2-19 no request to YouTube or Google until Play is pressed; then the nocookie iframe mounts", async ({
    page,
  }) => {
    const requests: string[] = [];
    page.on("request", (request) => requests.push(request.url()));
    await page.route(/youtube-nocookie\.com/, (route) => route.abort());

    const live = await publishedPage("ey", publishDocOf([youtube()], { tokens: NOIR }));
    await page.goto(live.url);
    const facade = page.locator("[data-block-type=embed] button");
    await expect(facade).toBeVisible();
    await page.waitForTimeout(1000);
    // The page's own Google Fonts stylesheet and files (M3-04) are expected; nothing else google,
    // and no YouTube host at all, until Play is pressed.
    const fontHosts = new Set(["fonts.googleapis.com", "fonts.gstatic.com"]);
    const third = requests.filter((u) => {
      const host = new URL(u).host;
      return (
        !fontHosts.has(host) && /youtube|youtu\.be|google|ytimg|gstatic|doubleclick/i.test(host)
      );
    });
    expect(third).toEqual([]);
    await expect(page.locator("iframe")).toHaveCount(0);

    await expect(facade).toHaveAttribute("aria-label", "Play video: Behind the lens, ep. 4");
    await expect(page.locator(".pg-embed-caption")).toHaveText("Behind the lens, ep. 4 · YouTube");
    const rect = await box(facade);
    const col = await column(page);
    expect(Math.abs(rect.width - col.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(rect.width / rect.height - 16 / 9)).toBeLessThan(0.02);
    expect(rect.height).toBeGreaterThanOrEqual(44);
    expect(await css(facade, "background-color")).toBe("rgb(5, 5, 5)");

    const request = page.waitForRequest((r) => /youtube-nocookie\.com/.test(r.url()));
    await facade.click();
    expect((await request).url()).toMatch(
      /^https:\/\/www\.youtube-nocookie\.com\/embed\/aqz-KE-bpKQ/,
    );
    const frame = page.locator("[data-block-type=embed] iframe");
    await expect(frame).toHaveCount(1);
    await expect(frame).toHaveAttribute("title", /Behind the lens, ep\. 4/);
    await expect(frame).toHaveAttribute("allow", "autoplay; encrypted-media; picture-in-picture");
    await expect(frame).toHaveAttribute("allowfullscreen", "");
    await expect(frame).toHaveAttribute("referrerpolicy", "strict-origin-when-cross-origin");
    await expect(facade).toHaveCount(0);
    await expectNoHorizontalScroll(page);
  });

  test("M2-19 Spotify renders a facade as tall as its player, 152px for a track and 352px for an album, inside the column; a tap mounts the player", async ({
    page,
  }) => {
    // M8-05 supersedes the lazy iframe: nothing is requested from Spotify until a tap.
    const requested: string[] = [];
    await page.route(/open\.spotify\.com/, (route) => {
      requested.push(route.request().url());
      return route.abort();
    });
    const live = await publishedPage(
      "es",
      publishDocOf([spotify("track"), spotify("album", "The album")], { tokens: NOIR }),
    );
    await page.goto(live.url);
    await expect(page.locator("[data-block-type=embed] iframe")).toHaveCount(0);
    const posters = page.locator("[data-block-type=embed] .pg-embed-play");
    await expect(posters).toHaveCount(2);
    const col = await column(page);
    const [track, album] = await Promise.all((await posters.all()).map((poster) => box(poster)));
    expect(track!.height).toBe(152);
    expect(album!.height).toBe(352);
    for (const rect of [track!, album!]) {
      expect(rect.width).toBeLessThanOrEqual(col.width + 1);
      expect(rect.x).toBeGreaterThanOrEqual(col.x - 1);
    }
    expect(requested).toEqual([]);
    await expectNoHorizontalScroll(page);

    await posters.first().click();
    await posters.first().click();
    const frames = page.locator("[data-block-type=embed] iframe");
    await expect(frames).toHaveCount(2);
    expect(await frames.evaluateAll((els) => els.map((el) => el.getAttribute("src")))).toEqual([
      "https://open.spotify.com/embed/track/37i9dQZF1DXcBWIGoYBM5M",
      "https://open.spotify.com/embed/album/37i9dQZF1DXcBWIGoYBM5M",
    ]);
    const [playingTrack, playingAlbum] = await Promise.all(
      (await frames.all()).map((frame) => box(frame)),
    );
    expect(playingTrack!.height).toBe(152);
    expect(playingAlbum!.height).toBe(352);
    await expectNoHorizontalScroll(page);
  });

  test("M2-19 the embed stays within the 480px column on a desktop", async ({ page }, testInfo) => {
    test.skip(!desktopOnly(testInfo), "desktop layout check");
    await page.route(/youtube-nocookie\.com|open\.spotify\.com/, (route) => route.abort());
    const live = await publishedPage("ew", publishDocOf([youtube(), spotify("playlist")]));
    await page.goto(live.url);
    for (const block of await page.locator("[data-block-type=embed]").all()) {
      expect((await box(block)).width).toBeLessThanOrEqual(480);
    }
  });
});

// ------------------------------------------------------------------------------------------------

test.describe("M2-20 image block", () => {
  test("M2-20 an uploaded image: size attributes, lazy loading, the radius token, full column width, linked", async ({
    page,
  }) => {
    const owner = await publishedPage("im0", publishDocOf([]));
    const image = await uploadImage(owner.userId, 600, 300);
    // The renderer builds the url from the path, so one owner's folder serves any page's block.
    const doc = publishDocOf(
      [
        {
          id: bid(),
          type: "image",
          visible: true,
          image,
          alt: "The studio at golden hour",
          url: "https://maraokafor.example/studio",
        },
        { id: bid(), type: "image", visible: true, image, alt: "No link" },
      ],
      { tokens: { ...NOIR, radius: 16 } },
    );
    const live = await publishedPage("im", doc);
    await page.goto(live.url);
    const [linked, plain] = await page.locator("[data-block-type=image]").all();
    const img = linked!.locator("img");
    await expect(img).toHaveAttribute("alt", "The studio at golden hour");
    await expect(img).toHaveAttribute("width", "600");
    await expect(img).toHaveAttribute("height", "300");
    await expect(img).toHaveAttribute("loading", "lazy");
    await expect(img).toHaveAttribute(
      "src",
      new RegExp(`^http://localhost:\\d+/media/${image.path}$`),
    );
    const anchor = linked!.locator("a");
    await expect(anchor).toHaveAttribute(
      "href",
      `/r/${live.pageId}/${await linked!.getAttribute("data-block-id")}`,
    );
    await expect(anchor).toHaveAttribute("rel", "nofollow noopener");
    expect(await css(img, "border-top-left-radius")).toBe("16px");
    expect(await css(img, "max-width")).toBe("100%");
    await expect(plain!.locator("a")).toHaveCount(0);

    await img.scrollIntoViewIfNeeded();
    await expect(img).toHaveJSProperty("complete", true);
    const rect = await box(img);
    const col = await column(page);
    expect(Math.abs(rect.width - col.width)).toBeLessThanOrEqual(1);
    expect(rect.width / rect.height).toBeCloseTo(2, 1);
    await expectNoHorizontalScroll(page);
  });
});

// ------------------------------------------------------------------------------------------------

test.describe("M2-21 link card", () => {
  test("M2-21 without an image: a surface banner with the title in the heading font and accent, the caption and an arrow", async ({
    page,
  }) => {
    const dialogs = trackDialogs(page);
    const doc = publishDocOf(
      [
        {
          id: bid(),
          type: "card",
          visible: true,
          title: "Night Market",
          caption: "",
          url: "https://maraokafor.example/night-market",
          image: null,
        },
        {
          id: bid(),
          type: "card",
          visible: true,
          title: "<img src=x onerror=alert(1)>",
          caption: "View the gallery",
          url: "https://maraokafor.example/gallery",
          image: null,
        },
      ],
      { tokens: NOIR },
    );
    const live = await publishedPage("cd", doc);
    await page.goto(live.url);
    const card = page.locator("a[data-block-type=card]").first();
    await expect(card).toHaveAttribute(
      "href",
      `/r/${live.pageId}/${await card.getAttribute("data-block-id")}`,
    );
    await expect(card).toHaveAttribute("rel", "nofollow noopener");
    expect(await css(card, "border-top-width")).toBe("1px");
    expect(await css(card, "border-top-color")).toBe(RGB.border);
    expect(await css(card, "border-top-left-radius")).toBe("12px");
    const col = await column(page);
    const rect = await box(card);
    expect(Math.abs(rect.width - col.width)).toBeLessThanOrEqual(1);
    expect(rect.height).toBeGreaterThanOrEqual(44);

    const banner = card.locator(".pg-card-banner");
    const bannerRect = await box(banner);
    expect(bannerRect.width / bannerRect.height).toBeCloseTo(5 / 2, 1);
    expect(await css(banner, "background-color")).toBe(RGB.surface);
    const title = card.locator(".pg-card-title");
    await expect(title).toHaveText("Night Market");
    expect(await css(title, "color")).toBe(RGB.accent);
    const rootHeading = await page
      .locator("[data-page-root]")
      .evaluate((el) => (el as HTMLElement).style.getPropertyValue("--t-font-heading"));
    expect(await css(title, "font-family")).toBe(rootHeading);
    await expect(card.locator(".pg-card-caption")).toHaveText("View");
    const arrow = card.locator(".pg-card-arrow");
    await expect(arrow).toHaveText("→");
    await expect(arrow).toHaveAttribute("aria-hidden", "true");
    expect(await css(arrow, "color")).toBe(RGB.accent);
    await expect(card.locator("img")).toHaveCount(0);

    // Hostile title: text, not an element.
    const second = page.locator("a[data-block-type=card]").nth(1);
    await expect(second.locator(".pg-card-title")).toHaveText("<img src=x onerror=alert(1)>");
    await expect(second.locator(".pg-card-caption")).toHaveText("View the gallery");
    await expect(page.locator("main img")).toHaveCount(0);
    await page.waitForTimeout(400);
    expect(dialogs).toEqual([]);
  });

  test("M2-21 with an image: object-fit cover, an empty alt and the title still in the link", async ({
    page,
  }) => {
    const owner = await publishedPage("cm0", publishDocOf([]));
    const image = await uploadImage(owner.userId, 500, 300, [30, 90, 160]);
    const live = await publishedPage(
      "cm",
      publishDocOf(
        [
          {
            id: bid(),
            type: "card",
            visible: true,
            title: "Night Market",
            caption: "See more",
            url: "https://maraokafor.example/night-market",
            image,
          },
        ],
        { tokens: NOIR },
      ),
    );
    await page.goto(live.url);
    const card = page.locator("a[data-block-type=card]");
    const img = card.locator("img");
    await expect(img).toHaveAttribute("alt", "");
    expect(await css(img, "object-fit")).toBe("cover");
    await expect(img).toHaveJSProperty("complete", true);
    await expect(card).toContainText("Night Market");
    await expect(card.locator(".pg-card-caption")).toHaveText("See more");
    const banner = await box(card.locator(".pg-card-banner"));
    const rendered = await box(img);
    expect(rendered.width).toBeCloseTo(banner.width, 0);
    expect(rendered.height).toBeCloseTo(banner.height, 0);
    expect(banner.width / banner.height).toBeCloseTo(5 / 2, 1);
    // The card's accessible name includes the title.
    expect((await card.textContent())?.includes("Night Market")).toBe(true);
    await expectNoHorizontalScroll(page);
  });
});
