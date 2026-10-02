"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The YouTube click-to-play facade, the renderer's one client island. Until the visitor presses
 * Play there is no iframe, no thumbnail and no request to YouTube or Google: just a dark poster
 * and a button. A click mounts the youtube-nocookie.com iframe, built from the parsed video id
 * (`src` comes from `parseEmbed`, never from the tenant's URL), and moves focus into it.
 */
export function YouTubeFacade({ src, caption }: { src: string; caption: string }) {
  const [playing, setPlaying] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    if (playing) frame.current?.focus();
  }, [playing]);

  if (playing) {
    return (
      <iframe
        ref={frame}
        className="pg-embed-iframe"
        src={`${src}?autoplay=1`}
        title={caption === "" ? "YouTube video" : `${caption} (YouTube video)`}
        allow="autoplay; encrypted-media; picture-in-picture"
        allowFullScreen
        referrerPolicy="strict-origin-when-cross-origin"
      />
    );
  }

  return (
    <button
      type="button"
      className="pg-embed-play"
      aria-label={caption === "" ? "Play video" : `Play video: ${caption}`}
      onClick={() => setPlaying(true)}
    >
      <span className="pg-embed-play-disc" aria-hidden="true">
        <svg className="pg-embed-play-glyph" viewBox="0 0 24 24" focusable="false">
          <path d="M8 5.5v13l11-6.5z" />
        </svg>
      </span>
    </button>
  );
}
