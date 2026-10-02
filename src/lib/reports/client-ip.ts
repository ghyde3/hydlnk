/**
 * The visitor's IP as the platform reports it, for the report form's limit and its hashed reporter
 * id. Never taken from the body. On Vercel `x-vercel-forwarded-for` and `x-forwarded-for` are set by
 * the platform and cannot be supplied by the client; on a dev machine the specs send
 * `x-forwarded-for` themselves. A request with no usable header lands in one shared "unknown"
 * bucket, so leaving the header out never skips the limit.
 */
export const UNKNOWN_IP = "unknown";

const IP_TEXT = /^[0-9a-f:.]{2,45}$/i;

export function clientIpOf(headers: Pick<Headers, "get">): string {
  const candidates = [
    headers.get("x-vercel-forwarded-for"),
    headers.get("x-forwarded-for"),
    headers.get("x-real-ip"),
  ];
  for (const value of candidates) {
    const first = value?.split(",", 1)[0]?.trim().toLowerCase();
    if (first && IP_TEXT.test(first)) return first;
  }
  return UNKNOWN_IP;
}

/** An IPv6 address as eight 16-bit groups, or null when it is not one. Handles `::` and a trailing IPv4. */
function ipv6Groups(ip: string): number[] | null {
  let text = ip.split("%", 1)[0] ?? "";
  const embedded = /^(.*:)(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text);
  if (embedded) {
    const [, head, a, b, c, d] = embedded;
    const octets = [a, b, c, d].map(Number);
    if (octets.some((octet) => octet > 255)) return null;
    text = `${head}${((octets[0]! << 8) | octets[1]!).toString(16)}:${((octets[2]! << 8) | octets[3]!).toString(16)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [
    ...head,
    ...(halves.length === 2 ? Array<string>(missing).fill("0") : []),
    ...tail,
  ];
  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/i.test(group))) return null;
  return groups.map((group) => Number.parseInt(group, 16));
}

/**
 * What identifies a reporter for the limit and the hashed reporter id: an IPv4 address as it is, an
 * IPv4-mapped IPv6 address as its IPv4, and any other IPv6 address as its /64 prefix. One household or
 * one hosting customer holds a whole /64 (2^64 addresses), so keying on the full address would let a
 * single machine mint unlimited "reporters" and walk around the per-IP limit and the 24-hour
 * duplicate rule. Unknown stays unknown, and so does anything that does not parse.
 */
export function ipBucketOf(ip: string): string {
  if (ip === UNKNOWN_IP || !ip.includes(":")) return ip;
  const groups = ipv6Groups(ip);
  if (!groups) return ip;
  if (groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff) {
    return `${groups[6]! >> 8}.${groups[6]! & 255}.${groups[7]! >> 8}.${groups[7]! & 255}`;
  }
  return `${groups
    .slice(0, 4)
    .map((group) => group.toString(16))
    .join(":")}::/64`;
}
