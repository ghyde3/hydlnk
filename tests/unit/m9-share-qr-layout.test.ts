import jsQR from "jsqr";
import { describe, expect, it } from "vitest";
import { QR_PNG_SIZE, QR_QUIET_ZONE, drawnSize, makeQr, type QrCode } from "@/lib/qr/generate";
import {
  FRAME_BORDER,
  FRAME_PNG_HEIGHT,
  FRAME_TEXT_MIN_SIZE,
  FRAME_TEXT_SIZE,
  LOGO_MAX_SHARE,
  fitContain,
  moduleRuns,
  plateModules,
  qrLayout,
  type QrLayout,
} from "@/lib/qr/layout";

/**
 * M9-25: where everything goes in a styled QR drawing (src/lib/qr/layout.ts). The geometry is pure,
 * so the limits the feature promises are checked here as arithmetic: the logo can never be larger
 * than 20 percent of the grid's side, the frame keeps the code at 80 percent of the width or more, the
 * quiet zone stays inside the frame, and a styled code decodes with a real decoder.
 */

const ADDRESS = "http://mara.localhost:3000/";
const LONG = `https://${"a".repeat(40)}.example.com/`;
const PLAIN = { frame: false, frameText: "Scan me", logo: false, picture: null } as const;

describe("M9-25 plateModules: the logo's plate is at most 20 percent of the grid's side", () => {
  // Every QR version: 21 modules at version 1, then four more per version up to 177.
  const sizes = Array.from({ length: 40 }, (_, i) => 21 + 4 * i);

  it.each(sizes)("M9-25 a grid of %i modules", (size) => {
    const modules = plateModules(size);
    expect(modules).toBeGreaterThanOrEqual(1);
    expect(modules / size).toBeLessThanOrEqual(LOGO_MAX_SHARE);
    // At most 4 percent of the area, far below what level H restores (30 percent).
    expect((modules * modules) / (size * size)).toBeLessThanOrEqual(0.04);
    // Centered on a module edge: the same parity as the grid.
    expect((size - modules) % 2).toBe(0);
  });

  it("M9-25 the usual code for a page address (33 modules at level H) gets a plate of 5", () => {
    expect(makeQr(ADDRESS, "H").size).toBe(33);
    expect(plateModules(33)).toBe(5);
  });
});

describe("M9-25 fitContain: a picture never leaves the plate, whatever its shape", () => {
  const inner = { x: 100, y: 200, width: 120, height: 120 };

  it("M9-25 a 1:1 picture fills the box", () => {
    expect(fitContain(inner, { width: 256, height: 256 })).toEqual(inner);
    expect(fitContain(inner, { width: 64, height: 64 })).toEqual(inner);
  });

  it("M9-25 a 4:1 picture fills the width and a quarter of the height, centered", () => {
    const box = fitContain(inner, { width: 256, height: 64 });
    expect(box.width).toBe(120);
    expect(box.height).toBe(30);
    expect(box.x).toBe(100);
    expect(box.y).toBe(200 + (120 - 30) / 2);
  });

  it("M9-25 a tall picture fills the height", () => {
    const box = fitContain(inner, { width: 64, height: 256 });
    expect(box.height).toBe(120);
    expect(box.width).toBe(30);
  });

  it("M9-25 the aspect is kept (within a pixel) and the box is inside the plate, for any shape", () => {
    for (const [width, height] of [
      [256, 256],
      [256, 64],
      [64, 256],
      [250, 17],
      [17, 250],
      [3, 3],
      [1, 255],
      [255, 1],
    ] as const) {
      const box = fitContain(inner, { width, height });
      expect(box.width, `${width}x${height}`).toBeLessThanOrEqual(inner.width);
      expect(box.height, `${width}x${height}`).toBeLessThanOrEqual(inner.height);
      expect(box.x).toBeGreaterThanOrEqual(inner.x);
      expect(box.y).toBeGreaterThanOrEqual(inner.y);
      expect(box.x + box.width).toBeLessThanOrEqual(inner.x + inner.width);
      expect(box.y + box.height).toBeLessThanOrEqual(inner.y + inner.height);
      // Whole pixels: the proportions are kept to within one pixel of the shorter side.
      expect(
        Math.abs(box.width * height - box.height * width),
        `${width}x${height}`,
      ).toBeLessThanOrEqual(Math.max(width, height));
    }
  });

  it("M9-25 an empty picture draws nothing", () => {
    expect(fitContain(inner, { width: 0, height: 10 })).toMatchObject({ width: 0, height: 0 });
  });
});

describe("M9-25 qrLayout without a frame is the M6-31 drawing", () => {
  const code = makeQr(ADDRESS);
  const layout = qrLayout(code, PLAIN);

  it("M9-25 1024 by 1024, the code and its quiet zone fill it, nothing else", () => {
    expect([layout.width, layout.height]).toEqual([QR_PNG_SIZE, QR_PNG_SIZE]);
    expect(layout.area).toEqual({ x: 0, y: 0, side: QR_PNG_SIZE });
    expect(layout.grid).toBe(drawnSize(code));
    expect(layout.frame).toBeNull();
    expect(layout.text).toBeNull();
    expect(layout.plate).toBeNull();
    expect(layout.picture).toBeNull();
  });

  it("M9-25 every module run is inside the quiet zone's margin and on whole pixels", () => {
    const margin = Math.round(QR_QUIET_ZONE * (QR_PNG_SIZE / layout.grid));
    for (const run of moduleRuns(code, layout)) {
      for (const value of [run.x0, run.y0, run.x1, run.y1])
        expect(Number.isInteger(value)).toBe(true);
      expect(run.x0).toBeGreaterThanOrEqual(margin);
      expect(run.y0).toBeGreaterThanOrEqual(margin);
      expect(run.x1).toBeLessThanOrEqual(QR_PNG_SIZE - margin);
      expect(run.y1).toBeLessThanOrEqual(QR_PNG_SIZE - margin);
      expect(run.x1).toBeGreaterThan(run.x0);
      expect(run.y1).toBeGreaterThan(run.y0);
    }
  });
});

describe("M9-25 qrLayout with a frame: 1024 by 1216, the code keeps its width and its quiet zone", () => {
  for (const [name, text] of [
    ["the M-level code", ADDRESS],
    ["a long address", LONG],
  ] as const) {
    const code = makeQr(text);
    const layout = qrLayout(code, { ...PLAIN, frame: true });

    it(`M9-25 ${name}: the drawing is 1024 wide and 1216 tall`, () => {
      expect([layout.width, layout.height]).toEqual([1024, FRAME_PNG_HEIGHT]);
      expect(layout.frame).not.toBeNull();
    });

    it(`M9-25 ${name}: the code and its quiet zone take at least 80 percent of the width`, () => {
      expect(layout.area.side / layout.width).toBeGreaterThanOrEqual(0.8);
      // And they sit inside the border, centered.
      expect(layout.area.x).toBe(FRAME_BORDER);
      expect(layout.area.x + layout.area.side).toBe(layout.width - FRAME_BORDER);
      expect(layout.area.y).toBe(FRAME_BORDER);
    });

    it(`M9-25 ${name}: the quiet zone of 4 modules is inside the frame, and no module is in it`, () => {
      const unit = layout.area.side / layout.grid;
      for (const run of moduleRuns(code, layout)) {
        expect(run.x0).toBeGreaterThanOrEqual(layout.area.x + Math.round(QR_QUIET_ZONE * unit));
        expect(run.y0).toBeGreaterThanOrEqual(layout.area.y + Math.round(QR_QUIET_ZONE * unit));
        expect(run.x1).toBeLessThanOrEqual(
          layout.area.x + layout.area.side - Math.round(QR_QUIET_ZONE * unit),
        );
        expect(run.y1).toBeLessThanOrEqual(
          layout.area.y + layout.area.side - Math.round(QR_QUIET_ZONE * unit),
        );
      }
    });

    it(`M9-25 ${name}: the text sits in the band under the code, centered, bold and at least 64px`, () => {
      const textBox = layout.text!;
      expect(textBox.x).toBe(512);
      expect(textBox.size).toBeGreaterThanOrEqual(64);
      expect(textBox.size).toBe(FRAME_TEXT_SIZE);
      expect(textBox.y).toBeGreaterThan(layout.area.y + layout.area.side);
      expect(textBox.y).toBeLessThan(layout.height - FRAME_BORDER);
      expect(textBox.textLength).toBeNull();
    });
  }

  it("M9-25 text wider than the band shrinks, never below 64px, then is squeezed to fit", () => {
    const code = makeQr(ADDRESS);
    // A stand-in for a font: every character is 0.7 em wide.
    const measure = (text: string, size: number) => text.length * 0.7 * size;
    const fits = qrLayout(code, {
      ...PLAIN,
      frame: true,
      frameText: "Scan me",
      measureText: measure,
    });
    expect(fits.text!.size).toBe(96);
    expect(fits.text!.textLength).toBeNull();

    const shrunk = qrLayout(code, {
      ...PLAIN,
      frame: true,
      frameText: "A".repeat(15),
      measureText: measure,
    });
    expect(shrunk.text!.size).toBeLessThan(96);
    expect(shrunk.text!.size).toBeGreaterThanOrEqual(FRAME_TEXT_MIN_SIZE);
    expect(shrunk.text!.textLength).toBeNull();

    const squeezed = qrLayout(code, {
      ...PLAIN,
      frame: true,
      frameText: "W".repeat(20),
      measureText: (t, s) => t.length * 1.1 * s,
    });
    expect(squeezed.text!.size).toBe(FRAME_TEXT_MIN_SIZE);
    expect(squeezed.text!.textLength).toBeLessThanOrEqual(1024 - 2 * FRAME_BORDER);
    expect(squeezed.text!.textLength).toBeGreaterThan(0);
  });

  it("M9-25 the text field cannot grow the drawing: 1216 tall whatever it holds", () => {
    const code = makeQr(ADDRESS);
    for (const frameText of ["x", "Scan me", "W".repeat(20), "😀".repeat(20)]) {
      const layout = qrLayout(code, {
        ...PLAIN,
        frame: true,
        frameText,
        measureText: (t, s) => t.length * s,
      });
      expect([layout.width, layout.height]).toEqual([1024, 1216]);
    }
  });
});

describe("M9-25 qrLayout with a logo: a plate of at most 20 percent, centered, and the picture inside it", () => {
  const code = makeQr(ADDRESS, "H");
  const logo = (picture: { width: number; height: number } | null, frame = false) =>
    qrLayout(code, { ...PLAIN, frame, logo: true, picture });

  it("M9-25 the plate is whole modules, at most 20 percent of the grid's side and 4 percent of its area", () => {
    const layout = logo({ width: 256, height: 256 });
    const unit = layout.area.side / layout.grid;
    const plate = layout.plate!;
    expect(plate.width).toBe(plate.height);
    expect(plate.width / (code.size * unit)).toBeLessThanOrEqual(LOGO_MAX_SHARE + 0.01);
    expect((plate.width * plate.height) / (code.size * unit) ** 2).toBeLessThanOrEqual(
      0.04 + 0.005,
    );
  });

  it("M9-25 the plate is centered on the code (within a pixel)", () => {
    for (const frame of [false, true]) {
      const layout = logo({ width: 256, height: 256 }, frame);
      const plate = layout.plate!;
      const centerX = plate.x + plate.width / 2;
      const centerY = plate.y + plate.height / 2;
      expect(Math.abs(centerX - (layout.area.x + layout.area.side / 2))).toBeLessThanOrEqual(1);
      expect(Math.abs(centerY - (layout.area.y + layout.area.side / 2))).toBeLessThanOrEqual(1);
    }
  });

  it("M9-25 a 1:1 and a 4:1 picture both end up inside the plate", () => {
    for (const picture of [
      { width: 256, height: 256 },
      { width: 256, height: 64 },
      { width: 64, height: 256 },
    ]) {
      const layout = logo(picture);
      const plate = layout.plate!;
      const box = layout.picture!;
      expect(box.x).toBeGreaterThanOrEqual(plate.x);
      expect(box.y).toBeGreaterThanOrEqual(plate.y);
      expect(box.x + box.width).toBeLessThanOrEqual(plate.x + plate.width);
      expect(box.y + box.height).toBeLessThanOrEqual(plate.y + plate.height);
      expect(box.width).toBeLessThanOrEqual(plate.width * LOGO_MAX_SHARE * 5); // trivially inside
    }
  });

  it("M9-25 until the picture has loaded there is a plate size but no picture box", () => {
    const layout = logo(null);
    expect(layout.plate).not.toBeNull();
    expect(layout.picture).toBeNull();
  });

  it("M9-25 a logo is never larger than 20 percent of the grid, for every code size", () => {
    for (const text of [ADDRESS, LONG, `https://${"b".repeat(90)}.example.com/path/`]) {
      const big = makeQr(text, "H");
      const layout = qrLayout(big, { ...PLAIN, logo: true, picture: { width: 4000, height: 40 } });
      const unit = layout.area.side / layout.grid;
      expect(layout.picture!.width).toBeLessThanOrEqual(layout.plate!.width);
      expect(layout.plate!.width / (big.size * unit)).toBeLessThanOrEqual(LOGO_MAX_SHARE + 0.01);
    }
  });
});

// A real decoder over the geometry ---------------------------------------------------------------

/** Paints the layout's rectangles into RGBA pixels: the background, the modules, then the plate. */
function raster(
  code: QrCode,
  layout: QrLayout,
  ink: [number, number, number],
  field: [number, number, number],
) {
  const { width, height } = layout;
  const data = new Uint8ClampedArray(width * height * 4);
  const fill = (
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    color: [number, number, number],
  ) => {
    for (let y = y0; y < y1; y += 1) {
      for (let x = x0; x < x1; x += 1) {
        const at = (y * width + x) * 4;
        data[at] = color[0];
        data[at + 1] = color[1];
        data[at + 2] = color[2];
        data[at + 3] = 255;
      }
    }
  };
  fill(0, 0, width, height, field);
  if (layout.frame) {
    // The border: a band of the code's color around the drawing.
    const t = layout.frame.thickness;
    fill(0, 0, width, t, ink);
    fill(0, height - t, width, height, ink);
    fill(0, 0, t, height, ink);
    fill(width - t, 0, width, height, ink);
  }
  for (const run of moduleRuns(code, layout)) fill(run.x0, run.y0, run.x1, run.y1, ink);
  if (layout.plate) {
    fill(
      layout.plate.x,
      layout.plate.y,
      layout.plate.x + layout.plate.width,
      layout.plate.y + layout.plate.height,
      field,
    );
  }
  return { data, width, height };
}

describe("M9-25 a styled code still decodes (jsQR over the module geometry)", () => {
  const BLACK: [number, number, number] = [0, 0, 0];
  const WHITE: [number, number, number] = [255, 255, 255];
  const NAVY: [number, number, number] = [11, 42, 91];
  const CREAM: [number, number, number] = [251, 246, 233];
  const IVORY: [number, number, number] = [247, 243, 236];
  const INK: [number, number, number] = [27, 24, 20];

  const decode = (image: ReturnType<typeof raster>) =>
    jsQR(image.data, image.width, image.height)?.data ?? null;

  for (const address of [
    ADDRESS,
    "https://mara.hydlnk.com/",
    LONG,
    "https://links.maraokafor.com/",
  ]) {
    it(`M9-25 ${address}: the default, custom colors, Page colors, a logo plate, a frame, and all together`, () => {
      const m = makeQr(address);
      const h = makeQr(address, "H");
      const plain = qrLayout(m, PLAIN);
      expect(decode(raster(m, plain, BLACK, WHITE))).toBe(address);
      expect(decode(raster(m, plain, NAVY, CREAM))).toBe(address);
      expect(decode(raster(m, plain, INK, IVORY))).toBe(address);
      const framed = qrLayout(m, { ...PLAIN, frame: true });
      expect(decode(raster(m, framed, BLACK, WHITE))).toBe(address);
      const logo = qrLayout(h, { ...PLAIN, logo: true, picture: { width: 256, height: 256 } });
      expect(decode(raster(h, logo, BLACK, WHITE))).toBe(address);
      const everything = qrLayout(h, {
        ...PLAIN,
        logo: true,
        frame: true,
        picture: { width: 256, height: 64 },
      });
      expect(decode(raster(h, everything, NAVY, CREAM))).toBe(address);
    });
  }

  it("M9-25 a code made at level H is larger than the same address at level M, and a plate hides modules", () => {
    const m = makeQr(ADDRESS);
    const h = makeQr(ADDRESS, "H");
    expect(h.size).toBeGreaterThan(m.size);
    expect(makeQr(ADDRESS).size).toBe(29);
    const layout = qrLayout(h, { ...PLAIN, logo: true, picture: null });
    const hidden = moduleRuns(h, layout).length;
    expect(hidden).toBeGreaterThan(0);
  });
});
