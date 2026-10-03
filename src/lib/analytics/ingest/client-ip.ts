import { isIP } from "node:net";

/**
 * The client IP of a request, as the platform reports it (M4-20, M5-01). Vercel overwrites
 * `x-forwarded-for` and sets `x-real-ip` itself, so the first entry is the connecting client and
 * nothing the visitor sends can replace it. Pure and dependency free: no raw IP is ever stored or
 * logged, it only feeds the visitor hash and the rate-limit bucket.
 */

/** What the visitor hash uses when no client IP header is present (local development). */
export const LOCAL_DEV_IP = "0.0.0.0";

/** The one shared rate-limit bucket for requests that carry no usable client IP header. */
export const UNKNOWN_IP_KEY = "unknown";

function usable(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (trimmed === "" || trimmed.length > 45) return null;
  return isIP(trimmed) !== 0 ? trimmed.toLowerCase() : null;
}

/**
 * First entry of `x-forwarded-for`, else `x-real-ip`; null when neither holds an IP address. An
 * entry that is not an IP address (garbage from a client talking to the origin directly) counts as
 * absent rather than becoming a bucket key of the sender's choosing.
 */
export function clientIp(headers: Headers): string | null {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = usable(forwarded.split(",", 1)[0]);
    if (first) return first;
  }
  return usable(headers.get("x-real-ip"));
}

/** The address the visitor hash is computed from: the client IP, or 0.0.0.0 when there is none. */
export function ipForHash(headers: Headers): string {
  return clientIp(headers) ?? LOCAL_DEV_IP;
}

/** Expands an IPv6 address to its eight 16-bit groups, or null when it is not a plain IPv6 address. */
function ipv6Groups(address: string): number[] | null {
  if (isIP(address) !== 6) return null;
  let text = address;
  // An embedded IPv4 tail ("::ffff:203.0.113.7") becomes two groups.
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

/**
 * The rate-limit key of a client: its IPv4 address, or the /64 network of an IPv6 address (one
 * household or phone can use any address inside its /64, so counting per address would let it dodge
 * the limit), or "unknown" when the request carries no usable client IP header.
 */
export function rateLimitClientKey(headers: Headers): string {
  const ip = clientIp(headers);
  if (!ip) return UNKNOWN_IP_KEY;
  if (isIP(ip) === 4) return ip;
  const groups = ipv6Groups(ip);
  if (!groups) return ip;
  // IPv4-mapped (::ffff:a.b.c.d) is an IPv4 client.
  if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) {
    const hi = groups[6]!;
    const lo = groups[7]!;
    return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  }
  return `${groups
    .slice(0, 4)
    .map((g) => g.toString(16))
    .join(":")}::/64`;
}
