// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeQr } from "@/lib/qr/generate";
import { qrLayout } from "@/lib/qr/layout";
import { renderQrPng } from "@/lib/qr/png";
import { DEFAULT_APPEARANCE, type QrAppearance } from "@/lib/qr/style";
import {
  frameFont,
  paintStyledQr,
  renderStyledQrPng,
  type QrPictureSource,
} from "@/lib/qr/styled-png";

/**
 * M9-25: the PNG of a styled QR code (src/lib/qr/styled-png.ts). A test environment has no canvas,
 * so a recording stand-in takes its place: it writes down every property set and every call, and
 * `toBlob` hands back that record. Two files drawn the same way leave the same record, which is how
 * "the default look is byte-identical to M6-31" is checked here; the real PNG's pixels and its
 * decode are in tests/e2e/m9/share-qr-style.spec.ts.
 */

type Op = [string, ...unknown[]];

interface Recorded {
  width: number;
  height: number;
  ops: Op[];
}

const created: HTMLCanvasElement[] = [];
const records = new Map<HTMLCanvasElement, Op[]>();

/** A 2D context that records. `measureText` is 0.6 em per character, so the frame font is read. */
function recorder(ops: Op[]): CanvasRenderingContext2D {
  let font = "";
  const target: Record<string, unknown> = {};
  return new Proxy(target, {
    get(_t, prop: string) {
      if (prop === "measureText") {
        return (text: string) => {
          const size = Number(/(\d+)px/.exec(font)?.[1] ?? 10);
          return { width: text.length * 0.6 * size };
        };
      }
      if (prop in target) return target[prop];
      return (...args: unknown[]) => {
        ops.push([prop, ...args]);
      };
    },
    set(_t, prop: string, value: unknown) {
      if (prop === "font") font = String(value);
      target[prop] = value;
      ops.push(["set:" + prop, value]);
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

beforeEach(() => {
  created.length = 0;
  records.clear();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (
    this: HTMLCanvasElement,
  ) {
    created.push(this);
    const ops: Op[] = [];
    records.set(this, ops);
    return recorder(ops);
  } as never);
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (
    this: HTMLCanvasElement,
    callback: BlobCallback,
  ) {
    const record: Recorded = {
      width: this.width,
      height: this.height,
      ops: records.get(this) ?? [],
    };
    callback(new Blob([JSON.stringify(record)], { type: "image/png" }));
  });
});

afterEach(() => vi.restoreAllMocks());

const read = async (blob: Blob | null): Promise<Recorded> => {
  expect(blob).not.toBeNull();
  return JSON.parse(await blob!.text()) as Recorded;
};

const code = makeQr("http://mara.localhost:3000/");
const codeH = makeQr("http://mara.localhost:3000/", "H");
const NAVY: QrAppearance = { ...DEFAULT_APPEARANCE, code: "#0B2A5B", background: "#FBF6E9" };

function picture(width = 256, height = 256): QrPictureSource {
  return {
    dataUrl: "data:image/png;base64,AAAA",
    width,
    height,
    source: document.createElement("canvas"),
  };
}

const lower = (ops: Op[]): Op[] =>
  ops.map(
    ([name, ...args]) =>
      [name!, ...args.map((a) => (typeof a === "string" ? a.toLowerCase() : a))] as Op,
  );

describe("M9-25 the default look is the M6-31 PNG", () => {
  it("M9-25 renderStyledQrPng with the default appearance draws exactly what renderQrPng draws", async () => {
    const legacy = await read(await renderQrPng(code));
    created.length = 0;
    const styled = await read(await renderStyledQrPng(code, DEFAULT_APPEARANCE, null));
    expect(styled).toEqual(legacy);
    expect([legacy.width, legacy.height]).toEqual([1024, 1024]);
    // The record is the bytes the test compares: identical, character for character.
    expect(JSON.stringify(styled)).toBe(JSON.stringify(legacy));
  });

  it("M9-25 the general painter, given black on white and nothing else, reproduces the M6-31 rectangles", async () => {
    const legacy = (await read(await renderQrPng(code))).ops;
    const layout = qrLayout(code, {
      frame: false,
      frameText: "Scan me",
      logo: false,
      picture: null,
    });
    const ops: Op[] = [];
    paintStyledQr(recorder(ops), code, DEFAULT_APPEARANCE, layout, null);
    // The same background, the same fill colors and the same module rectangles, in the same order.
    expect(lower(ops)).toEqual(lower(legacy));
  });

  it("M9-25 the default look ignores a loaded picture and the frame text", async () => {
    const legacy = await read(await renderQrPng(code));
    created.length = 0;
    const styled = await read(
      await renderStyledQrPng(code, { ...DEFAULT_APPEARANCE, frameText: "Hello" }, picture()),
    );
    expect(styled).toEqual(legacy);
  });
});

describe("M9-25 a styled PNG", () => {
  it("M9-25 custom colors: 1024 by 1024, the background first, then the modules in the code color", async () => {
    const recorded = await read(await renderStyledQrPng(code, NAVY, null));
    expect([recorded.width, recorded.height]).toEqual([1024, 1024]);
    expect(recorded.ops[0]).toEqual(["set:fillStyle", "#FBF6E9"]);
    expect(recorded.ops[1]).toEqual(["fillRect", 0, 0, 1024, 1024]);
    expect(recorded.ops[2]).toEqual(["set:fillStyle", "#0B2A5B"]);
    expect(recorded.ops.filter((op) => op[0] === "fillText")).toHaveLength(0);
    expect(recorded.ops.filter((op) => op[0] === "drawImage")).toHaveLength(0);
    expect(recorded.ops.filter((op) => op[0] === "fillRect").length).toBeGreaterThan(20);
  });

  it("M9-25 a frame makes the PNG 1024 wide and 1216 tall and draws the border in the code color", async () => {
    const recorded = await read(
      await renderStyledQrPng(code, { ...NAVY, frame: true, frameText: "Scan me" }, null),
    );
    expect([recorded.width, recorded.height]).toEqual([1024, 1216]);
    const sets = recorded.ops.filter((op) => op[0] === "set:strokeStyle");
    expect(sets).toEqual([["set:strokeStyle", "#0B2A5B"]]);
    expect(recorded.ops).toContainEqual(["set:lineWidth", 32]);
    expect(recorded.ops.filter((op) => op[0] === "stroke")).toHaveLength(1);
    expect(recorded.ops.filter((op) => op[0] === "arcTo")).toHaveLength(4);
  });

  it("M9-25 the frame text is one bold fillText, centered, at least 64px, in the code color", async () => {
    const recorded = await read(
      await renderStyledQrPng(code, { ...NAVY, frame: true, frameText: "Scan me" }, null),
    );
    const fills = recorded.ops.filter((op) => op[0] === "fillText");
    expect(fills).toHaveLength(1);
    expect(fills[0]![1]).toBe("Scan me");
    expect(fills[0]![2]).toBe(512);
    const font = recorded.ops.filter((op) => op[0] === "set:font").at(-1)![1] as string;
    expect(font).toMatch(/^700 \d+px sans-serif$/);
    expect(Number(/(\d+)px/.exec(font)![1])).toBeGreaterThanOrEqual(64);
    expect(frameFont(96)).toBe("700 96px sans-serif");
    expect(recorded.ops).toContainEqual(["set:textAlign", "center"]);
    // The last fillStyle before the text is the code color.
    const index = recorded.ops.findIndex((op) => op[0] === "fillText");
    const fill = recorded.ops
      .slice(0, index)
      .filter((op) => op[0] === "set:fillStyle")
      .at(-1);
    expect(fill).toEqual(["set:fillStyle", "#0B2A5B"]);
  });

  it("M9-25 a frame text that is too wide is shrunk, not allowed to grow the PNG", async () => {
    const recorded = await read(
      await renderStyledQrPng(code, { ...NAVY, frame: true, frameText: "W".repeat(20) }, null),
    );
    expect([recorded.width, recorded.height]).toEqual([1024, 1216]);
    const font = recorded.ops.filter((op) => op[0] === "set:font").at(-1)![1] as string;
    expect(Number(/(\d+)px/.exec(font)![1])).toBeLessThan(96);
    expect(Number(/(\d+)px/.exec(font)![1])).toBeGreaterThanOrEqual(64);
  });

  it("M9-25 a logo draws a plate of the background color and then the picture inside it", async () => {
    const source = picture();
    const recorded = await read(await renderStyledQrPng(codeH, { ...NAVY, logo: true }, source));
    const draws = recorded.ops.filter((op) => op[0] === "drawImage");
    expect(draws).toHaveLength(1);
    const layout = qrLayout(codeH, { frame: false, frameText: "", logo: true, picture: source });
    expect(draws[0]!.slice(2)).toEqual([
      layout.picture!.x,
      layout.picture!.y,
      layout.picture!.width,
      layout.picture!.height,
    ]);
    // The plate: a rect of the background color, drawn after the modules and before the picture.
    const at = recorded.ops.findIndex((op) => op[0] === "drawImage");
    const plateAt = recorded.ops.findIndex(
      (op) =>
        op[0] === "fillRect" &&
        op[1] === layout.plate!.x &&
        op[2] === layout.plate!.y &&
        op[3] === layout.plate!.width,
    );
    expect(plateAt).toBeGreaterThan(0);
    expect(plateAt).toBeLessThan(at);
    expect(recorded.ops[plateAt - 1]).toEqual(["set:fillStyle", "#FBF6E9"]);
    expect(recorded.ops.slice(plateAt + 1, at).filter((op) => op[0] === "fillRect")).toHaveLength(
      0,
    );
  });

  it("M9-25 a logo that has not loaded draws no plate and no picture", async () => {
    const recorded = await read(await renderStyledQrPng(codeH, { ...NAVY, logo: true }, null));
    expect(recorded.ops.filter((op) => op[0] === "drawImage")).toHaveLength(0);
    const plain = await read(await renderStyledQrPng(codeH, NAVY, null));
    expect(recorded.ops).toEqual(plain.ops);
  });

  it("M9-25 a wide picture and a tall one both stay inside the plate", async () => {
    for (const [w, h] of [
      [256, 64],
      [64, 256],
    ] as const) {
      const source = picture(w, h);
      const recorded = await read(await renderStyledQrPng(codeH, { ...NAVY, logo: true }, source));
      const layout = qrLayout(codeH, { frame: false, frameText: "", logo: true, picture: source });
      const [, , x, y, width, height] = recorded.ops.find((op) => op[0] === "drawImage")! as [
        string,
        unknown,
        number,
        number,
        number,
        number,
      ];
      expect(x).toBeGreaterThanOrEqual(layout.plate!.x);
      expect(y).toBeGreaterThanOrEqual(layout.plate!.y);
      expect(x + width).toBeLessThanOrEqual(layout.plate!.x + layout.plate!.width);
      expect(y + height).toBeLessThanOrEqual(layout.plate!.y + layout.plate!.height);
    }
  });

  it("M9-25 logo, frame and custom colors together", async () => {
    const recorded = await read(
      await renderStyledQrPng(
        codeH,
        { ...NAVY, logo: true, frame: true, frameText: "Hi" },
        picture(),
      ),
    );
    expect([recorded.width, recorded.height]).toEqual([1024, 1216]);
    expect(recorded.ops.filter((op) => op[0] === "drawImage")).toHaveLength(1);
    expect(recorded.ops.filter((op) => op[0] === "fillText")).toHaveLength(1);
  });
});

describe("M9-25 hostile colors never reach a canvas", () => {
  it("M9-25 a color that is not a hex color throws before any canvas is made", () => {
    for (const bad of ['#fff" onload="x', "red", "", "url(x)"]) {
      expect(() => renderStyledQrPng(code, { ...NAVY, code: bad }, null), bad).toThrow();
      expect(() => renderStyledQrPng(code, { ...NAVY, background: bad }, null), bad).toThrow();
    }
    expect(created).toHaveLength(0);
  });
});
