import { clientEnv } from "@/lib/env/client";
import { MEDIA_BUCKET } from "./limits";

/** Each segment of a path encoded on its own, so a stray character can never change the shape. */
function encodePath(path: string): string {
  return path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

/**
 * The address a browser loads an uploaded image from: `/media/{path}` on the page's own host
 * (M7-15). Relative on purpose, one slash and no query string: the route in
 * `src/app/media/[...path]/route.ts` answers it on every host and the CDN caches it, so Storage
 * is fetched about once per image instead of once per page view. `path` is an image reference's
 * `{uid}/{file}.{jpg|png|webp}` (checked by `imageRefSchema`); each segment is still encoded here.
 *
 * Use this for anything a browser draws (`<img src>`, CSS `url()`, the editor's previews). It is
 * never stored: documents, themes and versions keep the Storage form, `storageUrl`. Safe in server
 * and client code.
 */
export function mediaUrl(path: string): string {
  return `/media/${encodePath(path)}`;
}

/**
 * Public Storage URL of an uploaded image:
 * `{SUPABASE_URL}/storage/v1/object/public/page-media/{path}`. This is the form that is stored (a
 * background image's token holds it, an upload answers with it) and the only address the server
 * fetches from: the `/media` route, the Open Graph images and the Undo check for a deleted image
 * (which must see Storage itself, never a CDN's copy). Safe in server and client code.
 */
export function storageUrl(path: string): string {
  const base = clientEnv.NEXT_PUBLIC_SUPABASE_URL.replace(/\/+$/, "");
  return `${base}/storage/v1/object/public/${MEDIA_BUCKET}/${encodePath(path)}`;
}

/** The public origin of Storage: the only origin a stored image address may point at. */
export function mediaOrigin(): string {
  return new URL(clientEnv.NEXT_PUBLIC_SUPABASE_URL).origin;
}
