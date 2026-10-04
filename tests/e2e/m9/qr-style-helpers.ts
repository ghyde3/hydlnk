import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import sharp from "sharp";
import { expect, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { adminClient } from "../fixtures/auth";
import { storeImage } from "../m6/share-helpers";

/**
 * Helpers for the styled QR specs (M9-25). A styled file is checked with a real decoder (jsQR, via
 * `decodeQr` of the M6 helpers) on its pixels, and the default files are compared byte for byte with
 * what the M6-31 generator writes: the SVG against `qrSvg`, the PNG against `renderQrPng` itself,
 * bundled from the files on disk and run in the same browser (`legacyQrPng`).
 */

export { decodeQr, ihdrOf, PNG_SIGNATURE, readDownload } from "../m6/qr-helpers";

export const qrCard = (page: Page): Locator => page.getByTestId("qr-card");
export const styleGroup = (page: Page): Locator => page.getByTestId("qr-style");
export const preview = (page: Page): Locator => page.getByTestId("qr-code");

export const colorMode = (
  page: Page,
  name: "Black and white" | "Page colors" | "Custom",
): Locator => styleGroup(page).getByRole("radio", { name, exact: true });
export const logoSwitch = (page: Page): Locator =>
  styleGroup(page).getByRole("switch", { name: "Add my logo in the center" });
export const frameSwitch = (page: Page): Locator =>
  styleGroup(page).getByRole("switch", { name: "Add a frame with text" });
export const frameText = (page: Page): Locator =>
  styleGroup(page).getByLabel("Frame text", { exact: true });
export const resetStyle = (page: Page): Locator =>
  styleGroup(page).getByRole("button", { name: "Reset style", exact: true });
export const downloadPng = (page: Page): Locator =>
  qrCard(page).getByRole("button", { name: "Download PNG", exact: true });
export const downloadSvg = (page: Page): Locator =>
  qrCard(page).getByRole("button", { name: "Download SVG", exact: true });
export const colorsStatus = (page: Page): Locator => page.getByTestId("qr-colors-status");

export const REFUSED =
  "These colors may not scan. Use a darker code color on a lighter background.";

/** Types a hex color into one of the two Custom rows (the field applies a complete hex as it is typed). */
export async function typeColor(page: Page, field: "Code color" | "Background", hex: string) {
  const input = styleGroup(page).getByLabel(`${field} hex`, { exact: true });
  await input.fill(hex);
  await input.blur();
}

/** Switches to Custom and sets both colors. */
export async function setCustom(page: Page, code: string, background: string) {
  await colorMode(page, "Custom").click();
  await typeColor(page, "Code color", code);
  await typeColor(page, "Background", background);
}

/** Clicks a download button and returns the bytes of the file. */
export async function download(page: Page, which: "png" | "svg"): Promise<Buffer> {
  const [file] = await Promise.all([
    page.waitForEvent("download"),
    (which === "png" ? downloadPng(page) : downloadSvg(page)).click(),
  ]);
  return readFileSync((await file.path())!);
}

/**
 * Draws an SVG file into a canvas of its own size in the browser and returns the PNG of it (what
 * "the SVG drawn into a canvas" is for the decoder). The canvas is white behind it.
 */
export async function rasterize(page: Page, svg: string, width: number, height: number) {
  const dataUrl = await page.evaluate(
    async ({ markup, w, h }) => {
      const image = new Image();
      image.src = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(markup)))}`;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const context = canvas.getContext("2d")!;
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, w, h);
      context.drawImage(image, 0, 0, w, h);
      return canvas.toDataURL("image/png");
    },
    { markup: svg, w: width, h: height },
  );
  return Buffer.from(dataUrl.replace(/^data:image\/png;base64,/, ""), "base64");
}

/** The width and height of an SVG file's viewBox. */
export function viewBoxOf(svg: string): { width: number; height: number } {
  const match = /viewBox="0 0 (\d+) (\d+)"/.exec(svg);
  if (!match) throw new Error("no viewBox");
  return { width: Number(match[1]), height: Number(match[2]) };
}

// The M6-31 generator, in the browser ----------------------------------------------------------------

let legacyBundle: string | null = null;

/** The generator's own files (`src/lib/qr/generate.ts`, `png.ts`) bundled for a browser, once. */
function bundleLegacy(): string {
  if (legacyBundle) return legacyBundle;
  const root = resolve(__dirname, "../../..");
  const out = join(mkdtempSync(join(tmpdir(), "qr-legacy-")), "legacy.js");
  execFileSync(
    join(root, "node_modules/.bin/esbuild"),
    [
      join(root, "tests/e2e/m9/qr-legacy-entry.ts"),
      "--bundle",
      "--format=iife",
      "--global-name=QrLegacy",
      "--platform=browser",
      `--tsconfig=${join(root, "tsconfig.json")}`,
      `--outfile=${out}`,
      "--log-level=error",
    ],
    { cwd: root },
  );
  legacyBundle = readFileSync(out, "utf8");
  return legacyBundle;
}

/** The PNG the M6-31 generator makes for `address`, drawn by the same browser that draws the card's. */
export async function legacyQrPng(context: BrowserContext, address: string): Promise<Buffer> {
  const blank = await context.newPage();
  try {
    await blank.goto("about:blank");
    await blank.addScriptTag({ content: bundleLegacy() });
    const base64 = await blank.evaluate(async (text) => {
      const lib = (
        window as unknown as {
          QrLegacy: {
            makeQr: (t: string) => unknown;
            renderQrPng: (c: unknown) => Promise<Blob | null>;
          };
        }
      ).QrLegacy;
      const blob = await lib.renderQrPng(lib.makeQr(text));
      const bytes = new Uint8Array(await blob!.arrayBuffer());
      let binary = "";
      for (const byte of bytes) binary += String.fromCharCode(byte);
      return btoa(binary);
    }, address);
    return Buffer.from(base64, "base64");
  } finally {
    await blank.close();
  }
}

// A photo for the logo -------------------------------------------------------------------------------

/**
 * Stores a picture of `width` x `height` (an orange disc on dark blue, so it is not just a color)
 * under `ownerId`, and makes it the draft's photo. Returns the reference.
 */
export async function givePhoto(
  ownerId: string,
  pageId: string,
  size: { width: number; height: number },
) {
  const { width, height } = size;
  const svg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
      `<rect width="${width}" height="${height}" fill="#0b2a5b"/>` +
      `<circle cx="${width / 2}" cy="${height / 2}" r="${Math.min(width, height) / 3}" fill="#e8742a"/>` +
      `</svg>`,
  );
  const bytes = await sharp(svg).webp({ lossless: true }).toBuffer();
  const ref = await storeImage(ownerId, bytes, size);
  const admin = adminClient();
  const row = await admin.from("pages").select("draft").eq("id", pageId).single();
  if (row.error) throw new Error(row.error.message);
  const draft = row.data.draft as { profile: Record<string, unknown> };
  draft.profile.photo = ref;
  const saved = await admin.from("pages").update({ draft }).eq("id", pageId);
  if (saved.error) throw new Error(saved.error.message);
  return ref;
}

/** Sets the draft's theme reference (a system theme id), so the preview and the page colors follow it. */
export async function setThemeRef(pageId: string, themeId: string | null) {
  const admin = adminClient();
  const row = await admin.from("pages").select("draft").eq("id", pageId).single();
  if (row.error) throw new Error(row.error.message);
  const draft = row.data.draft as { theme: { ref: string | null; overrides: object } };
  draft.theme = { ref: themeId, overrides: {} };
  const saved = await admin.from("pages").update({ draft }).eq("id", pageId);
  if (saved.error) throw new Error(saved.error.message);
}

/** The text and bg tokens of a system theme, from the themes table. */
export async function themeColors(themeId: string): Promise<{ text: string; bg: string }> {
  const { data, error } = await adminClient()
    .from("themes")
    .select("tokens")
    .eq("id", themeId)
    .single();
  if (error) throw new Error(error.message);
  const tokens = data.tokens as { text: string; bg: string };
  return { text: tokens.text, bg: tokens.bg };
}

/** Pixel `[r, g, b]` of a PNG at (x, y). */
export async function pixel(png: Buffer, x: number, y: number): Promise<[number, number, number]> {
  const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const at = (y * info.width + x) * info.channels;
  return [data[at]!, data[at + 1]!, data[at + 2]!];
}

export const hexToRgb = (hex: string): [number, number, number] => {
  const clean = hex.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(clean.slice(i, i + 2), 16)) as [number, number, number];
};

export { expect };
