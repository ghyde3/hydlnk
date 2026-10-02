"use client";

import { useEffect, useRef, useState } from "react";

type State = "unready" | "playing" | "paused";

/** The <video> CSS is showing for this viewport (the other cut is display: none). */
function visibleVideo(box: Element | null): HTMLVideoElement | null {
  if (!box) return null;
  const videos = Array.from(box.querySelectorAll("video"));
  return videos.find((video) => getComputedStyle(video).display !== "none") ?? null;
}

/**
 * Play/pause control for the hero showreel, bottom right of the video. It stays hidden until it
 * is hydrated, so it never shows as a dead button. When reduced motion kept every <source> from
 * matching, the video has no source: the first press loads the cut for this viewport and plays it.
 */
export function ShowreelToggle() {
  const ref = useRef<HTMLButtonElement>(null);
  const [state, setState] = useState<State>("unready");

  useEffect(() => {
    const box = ref.current?.closest("[data-showreel]") ?? null;
    const videos = box ? Array.from(box.querySelectorAll("video")) : [];
    const sync = () => {
      const video = visibleVideo(box);
      setState(video && !video.paused ? "playing" : "paused");
    };
    for (const video of videos) {
      video.addEventListener("play", sync);
      video.addEventListener("pause", sync);
    }
    sync();
    return () => {
      for (const video of videos) {
        video.removeEventListener("play", sync);
        video.removeEventListener("pause", sync);
      }
    };
  }, []);

  const toggle = () => {
    const video = visibleVideo(ref.current?.closest("[data-showreel]") ?? null);
    if (!video) return;
    if (!video.paused) {
      video.pause();
      return;
    }
    if (!video.currentSrc) {
      const webm = video.dataset.webm;
      const mp4 = video.dataset.mp4;
      const useWebm = webm && video.canPlayType('video/webm; codecs="vp9"') !== "";
      const source = useWebm ? webm : mp4;
      if (!source) return;
      video.src = source;
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
