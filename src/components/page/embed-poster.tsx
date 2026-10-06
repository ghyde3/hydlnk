import type { CSSProperties } from "react";
import { embedFacadeHeight, type ParsedEmbed } from "@/lib/document";

/**
 * The still poster shared by the tap-to-play facade and the inert copies (the editor's dock, the
 * shared preview): a near-black screen with a play disc. No iframe, no thumbnail, no request to
 * anyone (the server never fetches another site to build one).
 */

/** The disc and glyph inside a poster or a Play button. */
export function PlayDisc() {
  return (
    <span className="pg-embed-play-disc" aria-hidden="true">
      <svg className="pg-embed-play-glyph" viewBox="0 0 24 24" focusable="false">
        <path d="M8 5.5v13l11-6.5z" />
      </svg>
    </span>
  );
}

/**
 * `data-embed-fit` and the inline height of a poster: the 16:9 box (`video`, from the stylesheet),
 * or a fixed height in pixels (`player`: the player's own height; `bar`: a short bar for the tall
 * TikTok and Instagram players).
 */
export function posterFit(embed: Pick<ParsedEmbed, "provider" | "kind">): {
  fit: "video" | "player" | "bar";
  style: CSSProperties | undefined;
} {
  const height = embedFacadeHeight(embed);
  if (typeof height !== "number") return { fit: "video", style: undefined };
  const fit = embed.provider === "tiktok" || embed.provider === "instagram" ? "bar" : "player";
  return { fit, style: { height, aspectRatio: "auto" } };
}

/** A poster that is not a control: aria-hidden, nothing to tap. */
export function EmbedPoster({ embed }: { embed: Pick<ParsedEmbed, "provider" | "kind"> }) {
  const { fit, style } = posterFit(embed);
  return (
    <div className="pg-embed-play" aria-hidden="true" data-embed-fit={fit} style={style}>
      <PlayDisc />
    </div>
  );
}
