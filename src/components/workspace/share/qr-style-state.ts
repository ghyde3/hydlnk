"use client";

import { useMemo } from "react";
import { imageRefSchema, type ImageRef } from "@/lib/document";
import { mediaUrl } from "@/lib/media/url";
import { pageColorsOf, type QrPageColors } from "@/lib/qr/style";
import { resolveTokens } from "@/lib/theme";
import { useWorkspace } from "../workspace-context";

/**
 * What the QR card's Style group reads from the workspace (M9-25), apart from the card itself: the
 * page's own colors for 'Page colors' and the picture for 'Add my logo in the center'. They are
 * read here, and only here, so the QR module and the card stay free of the theme (two token systems
 * stay apart): the card gets two strings that pass `normalizeHex` and a media address, nothing else.
 */

/**
 * The picture the logo comes from: the page's logo when it has one, else its photo, else null. The
 * logo is the page-level `profile.logo` of M9-24; this reads it as an unknown key, so the card works
 * before that field exists and a stored value that is not an image reference is ignored.
 */
export function qrLogoOf(profile: unknown): ImageRef | null {
  const record = (typeof profile === "object" && profile !== null ? profile : {}) as Record<
    string,
    unknown
  >;
  for (const key of ["logo", "photo"]) {
    const parsed = imageRefSchema.safeParse(record[key]);
    if (parsed.success) return parsed.data;
  }
  return null;
}

export interface QrStyleInputs {
  /** The draft's resolved `text` and `bg` tokens, or null when either is not a hex color. */
  pageColors: QrPageColors | null;
  /** The logo picture's address on the media origin, or null when the page has neither a logo nor a photo. */
  logoUrl: string | null;
}

export function useQrStyleInputs(): QrStyleInputs {
  const { draft, themeTokens } = useWorkspace();
  const resolved = useMemo(
    () => resolveTokens(themeTokens, draft.theme.overrides),
    [themeTokens, draft.theme.overrides],
  );
  // A gradient or an image background still has its solid `bg` token: that is the one used.
  const pageColors = useMemo(
    () => pageColorsOf({ text: resolved.text, bg: resolved.bg }),
    [resolved.text, resolved.bg],
  );
  const logo = qrLogoOf(draft.profile);
  const logoUrl = logo ? mediaUrl(logo.path) : null;
  return { pageColors, logoUrl };
}
