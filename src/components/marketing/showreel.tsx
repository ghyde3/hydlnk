import { ShowreelToggle } from "./showreel-toggle";

const BASE = "/marketing/showreel";

/**
 * The two cuts of the showreel. Both are rendered from the same HyperFrames composition: 16:9 for
 * 760px and wider, 4:5 for phones. Each file is silent (no audio track), so autoplay is allowed.
 */
export const SHOWREEL_CUTS = {
  wide: {
    media: "(min-width: 760px)",
    poster: `${BASE}/showreel-16x9-poster.webp`,
    webm: `${BASE}/showreel-16x9.webm`,
    mp4: `${BASE}/showreel-16x9.mp4`,
    width: 1920,
    height: 1080,
  },
  tall: {
    media: "(max-width: 759px)",
    poster: `${BASE}/showreel-4x5-poster.webp`,
    webm: `${BASE}/showreel-4x5.webm`,
    mp4: `${BASE}/showreel-4x5.mp4`,
    width: 1080,
    height: 1350,
  },
} as const;

/** Sources only match when the visitor has not asked for reduced motion. */
const MOTION_OK = "(prefers-reduced-motion: no-preference)";

function videoHtml(cut: (typeof SHOWREEL_CUTS)[keyof typeof SHOWREEL_CUTS], className: string) {
  const media = `${MOTION_OK} and ${cut.media}`;
  // Raw markup on purpose: React does not serialize the `muted` attribute on the server, and
  // autoplay needs it in the HTML. Every value here is a constant from this file.
  return (
    `<video class="${className}" data-cut="${cut.width}x${cut.height}" ` +
    `data-webm="${cut.webm}" data-mp4="${cut.mp4}" width="${cut.width}" height="${cut.height}" ` +
    `poster="${cut.poster}" autoplay muted loop playsinline preload="metadata" ` +
    `disablepictureinpicture disableremoteplayback aria-hidden="true">` +
    `<source media="${media}" src="${cut.webm}" type='video/webm; codecs="vp9"'>` +
    `<source media="${media}" src="${cut.mp4}" type="video/mp4">` +
    `</video>`
  );
}

const VIDEO_CLASS = "absolute inset-0 size-full object-cover";

/**
 * Hero showreel. A fixed-ratio box (4:5 on phones, 16:9 from 760px) so nothing shifts while the
 * video loads, holding two art-directed <video> elements; CSS shows the one for the viewport, and
 * that one's <source media> is the only one that can match, so a visitor downloads one cut.
 * With prefers-reduced-motion: reduce no source matches at all: the poster stays, and the toggle
 * offers to play it. While it plays, the same toggle pauses it (WCAG 2.2.2).
 */
export function Showreel({ label }: { label: string }) {
  return (
    <figure className="relative">
      <div
        data-showreel=""
        className="relative aspect-[4/5] w-full overflow-hidden rounded-md border border-ink-line bg-ink hl:aspect-video"
      >
        <div
          className="contents"
          dangerouslySetInnerHTML={{
            __html:
              videoHtml(SHOWREEL_CUTS.tall, `${VIDEO_CLASS} hl:hidden`) +
              videoHtml(SHOWREEL_CUTS.wide, `${VIDEO_CLASS} hidden hl:block`),
          }}
        />
        <ShowreelToggle />
      </div>
      <figcaption className="sr-only">{label}</figcaption>
    </figure>
  );
}
