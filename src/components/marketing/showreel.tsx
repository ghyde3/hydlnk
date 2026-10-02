import { preload } from "react-dom";
import { ShowreelToggle } from "./showreel-toggle";
import "./showreel.css";

const BASE = "/marketing/showreel";

/**
 * The two cuts of the showreel, rendered from the same HyperFrames composition: 16:9 from 760px,
 * 4:5 below it. Each file is silent (no audio track), so muted autoplay is always allowed.
 */
export const SHOWREEL_CUTS = {
  wide: {
    media: "(min-width: 760px)",
    poster: `${BASE}/showreel-16x9-poster.webp`,
    webm: `${BASE}/showreel-16x9.webm`,
    mp4: `${BASE}/showreel-16x9.mp4`,
  },
  tall: {
    media: "(max-width: 759px)",
    poster: `${BASE}/showreel-4x5-poster.webp`,
    webm: `${BASE}/showreel-4x5.webm`,
    mp4: `${BASE}/showreel-4x5.mp4`,
  },
} as const;

export type ShowreelCuts = typeof SHOWREEL_CUTS;

// Hidden until it is actually playing (the toggle sets data-shown), so the poster <img> below is
// what paints first and what LCP measures. Frame 0 of the loop is the poster, so the hand-over is
// seamless.
const VIDEO_CLASS =
  "absolute inset-0 size-full object-cover opacity-0 transition-opacity duration-500 motion-reduce:transition-none data-[shown=true]:opacity-100";

// Raw markup on purpose: React does not serialize the `muted` attribute on the server, and muted
// autoplay needs it in the HTML. Every value is a constant from this file. The sources are not in
// the markup: ShowreelToggle attaches the cut for the viewport once the page has loaded (and, under
// prefers-reduced-motion, only when Play is pressed), so the video never competes with the page's
// first paint.
const VIDEO_HTML =
  `<video class="${VIDEO_CLASS}" poster="${SHOWREEL_CUTS.tall.poster}" ` +
  `autoplay muted loop playsinline preload="metadata" disablepictureinpicture ` +
  `disableremoteplayback aria-hidden="true"></video>`;

/**
 * Hero showreel: a fixed-ratio box (4:5 on phones, 16:9 from 760px) so nothing shifts while it
 * loads. Underneath, the art-directed poster (frame 0, high priority); over it, the video, which
 * fades in once it plays. The toggle in the corner pauses it (WCAG 2.2.2), or, with reduced motion,
 * offers to play it. Without JavaScript the poster is all there is.
 */
export function Showreel({ label }: { label: string }) {
  // <link rel="preload"> in <head>, one per viewport, so the poster starts loading first.
  for (const cut of [SHOWREEL_CUTS.tall, SHOWREEL_CUTS.wide]) {
    preload(cut.poster, { as: "image", type: "image/webp", fetchPriority: "high", media: cut.media });
  }
  return (
    <figure className="relative">
      <div
        data-showreel=""
        className="relative aspect-[4/5] w-full overflow-hidden rounded-md border border-ink-line bg-ink hl:aspect-video"
      >
        <picture>
          <source
            media={SHOWREEL_CUTS.wide.media}
            srcSet={SHOWREEL_CUTS.wide.poster}
            type="image/webp"
            width={1600}
            height={900}
          />
          <img
            src={SHOWREEL_CUTS.tall.poster}
            alt=""
            width={864}
            height={1080}
            fetchPriority="high"
            decoding="async"
            className="absolute inset-0 size-full object-cover"
          />
        </picture>
        <div className="contents" dangerouslySetInnerHTML={{ __html: VIDEO_HTML }} />
        <ShowreelToggle cuts={SHOWREEL_CUTS} />
      </div>
      <figcaption className="sr-only">{label}</figcaption>
    </figure>
  );
}
