// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { PositionDialog } from "@/components/editor/position-dialog";
import {
  FOCUS_STEP,
  describeFocus,
  focusFromPoint,
  markerPosition,
  stepFocus,
} from "@/lib/editor/focus-geometry";
import {
  MAX_CROP_EDGE,
  clampCrop,
  cropRegion,
  hasTransparency,
  initialCrop,
  nudgePan,
  outputEdge,
  panLimit,
  panToCrop,
  restrictPan,
  scalePan,
  zoomAnnouncement,
  zoomCrop,
  type PositionPhoto,
} from "@/lib/media/position-crop";

vi.mock("@/lib/env/client", () => ({
  clientEnv: {
    NEXT_PUBLIC_ROOT_DOMAIN: "localhost:3000",
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
  },
}));

/** M6-24 crop math and the dialog's words; M6-25 focus geometry and the picker's static rules. */

describe("M6-24 the crop", () => {
  const W = 1200;
  const H = 800;

  it("opens on the whole shorter side, centered", () => {
    const crop = initialCrop(W, H);
    expect(crop).toEqual({ cx: 600, cy: 400, zoom: 1 });
    expect(cropRegion(crop, W, H)).toEqual({ sx: 200, sy: 0, side: 800 });
  });

  it("the square is always inside the picture, whatever is asked", () => {
    for (const crop of [
      { cx: -500, cy: -500, zoom: 1 },
      { cx: 9000, cy: 9000, zoom: 1 },
      { cx: 0, cy: 0, zoom: 4 },
      { cx: W, cy: H, zoom: 4 },
      { cx: 600, cy: 400, zoom: 99 },
      { cx: 600, cy: 400, zoom: 0 },
      { cx: Number.NaN, cy: Number.NaN, zoom: Number.NaN },
    ]) {
      const { sx, sy, side } = cropRegion(crop, W, H);
      expect(sx).toBeGreaterThanOrEqual(-1e-9);
      expect(sy).toBeGreaterThanOrEqual(-1e-9);
      expect(sx + side).toBeLessThanOrEqual(W + 1e-9);
      expect(sy + side).toBeLessThanOrEqual(H + 1e-9);
      expect(side).toBeGreaterThan(0);
    }
  });

  it("zoom stays between 1x and 4x, and the square shrinks with it", () => {
    const base = initialCrop(W, H);
    expect(zoomCrop(base, 2, W, H).zoom).toBe(2);
    expect(cropRegion(zoomCrop(base, 2, W, H), W, H).side).toBe(400);
    expect(zoomCrop(base, 10, W, H).zoom).toBe(4);
    expect(zoomCrop(base, 0.2, W, H).zoom).toBe(1);
  });

  it("M9-08 the pan the library reports becomes the square: the picture moving right moves the square left, by the viewfinder's scale", () => {
    // 1000 x 1000 at 2x in a 280px viewfinder shows 500 source px: one screen pixel is 500/280 source pixels.
    const moved = panToCrop({ x: 28, y: 0 }, 2, 1000, 1000, 280);
    expect(moved.cx).toBeCloseTo(500 - 28 * (500 / 280), 6);
    expect(moved.cy).toBe(500);
    expect(moved.zoom).toBe(2);
    // A 10px nudge, the arrow keys' step.
    expect(panToCrop({ x: -10, y: 0 }, 2, 1000, 1000, 280).cx).toBeCloseTo(500 + 10 * (500 / 280), 6);
    // A landscape picture: the shorter side fills the viewfinder, so the scale is the same.
    const wide = panToCrop({ x: 0, y: 0 }, 1, 1200, 800, 280);
    expect(cropRegion(wide, 1200, 800)).toEqual({ sx: 200, sy: 0, side: 800 });
  });

  it("M9-08 the pan stops at the edge (no empty edges), whatever the library or a key asks", () => {
    // 1000 x 1000 in 280px at 2x: the picture is 560px wide, so it may move 140px each way.
    expect(panLimit(1000, 1000, 280, 2)).toEqual({ x: 140, y: 140 });
    expect(restrictPan({ x: -99999, y: 99999 }, 1000, 1000, 280, 2)).toEqual({ x: -140, y: 140 });
    expect(panLimit(1000, 1000, 280, 1)).toEqual({ x: 0, y: 0 });
    // Landscape 900 x 500: at 1x it is 504px wide in the 280px viewfinder, 112px of play each way.
    expect(panLimit(900, 500, 280, 1).x).toBeCloseTo(112, 6);
    expect(panLimit(900, 500, 280, 1).y).toBe(0);
    // The square taken from the farthest pan sits on the picture's edge.
    const far = panToCrop({ x: -99999, y: 99999 }, 2, 1000, 1000, 280);
    expect(far.cx).toBe(750);
    expect(far.cy).toBe(250);
    // Bad numbers and an unmeasured viewfinder change nothing.
    expect(restrictPan({ x: Number.NaN, y: Number.POSITIVE_INFINITY }, 1000, 1000, 280, 2)).toEqual({
      x: 0,
      y: 0,
    });
    expect(restrictPan({ x: 50, y: 50 }, 1000, 1000, 0, 2)).toEqual({ x: 0, y: 0 });
    expect(panToCrop({ x: 50, y: 50 }, 2, 1000, 1000, 0)).toEqual(
      clampCrop({ cx: 500, cy: 500, zoom: 2 }, 1000, 1000),
    );
    expect(panToCrop({ x: Number.NaN, y: Number.NaN }, Number.NaN, 1000, 1000, 280)).toEqual({
      cx: 500,
      cy: 500,
      zoom: 1,
    });
  });

  it("M9-08 arrow nudges move the picture by their pixels and stop at the limit", () => {
    expect(nudgePan({ x: 0, y: 0 }, -10, 0, 1000, 1000, 280, 2)).toEqual({ x: -10, y: 0 });
    expect(nudgePan({ x: 0, y: 0 }, 0, -1, 1000, 1000, 280, 2)).toEqual({ x: 0, y: -1 });
    expect(nudgePan({ x: -135, y: 0 }, -10, 0, 1000, 1000, 280, 2).x).toBe(-140);
    // At 1x a square picture has no play at all.
    expect(nudgePan({ x: 0, y: 0 }, 10, 10, 1000, 1000, 280, 1)).toEqual({ x: 0, y: 0 });
  });

  it("M9-08 zooming keeps the visible center: the pan scales with the zoom", () => {
    expect(scalePan({ x: 40, y: -20 }, 2, 4)).toEqual({ x: 80, y: -40 });
    expect(scalePan({ x: 40, y: -20 }, 2, 1)).toEqual({ x: 20, y: -10 });
    const before = panToCrop({ x: 40, y: -20 }, 2, 1000, 1000, 280);
    const after = panToCrop(scalePan({ x: 40, y: -20 }, 2, 4), 4, 1000, 1000, 280);
    expect(after.cx).toBeCloseTo(before.cx, 6);
    expect(after.cy).toBeCloseTo(before.cy, 6);
    expect(scalePan({ x: 5, y: 5 }, 0, 2)).toEqual({ x: 0, y: 0 });
  });

  it("the output is the real resolution of the square, at most 800px a side", () => {
    expect(outputEdge(4000)).toBe(MAX_CROP_EDGE);
    expect(outputEdge(800)).toBe(800);
    expect(outputEdge(333.4)).toBe(333);
    expect(outputEdge(0.2)).toBe(1);
    // 6000 x 4000 turned upright is 4000 x 6000: the shorter side is 4000.
    expect(outputEdge(cropRegion(initialCrop(4000, 6000), 4000, 6000).side)).toBe(800);
  });

  it("announces the zoom in percent", () => {
    expect(zoomAnnouncement(1)).toBe("Zoom 100 percent");
    expect(zoomAnnouncement(2)).toBe("Zoom 200 percent");
    expect(zoomAnnouncement(2.25)).toBe("Zoom 225 percent");
    expect(zoomAnnouncement(9)).toBe("Zoom 400 percent");
  });

  it("finds transparency in RGBA data", () => {
    expect(hasTransparency(new Uint8ClampedArray([1, 2, 3, 255, 4, 5, 6, 255]))).toBe(false);
    expect(hasTransparency(new Uint8ClampedArray([1, 2, 3, 255, 4, 5, 6, 254]))).toBe(true);
    expect(hasTransparency(new Uint8ClampedArray([]))).toBe(false);
  });
});

describe("M6-24 the dialog's words", () => {
  const photo: PositionPhoto = {
    source: {} as CanvasImageSource,
    width: 800,
    height: 600,
    url: "blob:test",
    mayHaveAlpha: false,
    close: () => undefined,
  };
  const html = (variant?: "photo" | "image") =>
    renderToStaticMarkup(
      createElement(PositionDialog, {
        photo,
        variant,
        onUse: () => undefined,
        onCancel: () => undefined,
      }),
    );

  it("the profile photo: Position your photo, Use photo, a circular outline (M9-08: the library draws it)", () => {
    const markup = html();
    expect(markup).toContain("Position your photo");
    expect(markup).toContain(">Use photo<");
    expect(markup).toContain(">Reset<");
    expect(markup).toContain(">Cancel<");
    expect(markup).toContain('aria-modal="true"');
    expect(markup).toContain('data-shape="round"');
    expect(markup).toContain('data-variant="photo"');
  });

  it("a link thumbnail: Position your image, Use image, a square outline with the 6px radius", () => {
    const markup = html("image");
    expect(markup).toContain("Position your image");
    expect(markup).toContain(">Use image<");
    expect(markup).toContain('data-shape="square"');
    expect(markup).toContain('data-variant="image"');
    expect(markup).not.toContain("Use photo");
  });

  it("the viewfinder takes no touch scrolling", () => {
    expect(html()).toMatch(/data-testid="position-viewfinder"[^>]*touch-action:none/);
  });
});

describe("M6-25 the focus picker's geometry", () => {
  const rect = { left: 100, top: 50, width: 200, height: 100 };

  it("measures on the picture itself and rounds to three decimals", () => {
    expect(focusFromPoint(200, 100, rect)).toEqual({ x: 0.5, y: 0.5 });
    expect(focusFromPoint(100, 50, rect)).toEqual({ x: 0, y: 0 });
    expect(focusFromPoint(300, 150, rect)).toEqual({ x: 1, y: 1 });
    expect(focusFromPoint(166.666, 83.333, rect)).toEqual({ x: 0.333, y: 0.333 });
  });

  it("a point outside the picture is clamped onto its edge; bad numbers give the center", () => {
    expect(focusFromPoint(-5000, 9000, rect)).toEqual({ x: 0, y: 1 });
    expect(focusFromPoint(Number.NaN, Number.NaN, rect)).toEqual({ x: 0.5, y: 0.5 });
    expect(focusFromPoint(10, 10, { left: 0, top: 0, width: 0, height: 0 })).toEqual({
      x: 0.5,
      y: 0.5,
    });
  });

  it("arrow keys move 5 percent, Shift 1 percent, and stop at the edges", () => {
    expect(FOCUS_STEP).toBe(0.05);
    expect(stepFocus({ x: 0.5, y: 0.5 }, "ArrowRight", false)).toEqual({ x: 0.55, y: 0.5 });
    expect(stepFocus({ x: 0.5, y: 0.5 }, "ArrowUp", true)).toEqual({ x: 0.5, y: 0.49 });
    expect(stepFocus({ x: 0.02, y: 0.5 }, "ArrowLeft", false)).toEqual({ x: 0, y: 0.5 });
    expect(stepFocus({ x: 0.5, y: 0.99 }, "ArrowDown", false)).toEqual({ x: 0.5, y: 1 });
    expect(stepFocus({ x: 0.5, y: 0.5 }, "Enter", false)).toBeNull();
    // Seven steps of 0.05 do not drift off the grid.
    let focus = { x: 0.3, y: 0.5 };
    for (let i = 0; i < 7; i++) focus = stepFocus(focus, "ArrowRight", false)!;
    expect(focus.x).toBe(0.65);
  });

  it("says where the marker is", () => {
    expect(describeFocus({ x: 0.3, y: 0.7 })).toBe("Focus 30 percent across, 70 percent down");
    expect(markerPosition({ x: 0.25, y: 1 })).toEqual({ left: "25%", top: "100%" });
  });
});

describe("M6-25 the focus picker makes no request of its own", () => {
  const root = resolve(process.cwd());
  const read = (path: string) => readFileSync(resolve(root, path), "utf8");
  const strip = (source: string) =>
    source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

  it.each(["src/components/blocks/forms/focus-picker.tsx", "src/lib/editor/focus-geometry.ts"])(
    "%s has no fetch, XMLHttpRequest, beacon or WebSocket",
    (path) => {
      const code = strip(read(path));
      expect(code).not.toMatch(/\bfetch\b|XMLHttpRequest|sendBeacon|WebSocket|EventSource|\/api\//);
    },
  );

  it("the picker imports nothing that talks to the network", () => {
    const code = strip(read("src/components/blocks/forms/focus-picker.tsx"));
    const imports = [...code.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]!);
    for (const spec of imports) {
      expect(spec).not.toMatch(/supabase|upload|media\/(?!url)/);
    }
  });
});
