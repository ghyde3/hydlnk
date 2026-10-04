import { FONT_ALLOWLIST, FONT_GENERIC, type FontFamily } from "@/lib/theme";
import type { ImageRef } from "./schema";
import { URL_ERROR_MESSAGE } from "./url";

/**
 * The page-level extras of Wave K that decorate the top of a page: the support banner (M9-23) and
 * the profile's logo, name font and name size (M9-24). One module owns the lists, the wording and
 * the pure helpers the schema, the loader, the publish form, the editor reducer and the renderer
 * share, so no layer keeps its own copy of a list.
 *
 * Every key is optional in the document, so `version` stays 1 and a page that never used one parses,
 * publishes and renders exactly as before. The renderer never trusts a stored string: it maps each
 * value through a fixed list (`resolveNameStyle`) and falls back to the default.
 *
 * Imports nothing from schema.ts (the schema imports this), only the font allowlist and the URL
 * message, so the two can depend on it without a cycle.
 */

// The support banner ----------------------------------------------------------------------------

/** The Publish gate's sentences for the banner, one per field. */
export const BANNER_MESSAGES = {
  text: "Add the message.",
  label: "Add a label for the link.",
  url: URL_ERROR_MESSAGE,
} as const;

export type BannerField = keyof typeof BANNER_MESSAGES;

/** The banner as the draft and the published form hold it (every text is a string, maybe empty in a draft). */
export interface BannerLike {
  id?: string;
  visible?: boolean;
  text: string;
  label: string;
  url: string;
}

/** True when nothing is filled in (after trimming): the banner is as good as absent. */
export function isBannerEmpty(
  banner: Pick<BannerLike, "text" | "label" | "url"> | undefined,
): boolean {
  if (!banner) return true;
  return banner.text.trim() === "" && banner.label.trim() === "" && banner.url.trim() === "";
}

/**
 * What a visible banner is missing, one sentence per field (M9-23): once anything is filled in the
 * message is required, and the link's label and address are both set or both empty (a message alone
 * is allowed). The address's own validity is the `url()` rule's. Pure and total.
 */
export function bannerIssues(
  banner: Pick<BannerLike, "text" | "label" | "url">,
): { field: BannerField; message: string }[] {
  const issues: { field: BannerField; message: string }[] = [];
  if (isBannerEmpty(banner)) return issues;
  const text = banner.text.trim();
  const label = banner.label.trim();
  const url = banner.url.trim();
  if (text === "") issues.push({ field: "text", message: BANNER_MESSAGES.text });
  if (url !== "" && label === "") issues.push({ field: "label", message: BANNER_MESSAGES.label });
  if (label !== "" && url === "") issues.push({ field: "url", message: BANNER_MESSAGES.url });
  return issues;
}

/**
 * The published form of a draft's banner (M9-23): trimmed, written with `visible: true`, and
 * `undefined` (no `banner` key at all) when it is hidden or has nothing in it, so a page that never
 * used a banner publishes byte-identically to before. Pure and total.
 */
export function publishBanner(
  banner: (BannerLike & { id: string }) | undefined,
): { id: string; visible: true; text: string; label: string; url: string } | undefined {
  if (!banner || banner.visible === false || isBannerEmpty(banner)) return undefined;
  return {
    id: banner.id,
    visible: true,
    text: banner.text.trim(),
    label: banner.label.trim(),
    url: banner.url.trim(),
  };
}

// The profile's logo, name font and name size ----------------------------------------------------

/** Where the logo goes: next to the name (default) or in its place. */
export const LOGO_PLACEMENTS = ["beside", "instead"] as const;
export type LogoPlacement = (typeof LOGO_PLACEMENTS)[number];

/** The name's size: `medium` is exactly today's size; the others scale it by 0.85, 1.25 and 1.5. */
export const NAME_SIZES = ["small", "medium", "large", "xlarge"] as const;
export type NameSize = (typeof NAME_SIZES)[number];

export const LOGO_PLACEMENT_DEFAULT: LogoPlacement = "beside";
export const NAME_SIZE_DEFAULT: NameSize = "medium";

/** What the Publish gate says about a value outside its list, one sentence per field. */
export const PROFILE_STYLE_MESSAGES = {
  nameFont: "Pick a font from the list.",
  nameSize: "Pick a size from the list.",
  logoPlacement: "Pick where the logo goes.",
} as const;

/** How much of today's size each step is, for the editor's labels and the tests. */
export const NAME_SIZE_SCALE: Readonly<Record<NameSize, number>> = {
  small: 0.85,
  medium: 1,
  large: 1.25,
  xlarge: 1.5,
};

/** The logo's height, as a multiple of the name's font size. */
export const LOGO_HEIGHT_EM = 1.25;

export const NAME_SIZE_LABELS: Readonly<Record<NameSize, string>> = {
  small: "Small",
  medium: "Medium",
  large: "Large",
  xlarge: "Extra large",
};

export const LOGO_PLACEMENT_LABELS: Readonly<Record<LogoPlacement, string>> = {
  beside: "Beside the name",
  instead: "Instead of the name",
};

const isFontFamily = (value: unknown): value is FontFamily =>
  typeof value === "string" && (FONT_ALLOWLIST as readonly string[]).includes(value);

/** A family of the allowlist, or null for anything else (absent means the heading font). */
export function pickNameFont(value: unknown): FontFamily | null {
  return isFontFamily(value) ? value : null;
}

export function pickNameSize(value: unknown): NameSize {
  return (NAME_SIZES as readonly unknown[]).includes(value)
    ? (value as NameSize)
    : NAME_SIZE_DEFAULT;
}

export function pickLogoPlacement(value: unknown): LogoPlacement {
  return (LOGO_PLACEMENTS as readonly unknown[]).includes(value)
    ? (value as LogoPlacement)
    : LOGO_PLACEMENT_DEFAULT;
}

export interface NameStyle {
  /** `null`: the heading font. */
  nameFont: FontFamily | null;
  nameSize: NameSize;
  logoPlacement: LogoPlacement;
}

/** The three style keys of a stored profile, every one filled. Total: any input works. */
export function resolveNameStyle(raw: unknown): NameStyle {
  const source =
    typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : undefined;
  return {
    nameFont: pickNameFont(source?.nameFont),
    nameSize: pickNameSize(source?.nameSize),
    logoPlacement: pickLogoPlacement(source?.logoPlacement),
  };
}

/**
 * The CSS value of the name's `font-family` for an allowlisted family: the quoted family and its
 * generic fallback, built from the constants (never from a tenant string).
 */
export function nameFontStack(family: FontFamily): string {
  return `"${family}", ${FONT_GENERIC[family]}`;
}

/** The profile keys of M9-24 a stored profile may carry. */
export const PROFILE_STYLE_KEYS = ["logo", "logoPlacement", "nameFont", "nameSize"] as const;

/**
 * Only the M9-24 keys a profile carries, so a place that rebuilds the profile (the loader, the
 * restore of a version) copies them without writing a key that was never there.
 */
export function pickProfileStyle(profile: object | undefined): ProfileStyleKeys {
  const source = (profile ?? {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of PROFILE_STYLE_KEYS) {
    if (source[key] !== undefined) out[key] = source[key];
  }
  return out as ProfileStyleKeys;
}

/** The four M9-24 keys of a profile, each optional (a type-only import: no cycle at run time). */
export interface ProfileStyleKeys {
  logo?: ImageRef | null;
  logoPlacement?: LogoPlacement;
  nameFont?: FontFamily;
  nameSize?: NameSize;
}

/**
 * The profile keys of M9-24 as Publish writes them (the logo is added by `toPublishForm`, which owns
 * the image reference): only what differs from the default, so a page that uses none of them
 * publishes the same bytes as before. The placement is meaningful only with a logo.
 */
export function publishNameStyle(
  profile: { nameFont?: unknown; nameSize?: unknown; logoPlacement?: unknown },
  hasLogo: boolean,
): { logoPlacement?: LogoPlacement; nameFont?: FontFamily; nameSize?: NameSize } {
  const style = resolveNameStyle(profile);
  return {
    ...(hasLogo && style.logoPlacement !== LOGO_PLACEMENT_DEFAULT
      ? { logoPlacement: style.logoPlacement }
      : {}),
    ...(style.nameFont !== null ? { nameFont: style.nameFont } : {}),
    ...(style.nameSize !== NAME_SIZE_DEFAULT ? { nameSize: style.nameSize } : {}),
  };
}
