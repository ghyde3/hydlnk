import { expect, test, type Locator, type Page } from "@playwright/test";
import { supabaseUrl } from "../fixtures/auth";
import { cleanupUsers, insertPage, makeUser, rand } from "../fixtures/data";
import { expectNoHorizontalScroll, url } from "../helpers";
import { box, css, publishDocOf, publishedPage, uploadImage } from "../m2/blocks-helpers";
import type { Block } from "@/lib/document";
import type { TokenOverrides } from "@/lib/theme";

/**
 * M3-11 .. M3-16, the page side: how the shared renderer draws button style, corner radius, border
 * width, spacing, content width, alignment and the three backgrounds, on the live page (published
 * with the secret key, so nothing here depends on the Design screen), at 390x844 and 1440x900.
 *
 * Colors are chosen so the tokens that must differ do differ: buttonBg is blue, accent is brass.
 */

// The token schema only accepts a background image on this project's Storage origin.
process.env.NEXT_PUBLIC_SUPABASE_URL ??= supabaseUrl();

test.afterAll(cleanupUsers);

const COLORS: TokenOverrides = {
  bg: "#16120E",
  surface: "#221B13",
  text: "#EFE8DC",
  textMuted: "#A79E90",
  accent: "#C9A86A",
  buttonBg: "#3B5BDB",
  buttonText: "#FFFFFF",
  border: "#3A342D",
  radius: 12,
  borderWidth: 1,
  buttonStyle: "fill",
};
const RGB = {
  bg: "rgb(22, 18, 14)",
  surface: "rgb(34, 27, 19)",
  accent: [201, 168, 106],
  buttonBg: "rgb(59, 91, 219)",
  buttonText: "rgb(255, 255, 255)",
  text: "rgb(239, 232, 220)",
};

let counter = 0;
const bid = () => `blk-sec-${String(++counter).padStart(4, "0")}`;
const link = (label: string, extra: Partial<Extract<Block, { type: "link" }>> = {}): Block => ({
  id: bid(),
  type: "link",
  visible: true,
  label,
  url: "https://maraokafor.example/book",
  ...extra,
});

/** A page with every kind of block the shape tokens touch. */
function blocksFor(): Block[] {
  return [
    link("Plain link"),
    link("Second link"),
    link("Pill link", { overrides: { buttonStyle: "pill" } }),
    link("Outline link", { overrides: { buttonStyle: "outline" } }),
    { id: bid(), type: "header", visible: true, text: "A heading" },
    { id: bid(), type: "text", visible: true, text: "Some body text" },
    {
      id: bid(),
      type: "card",
      visible: true,
      title: "A card",
      caption: "View",
      url: "https://maraokafor.example/card",
      image: null,
    },
    {
      id: bid(),
      type: "embed",
      visible: true,
      url: "https://www.youtube.com/watch?v=jNQXAC9IVRw",
      caption: "Watch",
    },
    {
      id: bid(),
      type: "grid",
      visible: true,
      cells: [
        { id: bid(), title: "Prints", subtitle: "Shop", url: "https://maraokafor.example/prints" },
        { id: bid(), title: "Work", subtitle: "Learn", url: "https://maraokafor.example/work" },
      ],
    },
  ];
}

type Rgba = { r: number; g: number; b: number; a: number };

/** `rgb()`, `rgba()` and `color(srgb ...)` computed colors, whichever the browser prints. */
function parseColor(value: string): Rgba {
  const rgb = /^rgba?\(\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\s*\)$/.exec(value);
  if (rgb) return { r: +rgb[1]!, g: +rgb[2]!, b: +rgb[3]!, a: rgb[4] === undefined ? 1 : +rgb[4] };
  const modern = /^rgba?\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.%]+))?\s*\)$/.exec(
    value,
  );
  if (modern) {
    const a =
      modern[4] === undefined
        ? 1
        : modern[4].endsWith("%")
          ? +modern[4].slice(0, -1) / 100
          : +modern[4];
    return { r: +modern[1]!, g: +modern[2]!, b: +modern[3]!, a };
  }
  const srgb = /^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\)$/.exec(value);
  if (srgb) {
    return {
      r: Math.round(+srgb[1]! * 255),
      g: Math.round(+srgb[2]! * 255),
      b: Math.round(+srgb[3]! * 255),
      a: srgb[4] === undefined ? 1 : +srgb[4],
    };
  }
  throw new Error(`unrecognised color ${value}`);
}

function expectColor(actual: string, expected: readonly number[], alpha: number): void {
  const c = parseColor(actual);
  expect(Math.abs(c.r - expected[0]!), actual).toBeLessThanOrEqual(1);
  expect(Math.abs(c.g - expected[1]!), actual).toBeLessThanOrEqual(1);
  expect(Math.abs(c.b - expected[2]!), actual).toBeLessThanOrEqual(1);
  expect(Math.abs(c.a - alpha), actual).toBeLessThanOrEqual(0.005);
}

const byLabel = (page: Page, label: string): Locator => page.getByText(label, { exact: true });

async function look(locator: Locator) {
  return locator.evaluate((el) => {
    const s = getComputedStyle(el);
    return {
      bg: s.backgroundColor,
      color: s.color,
      borderColor: s.borderTopColor,
      borderWidth: s.borderTopWidth,
      radius: s.borderTopLeftRadius,
      shadow: s.boxShadow,
    };
  });
}

// ------------------------------------------------------------------------------------------------

test.describe("M3-11 button style on the live page", () => {
  test("M3-11 fill, outline, soft, shadow and pill compute as specified", async ({ page }) => {
    const styles = ["fill", "outline", "soft", "shadow", "pill"] as const;
    const looks: Record<string, Awaited<ReturnType<typeof look>>> = {};
    for (const style of styles) {
      const live = await publishedPage(
        `bs${style[0]}`,
        publishDocOf([link("Button")], { tokens: { ...COLORS, buttonStyle: style } }),
      );
      await page.goto(live.url);
      looks[style] = await look(byLabel(page, "Button"));
      await expectNoHorizontalScroll(page);
    }
    // Fill: buttonBg fill and border, buttonText.
    expect(looks.fill).toMatchObject({
      bg: RGB.buttonBg,
      borderColor: RGB.buttonBg,
      color: RGB.buttonText,
    });
    // Outline: transparent, accent border, text color.
    expect(parseColor(looks.outline!.bg).a).toBe(0);
    expectColor(looks.outline!.borderColor, RGB.accent, 1);
    expect(looks.outline!.color).toBe(RGB.text);
    // Soft: accent at 16%, no visible border, text color.
    expectColor(looks.soft!.bg, RGB.accent, 0.16);
    expect(parseColor(looks.soft!.borderColor).a).toBe(0);
    expect(looks.soft!.color).toBe(RGB.text);
    // Shadow: buttonBg fill and a 4px offset shadow.
    expect(looks.shadow!.bg).toBe(RGB.buttonBg);
    expect(looks.shadow!.shadow).not.toBe("none");
    expect(looks.shadow!.shadow).toMatch(/\b4px 4px\b/);
    // Pill: buttonBg fill and a 999px radius.
    expect(looks.pill!.bg).toBe(RGB.buttonBg);
    expect(looks.pill!.radius).toBe("999px");
    expect(looks.fill!.shadow).toBe("none");
  });

  test("M3-11 cards, headings, text and grid cells ignore the button style; an override keeps its own", async ({
    page,
  }) => {
    const signature = async (style: "fill" | "pill") => {
      const live = await publishedPage(
        `bi${style[0]}`,
        publishDocOf(blocksFor(), { tokens: { ...COLORS, buttonStyle: style } }),
      );
      await page.goto(live.url);
      const others = await page
        .locator(
          "[data-block-type=card], [data-block-type=header], [data-block-type=text], [data-block-type=grid] a",
        )
        .evaluateAll((els) =>
          els.map((el) => {
            const s = getComputedStyle(el);
            return [
              s.backgroundColor,
              s.borderTopLeftRadius,
              s.borderTopWidth,
              s.boxShadow,
              s.color,
            ];
          }),
        );
      const overridden = await look(byLabel(page, "Outline link"));
      const pill = await look(byLabel(page, "Pill link"));
      return { others, overridden, pill };
    };
    const fill = await signature("fill");
    const pill = await signature("pill");
    expect(fill.others.length).toBeGreaterThanOrEqual(5);
    expect(pill.others).toEqual(fill.others);
    // The link with its own style keeps it under both page styles.
    expect(pill.overridden).toEqual(fill.overridden);
    expect(parseColor(fill.overridden.bg).a).toBe(0);
    expect(fill.pill.radius).toBe("999px");
    expect(pill.pill.radius).toBe("999px");
  });
});

test.describe("M3-12 corner radius and border width on the live page", () => {
  test("M3-12 radius 20 reaches buttons, cards, grid cells and embed frames; avatars stay round and Pill stays 999px", async ({
    page,
  }) => {
    const live = await publishedPage(
      "rd",
      publishDocOf(blocksFor(), { tokens: { ...COLORS, radius: 20, borderWidth: 2 } }),
    );
    await page.goto(live.url);
    const radius = (locator: Locator) => css(locator.first(), "border-top-left-radius");
    expect(await radius(byLabel(page, "Plain link"))).toBe("20px");
    expect(await radius(page.locator("[data-block-type=card]"))).toBe("20px");
    expect(await radius(page.locator("[data-block-type=grid] a"))).toBe("20px");
    expect(await radius(page.locator("[data-block-type=embed] button"))).toBe("20px");
    expect(await radius(byLabel(page, "Pill link"))).toBe("999px");
    // The avatar is a circle whatever the radius token says.
    expect(await radius(page.locator("header >> div").first())).toBe("50%");
    await expectNoHorizontalScroll(page);
  });

  test("M3-12 border width reaches cards, grid cells and embed frames; an outline button never goes below 1px", async ({
    page,
  }) => {
    for (const width of [0, 2]) {
      const live = await publishedPage(
        `bw${width}`,
        publishDocOf(blocksFor(), { tokens: { ...COLORS, borderWidth: width } }),
      );
      await page.goto(live.url);
      for (const selector of [
        "[data-block-type=card]",
        "[data-block-type=grid] a",
        "[data-block-type=embed] button",
      ]) {
        expect(await css(page.locator(selector).first(), "border-top-width"), selector).toBe(
          `${width}px`,
        );
      }
      // The link with its own outline style stays visible at width 0.
      expect(await css(byLabel(page, "Outline link"), "border-top-width")).toBe(
        width === 0 ? "1px" : "2px",
      );
    }
  });
});

test.describe("M3-13 spacing, content width and alignment on the live page", () => {
  for (const [density, gap, width, align] of [
    ["compact", 8, 480, "center"],
    ["regular", 12, 560, "center"],
    ["airy", 18, 640, "left"],
  ] as const) {
    test(`M3-13 ${density} gives a ${gap}px gap, ${width} makes the column ${width}px wide on desktop, ${align} alignment`, async ({
      page,
    }, testInfo) => {
      const live = await publishedPage(
        `sp${density[0]}`,
        publishDocOf(blocksFor(), {
          tokens: { ...COLORS, density, maxWidth: width, align },
        }),
      );
      await page.goto(live.url);

      const first = await box(byLabel(page, "Plain link"));
      const second = await box(byLabel(page, "Second link"));
      expect(second.y - (first.y + first.height)).toBeCloseTo(gap, 1);

      const column = await box(page.locator("main"));
      const outer = await box(page.locator("[data-page-root] > div").first());
      if (testInfo.project.name === "desktop") {
        expect(outer.width).toBe(width);
        expect(column.width).toBeLessThan(width);
      } else {
        // A phone is narrower than any content width: the column fills it, and nothing scrolls.
        expect(outer.width).toBeLessThanOrEqual(390);
      }
      await expectNoHorizontalScroll(page);

      const textAlign = async (locator: Locator) => css(locator.first(), "text-align");
      expect(await textAlign(page.locator("h2[data-block-type=header]"))).toBe(align);
      expect(await textAlign(page.locator("p[data-block-type=text]"))).toBe(align);
      expect(await textAlign(page.locator("h1"))).toBe(align);
      expect(await css(page.locator("header").first(), "align-items")).toBe(
        align === "left" ? "flex-start" : "center",
      );
    });
  }
});

test.describe("M3-14 solid and gradient backgrounds on the live page", () => {
  for (const bgType of ["solid", "gradient"] as const) {
    test(`M3-14 ${bgType}: the page color fills the whole viewport of a short page`, async ({
      page,
    }) => {
      const live = await publishedPage(
        `bg${bgType[0]}`,
        publishDocOf([link("Only link")], { tokens: { ...COLORS, bgType } }),
      );
      await page.goto(live.url);
      const root = page.locator("[data-page-root]");
      await expect(root).toHaveAttribute("data-bg-type", bgType);
      const fill = await root.evaluate((el) => {
        const rect = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        return {
          top: rect.top,
          bottom: rect.bottom,
          height: window.innerHeight,
          bgColor: s.backgroundColor,
          bgImage: s.backgroundImage,
        };
      });
      // No unfilled strip below the content: the root reaches the bottom of the viewport.
      expect(fill.top).toBe(0);
      expect(fill.bottom).toBeGreaterThanOrEqual(fill.height);
      if (bgType === "solid") {
        expect(fill.bgColor).toBe(RGB.bg);
        expect(fill.bgImage).toBe("none");
      } else {
        // surface at 0%, bg at 55%, top to bottom.
        expect(fill.bgImage).toMatch(/^linear-gradient\(/);
        expect(fill.bgImage).toContain("rgb(34, 27, 19) 0%");
        expect(fill.bgImage).toContain("rgb(22, 18, 14) 55%");
        expect(fill.bgImage).not.toMatch(/\bto (top|left|right)\b|\d+deg/);
      }
      await expectNoHorizontalScroll(page);
    });
  }
});

test.describe("M3-15 / M3-16 image background on the live page", () => {
  test("M3-15 / M3-16 the image sits on its own layer, the overlay is the bg token and only the picture is blurred", async ({
    page,
  }) => {
    const user = await makeUser("bgi");
    const handle = `zq-bgi-${rand(5)}`;
    const image = await uploadImage(user.id, 1200, 800);
    const imageUrl = `${supabaseUrl()}/storage/v1/object/public/page-media/${image.path}`;
    const doc = publishDocOf(blocksFor(), {
      tokens: {
        ...COLORS,
        bgType: "image",
        bgImage: imageUrl,
        overlayOpacity: 0.6,
        blur: 12,
      },
    });
    await insertPage(user.id, handle, { published: doc, published_at: new Date().toISOString() });

    const imageResponse = page.waitForResponse((r) => r.url() === imageUrl);
    await page.goto(url(handle));
    expect((await imageResponse).status()).toBe(200);

    const root = page.locator("[data-page-root]");
    await expect(root).toHaveAttribute("data-bg-type", "image");
    const picture = page.locator("[data-bg-layer=image]");
    const overlay = page.locator("[data-bg-layer=overlay]");
    expect(await css(picture, "background-image")).toBe(`url("${imageUrl}")`);
    expect(await css(picture, "filter")).toBe("blur(12px)");
    // The overlay is the bg token at 0.6, above the picture, and is not blurred.
    expect(await css(overlay, "background-color")).toBe(RGB.bg);
    expect(await css(overlay, "opacity")).toBe("0.6");
    expect(await css(overlay, "filter")).toBe("none");
    // Text and buttons are not blurred, and sit above both layers.
    expect(await css(page.locator("[data-page-root] > div").last(), "filter")).toBe("none");
    expect(await css(byLabel(page, "Plain link"), "filter")).toBe("none");
    expect(await css(page.locator("h1"), "filter")).toBe("none");
    const stacking = await page.evaluate(() => {
      const el = document.elementFromPoint(window.innerWidth / 2, 120);
      return el?.closest("[data-bg-layer]") === null;
    });
    expect(stacking).toBe(true);

    // The picture is drawn three blur radii past the page on every side, so the blurred edge
    // never shows an unblurred or empty margin; the page itself fills the viewport.
    const rootBox = await box(root);
    const pictureBox = await box(picture);
    expect(rootBox.x - pictureBox.x).toBeCloseTo(36, 0);
    expect(pictureBox.x + pictureBox.width - (rootBox.x + rootBox.width)).toBeCloseTo(36, 0);
    expect(rootBox.y - pictureBox.y).toBeCloseTo(36, 0);
    expect(pictureBox.y + pictureBox.height - (rootBox.y + rootBox.height)).toBeCloseTo(36, 0);
    expect(await root.evaluate((el) => el.getBoundingClientRect().bottom)).toBeGreaterThanOrEqual(
      page.viewportSize()!.height,
    );
    await expectNoHorizontalScroll(page);
  });

  test("M3-15 a background image URL on another host is never requested", async ({ page }) => {
    // Nobody can publish this (the schema and the Publish gate refuse it); a row written straight
    // to the database must still not make the page call out.
    const user = await makeUser("bgx");
    const handle = `zq-bgx-${rand(5)}`;
    const doc = publishDocOf([link("Only link")], { tokens: COLORS });
    const hostile = {
      ...doc,
      tokens: { ...doc.tokens, bgType: "image", bgImage: "https://images.example.com/bg.webp" },
    };
    await insertPage(user.id, handle, {
      published: hostile,
      published_at: new Date().toISOString(),
    });
    const hosts = new Set<string>();
    page.on("request", (request) => hosts.add(new URL(request.url()).host));
    await page.goto(url(handle));
    await page.waitForLoadState("networkidle");
    expect([...hosts].filter((host) => /example\.com/.test(host))).toEqual([]);
    expect(await page.locator("[data-bg-layer]").count()).toBe(0);
  });
});
