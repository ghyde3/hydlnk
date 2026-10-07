import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { imageRefSchema } from "@/lib/document";
import { areaToCrop } from "@/lib/media/position-crop";
import { listFiles, stripComments, walk } from "./support/module-graph";

/**
 * M9-08: react-easy-crop draws the "Position your photo" viewfinder. What stays true: no crop, focus
 * or zoom value is stored or sent (the image reference has no `zoom`, the upload reads only `kind`
 * and `file`), the hand-written drag is gone, the dialog is still a native <dialog>, the library is
 * loaded when a file is picked and never reaches a public page.
 */

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const code = (path: string) => stripComments(read(path));
const DIALOG = "src/components/editor/position-dialog.tsx";

describe("M9-08 nothing about the crop is stored or sent", () => {
  const ref = {
    path: "11111111-1111-4111-8111-111111111111/avatar-0123456789abcdef0123456789abcdef.webp",
    width: 400,
    height: 400,
  };

  it("the image reference has no zoom key: a zoom, a crop and a pan fed to the schema are stripped", () => {
    const parsed = imageRefSchema.parse({
      ...ref,
      zoom: 2,
      crop: { x: 1, y: 2 },
      pan: { x: 3, y: 4 },
      x: 1,
      y: 2,
    });
    expect(Object.keys(parsed).sort()).toEqual(["height", "path", "width"]);
    expect("zoom" in parsed).toBe(false);
  });

  it("the focus control's focus stays 0 to 1 and is the only extra key", () => {
    expect(imageRefSchema.parse({ ...ref, focus: { x: 0.25, y: 0.75 } }).focus).toEqual({
      x: 0.25,
      y: 0.75,
    });
    expect(imageRefSchema.safeParse({ ...ref, focus: { x: 2, y: 0 } }).success).toBe(false);
  });

  it("the upload reads only the kind and the file: crop, x, y, zoom and focus form fields are ignored", () => {
    const source = code("src/lib/media/upload.ts");
    const fields = [...source.matchAll(/form\.get\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1]);
    expect([...new Set(fields)].sort()).toEqual(["file", "kind"]);
    expect(source).not.toMatch(/["'](crop|zoom|focus|pan)["']/);
  });

  it("the dialog sends nothing itself and writes no zoom or crop anywhere", () => {
    const source = code(DIALOG);
    expect(source).not.toMatch(
      /\bfetch\b|XMLHttpRequest|sendBeacon|FormData|localStorage|sessionStorage/,
    );
    expect(source).toMatch(/onUse\(file\)/);
  });
});

describe("M9-08 the viewfinder is the library's", () => {
  const source = code(DIALOG);

  it("the hand-written drag, its layout and its pointer capture are gone", () => {
    expect(source).not.toMatch(
      /movePicture|pictureLayout|setPointerCapture|onPointerMove|onPointerUp|onPointerCancel/,
    );
    expect(source).not.toMatch(/drag\.current/);
  });

  it("is configured as the spec says: square, 1x to 4x, covering, no grid, no wheel zoom", () => {
    expect(source).toMatch(/aspect=\{1\}/);
    expect(source).toMatch(/minZoom=\{MIN_ZOOM\}/);
    expect(source).toMatch(/maxZoom=\{MAX_ZOOM\}/);
    expect(source).toMatch(/restrictPosition/);
    expect(source).toMatch(/showGrid=\{false\}/);
    expect(source).toMatch(/zoomWithScroll=\{false\}/);
    expect(source).toMatch(/objectFit="cover"/);
    expect(source).toMatch(/cropShape=\{variant === "photo" \? "round" : "rect"\}/);
    // The pinch is the library's: zoom changes come back through onZoomChange.
    expect(source).toMatch(/onZoomChange=/);
    expect(source).toMatch(/onCropChange=/);
  });

  it("the outline and the dimming use HYDLNK UI tokens only", () => {
    expect(source).toMatch(/var\(--hl-surface\)/);
    expect(source).toMatch(/var\(--hl-ink\)/);
    expect(source).toMatch(/var\(--hl-radius\)/);
    expect(source).not.toMatch(/--t-/);
  });

  it("the dialog stays a native <dialog> (Radix is for the template picker only)", () => {
    expect(source).toMatch(/<dialog/);
    expect(source).toMatch(/showModal\(\)/);
    expect(source).not.toMatch(/@radix-ui/);
  });

  it("the viewfinder is the focusable group named Picture position, with touch-action none on it alone", () => {
    expect(source).toMatch(/aria-label="Picture position"/);
    expect(source).toMatch(/tabIndex=\{0\}/);
    expect(source).toMatch(/touchAction: "none"/);
    // The library's crop area is not a second tab stop.
    expect(source).toMatch(/tabIndex: undefined/);
  });

  it("the file is drawn from the croppedAreaPixels the library reports (onCropAreaChange, which also fires on a slider-only zoom), with panToCrop only as the fallback", () => {
    expect(source).toMatch(/onCropAreaChange=/);
    expect(source).toMatch(/areaToCrop\(/);
    expect(source).toMatch(/panToCrop\(view\.pan, view\.zoom, width, height, finderSize\(\)\)/);
  });
});

describe("M9-08 areaToCrop turns the library's croppedAreaPixels into the square to draw", () => {
  it("a 4000x3000 picture at 2x, area (500, 250, 1500, 1500): center and zoom follow", () => {
    expect(areaToCrop({ x: 500, y: 250, width: 1500, height: 1500 }, 4000, 3000)).toEqual({
      cx: 1250,
      cy: 1000,
      zoom: 2,
    });
  });

  it("the whole shorter side is 1x, and the square stays inside the picture", () => {
    const crop = areaToCrop({ x: -3, y: 0, width: 3000, height: 3000 }, 4000, 3000);
    expect(crop.zoom).toBe(1);
    expect(crop.cx).toBe(1500);
  });

  it("bad numbers (NaN, Infinity, zero or negative sizes) come back null, so the caller falls back", () => {
    expect(areaToCrop({ x: NaN, y: 0, width: 10, height: 10 }, 100, 100)).toBeNull();
    expect(areaToCrop({ x: 0, y: 0, width: Infinity, height: 10 }, 100, 100)).toBeNull();
    expect(areaToCrop({ x: 0, y: 0, width: 0, height: 0 }, 100, 100)).toBeNull();
    expect(areaToCrop({ x: 0, y: 0, width: -5, height: -5 }, 100, 100)).toBeNull();
  });
});

describe("M9-08 loading and public pages", () => {
  it("react-easy-crop is imported by position-dialog.tsx only, and only through import(), so the editor's first load has none of it", () => {
    const importers = listFiles("src").filter((file) => /["']react-easy-crop["']/.test(code(file)));
    expect(importers).toEqual([DIALOG]);
    const source = code(DIALOG);
    expect(source).toMatch(/import\("react-easy-crop"\)/);
    expect(source).not.toMatch(/from\s+["']react-easy-crop["']/);
  });

  it("the position dialog's callers load it with the file picked: they mount it only for a decoded picture", () => {
    for (const file of [
      "src/components/editor/image-upload-control.tsx",
      "src/components/blocks/forms/link-thumb-upload.tsx",
    ]) {
      expect(code(file), file).toMatch(/<PositionDialog/);
      expect(code(file), file).toMatch(/&&|\? \(|\?\s*</);
    }
  });

  it("nothing reachable from the tenant routes, the page renderer, the static renderer or the marketing site imports it", () => {
    const entries = [
      ...listFiles("src/app/(tenant)"),
      ...listFiles("src/app/(marketing)"),
      ...listFiles("src/components/page"),
      ...listFiles("src/components/marketing"),
      ...listFiles("src/lib/tenant-render"),
      ...listFiles("src/lib/tenant-assets"),
    ];
    const { packages } = walk(entries);
    expect(packages.has("react-easy-crop")).toBe(false);
  });

  it("the library makes no network request: the picture is the file's own object URL", () => {
    const source = code(DIALOG);
    expect(source).toMatch(/image=\{photo\.url\}/);
    expect(code("src/lib/media/position-crop.ts")).toMatch(/URL\.createObjectURL/);
  });
});
