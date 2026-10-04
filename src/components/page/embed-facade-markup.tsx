import type { MouseEventHandler } from "react";
import {
  embedAllow,
  embedAllowsFullscreen,
  embedHeight,
  embedPlayLabel,
  embedPlayerSrc,
  embedPlayerTitle,
  type EmbedKind,
  type EmbedProvider,
} from "@/lib/document";
import { PlayDisc, posterFit } from "./embed-poster";

/**
 * The markup of the tap-to-play facade (M8-05): a plain, server-safe component with no hooks and
 * no "use client", so the live page's finished HTML and the editor's React `EmbedFacade` draw
 * exactly the same first paint. The live page has no React in the browser: the one tenant script
 * (src/lib/tenant-assets/script/tenant.js) upgrades the button on a tap, reading only the
 * `data-embed-*` attributes written here. The editor preview draws the same markup and adds an
 * `onClick` through `onPlay`; the attributes (and so the markup) are identical in every mode.
 *
 * Everything the script needs is computed here, on the server, from the validated parts of
 * `parseEmbed(block.url)` and the helpers of `@/lib/document`; the tenant's own URL never reaches an
 * attribute. The script has no per-provider table of its own.
 *
 *   data-embed-src         the final player URL (autoplay flag included). Twitch: the parsed `src`
 *                          plus `&autoplay=true` and no `parent`: the script appends
 *                          `&parent={window.location.hostname}` at tap time, to Twitch and to nothing else
 *   data-embed-title       the iframe's `title`
 *   data-embed-allow       the iframe's `allow` list
 *   data-embed-fullscreen  present (empty) when the provider's player has a full-screen button
 *   data-embed-height      the playing height in pixels; absent for the 16:9 players
 */

export interface EmbedFacadeProps {
  provider: EmbedProvider;
  kind: EmbedKind;
  /** `parseEmbed(url).src`: rebuilt from the parsed id, never the tenant's URL. */
  src: string;
  caption: string;
  /** The editor preview's tap handler. Absent on the live page, where the tenant script handles the click. */
  onPlay?: MouseEventHandler<HTMLButtonElement>;
}

/**
 * The player URL written into `data-embed-src`: the provider's autoplay flag included, and for
 * Twitch no `parent` (it only ever comes from the browser's own hostname at tap time, never from
 * the document). `embedPlayerSrc` returns null for Twitch without a parent, so it is built here.
 */
export function facadePlayerSrc(embed: { provider: EmbedProvider; src: string }): string {
  if (embed.provider === "twitch") return `${embed.src}&autoplay=true`;
  // Every other provider needs no parent, so the helper cannot return null.
  return embedPlayerSrc(embed) ?? embed.src;
}

export function EmbedFacadeMarkup({ provider, kind, src, caption, onPlay }: EmbedFacadeProps) {
  const embed = { provider, kind };
  const { fit, style } = posterFit(embed);
  const height = embedHeight(embed);
  return (
    <button
      type="button"
      className="pg-embed-play"
      onClick={onPlay}
      aria-label={embedPlayLabel(embed, caption)}
      data-embed-fit={fit}
      style={style}
      data-embed-src={facadePlayerSrc({ provider, src })}
      data-embed-title={embedPlayerTitle(provider, caption)}
      data-embed-allow={embedAllow(provider)}
      data-embed-fullscreen={embedAllowsFullscreen(provider) ? "" : undefined}
      data-embed-height={typeof height === "number" ? height : undefined}
    >
      <PlayDisc />
    </button>
  );
}
