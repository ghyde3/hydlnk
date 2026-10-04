/**
 * Redirect URIs (M10-06): the two functions every client path calls and the only place in the wave
 * that compares one. Client-metadata validation (M10-08), registration (M10-10) and the authorize
 * endpoint (M10-11) call `parseRedirectUri` and `redirectUriMatches`; a scan of src/lib/oauth and
 * src/app (tests/unit/m10-oauth-redirect-uri.test.ts) finds no other comparison.
 *
 * The policy is exactly "https or loopback", as Gary decided: an app that only offers a custom
 * scheme (`cursor://`, `vscode://`, `com.example.app:/cb`) cannot connect.
 *
 * The URI is judged as TEXT, not through the URL parser: `new URL("http://0x7f.0.0.1/cb")` quietly
 * becomes `127.0.0.1`, and a policy that read the parsed host would let spellings through that a
 * person reading the string would never recognize as loopback. What is declared is what is compared,
 * stored, shown and finally redirected to, character for character.
 */

export const MAX_REDIRECT_URI_LENGTH = 2048;
export const MAX_REDIRECT_URIS = 10;

export type RedirectUriRefusal =
  | "not_a_string"
  | "too_long"
  | "forbidden_character"
  | "not_ascii"
  | "bad_scheme"
  | "bad_host"
  | "bad_port"
  | "userinfo"
  | "fragment"
  | "bad_path";

export interface ParsedRedirectUri {
  ok: true;
  uri: string;
  scheme: "https" | "http";
  /** The host as written: a DNS name for https, `localhost`, `127.0.0.1` or `[::1]` for loopback. */
  host: string;
  /** The port as written, or null. */
  port: number | null;
  /** Everything after the authority: path and query, as written (possibly empty). */
  rest: string;
  loopback: boolean;
}

export type RedirectUriResult = ParsedRedirectUri | { ok: false; reason: RedirectUriRefusal };

const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(["localhost", "127.0.0.1", "[::1]"]);

const DNS_LABEL = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;
/** Whitespace, control characters, backslash, wildcard. */

const FORBIDDEN = /[\s\u0000-\u001f\u007f-\u009f\\*]/;

const NON_ASCII = /[^\u0000-\u007f]/;

function refuse(reason: RedirectUriRefusal): RedirectUriResult {
  return { ok: false, reason };
}

/** A host that is a real DNS name: at least two labels, letters, digits and hyphens, a non-numeric last label. */
function isDnsNameWithDot(host: string): boolean {
  if (host.length < 3 || host.length > 253) return false;
  const labels = host.split(".");
  if (labels.length < 2) return false;
  if (!labels.every((label) => DNS_LABEL.test(label))) return false;
  // An all-numeric last label is an IPv4 spelling (`1.2.3.4`, `0x7f.0.0.1` ends in `1`), not a name.
  return !/^[0-9]+$/.test(labels[labels.length - 1]!);
}

function parsePort(text: string): number | null {
  if (!/^[1-9][0-9]{0,4}$/.test(text)) return null;
  const port = Number(text);
  return port >= 1 && port <= 65535 ? port : null;
}

/** Path segments that the URL parser would rewrite: `.`, `..` and their percent-encoded spellings. */
function hasDotSegment(path: string): boolean {
  return path.split("/").some((segment) => {
    const plain = segment.replace(/%2e/gi, ".");
    return plain === "." || plain === "..";
  });
}

/**
 * Is this a URI a client may declare, register or ask for? Absolute, at most 2,048 characters, free
 * of whitespace, control characters, backslashes, wildcards, fragments and user information, ASCII
 * only, and either (a) `https` with a host that is a DNS name containing a dot (no IP literal, no
 * single-label name) or (b) `http` with the loopback host `localhost`, `127.0.0.1` or `[::1]`
 * (RFC 8252).
 */
export function parseRedirectUri(value: unknown): RedirectUriResult {
  if (typeof value !== "string") return refuse("not_a_string");
  if (value.length === 0 || value.length > MAX_REDIRECT_URI_LENGTH) return refuse("too_long");
  if (FORBIDDEN.test(value)) return refuse("forbidden_character");
  if (NON_ASCII.test(value)) return refuse("not_ascii");

  const match = /^(https|http):\/\/([^/?#]*)([^#]*)$/.exec(value);
  if (!match) {
    return refuse(value.includes("#") ? "fragment" : "bad_scheme");
  }
  const scheme = match[1] as "https" | "http";
  const authority = match[2]!;
  const rest = match[3]!;
  if (value.includes("#")) return refuse("fragment");
  if (authority.includes("@")) return refuse("userinfo");
  if (authority === "") return refuse("bad_host");

  let host = authority;
  let port: number | null = null;
  if (authority.startsWith("[")) {
    const close = authority.indexOf("]");
    if (close === -1) return refuse("bad_host");
    host = authority.slice(0, close + 1);
    const after = authority.slice(close + 1);
    if (after !== "") {
      if (!after.startsWith(":")) return refuse("bad_host");
      port = parsePort(after.slice(1));
      if (port === null) return refuse("bad_port");
    }
  } else {
    const colon = authority.indexOf(":");
    if (colon !== -1) {
      host = authority.slice(0, colon);
      port = parsePort(authority.slice(colon + 1));
      if (port === null) return refuse("bad_port");
    }
  }

  if (scheme === "http") {
    if (!LOOPBACK_HOSTS.has(host)) return refuse(host.startsWith("[") ? "bad_host" : "bad_scheme");
  } else if (!isDnsNameWithDot(host)) {
    return refuse("bad_host");
  }

  if (rest !== "" && !rest.startsWith("/") && !rest.startsWith("?")) return refuse("bad_path");
  const path = rest.split("?", 1)[0]!;
  if (hasDotSegment(path)) return refuse("bad_path");

  return { ok: true, uri: value, scheme, host, port, rest, loopback: scheme === "http" };
}

/**
 * Does `requested` match the `registered` (or declared) URI? Character for character: a different
 * case in the host, a trailing slash, an added or reordered query parameter, a different path, an
 * added default port, a percent-encoded variation or a different scheme is a mismatch.
 *
 * The one exception is the loopback port (RFC 8252 section 7.3): when the registered URI is `http` on
 * `127.0.0.1`, `[::1]` or `localhost` and names no port, a requested URI with the same scheme, host,
 * path and query and ANY port from 1 to 65535 matches. `localhost` and `127.0.0.1` never match each
 * other, and a registered URI that names a port matches only that port.
 *
 * Nothing in this wave redirects, links or fetches a URI that did not pass this function first.
 */
export function redirectUriMatches(registered: string, requested: string): boolean {
  if (typeof registered !== "string" || typeof requested !== "string") return false;
  const asked = parseRedirectUri(requested);
  if (!asked.ok) return false;
  if (registered === requested) return parseRedirectUri(registered).ok;

  const declared = parseRedirectUri(registered);
  if (!declared.ok) return false;
  if (!declared.loopback || declared.port !== null) return false;
  return (
    asked.loopback &&
    asked.port !== null &&
    asked.scheme === declared.scheme &&
    asked.host === declared.host &&
    asked.rest === declared.rest
  );
}

/**
 * The token endpoint's check (M10-15): the redirect URI sent with the code must be the exact string
 * the authorize request stored, which is the string that already passed `redirectUriMatches`. Kept
 * here so this file stays the only one that compares redirect URIs.
 */
export function sameRedirectUri(stored: string, presented: string): boolean {
  return typeof stored === "string" && typeof presented === "string" && stored === presented;
}

/** Is `requested` one of the client's URIs? */
export function matchesAnyRedirectUri(registered: readonly string[], requested: string): boolean {
  return registered.some((uri) => redirectUriMatches(uri, requested));
}

/**
 * The host the consent screen shows: the ASCII host exactly as stored for https (a punycode name
 * stays punycode, so a look-alike Unicode name cannot pass for another), and a plain-words label for
 * a loopback URI. A string that is not a valid redirect URI gives an empty label.
 */
export const LOOPBACK_LABEL = "this computer (localhost)";

export function redirectHostLabel(uri: string): string {
  const parsed = parseRedirectUri(uri);
  if (!parsed.ok) return "";
  return parsed.loopback ? LOOPBACK_LABEL : parsed.host;
}

/** True when every URI is a loopback one: the consent screen warns about such a client (M10-13). */
export function isLoopbackOnly(uris: readonly string[]): boolean {
  if (uris.length === 0) return false;
  return uris.every((uri) => {
    const parsed = parseRedirectUri(uri);
    return parsed.ok && parsed.loopback;
  });
}

export type RedirectListResult =
  { ok: true; uris: string[] } | { ok: false; reason: "invalid_redirect_uri" };

export interface RedirectListOptions {
  /**
   * `NEXT_PUBLIC_ROOT_DOMAIN`: when given, an https return address on that domain or any name under it
   * (`hydlnk.com`, `app.hydlnk.com`, `mara.hydlnk.com`) is refused. A client's code has no business
   * going back to one of this product's own hosts, and one that said it would look first-party on the
   * consent screen. The same rule as the fetch policy's own-host check (ssrf.ts). The caller passes
   * it because this file reads no configuration.
   */
  rootDomain?: string;
}

/** Is this https host the product's own, or a name under it? Loopback hosts are never. */
function isOwnHost(host: string, rootDomain: string): boolean {
  const root = rootDomain.split(":")[0]!.toLowerCase();
  const name = host.toLowerCase();
  return root !== "" && (name === root || name.endsWith(`.${root}`));
}

/**
 * A client's declared list: an array of 1 to 10 distinct valid URIs. Duplicates are dropped before
 * counting; an 11th distinct one, an empty list and any invalid entry make the whole list invalid.
 */
export function validateRedirectUriList(
  value: unknown,
  options: RedirectListOptions = {},
): RedirectListResult {
  if (!Array.isArray(value)) return { ok: false, reason: "invalid_redirect_uri" };
  const unique: string[] = [];
  for (const entry of value) {
    const parsed = parseRedirectUri(entry);
    if (!parsed.ok) return { ok: false, reason: "invalid_redirect_uri" };
    if (!parsed.loopback && options.rootDomain && isOwnHost(parsed.host, options.rootDomain)) {
      return { ok: false, reason: "invalid_redirect_uri" };
    }
    if (!unique.includes(parsed.uri)) unique.push(parsed.uri);
  }
  if (unique.length < 1 || unique.length > MAX_REDIRECT_URIS) {
    return { ok: false, reason: "invalid_redirect_uri" };
  }
  return { ok: true, uris: unique };
}
