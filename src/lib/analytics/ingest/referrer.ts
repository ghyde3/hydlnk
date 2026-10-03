/**
 * The referrer of a view, reduced to a hostname (M4-21): lowercased, `www.` removed, no path, query
 * or port ("https://l.instagram.com/?u=x" becomes "l.instagram.com"). Null for direct visits and
 * for everything that is not worth counting: an empty value, a scheme other than http(s), a value
 * that is not a URL, and the page's own host (a reload or an internal jump is not a referral).
 * The raw referrer is never stored, so a path or query string with a token in it never reaches the
 * events table.
 */

const MAX_REFERRER_INPUT = 2048;
const MAX_HOSTNAME = 255;

function bare(hostname: string): string {
  return hostname.toLowerCase().replace(/^www\./, "");
}

/**
 * @param raw       `document.referrer` as the beacon sent it
 * @param ownHosts  hostnames of the page itself (the allowed Origin's hostname), compared without port
 */
export function referrerHost(raw: unknown, ownHosts: readonly string[] = []): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (value === "" || value.length > MAX_REFERRER_INPUT) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  const host = bare(url.hostname);
  if (host === "" || host.length > MAX_HOSTNAME) return null;
  if (ownHosts.some((own) => bare(own) === host)) return null;
  return host;
}
