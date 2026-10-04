/**
 * RFC 8707 resource indicators (M10-11, M10-15). A client may send `resource`; when it does it must
 * be the canonical MCP URL, compared character for character apart from the case of the scheme and
 * the host (the MCP specification says to accept an upper case scheme and host for robustness). A
 * trailing slash, a different path, a query or a fragment is another resource.
 */
export function resourceMatches(candidate: unknown, canonical: string): boolean {
  if (typeof candidate !== "string") return false;
  const match = /^([A-Za-z][A-Za-z0-9+.-]*):\/\/([^/?#]*)(.*)$/.exec(candidate);
  if (!match) return false;
  const [, scheme, authority, rest] = match;
  return `${scheme!.toLowerCase()}://${authority!.toLowerCase()}${rest}` === canonical;
}
