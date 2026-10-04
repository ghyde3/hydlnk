import "server-only";
import { unstable_cache } from "next/cache";
import { ImageResponse } from "next/og";
import sharp from "sharp";
import {
  IMAGE_PATH_PATTERN,
  codePointLength,
  imageRefSchema,
  truncateToCodePoints,
} from "@/lib/document";
import { initialsOf } from "@/components/page/initials";
import type { ImageRef, PublishDoc } from "@/lib/document";
import { mediaOrigin, storageUrl } from "@/lib/media/url";
import { SYSTEM_DEFAULT_TOKENS, type TokenSet } from "@/lib/theme";
import { loadOgFont, type OgFont } from "./og-font";
import { shareImagePng } from "./share-og";
import { pageTag } from "./tags";

/**
 * Bump when the layout changes: it is part of the cache key, so a deploy never serves the old one.
 * "2": a page's share image (M6-32) can replace the generated card.
 */
export const OG_TEMPLATE_VERSION = "2";

export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;

const BIO_MAX = 110;
const AVATAR_MAX_BYTES = 4 * 1024 * 1024;

const HEX = /^#[0-9a-fA-F]{6}$/;

export interface OgInput {
  name: string;
  bio: string;
  handle: string;
  /** `mara.hydlnk.com`: shown in mono-spaced cells. */
  host: string;
  photo: ImageRef | null;
  tokens: Pick<TokenSet, "bg" | "text" | "textMuted" | "accent">;
}

const color = (value: string, fallback: string) => (HEX.test(value) ? value : fallback);

function soft(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/**
 * Keeps only what the bundled font can draw. Anything else (emoji, scripts Geist lacks) would make
 * `next/og` fetch a font or an emoji image from the network, so it is dropped here and the image
 * is made from bundled assets alone. Whitespace is collapsed.
 */
export function drawable(text: string, font: Pick<OgFont, "has">): string {
  let out = "";
  for (const char of text) {
    const code = char.codePointAt(0)!;
    if (code === 0x20 || font.has(code)) out += char;
  }
  return out.replace(/\s+/g, " ").trim();
}

/**
 * The avatar as a data URI, or null (initials are drawn instead). Only an image reference that
 * matches the schema is followed, and only to the configured Supabase Storage origin: a `path`
 * that does not match is never fetched (SSRF guard), a redirect is an error, and anything that is
 * not a small PNG, JPEG or WebP falls back to initials. Every upload is a WebP since M5-11 and the
 * renderer cannot draw one, so a WebP is redrawn as a PNG first (at most 400 pixels: that is all the
 * pipeline ever stores). Never throws.
 */
export async function avatarDataUri(photo: ImageRef | null): Promise<string | null> {
  if (!photo) return null;
  const ref = imageRefSchema.safeParse(photo);
  if (!ref.success || !IMAGE_PATH_PATTERN.test(ref.data.path)) return null;
  try {
    const url = storageUrl(ref.data.path);
    if (new URL(url).origin !== mediaOrigin()) return null;
    const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(4000) });
    if (!response.ok) return null;
    const type = (response.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
    if (type !== "image/png" && type !== "image/jpeg" && type !== "image/webp") return null;
    const declared = Number(response.headers.get("content-length") ?? "0");
    if (declared > AVATAR_MAX_BYTES) return null;
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length === 0 || bytes.length > AVATAR_MAX_BYTES) return null;
    if (type === "image/webp") {
      // Not a real image (or a bomb past the pixel cap): sharp throws and the initials are drawn.
      const png = await sharp(bytes, { limitInputPixels: 16_000_000 })
        .resize({ width: 400, height: 400, fit: "inside", withoutEnlargement: true })
        .png()
        .toBuffer();
      return `data:image/png;base64,${png.toString("base64")}`;
    }
    return `data:${type};base64,${bytes.toString("base64")}`;
  } catch {
    return null;
  }
}

function nameSize(length: number): number {
  if (length <= 14) return 92;
  if (length <= 24) return 72;
  if (length <= 36) return 56;
  return 44;
}

/** The 1200x630 PNG for a page: name, bio, avatar, host and the page's frozen colors. */
export async function renderOgPng(input: OgInput): Promise<Buffer> {
  const font = await loadOgFont();
  const bg = color(input.tokens.bg, SYSTEM_DEFAULT_TOKENS.bg);
  const text = color(input.tokens.text, SYSTEM_DEFAULT_TOKENS.text);
  const muted = color(input.tokens.textMuted, SYSTEM_DEFAULT_TOKENS.textMuted);
  const accent = color(input.tokens.accent, SYSTEM_DEFAULT_TOKENS.accent);

  const name = drawable(input.name, font) || drawable(input.handle, font) || "HYDLNK";
  const bioText = drawable(input.bio, font);
  const bio =
    codePointLength(bioText) > BIO_MAX
      ? `${truncateToCodePoints(bioText, BIO_MAX).trimEnd()}…`
      : bioText;
  const host = drawable(input.host, font);
  const photo = await avatarDataUri(input.photo);
  const initials = initialsOf(name);

  // The host in fixed-width cells: no monospace font is bundled, so the columns are laid out here.
  const cell = 19;
  const hostCells = Array.from(host).map((char, index) => (
    <div
      key={index}
      style={{ display: "flex", width: cell, justifyContent: "center", fontSize: 32, color: muted }}
    >
      {char}
    </div>
  ));

  const element = (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        width: "100%",
        height: "100%",
        padding: 64,
        backgroundColor: bg,
        color: text,
        fontFamily: "Geist",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 56 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flex: "none",
            width: 232,
            height: 232,
            borderRadius: 116,
            border: `6px solid ${accent}`,
            backgroundColor: soft(accent, 0.14),
            overflow: "hidden",
          }}
        >
          {photo ? (
            // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
            <img src={photo} width={220} height={220} style={{ objectFit: "cover" }} />
          ) : (
            <div style={{ display: "flex", fontSize: 92, color: accent }}>{initials}</div>
          )}
        </div>
        <div style={{ display: "flex", flexDirection: "column", flex: 1, gap: 20, minWidth: 0 }}>
          <div
            style={{
              display: "flex",
              fontSize: nameSize(codePointLength(name)),
              lineHeight: 1.08,
              wordBreak: "break-word",
              color: text,
            }}
          >
            {name}
          </div>
          {bio ? (
            <div
              style={{
                display: "flex",
                fontSize: 34,
                lineHeight: 1.35,
                wordBreak: "break-word",
                color: muted,
              }}
            >
              {bio}
            </div>
          ) : null}
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex" }}>{hostCells}</div>
        <div
          style={{
            display: "flex",
            width: 96,
            height: 8,
            borderRadius: 4,
            backgroundColor: accent,
          }}
        />
      </div>
    </div>
  );

  const response = new ImageResponse(element, {
    width: OG_WIDTH,
    height: OG_HEIGHT,
    fonts: [{ name: "Geist", data: font.data, weight: 400, style: "normal" }],
  });
  return Buffer.from(await response.arrayBuffer());
}

/**
 * The key of the cached image: the template version, the page, its publish time and the share card
 * (M6-32), so a new publish or a changed share card is never answered with an old image. The
 * share fields are empty for a page without a share card.
 */
export function ogCacheKey(page: {
  pageId: string;
  publishedAt: string | null;
  share?: unknown;
}): string[] {
  return [
    "og-image",
    OG_TEMPLATE_VERSION,
    page.pageId,
    page.publishedAt ?? "",
    page.share === undefined ? "" : JSON.stringify(page.share),
  ];
}

/**
 * The page's OG image through the page's cache tag (same tag as the page and the public query),
 * so Publish refreshes it together with the page and a draft edit never changes it. The publish
 * time is part of the key as well: a new publish can never be answered with the old image.
 * `next dev` renders every time (see published-page.ts).
 *
 * A page whose share card has a picture serves that picture (M6-32); when it cannot be loaded the
 * generated card below is drawn instead, so this never fails because of it.
 */
export async function getOgPng(page: {
  pageId: string;
  publishedAt: string | null;
  document: PublishDoc;
  handle: string;
  host: string;
}): Promise<Buffer> {
  const { document } = page;
  const build = async () => {
    if (document.share?.image) {
      const picture = await shareImagePng(document.share.image);
      if (picture) return picture.toString("base64");
    }
    return (
      await renderOgPng({
        name: document.profile.name,
        bio: document.profile.bio,
        handle: page.handle,
        host: page.host,
        photo: document.profile.photo,
        tokens: document.tokens,
      })
    ).toString("base64");
  };

  const base64 =
    process.env.NODE_ENV !== "production"
      ? await build()
      : await unstable_cache(
          build,
          ogCacheKey({
            pageId: page.pageId,
            publishedAt: page.publishedAt,
            share: document.share,
          }),
          {
            tags: [pageTag(page.pageId)],
          },
        )();
  return Buffer.from(base64, "base64");
}
