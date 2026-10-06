import {
  appBadgeWords,
  bookStoreLabel,
  isAppStore,
  isBookStore,
  mapTargets,
  type AppsBlock,
  type BookBlock,
  type MapBlock,
} from "@/lib/document";
import { mediaUrl } from "@/lib/media/url";
import { appMarkPath } from "./brand-marks";
import { LinkBox, blockTokens, type BlockContext } from "./blocks";
import { outboundHref } from "./outbound";

/**
 * The book, app store and map blocks (M9-20, M9-21, M9-22), drawn by the same `BlockView` as every
 * other block, so the editor's preview and the public page cannot drift. Every word a visitor reads
 * is either the author's own text (a React text node, so escaped) or comes from a fixed table, and
 * every link is the click redirect (`/r/<pageId>/<id>`): no destination is in the markup. Nothing
 * here loads anything from another host: the book's cover is this page's own `/media` image, the
 * badges' marks and the map's street grid are inline SVG.
 */

// Book links -------------------------------------------------------------------------------------

/**
 * A book: the cover in a 2:3 frame (its size is set in CSS before the file loads, so nothing
 * shifts), the title, the author and one button per store, in the stored order. The buttons follow
 * the page's button style (`data-button-style`) and the block's overrides, like a link.
 */
export function BookView({ block, ctx }: { block: BookBlock; ctx: BlockContext }) {
  const { resolved, style } = blockTokens(ctx.tokens, block.overrides);
  const cover = block.cover;
  return (
    <div
      className="pg-book"
      data-block-id={block.id}
      data-block-type="book"
      data-button-style={resolved.buttonStyle}
      style={style}
    >
      {cover ? (
        <span className="pg-book-cover">
          {/* A plain <img>: `path` is a validated reference into the page-media bucket. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            className="pg-book-cover-img"
            src={mediaUrl(cover.path)}
            alt={`Cover of ${block.title}`}
            width={cover.width}
            height={cover.height}
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
          />
        </span>
      ) : null}
      <div className="pg-book-body">
        <p className="pg-book-title">{block.title}</p>
        {block.author === "" ? null : <p className="pg-book-author">{block.author}</p>}
        <div className="pg-book-links">
          {block.links.map((link) => {
            // A store this version does not know draws no button (stored data is not trusted).
            const store = bookStoreLabel(link.store);
            if (store === null) return null;
            return (
              <LinkBox
                key={link.id}
                className="pg-book-link"
                data-store={isBookStore(link.store) ? link.store : undefined}
                aria-label={`${block.title} on ${store}`}
                thumbnail={ctx.thumbnail}
                link={outboundHref(link.url, { pageId: ctx.pageId, id: link.id })}
              >
                {store}
              </LinkBox>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// App store buttons ------------------------------------------------------------------------------

/**
 * One badge: the store's mark and two lines of text from a fixed table. This is the one component
 * to swap for Apple's and Google's official badge artwork (see `appMarkPath` in ./brand-marks.ts).
 */
function AppBadge({ store }: { store: string }) {
  const words = appBadgeWords(store);
  const mark = appMarkPath(store);
  if (words === null || mark === null) return null;
  return (
    <>
      <svg className="pg-app-mark" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d={mark} />
      </svg>
      <span className="pg-app-text">
        <span className="pg-app-small">{words.small}</span>
        <span className="pg-app-name">{words.name}</span>
      </span>
    </>
  );
}

/**
 * The App Store and Google Play badges, in the stored order: the same for every visitor, because
 * the live page is static and cannot read a user agent. One link per badge, counted by its own id.
 */
export function AppsView({ block, ctx }: { block: AppsBlock; ctx: BlockContext }) {
  const { style } = blockTokens(ctx.tokens, block.overrides);
  return (
    <div className="pg-apps" data-block-id={block.id} data-block-type="apps" style={style}>
      {block.links.map((link) => {
        const words = appBadgeWords(link.store);
        if (words === null) return null;
        return (
          <LinkBox
            key={link.id}
            className="pg-app-badge"
            data-store={isAppStore(link.store) ? link.store : undefined}
            aria-label={words.label}
            thumbnail={ctx.thumbnail}
            link={outboundHref(link.url, { pageId: ctx.pageId, id: link.id })}
          >
            <AppBadge store={link.store} />
          </LinkBox>
        );
      })}
    </div>
  );
}

// Map location -----------------------------------------------------------------------------------

/**
 * The decorative street grid and pin: a few lines and a pin drawn with the page's own tokens (the
 * stylesheet colors the three classes), under 1 KB. Not a map, not a request, not a tile.
 */
function MapArt() {
  return (
    <svg
      className="pg-map-art"
      viewBox="0 0 320 96"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      focusable="false"
    >
      <path className="pg-map-grid" d="M0 28H320M0 62H320M56 0V96M138 0V96M222 0V96M286 0V96" />
      <path className="pg-map-road" d="M0 86L112 50L214 54L320 12" />
      <path
        className="pg-map-pin"
        d="M168 14c-10 0-18 8-18 18 0 13 18 34 18 34s18-21 18-34c0-10-8-18-18-18zm0 25a7 7 0 1 1 0-14 7 7 0 0 1 0 14z"
      />
    </svg>
  );
}

/**
 * An address card with an 'Open in Maps' chooser: two links, Google Maps and Apple Maps, each
 * counted by its own id. The destinations are not in the markup: `/r/` builds them from the
 * published name and address (`mapTargets`), and the check here is only that they are links at all.
 */
export function MapView({ block, ctx }: { block: MapBlock; ctx: BlockContext }) {
  const { style } = blockTokens(ctx.tokens, block.overrides);
  const targets = mapTargets(block.name, block.address);
  return (
    <div className="pg-map" data-block-id={block.id} data-block-type="map" style={style}>
      <MapArt />
      <div className="pg-map-body">
        <p className="pg-map-name">{block.name}</p>
        <p className="pg-map-address">{block.address}</p>
        <p className="pg-map-open">Open in Maps</p>
        <div className="pg-map-links" role="group" aria-label="Open in Maps">
          <LinkBox
            className="pg-map-link"
            data-map="google"
            aria-label={`Open ${block.name} in Google Maps`}
            thumbnail={ctx.thumbnail}
            link={outboundHref(targets.google, { pageId: ctx.pageId, id: block.googleId })}
          >
            Google Maps
          </LinkBox>
          <LinkBox
            className="pg-map-link"
            data-map="apple"
            aria-label={`Open ${block.name} in Apple Maps`}
            thumbnail={ctx.thumbnail}
            link={outboundHref(targets.apple, { pageId: ctx.pageId, id: block.appleId })}
          >
            Apple Maps
          </LinkBox>
        </div>
      </div>
    </div>
  );
}
