import { mediaPathOf } from "@/lib/themes/bg-image";

/**
 * The one rule for "this address in a post body is an upload" (M16-04, M16-13). Pure, no
 * `server-only` and no editor copy, so both sides import it: the publish gate
 * (`src/lib/content/images.ts`) and the live renderer (`PostBody`). What Publish accepts is, by
 * construction, exactly what the page draws.
 */

/**
 * The upload an address stands for, or null. Only the stored form passes, character for character:
 * what `storageUrl(path)` builds (`src/lib/media/url.ts`) for a `{uid}/{file}.{jpg|png|webp}` path on
 * this project's Storage. `mediaPathOf` reads the address back; on top of it, the address must be
 * exactly what a URL parser prints for it and must end in the path as written. So nothing a browser
 * would normalize into an upload's address (dot segments, a backslash, a tab, upper case, a
 * percent-encoded letter) passes, and the renderer never has to guess what a stored address means.
 * The project URL is read when called, as `isProjectMediaUrl` does; with none set, nothing is an upload.
 */
export function uploadPathOf(address: string): string | null {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return null;
  let origin: string;
  let printed: string;
  try {
    origin = new URL(base).origin;
    printed = new URL(address).href;
  } catch {
    return null;
  }
  const path = mediaPathOf(address, origin);
  if (path === null) return null;
  return printed === address && address.endsWith(`/${path}`) ? path : null;
}
