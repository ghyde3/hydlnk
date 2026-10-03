import type { CSSProperties } from "react";
import { objectPositionOf, pickShape, type ImageRef } from "@/lib/document";
import { mediaUrl } from "@/lib/media/url";

/**
 * The picture of an image block and the focus of a card's banner (M6-23).
 *
 * A focus is two numbers on the image reference. The only thing that reaches the page from it is
 * `object-position`, and that value is built by `objectPositionOf` from the two numbers alone (one
 * decimal, `{x*100}% {y*100}%`); no string from the document is ever written into a `style`
 * attribute. A missing, centered or invalid focus gives no style at all, so the stylesheet's own
 * `50% 50%` applies and the markup is the same as it was before focus existed.
 *
 * A shape (`square`, `landscape`, `wide`) is read through `pickShape`, which only ever returns one
 * of the three words, and arrives as `data-shape` on the frame. The frame's `aspect-ratio` is in
 * the stylesheet, so its height is the same before and after the file loads. Without a shape the
 * picture is drawn as it always was: the image at its natural ratio, and a focus has no effect.
 */

/** The inline style of a cropped picture: `object-position` from the focus, or none. */
export function focusStyle(image: Pick<ImageRef, "focus">): CSSProperties | undefined {
  return objectPositionOf(image.focus);
}

/** The image block's picture: the bare image, or the image inside its shaped frame. */
export function ImagePicture({
  image,
  alt,
  shape: rawShape,
}: {
  image: ImageRef;
  alt: string;
  shape: unknown;
}) {
  const shape = pickShape(rawShape);
  const picture = (
    // A plain <img>: `path` is a validated reference into the page-media bucket, so next/image
    // would add nothing but a remotePatterns list.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className="pg-image-img"
      src={mediaUrl(image.path)}
      alt={alt}
      width={image.width}
      height={image.height}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      {...(shape ? { style: focusStyle(image) } : {})}
    />
  );
  if (!shape) return picture;
  return (
    <span className="pg-image-frame" data-shape={shape}>
      {picture}
    </span>
  );
}
