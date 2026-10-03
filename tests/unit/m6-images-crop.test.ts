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
  movePicture,
  outputEdge,
  pictureLayout,
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

  it("dragging the picture right moves the square left, by the viewfinder's scale", () => {
    const zoomed = zoomCrop(initialCrop(1000, 1000), 2, 1000, 1000);
    // 280px viewfinder shows 500 source px: one screen pixel is 500/280 source pixels.
    const moved = movePicture(zoomed, 28, 0, 1000, 1000, 280);
    expect(moved.cx).toBeCloseTo(500 - 28 * (500 / 280), 6);
    expect(moved.cy).toBe(500);
    // A 10px nudge, the arrow keys' step.
    expect(movePicture(zoomed, -10, 0, 1000, 1000, 280).cx).toBeCloseTo(500 + 10 * (500 / 280), 6);
  });

  it("dragging far stops at the edge (no empty edges), and a zero-width viewfinder changes nothing", () => {
    const zoomed = zoomCrop(initialCrop(1000, 1000), 2, 1000, 1000);
    const far = movePicture(zoomed, -99999, 99999, 1000, 1000, 280);
    expect(far.cx).toBe(750);
    expect(far.cy).toBe(250);
    expect(movePicture(zoomed, 50, 50, 1000, 1000, 0)).toEqual(clampCrop(zoomed, 1000, 1000));
  });

  it("the picture's layout in the viewfinder covers it and follows the square", () => {
    const layout = pictureLayout(initialCrop(1200, 800), 1200, 800);
    // The viewfinder shows 800 of 1200 px across and all 800 down.
    expect(layout.width).toBeCloseTo(150, 6);
    expect(layout.height).toBeCloseTo(100, 6);
    expect(layout.left).toBeCloseTo(-25, 6);
    expect(layout.top).toBeCloseTo(0, 6);
    for (const crop of [
      { cx: 300, cy: 400, zoom: 2 },
      { cx: 1000, cy: 100, zoom: 3.3 },
      { cx: 600, cy: 400, zoom: 1 },
    ]) {
      const l = pictureLayout(crop, 1200, 800);
      expect(l.left).toBeLessThanOrEqual(1e-9);
      expect(l.top).toBeLessThanOrEqual(1e-9);
      expect(l.left + l.width).toBeGreaterThanOrEqual(100 - 1e-9);
      expect(l.top + l.height).toBeGreaterThanOrEqual(100 - 1e-9);
    }
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

  it("the profile photo: Position your photo, Use photo, a circular outline", () => {
    const markup = html();
    expect(markup).toContain("Position your photo");
    expect(markup).toContain(">Use photo<");
    expect(markup).toContain(">Reset<");
    expect(markup).toContain(">Cancel<");
    expect(markup).toContain('aria-modal="true"');
    expect(markup).toContain("rounded-full");
    expect(markup).toContain('data-variant="photo"');
  });

  it("a link thumbnail: Position your image, Use image, a square outline with the 6px radius", () => {
    const markup = html("image");
    expect(markup).toContain("Position your image");
    expect(markup).toContain(">Use image<");
    expect(markup).not.toContain("rounded-full");
    expect(markup).toContain("rounded-md");
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
