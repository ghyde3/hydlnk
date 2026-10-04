import { expect, test, type Page } from "@playwright/test";
import { supabaseUrl } from "../fixtures/auth";
import { cleanupUsers, desktopOnly, phoneOnly } from "../fixtures/data";
import { expectNoHorizontalScroll, url } from "../helpers";
import {
  LONG_LABEL,
  anchorOf,
  css,
  expectLinksTall,
  geometry,
  hexToRgb,
  linkBlock,
  liveLinks,
} from "./links-helpers";

/**
 * M6-20 (link icons and thumbnails) and M6-22 (featured links) on the public page. Each test
 * publishes its own page with the secret key and reads it back as a visitor, so what is checked is
 * what the one shared renderer draws on http://<handle>.localhost:3000 (the editor preview uses the
 * same component; their parity is in links-editor.spec.ts).
 */

test.afterAll(cleanupUsers);
test.describe.configure({ timeout: 120_000 });

/** The page's images are loaded (a thumbnail has its real size) before anything is measured. */
async function settled(page: Page): Promise<void> {
  await page.waitForFunction(() => Array.from(document.images).every((img) => img.complete));
}

/** `value` as the browser's computed color string (`rgb(...)`), whatever notation it came in. */
const resolveColor = (page: Page, value: string) =>
  page.evaluate((v) => {
    const probe = document.createElement("span");
    probe.style.color = v;
    document.body.append(probe);
    const resolved = getComputedStyle(probe).color;
    probe.remove();
    return resolved;
  }, value);

const accentOf = (page: Page, blockId: string) =>
  anchorOf(page, blockId).evaluate((el) =>
    getComputedStyle(el).getPropertyValue("--t-accent").trim(),
  );

test.describe("M6-20 layout of an icon or thumbnail link", () => {
  for (const density of ["compact", "regular", "airy"] as const) {
    test(`M6-20 ${density} density: the label wraps beside the icon, never under it, and every link is tall enough`, async ({
      page,
    }, info) => {
      const live = await liveLinks(
        `lk-${density}`,
        (thumb) => [
          linkBlock("Lk-icon-0001", {
            label: "Book a call",
            icon: { type: "builtin", name: "calendar" },
          }),
          linkBlock("Lk-thumb-0001", {
            label: "Portrait sessions",
            icon: { type: "image", image: thumb },
          }),
          linkBlock("Lk-long-0001", {
            label: LONG_LABEL,
            icon: { type: "builtin", name: "heart" },
          }),
          linkBlock("Lk-longth-001", {
            label: LONG_LABEL,
            icon: { type: "image", image: thumb },
          }),
          linkBlock("Lk-plain-0001", { label: "No icon here" }),
        ],
        { tokens: { density } },
      );
      expect(LONG_LABEL).toHaveLength(80);
      await page.goto(live.url);
      await expect(page.locator(".pg-link")).toHaveCount(5);
      await settled(page);

      // The page's own accessible names are the labels, exactly.
      for (const [id, label] of [
        ["Lk-icon-0001", "Book a call"],
        ["Lk-thumb-0001", "Portrait sessions"],
        ["Lk-long-0001", LONG_LABEL],
        ["Lk-plain-0001", "No icon here"],
      ] as const) {
        await expect(anchorOf(page, id)).toHaveText(label);
      }

      await expectLinksTall(page, 44);
      if (density === "regular") await expectLinksTall(page, 58);
      await expectNoHorizontalScroll(page);

      for (const id of ["Lk-icon-0001", "Lk-thumb-0001", "Lk-long-0001", "Lk-longth-001"]) {
        const g = await geometry(page, id);
        expect(g.icon, id).not.toBeNull();
        // The icon is at the start edge; the label begins after it and stays inside the button.
        expect(g.icon!.left - g.anchor.left, `${id} icon at the start edge`).toBeLessThan(26);
        expect(g.label!.left, `${id} label starts after the icon`).toBeGreaterThanOrEqual(
          g.icon!.right - 0.5,
        );
        expect(g.text!.left, `${id} text clear of the icon`).toBeGreaterThanOrEqual(
          g.icon!.right - 0.5,
        );
        expect(g.text!.right, `${id} text inside the button`).toBeLessThanOrEqual(
          g.anchor.right + 0.5,
        );
        // The icon is centered on the button's height.
        const iconMid = (g.icon!.top + g.icon!.bottom) / 2;
        const anchorMid = (g.anchor.top + g.anchor.bottom) / 2;
        expect(Math.abs(iconMid - anchorMid), `${id} icon vertically centered`).toBeLessThan(1.5);
      }

      // Icon and thumbnail sizes.
      const glyph = (await geometry(page, "Lk-icon-0001")).icon!;
      expect([glyph.width, glyph.height]).toEqual([20, 20]);
      const thumbBox = (await geometry(page, "Lk-thumb-0001")).icon!;
      expect([thumbBox.width, thumbBox.height]).toEqual([40, 40]);

      // The 80-character label wraps onto more than one line on the phone.
      const long = await geometry(page, "Lk-long-0001");
      if (phoneOnly(info)) {
        expect(long.text!.height).toBeGreaterThan(30);
        expect(long.anchor.right).toBeLessThanOrEqual(390);
      }

      if (desktopOnly(info)) {
        const column = (await page.locator(".pg-column").boundingBox())!;
        expect(column.width).toBeLessThanOrEqual(480.5);
        for (const id of ["Lk-icon-0001", "Lk-thumb-0001", "Lk-long-0001", "Lk-plain-0001"]) {
          const g = await geometry(page, id);
          expect(g.anchor.width, id).toBeLessThanOrEqual(480);
          expect(g.anchor.left, id).toBeGreaterThanOrEqual(column.x - 0.5);
          expect(g.anchor.right, id).toBeLessThanOrEqual(column.x + column.width + 0.5);
        }
        // A short label is centered in the space the icon leaves.
        for (const id of ["Lk-icon-0001", "Lk-thumb-0001"]) {
          const g = await geometry(page, id);
          const space = (g.label!.left + g.label!.right) / 2;
          const text = (g.text!.left + g.text!.right) / 2;
          expect(
            Math.abs(text - space),
            `${id} label centered in the remaining space`,
          ).toBeLessThan(1.5);
          // ...and that space is everything between the icon and the end edge.
          expect(g.label!.left - g.icon!.right, id).toBeCloseTo(12, 0);
          expect(g.anchor.right - g.label!.right - g.paddingRight, id).toBeLessThan(2.5);
        }
      }
      await page.screenshot({
        path: `tmp/screens/m6-links-public-${density}-${info.project.name}.png`,
        fullPage: true,
      });
    });
  }
});

test.describe("M6-20 the icon takes the button's look", () => {
  test("M6-20 the glyph is currentColor in all five button styles and follows a color override; a thumbnail's corners are the radius token capped at 12px", async ({
    page,
  }) => {
    const styles = ["fill", "outline", "soft", "shadow", "pill"] as const;
    const live = await liveLinks("lk-look", (thumb) => [
      ...styles.map((style) =>
        linkBlock(`Lk-${style}-00001`, {
          icon: { type: "builtin", name: "star" },
          overrides: { buttonStyle: style },
        }),
      ),
      linkBlock("Lk-color-00001", {
        icon: { type: "builtin", name: "star" },
        overrides: { buttonText: "#FF0000" },
      }),
      linkBlock("Lk-rad-big-01", {
        icon: { type: "image", image: thumb },
        overrides: { radius: 28 },
      }),
      linkBlock("Lk-rad-small1", {
        icon: { type: "image", image: thumb },
        overrides: { radius: 4 },
      }),
    ]);
    await page.goto(live.url);
    await settled(page);

    for (const style of styles) {
      const anchor = anchorOf(page, `Lk-${style}-00001`);
      await expect(anchor).toHaveAttribute("data-button-style", style);
      const glyph = anchor.locator("svg.pg-link-icon");
      expect(await css(glyph, "stroke"), style).toBe(await css(anchor, "color"));
      expect(await css(glyph, "fill"), style).toBe("none");
    }
    const colored = anchorOf(page, "Lk-color-00001");
    expect(await css(colored, "color")).toBe(hexToRgb("#FF0000"));
    expect(await css(colored.locator("svg.pg-link-icon"), "stroke")).toBe(hexToRgb("#FF0000"));

    expect(
      await css(
        anchorOf(page, "Lk-rad-big-01").locator(".pg-link-thumb"),
        "border-top-left-radius",
      ),
    ).toBe("12px");
    expect(
      await css(
        anchorOf(page, "Lk-rad-small1").locator(".pg-link-thumb"),
        "border-top-left-radius",
      ),
    ).toBe("4px");
    expect(await css(anchorOf(page, "Lk-rad-small1").locator(".pg-link-thumb"), "object-fit")).toBe(
      "cover",
    );
  });
});

test.describe("M6-20 abuse and the network", () => {
  test("M6-20 a label of markup stays text beside an icon and runs nothing", async ({ page }) => {
    const label = "<img src=x onerror=alert(1)>";
    const live = await liveLinks("lk-xss", (thumb) => [
      linkBlock("Lk-xss-icon-01", { label, icon: { type: "builtin", name: "star" } }),
      linkBlock("Lk-xss-thumb01", { label, icon: { type: "image", image: thumb } }),
    ]);
    const dialogs: string[] = [];
    page.on("dialog", async (dialog) => {
      dialogs.push(dialog.message());
      await dialog.dismiss();
    });
    await page.goto(live.url);
    await settled(page);
    for (const id of ["Lk-xss-icon-01", "Lk-xss-thumb01"]) {
      await expect(anchorOf(page, id).locator(".pg-link-label")).toHaveText(label);
      await expect(anchorOf(page, id).locator("img[src='x']")).toHaveCount(0);
    }
    await expect(page.locator("img[src='x']")).toHaveCount(0);
    await page.waitForTimeout(300);
    expect(dialogs).toEqual([]);
  });

  test("M6-20 three icon links request only the page's own host (the thumbnail from the root origin's /media route) and the fonts", async ({
    page,
  }) => {
    const live = await liveLinks("lk-net", (thumb) => [
      linkBlock("Lk-net-icon-01", { icon: { type: "builtin", name: "instagram" } }),
      linkBlock("Lk-net-icon-02", { icon: { type: "builtin", name: "globe" } }),
      linkBlock("Lk-net-thumb01", { icon: { type: "image", image: thumb } }),
    ]);
    const requested: string[] = [];
    page.on("request", (request) => requested.push(request.url()));
    await page.goto(live.url);
    await settled(page);
    await page.waitForLoadState("networkidle");

    const own = new URL(live.url).origin;
    // Images load from the one canonical media origin: the root host (not the page's own host).
    const root = url(null).replace(/\/$/, "");
    const storage = new URL(supabaseUrl()).origin;
    // The page's web fonts (Google Fonts, the theme's font tokens) are not something an icon
    // causes: they load the same with no icon on the page. Everything else must be ours.
    const fontHosts = new Set(["https://fonts.googleapis.com", "https://fonts.gstatic.com"]);
    const foreign = requested.filter((u) => {
      if (u.startsWith("data:") || u.startsWith("blob:")) return false;
      const origin = new URL(u).origin;
      return origin !== own && origin !== root && !fontHosts.has(origin);
    });
    expect(foreign, `requests to other origins: ${foreign.join(", ")}`).toEqual([]);
    // M7-15: the thumbnail comes from the root origin's /media route, never from Storage.
    expect(requested.filter((u) => new URL(u).origin === storage)).toEqual([]);
    expect(requested.filter((u) => new URL(u).pathname.startsWith("/media/"))).toEqual([
      `${root}/media/${live.thumb.path}`,
    ]);
    expect(requested.filter((u) => /favicon|icon\.horse|s2\/favicons/i.test(u))).toEqual([]);
  });
});

test.describe("M6-22 the bold style", () => {
  test("M6-22 weight 700, a ring in the accent and 8px more height, in all five button styles and with a color override", async ({
    page,
  }) => {
    const live = await liveLinks("lk-bold", () => [
      linkBlock("Lk-plain-fill01", { label: "Plain fill" }),
      linkBlock("Lk-bold-fill001", { label: "Bold fill", featured: "bold" }),
      linkBlock("Lk-bold-outln01", {
        label: "Bold outline",
        featured: "bold",
        overrides: { buttonStyle: "outline" },
      }),
      linkBlock("Lk-bold-soft001", {
        label: "Bold soft",
        featured: "bold",
        overrides: { buttonStyle: "soft" },
      }),
    ]);
    const second = await liveLinks("lk-bold2", () => [
      linkBlock("Lk-plain-shdw01", { label: "Plain shadow", overrides: { buttonStyle: "shadow" } }),
      linkBlock("Lk-bold-shadow01", {
        label: "Bold shadow",
        featured: "bold",
        overrides: { buttonStyle: "shadow" },
      }),
      linkBlock("Lk-bold-pill0001", {
        label: "Bold pill",
        featured: "bold",
        overrides: { buttonStyle: "pill" },
      }),
      linkBlock("Lk-bold-color001", {
        label: "Bold color",
        featured: "bold",
        overrides: { accent: "#C46A4F" },
      }),
    ]);

    await page.goto(live.url);
    const ring = async (blockId: string) => {
      const accent = await resolveColor(page, await accentOf(page, blockId));
      const shadow = await css(anchorOf(page, blockId), "box-shadow");
      expect(shadow, blockId).toContain(`${accent} 0px 0px 0px 2px`);
      return shadow;
    };
    for (const id of ["Lk-bold-fill001", "Lk-bold-outln01", "Lk-bold-soft001"]) {
      expect(await css(anchorOf(page, id), "font-weight"), id).toBe("700");
      await ring(id);
      expect((await geometry(page, id)).anchor.height, id).toBeGreaterThanOrEqual(44);
    }
    // Eight pixels taller than a plain link at the same density; the plain one has no ring.
    const plain = (await geometry(page, "Lk-plain-fill01")).anchor.height;
    const bold = (await geometry(page, "Lk-bold-fill001")).anchor.height;
    expect(bold - plain).toBeCloseTo(8, 0);
    expect(await css(anchorOf(page, "Lk-plain-fill01"), "box-shadow")).toBe("none");
    expect(await css(anchorOf(page, "Lk-plain-fill01"), "font-weight")).toBe("600");
    expect(await css(anchorOf(page, "Lk-bold-outln01"), "font-weight")).toBe("700");

    await page.goto(second.url);
    // The shadow style keeps its offset shadow next to the ring.
    const shadowStyle = await ring("Lk-bold-shadow01");
    expect(shadowStyle).toMatch(/4px 4px 0px/);
    expect(await css(anchorOf(page, "Lk-plain-shdw01"), "box-shadow")).toMatch(/4px 4px 0px/);
    expect(await css(anchorOf(page, "Lk-plain-shdw01"), "box-shadow")).not.toContain(
      "0px 0px 0px 2px",
    );
    await ring("Lk-bold-pill0001");
    expect(await css(anchorOf(page, "Lk-bold-pill0001"), "border-top-left-radius")).toBe("999px");
    // The ring follows the block's accent override.
    expect(await accentOf(page, "Lk-bold-color001")).toBe("#C46A4F");
    expect(await css(anchorOf(page, "Lk-bold-color001"), "box-shadow")).toContain(
      `${hexToRgb("#C46A4F")} 0px 0px 0px 2px`,
    );
    for (const id of ["Lk-bold-shadow01", "Lk-bold-pill0001", "Lk-bold-color001"]) {
      expect((await geometry(page, id)).anchor.height, id).toBeGreaterThanOrEqual(44);
      expect(await css(anchorOf(page, id), "font-weight"), id).toBe("700");
    }
    // Every featured value draws the same static bold style.
    await expect(anchorOf(page, "Lk-bold-color001")).toHaveAttribute("data-featured", "bold");
  });

  test("M6-22 each density adds 8px: 56, 66 and 72px", async ({ page }) => {
    const expected = { compact: [48, 56], regular: [58, 66], airy: [64, 72] } as const;
    for (const density of ["compact", "regular", "airy"] as const) {
      const live = await liveLinks(
        `lk-bd-${density}`,
        () => [
          linkBlock("Lk-plain-dens01", { label: "Plain" }),
          linkBlock("Lk-bold-dens001", { label: "Bold", featured: "bold" }),
        ],
        { tokens: { density } },
      );
      await page.goto(live.url);
      const [plainH, boldH] = expected[density];
      expect((await geometry(page, "Lk-plain-dens01")).anchor.height, density).toBeCloseTo(
        plainH,
        0,
      );
      expect((await geometry(page, "Lk-bold-dens001")).anchor.height, density).toBeCloseTo(
        boldH,
        0,
      );
    }
  });
});

test.describe("M6-22 gentle motion", () => {
  const blocks = () => [
    linkBlock("Lk-m-bold-0001", { label: "Bold", featured: "bold" }),
    linkBlock("Lk-m-pulse-001", { label: "Pulse", featured: "pulse" }),
    linkBlock("Lk-m-shine-001", { label: "Shine", featured: "shine" }),
  ];
  const IDS = ["Lk-m-bold-0001", "Lk-m-pulse-001", "Lk-m-shine-001"];

  test("M6-22 with reduced motion nothing moves: no animation on the link or its ::after, whatever the value", async ({
    page,
  }) => {
    const live = await liveLinks("lk-rm", blocks);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(live.url);
    for (const id of IDS) {
      const anchor = anchorOf(page, id);
      expect(await css(anchor, "animation-name"), id).toBe("none");
      expect(await css(anchor, "animation-name", "::after"), `${id} ::after`).toBe("none");
      // The shine's highlight is not even generated.
      expect(await css(anchor, "content", "::after"), `${id} ::after content`).toBe("none");
    }
    const first = await Promise.all(IDS.map((id) => css(anchorOf(page, id), "box-shadow")));
    await page.waitForTimeout(1300);
    const later = await Promise.all(IDS.map((id) => css(anchorOf(page, id), "box-shadow")));
    expect(later).toEqual(first);
    // Still the bold style: the ring and the weight are there.
    for (const id of IDS) {
      expect(await css(anchorOf(page, id), "font-weight")).toBe("700");
      expect(await css(anchorOf(page, id), "box-shadow")).toContain("0px 0px 0px 2px");
    }
  });

  test("M6-22 with no preference pulse breathes the ring (2.4s) and shine sweeps ::after (4s); bold is still", async ({
    page,
  }) => {
    const live = await liveLinks("lk-nm", blocks);
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.goto(live.url);

    const bold = anchorOf(page, "Lk-m-bold-0001");
    expect(await css(bold, "animation-name")).toBe("none");
    expect(await css(bold, "animation-name", "::after")).toBe("none");

    const pulse = anchorOf(page, "Lk-m-pulse-001");
    expect(await css(pulse, "animation-name")).toBe("pg-featured-pulse");
    expect(await css(pulse, "animation-duration")).toBe("2.4s");
    expect(await css(pulse, "animation-timing-function")).toBe("ease-in-out");
    expect(await css(pulse, "animation-iteration-count")).toBe("infinite");
    expect(await css(pulse, "animation-name", "::after")).toBe("none");

    const shine = anchorOf(page, "Lk-m-shine-001");
    expect(await css(shine, "animation-name")).toBe("none");
    expect(await css(shine, "animation-name", "::after")).toBe("pg-featured-shine");
    expect(await css(shine, "animation-duration", "::after")).toBe("4s");
    expect(await css(shine, "animation-iteration-count", "::after")).toBe("infinite");
    expect(await css(shine, "pointer-events", "::after")).toBe("none");

    // It really moves: the pulse's halo and the shine's highlight are somewhere else a moment later.
    const pulse0 = await css(pulse, "box-shadow");
    const shine0 = await css(shine, "background-position", "::after");
    await page.waitForTimeout(1200);
    expect(await css(pulse, "box-shadow")).not.toBe(pulse0);
    // The sweep takes 1.8s of every 4s cycle: some sample inside one cycle is somewhere else.
    await expect
      .poll(() => css(shine, "background-position", "::after"), { timeout: 6000, intervals: [100] })
      .not.toBe(shine0);
  });

  test("M6-22 the shadow style keeps its offset through the pulse", async ({ page }) => {
    const live = await liveLinks("lk-ps", () => [
      linkBlock("Lk-m-pulse-shd1", {
        featured: "pulse",
        overrides: { buttonStyle: "shadow" },
      }),
    ]);
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.goto(live.url);
    const anchor = anchorOf(page, "Lk-m-pulse-shd1");
    expect(await css(anchor, "animation-name")).toBe("pg-featured-pulse-offset");
    for (let i = 0; i < 4; i++) {
      expect(await css(anchor, "box-shadow")).toMatch(/4px 4px 0px/);
      await page.waitForTimeout(500);
    }
  });
});

test.describe("M6-22 featured links in the column", () => {
  test("M6-22 the ring is not clipped, nothing scrolls sideways, links stay in the column and the motion shifts nothing", async ({
    page,
  }, info) => {
    const live = await liveLinks("lk-fl", () => [
      linkBlock("Lk-f-bold-0001", { label: LONG_LABEL, featured: "bold" }),
      linkBlock("Lk-f-pulse-001", { label: LONG_LABEL, featured: "pulse" }),
      linkBlock("Lk-f-shine-001", { label: LONG_LABEL, featured: "shine" }),
      linkBlock("Lk-f-after-001", { label: "A link below" }),
    ]);
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.goto(live.url);
    await expectLinksTall(page, 44);
    await expectNoHorizontalScroll(page);

    const viewport = page.viewportSize()!;
    for (const id of ["Lk-f-bold-0001", "Lk-f-pulse-001", "Lk-f-shine-001"]) {
      const g = await geometry(page, id);
      // The ring (2px) and the pulse's halo (up to 8px) fit between the button and the viewport edge.
      expect(g.anchor.left - 8, `${id} left`).toBeGreaterThanOrEqual(0);
      expect(g.anchor.right + 8, `${id} right`).toBeLessThanOrEqual(viewport.width);
      // No ancestor clips what is drawn outside the border.
      const clips = await anchorOf(page, id).evaluate((el) => {
        const out: string[] = [];
        for (let node = el.parentElement; node; node = node.parentElement) {
          const style = getComputedStyle(node);
          if (style.overflowX !== "visible" || style.overflowY !== "visible") {
            out.push(
              `${node.tagName.toLowerCase()}.${node.className} overflow ${style.overflowX}/${style.overflowY}`,
            );
          }
          if (/paint|strict|content/.test(style.contain)) {
            out.push(`${node.tagName.toLowerCase()}.${node.className} contain ${style.contain}`);
          }
          if (node === document.body) break;
        }
        return out;
      });
      expect(clips, id).toEqual([]);
      expect(g.anchor.width, id).toBeGreaterThan(0);
    }

    if (desktopOnly(info)) {
      for (const id of ["Lk-f-bold-0001", "Lk-f-pulse-001", "Lk-f-shine-001"]) {
        expect((await geometry(page, id)).anchor.width, id).toBeLessThanOrEqual(480);
      }
    }

    // The animation does not move neighbors: the page and every block are where they were half a cycle later.
    const layout = () =>
      page.evaluate(() => ({
        height: document.documentElement.scrollHeight,
        tops: Array.from(document.querySelectorAll("[data-block-id]")).map(
          (el) => el.getBoundingClientRect().top + window.scrollY,
        ),
      }));
    const start = await layout();
    await page.waitForTimeout(1250);
    const middle = await layout();
    expect(middle).toEqual(start);
    await page.screenshot({
      path: `tmp/screens/m6-links-featured-${info.project.name}.png`,
      fullPage: true,
    });
  });
});
