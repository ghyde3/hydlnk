"use client";

import { Ellipsis } from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/components/app/icon";

export interface CardMenuItem {
  /** Stable key, and the `data-testid` of the item: `theme-preview`, `theme-rename`, `theme-delete`. */
  id: string;
  /** What the item says. */
  label: string;
  /** The accessible name when it is longer than the label ("Preview Paper"). */
  ariaLabel?: string | undefined;
  /** Red text, for the item that deletes. */
  danger?: boolean | undefined;
  /** The item was chosen. The menu is already closed; `trigger` is the "More" button, the focus to come back to. */
  onSelect: (trigger: HTMLElement) => void;
}

const MENU_WIDTH = 176;
const GAP = 4;
const EDGE = 8;

/**
 * The "More" button of a theme card and its menu (M7-06): a 44x44 button on the card's name row
 * (`aria-haspopup="menu"`, `aria-expanded`) that opens a menu named like the theme. The menu follows
 * the page switcher's keyboard pattern: Enter, Space and the arrows open it, the arrows, Home and
 * End move between the items (wrapping), Escape closes it and returns focus to the button, Tab leaves
 * (the focus goes on from the button), and a press outside closes it.
 *
 * The menu is drawn in a portal at the end of the page with `position: fixed`: the card sits in a
 * horizontal scroll container, which would clip a menu drawn inside it. A scroll or a resize moves it
 * with its button (and closes it when the button has scrolled out of view). Choosing an item closes
 * the menu first and then hands the button to `onSelect`.
 */
export function CardMenu({
  themeName,
  items,
  className,
}: {
  themeName: string;
  items: readonly CardMenuItem[];
  className: string;
}) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const menuId = useId();

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) buttonRef.current?.focus();
  }, []);

  // Place the menu under the button, its right edges aligned and kept inside the screen, or above
  // the button when there is no room below. Null when the button is no longer in view (its row
  // scrolled it away): the menu then closes instead of pointing at nothing.
  const place = useCallback((): { top: number; left: number } | null => {
    const button = buttonRef.current;
    const menu = menuRef.current;
    if (!button || !menu) return null;
    const rect = button.getBoundingClientRect();
    const clip = button.closest('[role="region"]')?.getBoundingClientRect();
    if (clip && (rect.right <= clip.left || rect.left >= clip.right)) return null;
    if (rect.bottom <= 0 || rect.top >= window.innerHeight) return null;
    const height = menu.offsetHeight;
    const width = menu.offsetWidth || MENU_WIDTH;
    const left = Math.min(
      Math.max(EDGE, rect.right - width),
      Math.max(EDGE, window.innerWidth - width - EDGE),
    );
    let top = rect.bottom + GAP;
    if (top + height > window.innerHeight - EDGE && rect.top - GAP - height >= EDGE) {
      top = rect.top - GAP - height;
    }
    return { top, left };
  }, []);

  /** Moves the open menu to `spot` without a render: it is drawn at the corner, hidden, until placed. */
  const applySpot = useCallback((spot: { top: number; left: number }) => {
    const menu = menuRef.current;
    if (!menu) return;
    menu.style.top = `${spot.top}px`;
    menu.style.left = `${spot.left}px`;
    menu.style.visibility = "visible";
  }, []);

  // Once the menu is drawn: place it, and put the focus on its first item. The button was just
  // pressed, so it is in view; a later scroll closes the menu if that changes.
  useLayoutEffect(() => {
    if (!open) return;
    const spot = place();
    if (spot) applySpot(spot);
    else if (menuRef.current) menuRef.current.style.visibility = "visible";
    itemRefs.current[0]?.focus();
  }, [open, place, applySpot]);

  // A press outside closes it. A scroll or a resize (a phone's address bar showing or hiding is
  // one) moves the menu with its button instead, and closes it only when the button is gone.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      setOpen(false);
    };
    let frame = 0;
    const follow = (event?: Event) => {
      if (
        event?.target instanceof Node &&
        menuRef.current &&
        menuRef.current.contains(event.target)
      ) {
        return;
      }
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const spot = place();
        if (spot === null) setOpen(false);
        else applySpot(spot);
      });
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("scroll", follow, true);
    window.addEventListener("resize", follow);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("scroll", follow, true);
      window.removeEventListener("resize", follow);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [open, place, applySpot]);

  const move = (from: number, to: number | "first" | "last") => {
    const count = items.length;
    const next = to === "first" ? 0 : to === "last" ? count - 1 : (from + to + count) % count;
    itemRefs.current[next]?.focus();
  };

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const from = itemRefs.current.findIndex((item) => item === document.activeElement);
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        event.stopPropagation();
        move(from, 1);
        break;
      case "ArrowUp":
        event.preventDefault();
        event.stopPropagation();
        move(from, -1);
        break;
      case "ArrowLeft":
      case "ArrowRight":
        // The row behind the menu scrolls with these; inside the menu they do nothing.
        event.preventDefault();
        event.stopPropagation();
        break;
      case "Home":
        event.preventDefault();
        event.stopPropagation();
        move(from, "first");
        break;
      case "End":
        event.preventDefault();
        event.stopPropagation();
        move(from, "last");
        break;
      case "Escape":
        event.preventDefault();
        event.stopPropagation();
        close(true);
        break;
      case "Tab":
        // Tab leaves: the focus goes back to the button first, so it moves on from there.
        setOpen(false);
        buttonRef.current?.focus();
        break;
    }
  };

  const choose = (item: CardMenuItem) => {
    const button = buttonRef.current;
    setOpen(false);
    if (button) item.onSelect(button);
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        data-testid="theme-more"
        aria-label={`More for ${themeName}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (!open && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
            event.preventDefault();
            event.stopPropagation();
            setOpen(true);
          }
        }}
        className={className}
      >
        <Icon icon={Ellipsis} size={18} />
      </button>

      {open && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={menuRef}
              id={menuId}
              role="menu"
              aria-label={themeName}
              data-testid="theme-menu"
              onKeyDown={onMenuKeyDown}
              // Drawn hidden at the corner, then placed by `applySpot` before it is painted.
              style={{
                position: "fixed",
                top: 0,
                left: 0,
                width: MENU_WIDTH,
                visibility: "hidden",
              }}
              className="z-50 flex flex-col rounded-md border border-line-3 bg-surface p-1 text-ink"
            >
              {items.map((item, index) => (
                <button
                  key={item.id}
                  ref={(node) => {
                    itemRefs.current[index] = node;
                  }}
                  type="button"
                  role="menuitem"
                  tabIndex={-1}
                  aria-label={item.ariaLabel}
                  data-testid={item.id}
                  onClick={() => choose(item)}
                  className={`flex min-h-11 w-full cursor-pointer items-center rounded-sm px-3 py-2 text-left text-sm font-medium hover:bg-page focus-visible:bg-page ${
                    item.danger ? "text-bad" : "text-ink"
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
