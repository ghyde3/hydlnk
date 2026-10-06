import { preload } from "react-dom";
import { ShowreelToggle, type AlphaCuts } from "./showreel-toggle";

const BASE = "/marketing/showreel";

/**
 * The transparent cuts of the showreel (same composition, background, dot grid, glow and vignette
 * left out): 16:9 from 760px, 4:5 below it. Chrome and Firefox get the WebM (VP9 with alpha);
 * Safari and iOS get the MOV (HEVC with alpha). The toggle picks by browser, see `alphaKind`.
 */
export const SHOWREEL_ALPHA_CUTS: AlphaCuts = {
  wide: {
    media: "(min-width: 760px)",
    poster: `${BASE}/showreel-16x9-alpha-poster.webp`,
    webm: `${BASE}/showreel-16x9-alpha.webm`,
    mov: `${BASE}/showreel-16x9-alpha.mov`,
  },
  tall: {
    media: "(max-width: 759px)",
    poster: `${BASE}/showreel-4x5-alpha-poster.webp`,
    webm: `${BASE}/showreel-4x5-alpha.webm`,
    mov: `${BASE}/showreel-4x5-alpha.mov`,
  },
};

// No poster attribute: the <img> below is the poster. The video fades in once it plays, and the
// poster is hidden then (a transparent video over its own first frame would show both).
const VIDEO_HTML =
  `<video class="absolute inset-0 size-full object-cover opacity-0 transition-opacity duration-500 motion-reduce:transition-none data-[shown=true]:opacity-100" ` +
  `autoplay muted loop playsinline preload="metadata" disablepictureinpicture ` +
  `disableremoteplayback aria-hidden="true"></video>`;

/**
 * The showreel with no box: no border, radius or fill, so it reads as part of the section behind
 * it. The caller paints the charcoal, grid and glow. The fixed ratio (4:5 on phones, 16:9 from
 * 760px) keeps the layout still while it loads. Reduced motion, or a browser with no alpha
 * support, shows the transparent poster only.
 */
export function ShowreelAlpha({ label, className = "" }: { label: string; className?: string }) {
  for (const cut of [SHOWREEL_ALPHA_CUTS.tall, SHOWREEL_ALPHA_CUTS.wide]) {
    preload(cut.poster, {
      as: "image",
      type: "image/webp",
      fetchPriority: "high",
      media: cut.media,
    });
  }
  return (
    <figure className={`relative ${className}`}>
      <div data-showreel="" className="group relative aspect-[4/5] w-full hl:aspect-video">
        <picture>
          <source
            media={SHOWREEL_ALPHA_CUTS.wide.media}
            srcSet={SHOWREEL_ALPHA_CUTS.wide.poster}
            type="image/webp"
            width={1600}
            height={900}
          />
          <img
            src={SHOWREEL_ALPHA_CUTS.tall.poster}
            alt=""
            width={864}
            height={1080}
            fetchPriority="high"
            decoding="async"
            className="absolute inset-0 size-full object-cover group-has-[video[data-shown=true]]:opacity-0"
          />
        </picture>
        <div className="contents" dangerouslySetInnerHTML={{ __html: VIDEO_HTML }} />
        <ShowreelToggle cuts={SHOWREEL_ALPHA_CUTS} />
      </div>
      <figcaption className="sr-only">{label}</figcaption>
    </figure>
  );
}
