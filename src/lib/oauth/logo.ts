import "server-only";
import sharp from "sharp";
import { readImageSize } from "@/lib/media/dimensions";
import { sniffImage } from "@/lib/media/sniff";
import { LOGO_MAX_BYTES, fetchClientDocument, type SafeFetchDeps } from "./safe-fetch";

/**
 * An app's logo (M10-09): shown only for a client whose document HYDLNK fetched itself, and only
 * after it was fetched and RE-ENCODED here. The browser never fetches anything for it: the consent page
 * embeds the result as a `data:image/png;base64,...` URI, and a failure of any part of the path just
 * means initials are drawn.
 *
 * The path: the logo address must be https, pass the same address and resolution policy as the document
 * (it goes through the same fetch function), and be "safe": its host is the client address's host or a
 * subdomain of it, or is listed in `LOGO_HOST_ALLOWLIST`. The response is capped at 100 KB and must be
 * `image/png`, `image/jpeg` or `image/webp` (SVG and everything else is refused); its real type is read
 * from the bytes, not the header; its size is read from the file header and must be between 32x32 and
 * 2,000x2,000 pixels BEFORE any decode (a header claiming 30,000x30,000 is refused without decoding);
 * then it is decoded with sharp (a pixel limit, no animation), cropped to a square and re-encoded as a
 * 96x96 PNG with no metadata of at most 20,480 bytes.
 */

/**
 * Logo hosts that are not the client's own, keyed by client host. Every entry is Gary's decision.
 * `chatgpt.com` to `persistent.oaistatic.com`: ChatGPT's published document names that host.
 */
export const LOGO_HOST_ALLOWLIST: Readonly<Record<string, readonly string[]>> = {
  "chatgpt.com": ["persistent.oaistatic.com"],
};

export const LOGO_MIN_EDGE = 32;
export const LOGO_MAX_EDGE = 2000;
export const LOGO_SIZE = 96;
export const LOGO_STORED_MAX_BYTES = 20_480;

const LOGO_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

/** Is `logoHost` the client's host, a subdomain of it, or allow-listed for it? */
export function isSafeLogoHost(logoHost: string, clientHost: string): boolean {
  const logo = logoHost.toLowerCase();
  const client = clientHost.toLowerCase();
  if (logo === client || logo.endsWith(`.${client}`)) return true;
  return (LOGO_HOST_ALLOWLIST[client] ?? []).includes(logo);
}

/**
 * Re-encodes the bytes of an accepted image as the 96x96 PNG stored on the client row, or null when
 * any check fails. No network. The size is read from the header first; a bad header never reaches the
 * decoder.
 */
export async function reencodeLogo(bytes: Uint8Array): Promise<Uint8Array | null> {
  const format = sniffImage(bytes);
  if (!format) return null;
  const size = readImageSize(bytes, format);
  if (!size) return null;
  const { width, height } = size;
  if (width < LOGO_MIN_EDGE || height < LOGO_MIN_EDGE) return null;
  if (width > LOGO_MAX_EDGE || height > LOGO_MAX_EDGE) return null;

  try {
    const pipeline = () =>
      sharp(Buffer.from(bytes), {
        limitInputPixels: LOGO_MAX_EDGE * LOGO_MAX_EDGE,
        failOn: "error",
        animated: false,
      })
        .rotate()
        .resize(LOGO_SIZE, LOGO_SIZE, { fit: "cover", position: "centre" });
    // Sharp keeps no metadata unless asked to; fewer colors until the image fits the byte budget.
    for (const colours of [256, 128, 64, 32, 16]) {
      const output = await pipeline()
        .png({ compressionLevel: 9, palette: true, colours, effort: 10 })
        .toBuffer();
      if (output.length <= LOGO_STORED_MAX_BYTES) return new Uint8Array(output);
    }
    return null;
  } catch {
    return null;
  }
}

/** Fetches, checks and re-encodes `logoUri`, or null (initials). Never throws. */
export async function loadLogo(
  logoUri: string,
  clientHost: string,
  deps: SafeFetchDeps,
): Promise<Uint8Array | null> {
  try {
    const host = new URL(logoUri).hostname.toLowerCase();
    if (!isSafeLogoHost(host, clientHost)) return null;
    const fetched = await fetchClientDocument(logoUri, deps, {
      maxBytes: LOGO_MAX_BYTES,
      accept: "image/png, image/jpeg, image/webp",
      acceptsType: (type) => LOGO_TYPES.has(type),
    });
    if (!fetched.ok) return null;
    return await reencodeLogo(fetched.body);
  } catch {
    return null;
  }
}
