import { isIP } from "node:net";

/**
 * The policy of every request the authorization server makes to an address a client chose (M10-07):
 * pure functions, with the DNS lookup and the socket connect injected where they are used
 * (safe-fetch.ts), so a Vitest drives every row of the policy with no network.
 *
 * Two questions, asked in this order:
 *
 *   1. `checkClientAddress(value)`: is this `client_id` (or logo address) a URL we may even look up?
 *      Judged as TEXT before any DNS lookup: https only, a path beyond `/`, no user information, no
 *      fragment, no dot segments, port 443 only, no whitespace or control characters, no IP literal in
 *      any spelling, no single-label or reserved name, and never this product's own hosts.
 *   2. `isPublicAddress(ip)`: after DNS, is every address a public unicast one? A name with ANY
 *      non-public address is refused, and the connection then goes to the address that was validated,
 *      not to a second lookup (safe-fetch.ts).
 *
 * The one local exception: `TEST_STUB_ORIGIN`, the address of the end-to-end stub, is a
 * valid address while the test hooks are on (`allowTestStub`), and nowhere else.
 */

export type AddressRefusal =
  | "not_a_string"
  | "too_long"
  | "forbidden_character"
  | "bad_scheme"
  | "userinfo"
  | "fragment"
  | "no_path"
  | "dot_segment"
  | "bad_port"
  | "ip_literal"
  | "bad_host"
  | "single_label"
  | "reserved_name"
  | "own_host";

export interface CheckedAddress {
  ok: true;
  /** The address as given. */
  url: string;
  /** The lower-case host, without port. */
  host: string;
  path: string;
  /** The end-to-end stub (http, loopback). */
  testStub: boolean;
}

export type AddressCheck = CheckedAddress | { ok: false; reason: AddressRefusal };

export const TEST_STUB_ORIGIN = "http://127.0.0.1:12113";

/** Names that are never a public client: suffixes of reserved or local-only zones. */
const RESERVED_SUFFIXES = [
  ".localhost",
  ".local",
  ".internal",
  ".lan",
  ".home.arpa",
  ".test",
  ".example",
  ".invalid",
] as const;

const DNS_LABEL = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;

const FORBIDDEN = /[\s\u0000-\u001f\u007f-\u009f\\]/;

const refuse = (reason: AddressRefusal): AddressCheck => ({ ok: false, reason });

/** Does the text spell an IP address, in any notation a resolver or URL parser would accept? */
function spellsIpAddress(host: string): boolean {
  if (host.startsWith("[") || host.includes(":")) return true;
  if (isIP(host) !== 0) return true;
  // Decimal, octal and hex spellings: 2130706433, 0177.0.0.1, 0x7f.1, 0x7f000001.
  const labels = host.split(".");
  return labels.every((label) => /^(?:0x[0-9a-f]*|[0-9]+)$/i.test(label));
}

function isPathDotSegment(segment: string): boolean {
  const decoded = segment.replace(/%2e/gi, ".");
  return decoded === "." || decoded === "..";
}

export interface CheckOptions {
  /** NEXT_PUBLIC_ROOT_DOMAIN, so this product's own hosts are refused. */
  rootDomain: string;
  /** True only while the end-to-end test hooks are on. */
  allowTestStub?: boolean;
}

export function checkClientAddress(value: unknown, options: CheckOptions): AddressCheck {
  if (typeof value !== "string") return refuse("not_a_string");
  if (value.length === 0 || value.length > 2048) return refuse("too_long");
  if (FORBIDDEN.test(value)) return refuse("forbidden_character");
  if (value.includes("#")) return refuse("fragment");

  if (options.allowTestStub && value.startsWith(`${TEST_STUB_ORIGIN}/`)) {
    const path = value.slice(TEST_STUB_ORIGIN.length);
    const segments = path.split("?", 1)[0]!.split("/");
    if (segments.some(isPathDotSegment)) return refuse("dot_segment");
    return { ok: true, url: value, host: "127.0.0.1", path, testStub: true };
  }

  const match = /^https:\/\/([^/?#]*)(\/[^?#]*)?(\?[^#]*)?$/.exec(value);
  if (!match) return refuse("bad_scheme");
  const authority = match[1]!;
  const path = match[2] ?? "";
  if (authority.includes("@")) return refuse("userinfo");
  if (authority === "") return refuse("bad_host");

  // The host and the optional port, from the text itself.
  let host = authority;
  const colon = authority.lastIndexOf(":");
  if (authority.startsWith("[")) return refuse("ip_literal");
  if (colon !== -1) {
    host = authority.slice(0, colon);
    if (authority.slice(colon + 1) !== "443") return refuse("bad_port");
  }
  host = host.toLowerCase();
  if (host === "") return refuse("bad_host");

  if (spellsIpAddress(host)) return refuse("ip_literal");
  const labels = host.split(".");
  if (labels.length < 2) return refuse("single_label");
  if (!labels.every((label) => DNS_LABEL.test(label)) || host.length > 253)
    return refuse("bad_host");
  if (/^[0-9]+$/.test(labels[labels.length - 1]!)) return refuse("bad_host");
  if (RESERVED_SUFFIXES.some((suffix) => host.endsWith(suffix)) || host === "localhost") {
    return refuse("reserved_name");
  }

  // This product's own hosts: the root domain and every name under it.
  const root = options.rootDomain.split(":")[0]!.toLowerCase();
  if (host === root || host.endsWith(`.${root}`)) return refuse("own_host");

  // The draft requires a path beyond "/".
  if (path === "" || path === "/") return refuse("no_path");
  if (path.split("/").some(isPathDotSegment)) return refuse("dot_segment");

  return { ok: true, url: value, host, path: `${path}${match[3] ?? ""}`, testStub: false };
}

// ---------------------------------------------------------------------------------------------
// Addresses
// ---------------------------------------------------------------------------------------------

function ipv4ToNumber(address: string): number | null {
  const parts = address.split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^[0-9]{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = value * 256 + octet;
  }
  return value;
}

const cidr = (base: string, bits: number): [number, number] => {
  const start = ipv4ToNumber(base)!;
  return [start, start + 2 ** (32 - bits) - 1];
};

/** The IPv4 ranges that are not public unicast. */
const NON_PUBLIC_V4: ReadonlyArray<[number, number]> = [
  cidr("0.0.0.0", 8),
  cidr("10.0.0.0", 8),
  cidr("100.64.0.0", 10),
  cidr("127.0.0.0", 8),
  cidr("169.254.0.0", 16),
  cidr("172.16.0.0", 12),
  cidr("192.0.0.0", 24),
  cidr("192.0.2.0", 24),
  cidr("192.168.0.0", 16),
  cidr("198.18.0.0", 15),
  cidr("198.51.100.0", 24),
  cidr("203.0.113.0", 24),
  cidr("224.0.0.0", 4),
  cidr("240.0.0.0", 4),
  cidr("255.255.255.255", 32),
];

export function isPublicIPv4(address: string): boolean {
  const value = ipv4ToNumber(address);
  if (value === null) return false;
  return !NON_PUBLIC_V4.some(([start, end]) => value >= start && value <= end);
}

/** Eight 16-bit groups of an IPv6 address, or null when it is not one. An IPv4 tail counts as two groups. */
export function ipv6Groups(address: string): number[] | null {
  if (isIP(address) !== 6) return null;
  let text = address.toLowerCase();
  const zone = text.indexOf("%");
  if (zone !== -1) text = text.slice(0, zone);
  const tail = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(text);
  if (tail) {
    const [a, b, c, d] = tail.slice(1).map(Number) as [number, number, number, number];
    text = `${text.slice(0, tail.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] === "" ? [] : (halves[0] ?? "").split(":");
  const rest = halves.length === 2 && halves[1] !== "" ? (halves[1] ?? "").split(":") : [];
  const missing = 8 - head.length - rest.length;
  if (halves.length === 1 ? head.length !== 8 : missing < 0) return null;
  const groups = [...head, ...(halves.length === 2 ? Array(missing).fill("0") : []), ...rest];
  const numbers = groups.map((group) => Number.parseInt(group, 16));
  return numbers.length === 8 && numbers.every((n) => Number.isInteger(n) && n >= 0 && n <= 0xffff)
    ? numbers
    : null;
}

const v4FromGroups = (high: number, low: number): string =>
  `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;

export function isPublicIPv6(address: string): boolean {
  const g = ipv6Groups(address);
  if (!g) return false;
  const zeros = (count: number) => g.slice(0, count).every((group) => group === 0);

  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible (::a.b.c.d): judged by the embedded address.
  if (zeros(5) && (g[5] === 0xffff || g[5] === 0)) return isPublicIPv4(v4FromGroups(g[6]!, g[7]!));
  // NAT64 (64:ff9b::/96): judged by the embedded address.
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((group) => group === 0)) {
    return isPublicIPv4(v4FromGroups(g[6]!, g[7]!));
  }
  // 6to4 (2002::/16): the embedded address is the next 32 bits.
  if (g[0] === 0x2002) return isPublicIPv4(v4FromGroups(g[1]!, g[2]!));

  // Everything else must be global unicast (2000::/3), minus the documentation range and the
  // IETF protocol assignments (Teredo among them).
  if ((g[0]! & 0xe000) !== 0x2000) return false;
  if (g[0] === 0x2001 && g[1] === 0x0db8) return false;
  if (g[0] === 0x2001 && g[1]! < 0x0200) return false;
  return true;
}

export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return isPublicIPv4(address);
  if (family === 6) return isPublicIPv6(address);
  return false;
}

export type ResolutionVerdict =
  | { ok: true; address: string; family: 4 | 6 }
  | { ok: false; reason: "no_address" | "ssrf_blocked" };

/**
 * Judges the addresses a name resolved to: none is a refusal, and so is ANY address that is not a
 * public unicast one (a name with one public and one private address is refused). The first
 * address is the one the connection goes to.
 */
export function judgeResolution(addresses: readonly string[]): ResolutionVerdict {
  if (addresses.length === 0) return { ok: false, reason: "no_address" };
  if (!addresses.every(isPublicAddress)) return { ok: false, reason: "ssrf_blocked" };
  const first = addresses[0]!;
  return { ok: true, address: first, family: isIP(first) === 6 ? 6 : 4 };
}
