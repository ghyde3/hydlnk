"use client";

import { useEffect, useRef, useState } from "react";
import type { ShowreelCuts } from "./showreel";

type State = "unready" | "playing" | "paused";
type CutName = keyof ShowreelCuts;

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

/** Gives the video the sources of one cut (WebM first, MP4 for Safari) and reloads it. */
function attach(video: HTMLVideoElement, name: CutName, cuts: ShowreelCuts): void {
  if (video.dataset.cut === name) return;
  const cut = cuts[name];
  const sources = [
    [cut.webm, 'video/webm; codecs="vp9"'],
    [cut.mp4, "video/mp4"],
  ].map(([src, type]) => {
    const source = document.createElement("source");
    source.src = src!;
    source.type = type!;
    return source;
  });
  video.replaceChildren(...sources);
  video.dataset.cut = name;
  video.load();
}

/**
 * Runs the hero showreel and is its play/pause button (bottom right; hidden until hydrated, so it
 * never shows as a dead control).
 *
 * After the page's load event the video gets the cut for the viewport (4:5 below 760px, 16:9
 * above) and its autoplay attribute starts it; the video fades in over the poster once it plays.
 * With prefers-reduced-motion: reduce nothing loads and the button offers Play instead. If the
 * viewport crosses 760px later, the other cut takes over.
 */
export function ShowreelToggle({ cuts }: { cuts: ShowreelCuts }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [state, setState] = useState<State>("unready");

  useEffect(() => {
    const video = ref.current?.closest("[data-showreel]")?.querySelector("video");
    if (!video) return;
    const narrow = window.matchMedia(cuts.tall.media);
    const cutForViewport = (): CutName => (narrow.matches ? "tall" : "wide");

    const sync = () => setState(video.paused ? "paused" : "playing");
    const reveal = () => {
      video.dataset.shown = "true";
    };
    video.addEventListener("play", sync);
    video.addEventListener("pause", sync);
    video.addEventListener("playing", reveal);

    let timer = 0;
    const start = () => {
      if (window.matchMedia(REDUCED_MOTION).matches) return;
      attach(video, cutForViewport(), cuts);
    };
    const onLoad = () => {
      timer = window.setTimeout(start, 0);
    };
    if (document.readyState === "complete") onLoad();
    else window.addEventListener("load", onLoad, { once: true });

    const onViewportChange = () => {
      if (!video.dataset.cut) return;
      const wasPlaying = !video.paused;
      attach(video, cutForViewport(), cuts);
      if (wasPlaying) void video.play().catch(() => undefined);
    };
    narrow.addEventListener("change", onViewportChange);

    sync();
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("load", onLoad);
      narrow.removeEventListener("change", onViewportChange);
      video.removeEventListener("play", sync);
      video.removeEventListener("pause", sync);
      video.removeEventListener("playing", reveal);
    };
  }, [cuts]);

  const toggle = () => {
    const video = ref.current?.closest("[data-showreel]")?.querySelector("video");
    if (!video) return;
    if (!video.paused) {
      video.pause();
      return;
    }
    if (!video.dataset.cut) {
      attach(video, window.matchMedia(cuts.tall.media).matches ? "tall" : "wide", cuts);
    }
    void video.play().catch(() => setState("paused"));
  };

  const playing = state === "playing";
  return (
    <button
      ref={ref}
      type="button"
      hidden={state === "unready"}
      onClick={toggle}
      aria-label={playing ? "Pause showreel" : "Play showreel"}
      data-state={state}
      className="absolute right-3 bottom-3 z-10 flex size-11 cursor-pointer items-center justify-center rounded-md border border-ink-line bg-ink/80 text-on-ink hover:bg-ink"
    >
      {playing ? (
        <svg viewBox="0 0 24 24" aria-hidden="true" className="size-[18px] fill-current">
          <rect x="6.5" y="5" width="4" height="14" rx="1" />
          <rect x="13.5" y="5" width="4" height="14" rx="1" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" aria-hidden="true" className="size-[18px] fill-current">
          <path d="M8 5.5v13l11-6.5z" />
        </svg>
      )}
    </button>
  );
}
