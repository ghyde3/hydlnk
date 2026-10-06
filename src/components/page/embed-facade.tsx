"use client";

import { useEffect, useRef, useState } from "react";
import {
  embedAllow,
  embedAllowsFullscreen,
  embedHeight,
  embedPlayerSrc,
  embedPlayerTitle,
  type EmbedKind,
  type EmbedProvider,
} from "@/lib/document";
import { EmbedFacadeMarkup } from "./embed-facade-markup";

/**
 * The tap-to-play facade for every embed provider, as the EDITOR PREVIEW draws it (M2-19, M6-27,
 * M8-05). The live page does not run React in the browser: it ships `EmbedFacadeMarkup` as plain
 * HTML and one small script mounts the same iframe on a tap (src/lib/tenant-assets/script). This
 * client component is the editor's twin of that script, and the table-driven Playwright test
 * compares the two iframes' `outerHTML`.
 *
 * Until the visitor presses Play there is no iframe, no thumbnail and no request to the provider:
 * just a dark poster and a button (the shared `EmbedFacadeMarkup`, so the first paint is the live
 * page's markup byte for byte). A tap mounts the provider's player, with `src` built from
 * `parseEmbed(...).src` (the parsed parts, never the tenant's URL) plus the provider's autoplay
 * flag, and moves focus into it.
 *
 * Twitch plays only inside a site it knows: the tap adds `parent={hostname}`, read from
 * `window.location.hostname` at tap time and nowhere else (never from the document). A hostname
 * that is not plain letters, digits, dots and dashes mounts no iframe.
 */
export function EmbedFacade({
  provider,
  kind,
  src,
  caption,
}: {
  provider: EmbedProvider;
  kind: EmbedKind;
  src: string;
  caption: string;
}) {
  const [playing, setPlaying] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    if (playing) frame.current?.focus();
  }, [playing]);

  if (playing) {
    // Read only after a tap, so the first render is the same on the server and in the browser.
    const parent = provider === "twitch" ? window.location.hostname : undefined;
    const playerSrc = embedPlayerSrc({ provider, src }, parent);
    if (playerSrc === null) {
      return (
        <p className="pg-embed-unavailable" role="status">
          This embed can’t load here.
        </p>
      );
    }
    const height = embedHeight({ provider, kind });
    return (
      <iframe
        ref={frame}
        className="pg-embed-iframe"
        src={playerSrc}
        title={embedPlayerTitle(provider, caption)}
        allow={embedAllow(provider)}
        allowFullScreen={embedAllowsFullscreen(provider)}
        referrerPolicy="strict-origin-when-cross-origin"
        style={typeof height === "number" ? { height, aspectRatio: "auto" } : undefined}
      />
    );
  }

  return (
    <EmbedFacadeMarkup
      provider={provider}
      kind={kind}
      src={src}
      caption={caption}
      onPlay={() => setPlaying(true)}
    />
  );
}
