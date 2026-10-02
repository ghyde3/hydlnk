import { clientEnv } from "@/lib/env/client";
import { MEDIA_BUCKET } from "./limits";

/**
 * Public URL of an uploaded image: `{SUPABASE_URL}/storage/v1/object/public/page-media/{path}`.
 * `path` is an image reference's `{uid}/{file}.{jpg|png|webp}` (checked by `imageRefSchema`);
 * each segment is still encoded here, so a stray character can never change the URL's shape.
 * Safe in server and client code.
 */
export function mediaUrl(path: string): string {
  const base = clientEnv.NEXT_PUBLIC_SUPABASE_URL.replace(/\/+$/, "");
  const encoded = path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `${base}/storage/v1/object/public/${MEDIA_BUCKET}/${encoded}`;
}

/** The public origin that serves page media: the only origin an avatar or image may load from. */
export function mediaOrigin(): string {
  return new URL(clientEnv.NEXT_PUBLIC_SUPABASE_URL).origin;
}
