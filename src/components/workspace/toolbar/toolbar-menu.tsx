"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import { useMenuEntry } from "@/components/menu-entry";

/**
 * Every menu item is at least 44px tall (DESIGN.md: touch targets). Radix focuses the item under
 * the pointer and marks it `data-highlighted`, so hover and keyboard focus read the same.
 */
export const MENU_ITEM_CLASS =
  "flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-sm px-3 py-2 text-left text-sm font-semibold text-ink no-underline hover:bg-page focus-visible:bg-page data-[highlighted]:bg-page aria-disabled:cursor-not-allowed aria-disabled:text-text-2";

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
 * One item of a `ToolbarMenu`: Radix's `DropdownMenu.Item`. Wrap the element that is the item with
 * `asChild` (an `<a>`, a Next `<Link>`, a `<div>`); Radix gives it `role="menuitem"`, the roving
 * `tabIndex` and the keyboard behavior (Enter and Space click it, so a link activates on both).
 * Keeping the wrapper here keeps the Radix import in this file (M9-05).
 */
export function ToolbarMenuItem(props: ComponentProps<typeof DropdownMenu.Item>) {
  return <DropdownMenu.Item {...props} />;
}

/**
 * An accessible menu button for the pinned toolbar (M7-05), now on `@radix-ui/react-dropdown-menu`
 * (M9-05): a button with `aria-haspopup="menu"`, `aria-expanded` and `aria-controls`, and a
 * `role="menu"` panel in a portal at the end of `body`, positioned by Radix under the button.
 *
 *   - Enter, Space and ArrowDown open it with focus on the first item; ArrowUp opens it with focus
 *     on the last. A pointer open leaves focus on the menu itself.
 *   - Inside: the arrows move and wrap, Home and End jump, a letter jumps to the item that starts
 *     with it, Escape closes and returns focus to the button, a press outside closes. Tab does not
 *     leave an open menu (Radix keeps focus in it).
 *   - It is not modal (`modal={false}`): the page behind keeps its scroll and gets no padding or
 *     inert attributes, so opening a menu moves nothing.
 *
 * Opening a menu is only a piece of view state: it never reads or writes the draft, adds no undo
 * step and sends no request. The menu is unmounted while it is closed. A disabled item is
 * `aria-disabled` with its select canceled, never Radix's `disabled`, which would take it out of
 * keyboard focus (like the page switcher's "New page" at the plan limit).
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
  /** The items: `ToolbarMenuItem`s; they close the menu with `useMenuApi()`. */
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  // Whether closing puts focus back on the button (Escape, a chosen item that stays here) or not
  // (an item that moves focus somewhere else, a press on another control).
  const returnFocus = useRef(true);
  const pressedOutside = useRef(false);
  const { entry: entryRef, contentRef } = useMenuEntry();

  // Focus goes back to the button here, in the same turn the menu closes, rather than through
  // Radix's own close handling (a timeout): a key pressed right after Escape reaches the button.
  const setMenuOpen = useCallback((next: boolean) => {
    if (next) {
      returnFocus.current = true;
      pressedOutside.current = false;
    } else if (returnFocus.current && !pressedOutside.current) {
      buttonRef.current?.focus({ preventScroll: true });
    }
    setOpen(next);
  }, []);
  const close = useCallback(
    (focusButton: boolean) => {
      returnFocus.current = focusButton;
      setMenuOpen(false);
    },
    [setMenuOpen],
  );
  const api = useMemo<MenuApi>(() => ({ close }), [close]);

  return (
    <div className="relative">
      <DropdownMenu.Root modal={false} open={open} onOpenChange={setMenuOpen}>
        <DropdownMenu.Trigger asChild>
          <button
            ref={buttonRef}
            type="button"
            aria-label={buttonLabel}
            className={buttonClassName}
            onKeyDown={(event) => {
              // Radix opens on Enter, Space and ArrowDown; a menu button also opens on ArrowUp, at the end.
              if (event.key === "ArrowUp" && !open) {
                event.preventDefault();
                entryRef.current = "last";
                setMenuOpen(true);
              }
            }}
          >
            {buttonContent}
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            ref={contentRef}
            // Named by what it is, not by its button ("Account menu" would read "Account menu menu").
            aria-label={label}
            aria-labelledby={undefined}
            loop
            side="bottom"
            align={align === "right" ? "end" : "start"}
            sideOffset={6}
            collisionPadding={8}
            onInteractOutside={() => {
              pressedOutside.current = true;
            }}
            // Focus is returned in `setMenuOpen`, never by Radix's own close handling.
            onCloseAutoFocus={(event) => event.preventDefault()}
            // Only the menu reacts to Escape: nothing behind it (a rename field, the preview sheet) does.
            onEscapeKeyDown={(event) => event.stopPropagation()}
            className="z-40 flex w-[min(15rem,calc(100vw-2rem))] flex-col rounded-md border border-line-3 bg-surface p-1"
          >
            <MenuContext.Provider value={api}>{children}</MenuContext.Provider>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  );
}
