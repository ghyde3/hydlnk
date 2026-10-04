import { telHref } from "@/lib/document/url";

/**
 * The vCard of a contact block (M9-18): vCard 3.0, built on the server from the stored fields and
 * from nothing the request carries. Pure, so every rule below is a table test.
 *
 * The file holds exactly these properties and no other: BEGIN, VERSION, FN, N, TEL (when there is a
 * phone number), EMAIL (when there is an email address), URL (the page's public address), NOTE (the
 * hours, when there are some) and END. No photo. Every value is escaped for vCard text (backslash,
 * comma, semicolon and line breaks), control and bidi characters are removed first, lines end with
 * CRLF and are folded at 75 octets, so no stored string can start a second card or a second property.
 */

export interface VcardContact {
  name: string;
  phone?: string;
  email?: string;
  hours?: string;
}

/** The property names a card from this module may hold. A test checks every line against it. */
export const VCARD_PROPERTIES = [
  "BEGIN",
  "VERSION",
  "FN",
  "N",
  "TEL",
  "EMAIL",
  "URL",
  "NOTE",
  "END",
] as const;

/** Control characters (U+0000 to U+001F, U+007F to U+009F) and the bidi overrides and isolates. */
const CONTROL_OR_BIDI = /[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/g;
/** The same, but a line break survives (a multi-line value is `\n`-escaped afterwards). */
const CONTROL_OR_BIDI_KEEP_NEWLINE = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f‪-‮⁦-⁩]/g;

/** A one-line value with its control and bidi characters removed. */
function clean(value: string): string {
  return value.replace(CONTROL_OR_BIDI, "");
}

/** A multi-line value: CRLF and CR become LF, other control and bidi characters are removed. */
function cleanLines(value: string): string {
  return value.replace(/\r\n?/g, "\n").replace(CONTROL_OR_BIDI_KEEP_NEWLINE, "");
}

/** vCard 3.0 text escaping: backslash first, then comma, semicolon and line breaks. */
export function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\;")
    .replace(/\n/g, "\\n");
}

/** One line cut at 75 octets: continuation lines start with one space. Never splits a character. */
export function foldLine(line: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return line;
  const parts: string[] = [];
  let current = "";
  let size = 0;
  // The first line may hold 75 octets; every continuation holds a space and 74.
  let limit = 75;
  for (const char of line) {
    const bytes = encoder.encode(char).length;
    if (size + bytes > limit) {
      parts.push(current);
      current = "";
      size = 0;
      limit = 74;
    }
    current += char;
    size += bytes;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

/** `N:` components: the last word is the family name and the rest the given names. */
function nameParts(name: string): { family: string; given: string } {
  const words = name.split(/\s+/).filter((word) => word !== "");
  if (words.length <= 1) return { family: words[0] ?? "", given: "" };
  return { family: words[words.length - 1]!, given: words.slice(0, -1).join(" ") };
}

/** `+15551234567` for a phone number, or "" when the value is not one (telHref reads digits and a leading + only). */
function telValue(phone: string): string {
  return telHref(phone)?.slice("tel:".length) ?? "";
}

/**
 * The card for `contact`, with `pageUrl` as its `URL:` line. Lines end with CRLF, including the
 * last one.
 */
export function vcardFor(contact: VcardContact, pageUrl: string): string {
  const name = clean(contact.name).trim();
  const { family, given } = nameParts(name);
  const lines: string[] = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    `FN:${escapeText(name)}`,
    `N:${escapeText(family)};${escapeText(given)};;;`,
  ];
  const tel = telValue(clean(contact.phone ?? "").trim());
  if (tel !== "") lines.push(`TEL;TYPE=VOICE:${tel}`);
  const email = clean(contact.email ?? "").trim();
  if (email !== "") lines.push(`EMAIL;TYPE=INTERNET:${escapeText(email)}`);
  const url = clean(pageUrl).trim();
  if (url !== "") lines.push(`URL:${url}`);
  const hours = cleanLines(contact.hours ?? "").trim();
  if (hours !== "") lines.push(`NOTE:${escapeText(hours)}`);
  lines.push("END:VCARD");
  return `${lines.map(foldLine).join("\r\n")}\r\n`;
}

/**
 * The file name of the download: the name lower-cased and reduced to `[a-z0-9-]` (accents dropped,
 * every other run of characters a single hyphen), 1 to 40 characters, "contact" when nothing is left.
 * It never holds a quote, a semicolon, a space, a path separator or a non-ASCII character.
 */
export function vcardSlug(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .slice(0, 40)
    .replace(/-+$/, "");
  return slug === "" ? "contact" : slug;
}

/** `{slug}.vcf` */
export function vcardFilename(name: string): string {
  return `${vcardSlug(name)}.vcf`;
}

/** The card's lines with the folds undone: what a reader sees (used by the tests). */
export function unfoldVcard(card: string): string[] {
  return card
    .replace(/\r\n[ \t]/g, "")
    .split("\r\n")
    .filter((line) => line !== "");
}
