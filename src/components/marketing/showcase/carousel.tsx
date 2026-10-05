"use client";

import { useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
import "./showcase.css";

/**
 * The row of phones, as a scroll-snap scroller with Previous and Next buttons and a position cue
 * (a counter and a thin track with a brass thumb). Nothing moves on its own. The slides are
 * server-rendered children; this only wires the scrolling. The cue is written straight to the DOM
 * on scroll, so a swipe re-renders nothing.
 */
export function Carousel({
  label,
  total,
  children,
}: {
  label: string;
  total: number;
  children: ReactNode;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const prev = useRef<HTMLButtonElement>(null);
  const next = useRef<HTMLButtonElement>(null);
  const thumb = useRef<HTMLSpanElement>(null);
  const count = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    let frame = 0;

    const measure = () => {
      const slides = el.children;
      const step =
        slides.length > 1
          ? (slides[1] as HTMLElement).offsetLeft - (slides[0] as HTMLElement).offsetLeft
          : el.clientWidth;
      return { step: Math.max(step, 1), visible: Math.max(1, Math.floor((el.clientWidth + 24) / step)) };
    };

    const update = () => {
      frame = 0;
      const { step, visible } = measure();
      const max = el.scrollWidth - el.clientWidth;
      const atStart = el.scrollLeft <= 2;
      const atEnd = el.scrollLeft >= max - 2;
      // Set only here, never as a JSX prop: React drops clicks on a button whose prop says
      // disabled, even after the element itself has been enabled, which froze Previous.
      if (prev.current) prev.current.disabled = atStart;
      if (next.current) next.current.disabled = atEnd;
      if (thumb.current) {
        thumb.current.style.left = `${(el.scrollLeft / el.scrollWidth) * 100}%`;
        thumb.current.style.width = `${(el.clientWidth / el.scrollWidth) * 100}%`;
      }
      if (count.current) {
        const first = atEnd ? Math.max(1, total - visible + 1) : Math.round(el.scrollLeft / step) + 1;
        count.current.textContent =
          visible === 1 ? `${first} of ${total}` : `${first} to ${first + visible - 1} of ${total}`;
      }
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };

    update();
    el.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      el.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [total]);

  function move(direction: 1 | -1) {
    const el = scroller.current;
    if (!el) return;
    const slides = el.children;
    const step =
      slides.length > 1
        ? (slides[1] as HTMLElement).offsetLeft - (slides[0] as HTMLElement).offsetLeft
        : el.clientWidth;
    const visible = Math.max(1, Math.floor((el.clientWidth + 24) / step));
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollBy({
      left: direction * step * Math.max(1, visible - 1),
      behavior: reduced ? "auto" : "smooth",
    });
  }

  // Left and right move focus from one slide to its neighbor; the browser scrolls it into view.
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    const target = event.target as HTMLElement;
    if (target.parentElement !== scroller.current) return;
    const sibling = (
      event.key === "ArrowRight" ? target.nextElementSibling : target.previousElementSibling
    ) as HTMLElement | null;
    if (sibling) {
      event.preventDefault();
      sibling.focus();
    }
  }

  return (
    <div role="region" aria-roledescription="carousel" aria-label={label}>
      <div ref={scroller} className="sc-scroller" onKeyDown={onKeyDown}>
        {children}
      </div>
      <div className="mt-6 flex items-center gap-4">
        <button
          ref={prev}
          type="button"
          className="sc-nav-button"
          aria-label="Previous setups"
          onClick={() => move(-1)}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M14.5 6l-6 6 6 6" />
          </svg>
        </button>
        <button
          ref={next}
          type="button"
          className="sc-nav-button"
          aria-label="Next setups"
          onClick={() => move(1)}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M9.5 6l6 6-6 6" />
          </svg>
        </button>
        <span className="sc-track" aria-hidden="true">
          <span ref={thumb} className="sc-thumb" style={{ width: "58%" }} />
        </span>
        <span
          ref={count}
          aria-live="polite"
          className="min-w-[4.5rem] text-right text-sm text-text-2 tabular-nums"
        >
          {`1 of ${total}`}
        </span>
      </div>
    </div>
  );
}
