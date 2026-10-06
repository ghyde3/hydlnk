import { MAX_URL_LENGTH } from "./url";

/**
 * Where the two buttons of a map block (M9-22) go. The page never holds the destinations: `/r/` reads
 * the published name and address and builds them here, from fixed https hosts, so what a tenant
 * writes can only ever be a search query and never a host, a path, a scheme or a redirect.
 *
 *   Google Maps  https://www.google.com/maps/search/?api=1&query={q}
 *   Apple Maps   https://maps.apple.com/?q={q}
 *
 * `q` is `encodeURIComponent(name + ' ' + address)`: ASCII only, so no raw `&`, `#`, quote, angle
 * bracket or space from the text reaches the `Location` and `decodeURIComponent` reads it back to
 * the same words. A lone surrogate (not text, and `encodeURIComponent` throws on one) becomes U+FFFD.
 *
 * A name of 60 and an address of 160 four-byte characters would encode to about 2,650 characters, and
 * a URL over 2,048 is not a link (`isHttpUrl`), which would turn a published block into a 404. So the
 * query is bounded: when the encoded URL would be too long the TEXT is cut, from the end, one code
 * point at a time, until it fits. Ordinary text is never changed.
 */

const GOOGLE_PREFIX = "https://www.google.com/maps/search/?api=1&query=";
const APPLE_PREFIX = "https://maps.apple.com/?q=";

/** The longest query both URLs can carry (the Google prefix is the longer one). */
const MAX_QUERY_LENGTH = MAX_URL_LENGTH - GOOGLE_PREFIX.length;

export interface MapTargets {
  google: string;
  apple: string;
}

/** The text with lone surrogates replaced by U+FFFD (`String.prototype.toWellFormed`, spelled out). */
function wellFormed(value: string): string {
  return value.replace(
    /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g,
    "�",
  );
}

/** The encoded query for the place, bounded as described above. */
export function mapQuery(name: string, address: string): string {
  // At most 400 points are read: the limits (60 and 160) keep a real place far below that, and the
  // cap keeps a hostile string from costing anything.
  const points = Array.from(wellFormed(`${name} ${address}`)).slice(0, 400);
  let query = encodeURIComponent(points.join(""));
  while (query.length > MAX_QUERY_LENGTH && points.length > 0) {
    points.pop();
    query = encodeURIComponent(points.join("").trimEnd());
  }
  return query;
}

/** The Google Maps and Apple Maps search URLs for a published place. Pure. */
export function mapTargets(name: string, address: string): MapTargets {
  const query = mapQuery(name, address);
  return { google: `${GOOGLE_PREFIX}${query}`, apple: `${APPLE_PREFIX}${query}` };
}
