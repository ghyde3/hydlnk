import { codePointLength } from "./limits";
import { isHttpUrl, MAX_URL_LENGTH } from "./url";

/**
 * UTM tags (M9-27, M9-28): the three campaign values a page may add to its outgoing links, and the
 * one pure function that adds them, `withUtm`. The click redirect (`/r/...`) is the only place a tag
 * is ever added, at redirect time: the markup of a public page never carries one, and the stored
 * destination is never rewritten.
 *
 * Leaf module (imports only the limits and URL primitives), so the schema, the editor, the publish
 * form and the redirect share one rule and one wording. Safe in server and client code.
 */

/** The three keys, in the order they are written to a URL. */
export const UTM_KEYS = ["source", "medium", "campaign"] as const;
export type UtmKey = (typeof UTM_KEYS)[number];

/** The query parameter each key becomes. */
export const UTM_PARAM: Readonly<Record<UtmKey, string>> = {
  source: "utm_source",
  medium: "utm_medium",
  campaign: "utm_campaign",
};

export const UTM_LABELS: Readonly<Record<UtmKey, string>> = {
  source: "Source",
  medium: "Medium",
  campaign: "Campaign",
};

/** The placeholders of the Share tab's card (M9-28). */
export const UTM_PLACEHOLDERS: Readonly<Record<UtmKey, string>> = {
  source: "hydlnk",
  medium: "link-in-bio",
  campaign: "spring-launch",
};

/** Longest value Publish accepts, in code points. */
export const UTM_VALUE_MAX = 40;
/** Longest value a DRAFT keeps, so a half-typed or pasted value still autosaves and shows its error. */
export const UTM_DRAFT_MAX = 100;

export const UTM_PATTERN_MESSAGE = "Use letters, numbers, spaces, dots, dashes and underscores.";
export const UTM_LENGTH_MESSAGE = `Use ${UTM_VALUE_MAX} characters or fewer.`;

/**
 * Letters, digits, spaces, dots, hyphens, underscores and tildes. `&`, `=`, `#`, `?`, `%`, `+`,
 * quotes, slashes, line breaks and every other control or format character fall outside it, so a
 * value can never start a second parameter, end the query or smuggle a header.
 */
const UTM_VALUE_PATTERN = /^[\p{L}\p{M}\p{N} ._~-]+$/u;

/** Why a value fails, or null when it is fine. The value is judged trimmed, as it is stored. */
export function utmValueError(value: unknown): string | null {
  if (typeof value !== "string") return UTM_PATTERN_MESSAGE;
  const trimmed = value.trim();
  if (trimmed === "" || !UTM_VALUE_PATTERN.test(trimmed)) return UTM_PATTERN_MESSAGE;
  if (codePointLength(trimmed) > UTM_VALUE_MAX) return UTM_LENGTH_MESSAGE;
  return null;
}

/** The trimmed value when it passes the rule, else undefined. The redirect re-checks every value with this. */
export function validUtmValue(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return utmValueError(trimmed) === null ? trimmed : undefined;
}

/** A page's defaults (`utm` on the document): each key optional. */
export interface PageUtm {
  source?: string | undefined;
  medium?: string | undefined;
  campaign?: string | undefined;
}

/** A link's own tags (`utm` on a link block): the same keys, and `off` to add nothing at all. */
export interface LinkUtm extends PageUtm {
  off?: boolean | undefined;
}

const hasOwn = (value: object, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(value, key);

/**
 * Adds `utm_source`, `utm_medium` and `utm_campaign` to an outgoing link (M9-27). Pure and total.
 *
 *   - only an http or https target (`isHttpUrl`); anything else, and an unparseable value, comes back
 *     unchanged;
 *   - each parameter takes the link's own value when it has a valid one, else the page's default;
 *     an empty or invalid value adds nothing; `off` on the link adds nothing at all;
 *   - a parameter name the destination already carries stays as it is (the owner's own URL wins and
 *     nothing is duplicated);
 *   - the tags are written with `URLSearchParams` (percent-encoded), after the existing query, which
 *     is kept byte for byte, and before the fragment; the host, path and fragment never change;
 *   - when the result would be longer than 2048 characters nothing is added.
 */
export function withUtm(
  target: string,
  pageUtm?: PageUtm | null,
  linkUtm?: LinkUtm | null,
): string {
  if (!isHttpUrl(target)) return target;
  if (linkUtm && typeof linkUtm === "object" && linkUtm.off === true) return target;

  const hashAt = target.indexOf("#");
  const beforeHash = hashAt === -1 ? target : target.slice(0, hashAt);
  const fragment = hashAt === -1 ? "" : target.slice(hashAt);
  const queryAt = beforeHash.indexOf("?");
  const base = queryAt === -1 ? beforeHash : beforeHash.slice(0, queryAt);
  const query = queryAt === -1 ? undefined : beforeHash.slice(queryAt + 1);

  let existing: URLSearchParams;
  try {
    existing = new URLSearchParams(query ?? "");
  } catch {
    return target;
  }

  const added = new URLSearchParams();
  for (const key of UTM_KEYS) {
    const name = UTM_PARAM[key];
    if (existing.has(name)) continue;
    const own =
      linkUtm && typeof linkUtm === "object" && hasOwn(linkUtm, key)
        ? validUtmValue(linkUtm[key])
        : undefined;
    const page =
      pageUtm && typeof pageUtm === "object" && hasOwn(pageUtm, key)
        ? validUtmValue(pageUtm[key])
        : undefined;
    const value = own ?? page;
    if (value !== undefined) added.append(name, value);
  }
  const tags = added.toString();
  if (tags === "") return target;

  const joined =
    query === undefined || query === ""
      ? `${base}?${tags}`
      : `${base}?${query}${query.endsWith("&") ? "" : "&"}${tags}`;
  const result = `${joined}${fragment}`;
  return result.length > MAX_URL_LENGTH ? target : result;
}

/**
 * The published form of a page's defaults: trimmed, empty values left out, and `undefined` (no `utm`
 * key at all) when nothing is left, so a page that never set one publishes the same bytes as before.
 */
export function publishPageUtm(utm: PageUtm | null | undefined): PageUtm | undefined {
  if (!utm || typeof utm !== "object") return undefined;
  const out: PageUtm = {};
  for (const key of UTM_KEYS) {
    const value = utm[key];
    if (typeof value === "string" && value.trim() !== "") out[key] = value.trim();
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * The published form of a link's own tags: `{off: true}` alone when it is off (it adds nothing, so
 * its values are moot), else the trimmed non-empty values; `undefined` when nothing is left.
 */
export function publishLinkUtm(utm: LinkUtm | null | undefined): LinkUtm | undefined {
  if (!utm || typeof utm !== "object") return undefined;
  if (utm.off === true) return { off: true };
  return publishPageUtm(utm);
}

/** True when a link carries its own tag values (the row's 'Custom tags' chip). */
export function hasCustomUtm(utm: LinkUtm | null | undefined): boolean {
  if (!utm || utm.off === true) return false;
  return UTM_KEYS.some((key) => typeof utm[key] === "string" && utm[key]!.trim() !== "");
}

/**
 * The example line of the Share tab and of a link's 'Link tags' group: what `https://example.com/page`
 * becomes. Built by `withUtm`, the very function the redirect uses, so it cannot disagree with what a
 * visitor gets.
 */
export const UTM_EXAMPLE_URL = "https://example.com/page";
export function utmExample(
  pageUtm?: PageUtm | null,
  linkUtm?: LinkUtm | null,
  url: string = UTM_EXAMPLE_URL,
): string {
  return withUtm(url, pageUtm, linkUtm);
}

/** Count of code points, re-exported for the editor's counters. */
export { codePointLength };
