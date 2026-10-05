import Link from "next/link";
import { brandMarkPath } from "@/components/page/brand-marks";
import { Section, SectionIntro } from "../primitives";
import { AUDIENCE_IMAGES, type AudienceImage } from "./audience-imagery";
import { CREATOR_AUDIENCES, PLATFORM_AUDIENCES, audienceHref } from "./data";

const TILE =
  "group relative block overflow-hidden rounded-md border border-line bg-ink text-on-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

/*
 * The fades behind each tile's label, as plain CSS gradients (this project's Tailwind has no
 * black or white colors, so `from-black/75` drew nothing). "What you do" gets a dark fade; each
 * app gets its own brand color (brandFade, below).
 */
const DARK_FADE =
  "linear-gradient(to top, rgba(0,0,0,0.82) 0%, rgba(0,0,0,0.45) 32%, rgba(0,0,0,0) 62%)";

/**
 * One brand color per app (Gary, 2026-10-05), low on the tile so the photo keeps the top two
 * thirds: the color is strongest under the label and gone by 40% of the height. A short dark band
 * at the very bottom keeps the white mark and name readable on the lighter colors.
 */
function brandFade(rgb: string): string {
  return `linear-gradient(to top, rgba(0,0,0,0.3) 0%, rgba(0,0,0,0) 20%), linear-gradient(to top, rgba(${rgb},0.92) 0%, rgba(${rgb},0.5) 18%, rgba(${rgb},0) 40%)`;
}

const PLATFORM_FADE: Record<string, string> = {
  tiktok: brandFade("0,0,0"),
  instagram: brandFade("225,48,108"),
  youtube: brandFade("255,0,0"),
  twitch: brandFade("145,70,255"),
  x: brandFade("0,0,0"),
};

/** One photo as AVIF with a WebP fallback, filling its tile. */
function Photo({ image }: { image: AudienceImage }) {
  return (
    <picture>
      <source srcSet={`${image.src}.avif`} type="image/avif" />
      <source srcSet={`${image.src}.webp`} type="image/webp" />
      <img
        src={`${image.src}.webp`}
        width={image.width}
        height={image.height}
        alt={image.alt}
        loading="lazy"
        decoding="async"
        className="absolute inset-0 h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
      />
    </picture>
  );
}

/** The row of apps: tall photo tiles, scrolling sideways on a phone and five across on a desktop. */
function Platforms() {
  return (
    <div className="min-w-0">
      <h3 className="text-xl font-semibold tracking-[-0.01em]">Where you post</h3>
      <ul className="-mx-6 mt-4 flex snap-x snap-mandatory scroll-px-6 gap-3 overflow-x-auto px-6 pb-2 min-[1024px]:mx-0 min-[1024px]:grid min-[1024px]:grid-cols-5 min-[1024px]:overflow-visible min-[1024px]:px-0 min-[1024px]:pb-0">
        {PLATFORM_AUDIENCES.map((audience) => {
          const image = AUDIENCE_IMAGES[audience.slug];
          const mark = brandMarkPath(audience.slug);
          return (
            <li key={audience.slug} className="w-[58%] shrink-0 snap-start min-[640px]:w-[34%] min-[1024px]:w-auto">
              <Link href={audienceHref(audience.slug)} className={`${TILE} aspect-[3/4] min-h-11`}>
                {image ? <Photo image={image} /> : null}
                <span
                  className="absolute inset-0"
                  style={{ backgroundImage: PLATFORM_FADE[audience.slug] ?? DARK_FADE }}
                  aria-hidden="true"
                />
                <span className="absolute inset-x-0 bottom-0 flex items-center gap-2.5 p-4 text-base font-semibold">
                  {mark ? (
                    <svg
                      viewBox="0 0 24 24"
                      className="size-6 shrink-0 fill-current"
                      aria-hidden="true"
                    >
                      <path d={mark} />
                    </svg>
                  ) : null}
                  {audience.name}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * Row spans of the masonry grid, in rows of the grid's unit height. Four rows is a 4:5 or 3:4
 * photo, three rows a square one, so the tiles keep different shapes and the columns end level.
 * `min-[1024px]:order-*` puts the three tall tiles in the first row of three columns; on a phone the order
 * is the list's own, two columns of eleven rows each.
 */
const CREATOR_SPANS: Record<string, string> = {
  musicians: "row-span-4 min-[1024px]:order-1",
  artists: "row-span-4 min-[1024px]:order-2",
  "small-business": "row-span-4 min-[1024px]:order-3",
  podcasters: "row-span-3 min-[1024px]:order-4",
  coaches: "row-span-3 min-[1024px]:order-5",
};

/** The "what you do" masonry: one photo tile for each kind of work, plus a tile to the hub. */
function Creators() {
  return (
    <div className="min-w-0">
      <h3 className="text-xl font-semibold tracking-[-0.01em]">And for what you do</h3>
      <ul className="mt-4 grid grid-flow-row-dense auto-rows-[50px] grid-cols-2 gap-3 min-[640px]:auto-rows-[90px] min-[1024px]:auto-rows-[120px] min-[1024px]:grid-cols-3">
        {CREATOR_AUDIENCES.map((audience) => {
          const image = AUDIENCE_IMAGES[audience.slug];
          return (
            <li
              key={audience.slug}
              className={`min-w-0 ${CREATOR_SPANS[audience.slug] ?? "row-span-3"}`}
            >
              <Link href={audienceHref(audience.slug)} className={`${TILE} h-full min-h-11`}>
                {image ? <Photo image={image} /> : null}
                <span
                  className="absolute inset-0"
                  style={{ backgroundImage: DARK_FADE }}
                  aria-hidden="true"
                />
                <span className="absolute inset-x-0 bottom-0 block p-3.5 min-[640px]:p-4">
                  <span className="block text-base font-semibold min-[640px]:text-lg">{audience.name}</span>
                  <span className="mt-1 hidden text-sm leading-snug text-on-ink/85 min-[640px]:block">
                    {audience.blurb}
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
        <li className="row-span-4 min-w-0 min-[1024px]:order-6 min-[1024px]:row-span-3">
          <Link
            href={audienceHref()}
            className="flex h-full min-h-11 flex-col justify-end rounded-md border border-line-3 bg-page p-4 text-ink hover:border-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            <span className="text-lg font-semibold">All link in bio pages</span>
            <span className="mt-1 text-sm leading-snug text-text-2">
              Every app and kind of work, in one list.
            </span>
            <span aria-hidden="true" className="mt-3 text-lg">
              →
            </span>
          </Link>
        </li>
      </ul>
    </div>
  );
}

/**
 * A full-width band for the home page: a photo tile for each link-in-bio page, grouped by where
 * people post and what they do. Plain links with no script. `tone` picks the band's background so
 * it can sit between either of the home page's two.
 */
export function AudienceStrip({ tone = "white" }: { tone?: "white" | "page" }) {
  return (
    <Section id="link-in-bio-for" tone={tone} labelledBy="link-in-bio-for-title">
      <SectionIntro
        eyebrow="Link in bio for"
        titleId="link-in-bio-for-title"
        title="Set up for where you post and what you make."
        lead="Pick your app or your kind of work for the exact steps to add your link, and a page that fits."
      />
      <div className="mt-10 grid gap-12">
        <Platforms />
        <Creators />
      </div>
    </Section>
  );
}
