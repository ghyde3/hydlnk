"use client";

import Link from "next/link";
import { useSelectedLayoutSegment } from "next/navigation";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { signOut } from "@/lib/auth/actions";
import { initialsOf } from "@/lib/pages/initials";
import { navKeyForSegment } from "./nav-items";

const ITEM =
  "flex min-h-11 w-full cursor-pointer items-center rounded-sm px-2.5 py-2 text-left text-[13px] font-semibold text-on-ink no-underline hover:bg-ink-raised-2 focus-visible:bg-ink-raised-2";

/**
 * The sidebar's user block as the account menu (M7-01): the 30px initials circle with the name over
 * the email (M1-18), as one button (`aria-haspopup="menu"`, the accessible name "Account menu") that
 * opens a menu above it with two items, "Settings & billing" (a link to /settings) and "Sign out".
 *
 * Sign out is a `<button type="submit">` inside a `<form>` that calls the `signOut` Server Action:
 * a POST, never a link, so nothing a GET can reach logs anyone out, and the cross-site and
 * no-JavaScript behavior of M1-21 is unchanged. The name and email come from the verified session
 * on the server (props), drawn as React text. Opening and closing the menu is view state: it sends
 * no request.
 *
 * Keyboard: Enter, Space, ArrowUp and ArrowDown open it (ArrowUp lands on the last item, the others
 * on the first); inside, the arrows wrap, Home and End jump, Escape closes and returns focus to the
 * button, Tab leaves and closes, and a click outside closes. On /settings the block shows the
 * selected style and "Settings & billing" carries `aria-current="page"`.
 */
export function AccountMenu({ email }: { email: string }) {
  const name = email.split("@")[0] ?? email;
  const onSettings = navKeyForSegment(useSelectedLayoutSegment()) === "settings";
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLElement | null)[]>([]);
  const firstOrLast = useRef<"first" | "last">("first");
  const menuId = useId();

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) buttonRef.current?.focus();
  }, []);

  // Focus the first item (or the last, when it was opened with ArrowUp).
  useEffect(() => {
    if (!open) return;
    const items = itemRefs.current.filter((item): item is HTMLElement => item !== null);
    (firstOrLast.current === "last" ? items[items.length - 1] : items[0])?.focus();
  }, [open]);

  // A click outside closes it; focus goes back to the button unless the click landed on something
  // else focusable.
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

  const move = (delta: number | "first" | "last") => {
    const items = itemRefs.current.filter((item): item is HTMLElement => item !== null);
    const from = items.findIndex((item) => item === document.activeElement);
    const next =
      delta === "first"
        ? 0
        : delta === "last"
          ? items.length - 1
          : (from + delta + items.length) % items.length;
    items[next]?.focus();
  };

  const onMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        move(1);
        break;
      case "ArrowUp":
        event.preventDefault();
        move(-1);
        break;
      case "Home":
        event.preventDefault();
        move("first");
        break;
      case "End":
        event.preventDefault();
        move("last");
        break;
      case "Escape":
        event.preventDefault();
        event.stopPropagation();
        close(true);
        break;
      case "Tab":
        setOpen(false);
        break;
    }
  };

  return (
    <div ref={rootRef} className="relative">
      {open ? (
        <div
          id={menuId}
          role="menu"
          aria-label="Account"
          onKeyDown={onMenuKeyDown}
          className="absolute inset-x-0 bottom-full z-30 mb-1.5 flex flex-col rounded-md border border-ink-line bg-ink-raised p-1 text-on-ink"
        >
          <Link
            ref={(node) => {
              itemRefs.current[0] = node;
            }}
            href="/settings"
            role="menuitem"
            tabIndex={-1}
            aria-current={onSettings ? "page" : undefined}
            onClick={() => close(false)}
            onKeyDown={(event) => {
              // A link does not activate on Space on its own; a menu item does.
              if (event.key === " ") {
                event.preventDefault();
                event.currentTarget.click();
              }
            }}
            className={ITEM}
          >
            Settings &amp; billing
          </Link>
          <form action={signOut} className="m-0">
            <button
              ref={(node) => {
                itemRefs.current[1] = node;
              }}
              type="submit"
              role="menuitem"
              tabIndex={-1}
              className={ITEM}
            >
              Sign out
            </button>
          </form>
        </div>
      ) : null}
      <button
        ref={buttonRef}
        type="button"
        aria-label="Account menu"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        data-account-menu=""
        onClick={() => {
          firstOrLast.current = "first";
          setOpen((value) => !value);
        }}
        onKeyDown={(event) => {
          if (!open && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
            event.preventDefault();
            firstOrLast.current = event.key === "ArrowUp" ? "last" : "first";
            setOpen(true);
          }
        }}
        className={`flex min-h-11 w-full cursor-pointer items-center gap-2.5 rounded-md px-1 py-1 text-left hover:bg-ink-raised ${
          onSettings ? "bg-ink-raised-2" : "bg-transparent"
        }`}
      >
        <span
          aria-hidden="true"
          className="flex size-[30px] shrink-0 items-center justify-center rounded-full bg-ink-2 text-xs font-semibold text-on-ink"
        >
          {initialsOf(email)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] text-on-ink" title={name}>
            {name}
          </span>
          <span className="block truncate text-xs text-on-ink-muted" title={email}>
            {email}
          </span>
        </span>
      </button>
    </div>
  );
}
