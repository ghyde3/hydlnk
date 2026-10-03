import qrcode from "qrcode-generator";

/**
 * The page's QR code (M6-31), made in the browser by one small bundled package (qrcode-generator,
 * MIT). Nothing here reads a request, a theme or a tenant token: the text is the page's public
 * address, decided on the server, and the code is black on white at error correction level M with a
 * quiet zone of 4 modules, whatever the page looks like, so it always scans.
 */

export const QR_ERROR_LEVEL = "M";
/** White modules around the code, in modules (the QR standard asks for four). */
export const QR_QUIET_ZONE = 4;
/** The PNG is this many pixels on a side. */
export const QR_PNG_SIZE = 1024;

export interface QrCode {
  /** Modules on a side (without the quiet zone). */
  size: number;
  /** `modules[row][col]` is true for a black module. */
  modules: readonly (readonly boolean[])[];
}

// A page address is ASCII (hostnames are lower case and punycode, handles are a-z0-9-). The package
// encodes one byte per character, so anything else would be mangled: refuse it instead.
const PRINTABLE_ASCII = /^[\x20-\x7e]+$/;

/** The QR code of `text`. Throws for an empty or non-ASCII string, or one too long for a code. */
export function makeQr(text: string): QrCode {
  if (!PRINTABLE_ASCII.test(text)) throw new Error("A QR code needs printable ASCII text.");
  const code = qrcode(0, QR_ERROR_LEVEL);
  code.addData(text);
  code.make();
  const size = code.getModuleCount();
  const modules = Array.from({ length: size }, (_, row) =>
    Array.from({ length: size }, (_, col) => code.isDark(row, col)),
  );
  return { size, modules };
}

/** The side of the drawing in modules: the code plus a quiet zone on each side. */
export const drawnSize = (code: QrCode): number => code.size + 2 * QR_QUIET_ZONE;

/**
 * The path data of the black modules, one `M x y h w v1 h-w z` run per stretch of black in a row,
 * in a viewBox of `drawnSize` units (the quiet zone is already in the coordinates).
 */
export function qrPathData(code: QrCode): string {
  const runs: string[] = [];
  for (let row = 0; row < code.size; row += 1) {
    let col = 0;
    while (col < code.size) {
      if (!code.modules[row]![col]) {
        col += 1;
        continue;
      }
      const start = col;
      while (col < code.size && code.modules[row]![col]) col += 1;
      const width = col - start;
      runs.push(`M${start + QR_QUIET_ZONE} ${row + QR_QUIET_ZONE}h${width}v1h-${width}z`);
    }
  }
  return runs.join("");
}

/**
 * The downloadable SVG: one `<svg>` with one background `<rect>` and one `<path>`, and nothing
 * else (no script, no style, no link, no image, no event attribute). It is plain markup built from
 * numbers only, so no string from outside can reach it.
 */
export function qrSvg(code: QrCode): string {
  const side = drawnSize(code);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${side} ${side}" ` +
    `width="${QR_PNG_SIZE}" height="${QR_PNG_SIZE}" shape-rendering="crispEdges">` +
    `<rect width="${side}" height="${side}" fill="#ffffff"/>` +
    `<path fill="#000000" d="${qrPathData(code)}"/>` +
    `</svg>`
  );
}
