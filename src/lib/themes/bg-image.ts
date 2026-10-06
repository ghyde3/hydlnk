import { IMAGE_PATH_PATTERN } from "@/lib/document";

/** The public Storage path every `page-media` object is served from (see `mediaUrl`). */
const PUBLIC_PREFIX = "/storage/v1/object/public/page-media/";

/**
 * A background image is a URL in the token set (`bgImage`), but the only URLs Publish accepts are
 * the ones `mediaUrl(path)` builds: this project's Storage origin, the public `page-media` path
 * and an image path of the shape `{uid}/{name}.{jpg|png|webp}` (IMAGE_PATH_PATTERN).
 *
 * Returns the `{uid}/{name}.{ext}` path, or null for anything else: another host, another bucket,
 * a query string or fragment, extra or encoded path segments, other schemes, quotes or
 * parentheses. The caller still checks the folder belongs to the page owner and the object exists.
 */
export function mediaPathOf(value: unknown, mediaOrigin: string): string | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.origin !== mediaOrigin) return null;
  if (url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== "") {
    return null;
  }
  if (!url.pathname.startsWith(PUBLIC_PREFIX)) return null;
  const rest = url.pathname.slice(PUBLIC_PREFIX.length);
  // `mediaUrl` encodes each segment on its own, so a real URL never carries an encoded slash.
  if (/%2f|%5c/i.test(rest)) return null;
  let path: string;
  try {
    path = decodeURIComponent(rest);
  } catch {
    return null;
  }
  return IMAGE_PATH_PATTERN.test(path) ? path : null;
}
