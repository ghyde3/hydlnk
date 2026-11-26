/**
 * Character classes, as marked 17's patterns define them (the token shapes are marked's, so its idea
 * of a space or a punctuation mark is the one that decides). Every test looks at one code point:
 * nothing here scans text.
 */

export const TAB = 0x09;
export const NEWLINE = 0x0a;
export const SPACE = 0x20;
export const BANG = 0x21;
export const QUOTE = 0x22;
export const AMP = 0x26;
export const APOS = 0x27;
export const OPEN_PAREN = 0x28;
export const CLOSE_PAREN = 0x29;
export const STAR = 0x2a;
export const DOT = 0x2e;
export const COLON = 0x3a;
export const SEMICOLON = 0x3b;
export const LESS = 0x3c;
export const GREATER = 0x3e;
export const AT = 0x40;
export const OPEN_BRACKET = 0x5b;
export const BACKSLASH = 0x5c;
export const CLOSE_BRACKET = 0x5d;
export const UNDERSCORE = 0x5f;
export const BACKTICK = 0x60;
export const PIPE = 0x7c;
export const TILDE = 0x7e;

/** JavaScript's `\s` (what marked's `\s` and `String.prototype.trim` mean): ASCII and Unicode spaces. */
export function isJsSpace(code: number): boolean {
  if (code <= SPACE) return code === SPACE || (code >= TAB && code <= 0x0d);
  if (code < 0xa0) return false;
  return (
    code === 0xa0 ||
    code === 0x1680 ||
    (code >= 0x2000 && code <= 0x200a) ||
    code === 0x2028 ||
    code === 0x2029 ||
    code === 0x202f ||
    code === 0x205f ||
    code === 0x3000 ||
    code === 0xfeff
  );
}

// One code point each, anchored at both ends: these never see more than one character.
const PUNCTUATION_CHAR = /^[\p{P}\p{S}]$/u;
const LETTER_OR_DIGIT_CHAR = /^[\p{L}\p{N}]$/u;

const ASCII_PUNCTUATION = new Uint8Array(128);
const ASCII_ALNUM = new Uint8Array(128);
for (let code = 0; code < 128; code += 1) {
  const char = String.fromCharCode(code);
  ASCII_PUNCTUATION[code] = PUNCTUATION_CHAR.test(char) ? 1 : 0;
  ASCII_ALNUM[code] = LETTER_OR_DIGIT_CHAR.test(char) ? 1 : 0;
}

/** Unicode punctuation or symbol (`\p{P}\p{S}`), the class marked's emphasis rules use. */
export function isPunctuation(code: number): boolean {
  if (code < 128) return ASCII_PUNCTUATION[code] === 1;
  return PUNCTUATION_CHAR.test(String.fromCodePoint(code));
}

/** Unicode letter or number (`\p{L}\p{N}`). */
export function isLetterOrDigit(code: number): boolean {
  if (code < 128) return ASCII_ALNUM[code] === 1;
  return LETTER_OR_DIGIT_CHAR.test(String.fromCodePoint(code));
}

/** The ASCII punctuation a backslash escapes (CommonMark, marked's `escape` rule). */
export function isAsciiPunctuation(code: number): boolean {
  return code < 128 && ASCII_PUNCTUATION[code] === 1;
}

export function isAsciiAlnum(code: number): boolean {
  return (
    (code >= 0x30 && code <= 0x39) || (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a)
  );
}

export function isAsciiLetter(code: number): boolean {
  return (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a);
}

/** `\w`: ASCII letters, digits and `_`. */
export function isWordChar(code: number): boolean {
  return isAsciiAlnum(code) || code === UNDERSCORE;
}

/** The code point that starts at `at`, or -1 past the end. */
export function codePointAt(text: string, at: number): number {
  if (at < 0 || at >= text.length) return -1;
  return text.codePointAt(at)!;
}

/** The code point that ends just before `at`, or -1 at the start. */
export function codePointBefore(text: string, at: number): number {
  if (at <= 0) return -1;
  const low = text.charCodeAt(at - 1);
  if (low >= 0xdc00 && low <= 0xdfff && at >= 2) {
    const high = text.charCodeAt(at - 2);
    if (high >= 0xd800 && high <= 0xdbff) return text.codePointAt(at - 2)!;
  }
  return low;
}
