import { IMAGE_PATH_PATTERN } from "@/lib/document";
import type { TokenSet } from "@/lib/theme";
import { mediaUrl } from "@/lib/media/url";

/**
 * The page background image (M3-15). A tenant background is always one of the owner's own uploads
 * in the public `page-media` bucket, never a third-party address: the token stores that object's
 * public URL, and everything that draws or checks it goes through the two functions below. The
 * schema (`tokenSetSchema.bgImage`, `isProjectMediaUrl`) already accepts only that bucket's public
 * URLs; this is the renderer's own check of the same rule, so a hostile draft written straight to
 * the database (RLS lets a user write any JSON to `pages.draft`) can never make the renderer load an
 * image from another host even if a row bypassed the schema.
 */

/**
 * `{owner uid}/{file}.{jpg|png|webp}` when `value` is exactly the public URL of an object in this
 * deployment's `page-media` bucket (same origin, same path prefix, no query string or fragment),
 * otherwise null. The path has already passed `IMAGE_PATH_PATTERN`, so it holds only lowercase hex,
 * digits, `-` and the extension, and can be put in CSS or HTML without escaping.
 */
export function backgroundImagePath(value: string | null | undefined): string | null {
  if (typeof value !== "string" || value === "") return null;
  const prefix = mediaUrl("");
  if (!value.startsWith(prefix)) return null;
  const path = value.slice(prefix.length);
  return IMAGE_PATH_PATTERN.test(path) ? path : null;
}

/**
 * The background image URL the renderer may use for `tokens`: only when the background type is
 * image and the URL is a page-media URL. The returned URL is rebuilt from the validated path, not
 * copied from the token. Null means "draw no image" (the page then falls back to the solid color).
 */
export function backgroundImageUrl(tokens: Pick<TokenSet, "bgType" | "bgImage">): string | null {
  if (tokens.bgType !== "image") return null;
  const path = backgroundImagePath(tokens.bgImage);
  return path === null ? null : mediaUrl(path);
}

/**
 * True when the page's gradient has colors of its own (M6-41): either stop is set. A gradient
 * with neither keeps the stops it has always had, the surface color at 0% and the page color at
 * 55%, whatever the angle; one with a color of its own runs from the first stop at 0% to the last
 * at 100%. CSS cannot compare a variable with null, so the renderer says which it is with a data
 * attribute (`data-gradient="custom"`, only then), and the stylesheet picks the stops from it.
 */
export function gradientIsCustom(
  tokens: Pick<TokenSet, "bgType" | "gradientFrom" | "gradientTo">,
): boolean {
  // `?? null`: a token set built by hand without the gradient keys has none, like null.
  return (
    tokens.bgType === "gradient" &&
    ((tokens.gradientFrom ?? null) !== null || (tokens.gradientTo ?? null) !== null)
  );
}
