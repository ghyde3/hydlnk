import { truncateToCodePoints } from "@/lib/document/limits";
import { stripHiddenCharacters } from "@/lib/document/schema";
import { parseRedirectUri } from "./redirect-uri";

/**
 * What an app calls itself, made safe to show (M10-09). The name comes from a document or a
 * registration the app wrote, so it is data: it is cleaned here and ESCAPED at render, never stripped
 * of markup (`<script>alert(1)</script>` stays that literal text) and never interpreted.
 */

export const CLIENT_NAME_MAX_CODE_POINTS = 100;
export const UNNAMED_APP = "Unnamed app";
export const HYDLNK_NAME_REFUSAL = "The name can’t include HYDLNK.";

/** Zero-width characters and the left-to-right and right-to-left marks, which the repo's stripper keeps. */
const INVISIBLE = new RegExp("[\\u200b-\\u200f\\u2060\\ufeff]", "g");
/** Whitespace controls become a space, so "Claude\nCode" is two words, not one. */
const WHITESPACE_CONTROLS = new RegExp("[\\t\\n\\r\\u000b\\u000c\\u0085\\u2028\\u2029]", "g");
/** What 'hydlnk' may be spread with: spaces, hyphens of every kind, dots and underscores. */
const SPREADERS = new RegExp("[\\s\\-_.\\u2010-\\u2015\\u2212]", "gu");

/**
 * Unicode NFC; control characters, bidirectional controls (U+202A to U+202E, U+2066 to U+2069,
 * U+200E, U+200F) and zero-width characters (U+200B to U+200D, U+2060, U+FEFF) removed; runs of
 * whitespace collapsed; trimmed; at most 100 code points, cut at a whole character. Nothing left means
 * `fallback`.
 */
export function sanitizeClientName(raw: unknown, fallback: string): string {
  if (typeof raw !== "string") return fallback;
  let value = raw.normalize("NFC").replace(WHITESPACE_CONTROLS, " ");
  value = stripHiddenCharacters(value).replace(INVISIBLE, "");
  value = value.replace(/\s+/gu, " ").trim();
  value = truncateToCodePoints(value, CLIENT_NAME_MAX_CODE_POINTS).trim();
  return value === "" ? fallback : value;
}

/**
 * Does the name pose as this product? 'hydlnk' once spaces, hyphens, dots, underscores and invisible
 * characters are removed and case is folded ('HYDLNK Support', 'hyd lnk', 'H-Y-D-L-N-K'). Names like
 * 'Claude' or 'ChatGPT' are judged by `namesVendorWithoutRight` (known-clients.ts), because real
 * clients use them and only a client that returns to that company can.
 */
export function namesHydlnk(name: string): boolean {
  return foldName(name).includes("hydlnk");
}

/**
 * Is 'hydlnk' in the name by someone who has no business using it? A client whose every return
 * address is on this computer (a program on the person's own machine, like Claude Code's fallback name
 * "Claude Code (hydlnk)") may use it: its code goes nowhere else, the same reasoning as the vendor-name
 * rule. Any https return address, or none, keeps the refusal.
 */
export function namesHydlnkWithoutRight(name: string, redirectUris: readonly string[]): boolean {
  if (!namesHydlnk(name)) return false;
  const allOnThisComputer =
    redirectUris.length > 0 &&
    redirectUris.every((uri) => {
      const parsed = parseRedirectUri(uri);
      return parsed.ok && parsed.loopback;
    });
  return !allOnThisComputer;
}

/**
 * A name as a person would read it, for comparison: compatibility-normalized, invisible characters,
 * spaces, hyphens, dots and underscores removed, case folded ('C-l-a-u-d-e' and 'claude' are one name).
 */
export function foldName(name: string): string {
  return name.normalize("NFKC").replace(INVISIBLE, "").replace(SPREADERS, "").toLowerCase();
}

/**
 * The initials drawn in the circle when an app has no logo: the first letter of each of the first
 * two words, upper case ('Claude Code' is 'CC', 'ChatGPT' is 'C', nothing is '?').
 */
export function clientInitials(name: string): string {
  const words = name.trim().split(/\s+/u).filter(Boolean).slice(0, 2);
  const letters = words.map((word) => Array.from(word)[0]?.toUpperCase() ?? "").join("");
  return letters === "" ? "?" : letters;
}
