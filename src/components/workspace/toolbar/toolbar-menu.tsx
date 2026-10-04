"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";

/** Every menu item is at least 44px tall (DESIGN.md: touch targets). */
export const MENU_ITEM_CLASS =
  "flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-sm px-3 py-2 text-left text-sm font-semibold text-ink no-underline hover:bg-page focus-visible:bg-page aria-disabled:cursor-not-allowed aria-disabled:text-text-2";

/** The trigger button of both toolbar menus: the secondary button of DESIGN.md, 44px tall. */
export const MENU_BUTTON_CLASS =
  "inline-flex min-h-11 cursor-pointer items-center justify-center gap-1.5 rounded-md border border-line-3 bg-surface px-3 text-sm font-semibold text-ink";

/** What a menu hands to its items: how to close it, and whether focus should return to the button. */
export interface MenuApi {
  close: (returnFocus: boolean) => void;
}

const MenuContext = createContext<MenuApi>({ close: () => undefined });

/** The open menu's controls, for an item to close it (and say where focus goes) when it is chosen. */
export function useMenuApi(): MenuApi {
  return useContext(MenuContext);
}

/**
 * An accessible menu button for the pinned toolbar (M7-05): a button with `aria-haspopup="menu"`
 * and `aria-expanded`, and a `role="menu"` panel under it, the same keyboard behavior as the page
 * switcher's menu.
 *
 *   - Enter, Space (the button's own click) and ArrowDown open it with focus on the first item;
 *     ArrowUp opens it with focus on the last.
 *   - Inside: ArrowDown and ArrowUp move (wrapping), Home and End jump, Escape closes and returns
 *     focus to the button, Tab closes and lets focus leave, a press outside closes.
 *   - Space on a link item activates it like Enter (a link does not do that on its own).
 *
 * Opening a menu is only a piece of view state: it never reads or writes the draft, adds no undo
 * step and sends no request. Items are focusable elements with `role="menuitem"` and
 * `tabIndex={-1}`; a disabled item is `aria-disabled` and stays focusable, like the page switcher's
 * "New page" at the plan limit.
 */
export function ToolbarMenu({
  label,
  buttonLabel,
  buttonContent,
  buttonClassName = MENU_BUTTON_CLASS,
  align = "right",
  children,
}: {
  /** The menu's accessible name ("Preview", "More actions"). */
  label: string;
  /** The button's accessible name when its visible content is an icon. */
  buttonLabel?: string;
  buttonContent: ReactNode;
  buttonClassName?: string;
  align?: "left" | "right";
  /** The items: elements with `role="menuitem"` and `tabIndex={-1}`; they close the menu with `useMenuApi()`. */
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  // Where focus goes when the menu opens: the first item, or the last for ArrowUp.
  const focusOnOpen = useRef<"first" | "last">("first");
  const menuId = useId();

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) buttonRef.current?.focus();
  }, []);
  const api = useMemo<MenuApi>(() => ({ close }), [close]);

  const items = useCallback(
    () => Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []),
    [],
  );

  useEffect(() => {
    if (!open) return;
    const list = items();
    (focusOnOpen.current === "last" ? list[list.length - 1] : list[0])?.focus();
  }, [open, items]);

  // A press outside closes the menu. Focus goes back to the button unless the press landed on
  // something else focusable.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      setOpen(false);
      requestAnimationFrame(() => {
        const active = document.activeElement;
        if (!active || active === document.body) buttonRef.current?.focus();
      });
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  function onMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const list = items();
    const from = list.findIndex((item) => item === document.activeElement);
    const move = (next: number) => {
      event.preventDefault();
      list[(next + list.length) % list.length]?.focus();
    };
    switch (event.key) {
      case "ArrowDown":
        move(from + 1);
        break;
      case "ArrowUp":
        move(from <= 0 ? list.length - 1 : from - 1);
        break;
      case "Home":
        move(0);
        break;
      case "End":
        move(list.length - 1);
        break;
      case "Escape":
        event.preventDefault();
        // Only the menu closes: nothing behind it (the rename field's Escape) reacts.
        event.stopPropagation();
        close(true);
        break;
      case "Tab":
        setOpen(false);
        break;
      case " ": {
        // A link activates on Enter only; a menu item acts on Space too.
        const target = event.target as HTMLElement;
        if (target.tagName === "A") {
          event.preventDefault();
          target.click();
        }
        break;
      }
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-label={buttonLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => {
          focusOnOpen.current = "first";
          setOpen((value) => !value);
        }}
        onKeyDown={(event) => {
          if (!open && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
            event.preventDefault();
            focusOnOpen.current = event.key === "ArrowUp" ? "last" : "first";
            setOpen(true);
          }
        }}
        className={buttonClassName}
      >
        {buttonContent}
      </button>
      {open ? (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={label}
          onKeyDown={onMenuKeyDown}
          className={`absolute top-full z-30 mt-1.5 flex w-[min(15rem,calc(100vw-2rem))] flex-col rounded-md border border-line-3 bg-surface p-1 ${
            align === "right" ? "right-0" : "left-0"
          }`}
        >
          <MenuContext.Provider value={api}>{children}</MenuContext.Provider>
        </div>
      ) : null}
    </div>
  );
}
