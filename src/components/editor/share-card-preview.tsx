"use client";

import { useState } from "react";
import { objectPositionOf, shareDescriptionOf, shareTitleOf, type Share } from "@/lib/document";
import { mediaUrl } from "@/lib/media/url";

export const NO_IMAGE_TILE = "We make this image from your name and colors when you publish.";
export const PREVIEW_NOTE = "Apps draw cards a little differently. This is close.";

/**
 * The "Share preview" card (M6-33): how the page's link looks when it is sent, drawn from the
 * draft on every keystroke, before autosave. The picture at 1.91:1 (`object-fit: cover` around the
 * chosen focus), under it the page's address in Geist Mono 12px, then the title (14/600, two lines
 * at most) and the description (13px, two lines at most). An empty title falls back to the display
 * name and an empty description to the bio, as the published tags do.
 *
 * With no picture chosen it shows the page's current social image, `{liveUrl}/og?v={publishedAt}`,
 * once the page has been published, and otherwise a gray tile that says one is made at Publish.
 * HYDLNK UI tokens only: a white surface, a 1px `--hl-line` border and the 6px radius, no tenant
 * color, font or `--t-` variable. Every string is drawn as text.
 */
export function SharePreviewCard({
  share,
  name,
  bio,
  host,
  liveOgUrl,
}: {
  share: Share | undefined;
  /** The display name: the title when no share title is set. */
  name: string;
  bio: string;
  /** The page's address as shown, `mara.hydlnk.com` or the primary custom domain. */
  host: string;
  /** The live page's `/og?v=` URL once published, else null. */
  liveOgUrl: string | null;
}) {
  const title = shareTitleOf(share, name.trim());
  const description = shareDescriptionOf(share, bio.trim());
  const image = share?.image ?? null;
  const [failed, setFailed] = useState<string | null>(null);
  const src = image ? mediaUrl(image.path) : liveOgUrl;
  const showImage = src !== null && failed !== src;

  return (
    <section
      aria-label="Share preview"
      data-testid="share-preview-card"
      className="flex flex-col gap-1.5"
    >
      <h3 className="text-[13px] font-semibold text-ink-2">Share preview</h3>
      <div className="w-full overflow-hidden rounded-md border border-line bg-surface">
        <div style={{ aspectRatio: "1.91 / 1" }} className="relative w-full bg-track">
          {showImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={src}
              src={src}
              alt=""
              data-testid="share-preview-image"
              referrerPolicy="no-referrer"
              onError={() => setFailed(src)}
              style={image ? objectPositionOf(image.focus) : undefined}
              className="size-full object-cover"
            />
          ) : (
            <p
              data-testid="share-preview-tile"
              className="m-0 flex size-full items-center justify-center p-4 text-center text-[13px] text-text-2"
            >
              {NO_IMAGE_TILE}
            </p>
          )}
        </div>
        <div className="flex flex-col gap-1 p-3">
          <p
            data-testid="share-preview-host"
            className="m-0 font-mono text-xs text-text-2 [overflow-wrap:anywhere]"
          >
            {host}
          </p>
          <p
            data-testid="share-preview-title"
            className="m-0 line-clamp-2 text-sm font-semibold text-ink [overflow-wrap:anywhere]"
          >
            {title}
          </p>
          <p
            data-testid="share-preview-description"
            className="m-0 line-clamp-2 text-[13px] text-text-2 [overflow-wrap:anywhere]"
          >
            {description}
          </p>
        </div>
      </div>
      <p className="m-0 text-xs text-text-2">{PREVIEW_NOTE}</p>
    </section>
  );
}
