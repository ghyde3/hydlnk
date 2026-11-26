import { BACKSLASH, isJsSpace, isPunctuation } from "./chars";

/** The link reference definitions of one body, by normalised label (first one wins). */
export type LinkDefinitions = Map<string, { href: string; title: string | null | undefined }>;

/**
 * A reference label as marked matches it: runs of whitespace as one space, in lower case
 * (`toLowerCase().replace(/\s+/g, " ")`, not trimmed).
 */
export function normalizeLabel(label: string): string {
  let out = "";
  let space = false;
  for (let k = 0; k < label.length; k += 1) {
    if (isJsSpace(label.charCodeAt(k))) {
      space = true;
      continue;
    }
    if (space) out += " ";
    space = false;
    out += label[k];
  }
  if (space) out += " ";
  return out.toLowerCase();
}

/**
 * Backslash escapes removed from an address, title or fence language (marked's
 * `replace(anyPunctuation, "$1")`: a backslash before any Unicode punctuation or symbol).
 */
export function unescapePunctuation(text: string): string {
  if (text.indexOf("\\") === -1) return text;
  let out = "";
  for (let k = 0; k < text.length; k += 1) {
    if (text.charCodeAt(k) === BACKSLASH && k + 1 < text.length) {
      const next = text.codePointAt(k + 1)!;
      if (isPunctuation(next)) {
        const width = next > 0xffff ? 2 : 1;
        out += text.slice(k + 1, k + 1 + width);
        k += width;
        continue;
      }
    }
    out += text[k];
  }
  return out;
}
