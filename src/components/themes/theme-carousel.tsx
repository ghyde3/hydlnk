"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type FocusEvent,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
} from "react";
import {
  cardTarget,
  canScrollNext,
  canScrollPrev,
  maxScroll,
  overflows,
  pageTarget,
  revealTarget,
  type RowMetrics,
} from "./scroll-math";

/** The one breakpoint (DESIGN.md): the arrows are for 760px and up; a phone swipes. */
const DESKTOP = "(min-width: 760px)";

function subscribeDesktop(onChange: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
  const list = window.matchMedia(DESKTOP);
  list.addEventListener("change", onChange);
  return () => list.removeEventListener("change", onChange);
}

/** `useIsDesktop` without the throw where `matchMedia` does not exist (a unit test's jsdom). */
function useDesktop(): boolean {
  return useSyncExternalStore(
    subscribeDesktop,
    () => typeof window.matchMedia === "function" && window.matchMedia(DESKTOP).matches,
    () => false,
  );
}

function motion(): ScrollBehavior {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return "auto";
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
}

/** Scrolls only the row, sideways: never `scrollIntoView`, so the page and every other scroller stay put. */
function scrollRowTo(row: HTMLElement, left: number, behavior: ScrollBehavior): void {
  if (typeof row.scrollTo === "function") row.scrollTo({ left, behavior });
  else row.scrollLeft = left;
}

function measure(row: HTMLElement): RowMetrics {
  const list = row.firstElementChild;
  let step = 0;
  if (list && list.children.length > 1) {
    step =
      list.children[1]!.getBoundingClientRect().left -
      list.children[0]!.getBoundingClientRect().left;
  }
  return {
    scrollLeft: row.scrollLeft,
    clientWidth: row.clientWidth,
    scrollWidth: row.scrollWidth,
    step: step > 0 ? step : 0,
  };
}

function paddingOf(row: HTMLElement): { start: number; end: number } {
  if (typeof getComputedStyle !== "function") return { start: 0, end: 0 };
  const style = getComputedStyle(row);
  return { start: parseFloat(style.paddingLeft) || 0, end: parseFloat(style.paddingRight) || 0 };
}

/** The card (the `li`) of a theme in the row, or null. */
function cardOf(row: HTMLElement, id: string): HTMLElement | null {
  const list = row.firstElementChild;
  if (!list) return null;
  for (const child of Array.from(list.children)) {
    if (child instanceof HTMLElement && child.dataset.themeId === id) return child;
  }
  return null;
}

/**
 * Brings a card fully into the row's view by changing the row's own `scrollLeft`, or does nothing
 * when it is in view already. Returns false when the row cannot say yet (it has no width: hidden).
 */
function reveal(row: HTMLElement, card: HTMLElement, behavior: ScrollBehavior): boolean {
  if (row.clientWidth <= 0) return false;
  const m = measure(row);
  const rowRect = row.getBoundingClientRect();
  const cardRect = card.getBoundingClientRect();
  const target = revealTarget(
    m,
    { left: cardRect.left - rowRect.left + m.scrollLeft, width: cardRect.width },
    paddingOf(row),
  );
  if (target !== null) scrollRowTo(row, target, behavior);
  return true;
}

const ARROW =
  "absolute top-1/2 z-10 inline-flex size-11 -translate-y-1/2 cursor-pointer items-center justify-center rounded-md border border-line-3 bg-surface p-0 text-ink aria-disabled:pointer-events-none aria-disabled:cursor-default aria-disabled:opacity-0 focus-visible:aria-disabled:opacity-100";

/**
 * One row of theme cards (M7-06): a heading (with an optional action at its right), then a
 * horizontal scroll container that snaps every card to its left edge. On a phone a finger swipes it
 * and the row bleeds to the edges of its card, so a part of the next card shows; from 760px up two
 * 44x44 arrow buttons sit on its edges and move it by its visible width less one card, onto a card
 * boundary. The arrows are drawn only when the cards do not all fit, and are `aria-disabled` at the
 * start and the end of the row, where they fade out and let a press through to the card under them
 * (they come back while they have keyboard focus).
 *
 * The scroll container is a labeled region you can focus, so the arrow keys scroll it, and a card
 * you tab to that is out of view scrolls into it. The applied card's row scrolls to it (a
 * `scrollLeft` change on the row only) when the screen opens and whenever `syncKey` changes: an
 * apply, an undo, a redo, a save, a retry that loads the themes.
 */
export function ThemeCarousel({
  headingId,
  title,
  headingRef,
  action,
  appliedId,
  syncKey,
  testId,
  empty,
  children,
}: {
  headingId: string;
  title: string;
  /** The heading takes focus when a card it held is gone (a delete). */
  headingRef?: Ref<HTMLHeadingElement> | undefined;
  /** A control at the right of the heading ("Save as theme"). */
  action?: ReactNode;
  /** The applied theme when it is in this row, else null: the card the row scrolls to. */
  appliedId: string | null;
  /** Changes whenever the row should look for the applied card again. */
  syncKey: string;
  testId: string;
  /** Shown instead of cards when the row has none. */
  empty?: ReactNode;
  children?: ReactNode;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  const desktop = useDesktop();
  const [state, setState] = useState({ overflow: false, prev: false, next: false });
  const firstSync = useRef(true);
  const pendingReveal = useRef(false);
  const appliedRef = useRef(appliedId);
  useEffect(() => {
    appliedRef.current = appliedId;
  }, [appliedId]);
  const hasCards = empty === undefined || empty === null;

  const update = useCallback(() => {
    const row = rowRef.current;
    if (!row) return;
    const m = measure(row);
    const next = { overflow: overflows(m), prev: canScrollPrev(m), next: canScrollNext(m) };
    setState((current) =>
      current.overflow === next.overflow && current.prev === next.prev && current.next === next.next
        ? current
        : next,
    );
  }, []);

  // Arrow state follows the scroll position and the row's size and content.
  useEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        update();
      });
    };
    row.addEventListener("scroll", onScroll, { passive: true });
    update();
    let observer: ResizeObserver | undefined;
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(() => {
        update();
        // A row that was hidden (the Style tab behind the Preview tab) and now has a width.
        if (pendingReveal.current && row.clientWidth > 0 && appliedRef.current) {
          const card = cardOf(row, appliedRef.current);
          if (card && reveal(row, card, "auto")) pendingReveal.current = false;
        }
      });
      observer.observe(row);
      if (row.firstElementChild) observer.observe(row.firstElementChild);
    }
    return () => {
      row.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [update, hasCards]);

  // The applied card's row scrolls to it: instantly when the screen opens, smoothly after that.
  useEffect(() => {
    const row = rowRef.current;
    if (!row || !appliedId) return;
    const card = cardOf(row, appliedId);
    if (!card) return;
    const behavior = firstSync.current ? "auto" : motion();
    firstSync.current = false;
    pendingReveal.current = !reveal(row, card, behavior);
  }, [appliedId, syncKey]);

  const go = (direction: 1 | -1) => {
    const row = rowRef.current;
    if (!row) return;
    const m = measure(row);
    if (direction === 1 ? !canScrollNext(m) : !canScrollPrev(m)) return;
    scrollRowTo(row, pageTarget(m, direction), motion());
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const row = rowRef.current;
    // A menu drawn in a portal sends its keys up the React tree: only keys from inside the row count.
    if (!row || !(event.target instanceof Node) || !row.contains(event.target)) return;
    const m = measure(row);
    let target: number;
    if (event.key === "ArrowRight") target = cardTarget(m, 1);
    else if (event.key === "ArrowLeft") target = cardTarget(m, -1);
    else if (event.key === "Home") target = 0;
    else if (event.key === "End") target = maxScroll(m);
    else return;
    event.preventDefault();
    scrollRowTo(row, target, motion());
  };

  // Tabbing to a card (or its More button) that is out of view scrolls the row to it. A mouse
  // press does not: the card would move out from under the pointer before the click lands.
  const onFocus = (event: FocusEvent<HTMLDivElement>) => {
    const row = rowRef.current;
    const target = event.target;
    if (!row || !(target instanceof HTMLElement)) return;
    try {
      if (!target.matches(":focus-visible")) return;
    } catch {
      return;
    }
    const card = target.closest<HTMLElement>("li[data-theme-id]");
    if (card && row.contains(card)) reveal(row, card, "auto");
  };

  return (
    <div data-testid={testId}>
      <div className="flex items-center justify-between gap-3">
        <h3
          id={headingId}
          ref={headingRef}
          tabIndex={-1}
          className="m-0 text-sm font-semibold outline-none"
        >
          {title}
        </h3>
        {action}
      </div>

      <div className="relative -mx-4 mt-2 hl:-mx-5">
        <div
          ref={rowRef}
          role="region"
          aria-labelledby={headingId}
          tabIndex={hasCards ? 0 : undefined}
          data-testid={`${testId}-scroller`}
          onKeyDown={onKeyDown}
          onFocus={onFocus}
          className="-my-1 overflow-x-auto overflow-y-hidden overscroll-x-contain px-4 py-1 [scrollbar-width:none] snap-x snap-mandatory scroll-px-4 hl:px-5 hl:scroll-px-5 focus-visible:outline-offset-[-2px] [&::-webkit-scrollbar]:hidden"
        >
          {hasCards ? <ul className="m-0 flex w-max list-none gap-2 p-0">{children}</ul> : empty}
        </div>

        {desktop && hasCards && state.overflow ? (
          <>
            <button
              type="button"
              aria-label="Show previous themes"
              aria-disabled={!state.prev}
              data-testid="themes-prev"
              onClick={() => go(-1)}
              className={`${ARROW} left-1`}
            >
              <Chevron direction="left" />
            </button>
            <button
              type="button"
              aria-label="Show next themes"
              aria-disabled={!state.next}
              data-testid="themes-next"
              onClick={() => go(1)}
              className={`${ARROW} right-1`}
            >
              <Chevron direction="right" />
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}

function Chevron({ direction }: { direction: "left" | "right" }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      className="size-5 fill-none stroke-current stroke-2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={direction === "left" ? "M15 5l-7 7 7 7" : "M9 5l7 7-7 7"} />
    </svg>
  );
}
