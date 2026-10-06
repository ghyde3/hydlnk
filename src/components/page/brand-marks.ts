import {
  siAppstore,
  siDiscord,
  siFacebook,
  siGithub,
  siGoogleplay,
  siInstagram,
  siPinterest,
  siReddit,
  siSnapchat,
  siSpotify,
  siThreads,
  siTiktok,
  siTwitch,
  siX,
  siYoutube,
} from "simple-icons";

/**
 * The one table of brand marks (M9-04), for the social row and for the link block's brand icons.
 * Plain data, no React and no `'use client'`: the static HTML pipeline reads it at render, so a
 * public page ships the marks as inline SVG and no library code. Each mark is the 24x24 `path` of
 * Simple Icons at the pinned version (16.34.0, CC0-1.0), imported by name, so a bundler keeps only
 * these thirteen paths. The shapes are used unaltered: one filled `<path>`, `currentColor`, never
 * the brand's own color.
 *
 * Trademark note: the marks belong to their owners and are used only to link to those services.
 *
 * A name that is not in the table (`__proto__`, `constructor`, anything a document might hold)
 * has no mark: the lookup is a `Map`, never a property read on an object.
 */

/**
 * LinkedIn is not in Simple Icons at the pinned version (tests/unit/m9-blocks-brand-marks.test.ts
 * asserts the package has no LinkedIn export, so an upgrade that adds one is noticed). This is
 * the 'in' square, one filled path in the same 24x24 box: the outer rounded square, then the
 * letters as holes (wound the other way, so the default non-zero fill leaves them open).
 *
 * Source and provenance: LinkedIn Brand Guidelines (https://brand.linkedin.com/policies), checked
 * 2026-10-04. That page names the "[in] Logo" and links to it but publishes no path data, and no
 * file was downloaded. The drawing is by hand, from the familiar proportions of the 'in' square
 * (a 9% corner, an 'i' with a round dot, an 'n' whose arch starts at the stem), so it may differ
 * in small details from LinkedIn's own artwork. To use the exact artwork, replace this one string
 * with the path of the official 'in' square from the LinkedIn media kit (24x24, one path).
 */
const LINKEDIN_PATH =
  // the rounded square, clockwise
  "M2.2 0H21.8A2.2 2.2 0 0 1 24 2.2V21.8A2.2 2.2 0 0 1 21.8 24H2.2A2.2 2.2 0 0 1 0 21.8V2.2A2.2 2.2 0 0 1 2.2 0z" +
  // the dot of the 'i', counter-clockwise
  "M7.4 5.37A2.063 2.063 0 0 0 3.274 5.37A2.063 2.063 0 0 0 7.4 5.37z" +
  // the stem of the 'i'
  "M3.56 9V20.45H7.12V9z" +
  // the 'n': stem, then the arch and the right leg
  "M9.35 9V20.45H12.9V14.79C12.9 13.29 13.19 11.85 15.04 11.85C16.87 11.85 16.89 13.56 16.89 14.88V20.45H20.45V14.17C20.45 11.08 19.78 8.71 16.18 8.71C14.45 8.71 13.29 9.66 12.81 10.56L12.77 10.56V9z";

/** The brands with a mark, in the order of the social row's platforms, then LinkedIn's. */
export const BRAND_MARK_NAMES = [
  "instagram",
  "tiktok",
  "youtube",
  "x",
  "facebook",
  "linkedin",
  "github",
  "threads",
  "reddit",
  "snapchat",
  "pinterest",
  "discord",
  "twitch",
  "spotify",
] as const;
export type BrandMarkName = (typeof BRAND_MARK_NAMES)[number];

const MARKS: ReadonlyMap<string, string> = new Map<BrandMarkName, string>([
  ["instagram", siInstagram.path],
  ["tiktok", siTiktok.path],
  ["youtube", siYoutube.path],
  ["x", siX.path],
  ["facebook", siFacebook.path],
  ["linkedin", LINKEDIN_PATH],
  ["github", siGithub.path],
  ["threads", siThreads.path],
  ["reddit", siReddit.path],
  ["snapchat", siSnapchat.path],
  ["pinterest", siPinterest.path],
  ["discord", siDiscord.path],
  ["twitch", siTwitch.path],
  ["spotify", siSpotify.path],
]);

/**
 * The two app store marks (M9-21), for the app store block's badges: the App Store and Google Play,
 * the same kind of path as above (Simple Icons at the pinned version, 24x24, one filled path used
 * unaltered). They have their own table: they are not social platforms and not link icons, so
 * `brandMarkPath` never answers for them. Apple's and Google's official badge artwork is not
 * vendored (it has to be downloaded from their marketing sites, which needs Gary's approval); the
 * one component to swap for it is `AppBadge` in ./store-blocks.tsx.
 */
const APP_MARKS: ReadonlyMap<string, string> = new Map([
  ["appstore", siAppstore.path],
  ["googleplay", siGoogleplay.path],
]);

/** The path of an app store's mark ('appstore' or 'googleplay'), or null for any other name. */
export function appMarkPath(store: unknown): string | null {
  return typeof store === "string" ? (APP_MARKS.get(store) ?? null) : null;
}

/** The path of a brand's mark, or null for a name that has none (and for anything that is not a string). */
export function brandMarkPath(name: unknown): string | null {
  return typeof name === "string" ? (MARKS.get(name) ?? null) : null;
}

/** The LinkedIn path, for the test that holds its shape. */
export const LINKEDIN_MARK_PATH = LINKEDIN_PATH;
