import { IMAGE_PATH_PATTERN } from "@/lib/document/schema";
import { storageUrl } from "./url";

/**
 * The `/media/{uid}/{file}` route's whole job (M7-14): answer a browser's request for an uploaded
 * image from the page's own address, by fetching the public Storage object once and letting the
 * CDN keep it. Pure of the framework on purpose (`Request` in, `Response` out, an injectable
 * `fetch`), so the tests can pin every refusal and every header without a server. The route file
 * `src/app/media/[...path]/route.ts` only calls it.
 *
 * It is a cost control, not a feature: images were fetched straight from Storage on every view and
 * spent its bandwidth. Now the CDN answers most views and this runs about once per image, host and
 * region per `MEDIA_CDN_MAX_AGE`.
 *
 * What it never is: an open proxy. The upstream address is built by `storageUrl` from a path that
 * passed `IMAGE_PATH_PATTERN` and nothing else (no Host, forwarded or Referer header, no query
 * string, no cookie and no credential of the caller's is read or sent). No secret key is imported
 * here either: the bucket is public.
 */

/**
 * `Cache-Control` of an image: the browser keeps it a year. Names are content hashes and never
 * reused (M2-08, M5-11), so a stored image never changes under its name.
 */
export const MEDIA_BROWSER_CACHE_CONTROL = "public, max-age=31536000, immutable";

/**
 * How long Vercel's CDN keeps one fetch of an image before asking Storage again: seven days, in
 * seconds. Not a year, though the object never changes: a deleted image, an account's removed media
 * and a removed photo stop being served within seven days instead of a year, and the cost is one
 * more Storage fetch per image, host and region a week. Raise it to 31536000 for fewer Storage
 * fetches and slower removal; this is the only place the number lives.
 */
export const MEDIA_CDN_MAX_AGE = 604_800;

/**
 * `Vercel-CDN-Cache-Control` of an image. Vercel's CDN reads this header instead of `Cache-Control`
 * and does not pass it on, so the browser keeps its year (above) while the CDN keeps `MEDIA_CDN_MAX_AGE`.
 */
export const MEDIA_CDN_CACHE_CONTROL = `public, max-age=${MEDIA_CDN_MAX_AGE}`;

/**
 * Both cache headers of every 404 this route makes: a missing or deleted image costs one Storage
 * request a minute, not one per view, and a flood of one malformed path costs one function
 * invocation a minute per address.
 */
export const MEDIA_MISS_CACHE_CONTROL = "public, max-age=60";

/** Storage gets this long to answer, body included; then the route answers 504. */
export const MEDIA_UPSTREAM_TIMEOUT_MS = 5000;

/** Largest object served. The bucket's own limit is 4 MiB (`MAX_UPLOAD_BYTES`); this is the margin. */
export const MEDIA_MAX_BYTES = 5 * 1024 * 1024;

/** The only types served: what the upload pipeline stores (webp) and what older uploads are. */
const SERVED_TYPES: ReadonlySet<string> = new Set(["image/webp", "image/png", "image/jpeg"]);

const PREFIX = "/media/";

export interface ServeMediaOptions {
  /** The fetch to reach Storage with. Tests inject one; the route uses the platform's. */
  fetch?: typeof fetch;
  /**
   * The catch-all's own segments, as the router split them. The path is read from the URL; this
   * is the router's second opinion, so a path the router read differently (a backslash) is refused.
   */
  segments?: readonly string[];
}

/** The refusal every bad path gets: a short public 404, and no request to Storage. */
function missing(): Response {
  return new Response("Not found", {
    status: 404,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": MEDIA_MISS_CACHE_CONTROL,
      "Vercel-CDN-Cache-Control": MEDIA_MISS_CACHE_CONTROL,
      "X-Content-Type-Options": "nosniff",
    },
  });
}

/** Storage failed or did not answer: never cached, so an outage ends when Storage does. */
function failed(status: 502 | 504): Response {
  return new Response(status === 504 ? "Gateway timeout" : "Bad gateway", {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

/** What every method but GET and HEAD gets (the route file calls it for each). */
export function methodNotAllowed(): Response {
  return new Response(null, {
    status: 405,
    headers: { Allow: "GET, HEAD", "Cache-Control": "no-store" },
  });
}

/**
 * `{uid}/{file}.{jpg|png|webp}` when the request is exactly that and nothing else, otherwise null.
 * Read from the URL's path as written (percent-encoding is not decoded, so `%2e`, `%2f` and `%61`
 * never match: the pattern has no `%`, and one image has one address, which keeps the CDN's cache
 * key from being multiplied). Any `?` at all is refused, even an empty one: the query is part of
 * the cache key, so it would let anyone make endless misses.
 */
function validPath(rawUrl: string, segments: readonly string[] | undefined): string | null {
  if (rawUrl.includes("?")) return null;
  let pathname: string;
  try {
    pathname = new URL(rawUrl).pathname;
  } catch {
    return null;
  }
  if (!pathname.startsWith(PREFIX)) return null;
  const path = pathname.slice(PREFIX.length);
  if (!IMAGE_PATH_PATTERN.test(path)) return null;
  if (segments !== undefined && segments.join("/") !== path) return null;
  return path;
}

/** `image/webp; charset=x` -> `image/webp`; null when there is no type. */
function mediaTypeOf(value: string | null): string | null {
  const type = value?.split(";")[0]?.trim().toLowerCase();
  return type ? type : null;
}

/** The body through a counter that errors the stream past `max` (for an upstream with no length). */
function capped(body: ReadableStream<Uint8Array>, max: number): ReadableStream<Uint8Array> {
  let seen = 0;
  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        seen += chunk.byteLength;
        if (seen > max) controller.error(new Error("The image is larger than the limit."));
        else controller.enqueue(chunk);
      },
    }),
  );
}

const isTimeout = (error: unknown): boolean =>
  error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");

export async function serveMedia(
  request: Request,
  options: ServeMediaOptions = {},
): Promise<Response> {
  const method = request.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD") return methodNotAllowed();

  const path = validPath(request.url, options.segments);
  if (path === null) return missing();

  let upstream: Response;
  try {
    upstream = await (options.fetch ?? fetch)(storageUrl(path), {
      method,
      // A Storage redirect is an anomaly: never followed (fetch rejects, and that is a 502).
      redirect: "error",
      // Next's data cache would keep a second copy of every image; the CDN is the cache.
      cache: "no-store",
      // The caller's cookies, Authorization and apikey are never sent: no headers at all.
      credentials: "omit",
      signal: AbortSignal.timeout(MEDIA_UPSTREAM_TIMEOUT_MS),
    });
  } catch (error) {
    return failed(isTimeout(error) ? 504 : 502);
  }

  // Only a 200 is an image. Storage answers 400 or 404 for a missing object; an error of its own
  // (5xx), or anything else that is not an answer (a redirect when not followed), is a failure.
  if (upstream.status !== 200) {
    await upstream.body?.cancel().catch(() => undefined);
    return upstream.status >= 500 || (upstream.status >= 300 && upstream.status < 400)
      ? failed(502)
      : missing();
  }

  const type = mediaTypeOf(upstream.headers.get("content-type"));
  const declared = upstream.headers.get("content-length");
  const length = declared !== null && /^\d+$/.test(declared) ? Number(declared) : null;
  if (type === null || !SERVED_TYPES.has(type) || (length !== null && length > MEDIA_MAX_BYTES)) {
    await upstream.body?.cancel().catch(() => undefined);
    return missing();
  }

  // The response is built from this list and nothing the upstream sent: no Set-Cookie, no
  // Supabase header, no ETag of another system.
  const headers = new Headers({
    "Content-Type": type,
    "Cache-Control": MEDIA_BROWSER_CACHE_CONTROL,
    "Vercel-CDN-Cache-Control": MEDIA_CDN_CACHE_CONTROL,
    "X-Content-Type-Options": "nosniff",
  });
  // An encoded upstream body is decoded by fetch, so its length would no longer be the body's.
  if (length !== null && !upstream.headers.get("content-encoding")) {
    headers.set("Content-Length", String(length));
  }

  if (method === "HEAD") {
    await upstream.body?.cancel().catch(() => undefined);
    return new Response(null, { status: 200, headers });
  }
  // A 200 for a GET with no body at all is not an image Storage can have stored: a failure.
  if (upstream.body === null) return failed(502);
  // Streamed through, never read into memory first.
  return new Response(length === null ? capped(upstream.body, MEDIA_MAX_BYTES) : upstream.body, {
    status: 200,
    headers,
  });
}
