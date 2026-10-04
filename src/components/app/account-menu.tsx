"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import Link from "next/link";
import { useSelectedLayoutSegment } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import { useMenuEntry } from "@/components/menu-entry";
import { signOut } from "@/lib/auth/actions";
import { initialsOf } from "@/lib/pages/initials";
import { navKeyForSegment } from "./nav-items";

const ITEM =
  "flex min-h-11 w-full cursor-pointer items-center rounded-sm px-2.5 py-2 text-left text-[13px] font-semibold text-on-ink no-underline hover:bg-ink-raised-2 focus-visible:bg-ink-raised-2 data-[highlighted]:bg-ink-raised-2";

/**
 * The sidebar's user block as the account menu (M7-01, M9-05): the 30px initials circle with the
 * name over the email (M1-18), as one button (`aria-haspopup="menu"`, the accessible name "Account
 * menu") that opens a menu above it with two items, "Settings & billing" (a link to /settings) and
 * "Sign out". The menu is `@radix-ui/react-dropdown-menu`, not modal, in a portal at the end of
 * `body`, as wide as the block, above it, flipped and shifted by Radix to stay inside the viewport.
 *
 * Sign out is a `<button type="submit">` inside a `<form>` that calls the `signOut` Server Action:
 * a POST, never a link, so nothing a GET can reach logs anyone out, and the cross-site and
 * no-JavaScript behavior of M1-21 is unchanged. Choosing it does not close the menu first (its
 * select is canceled): the form has to be in the page when the browser submits it, and the Server
 * Action leaves the page. The name and email come from the verified session on the server (props),
 * drawn as React text. Opening and closing the menu is view state: it sends no request.
 *
 * Keyboard: Enter, Space and ArrowDown open it on the first item, ArrowUp on the last; inside, the
 * arrows wrap, Home and End jump, a letter jumps to the item that starts with it, Escape closes and
 * returns focus to the button, Tab stays in the menu, and a press outside closes. On /settings the
 * block shows the selected style and "Settings & billing" carries `aria-current="page"`.
 */
export function AccountMenu({ email }: { email: string }) {
  const name = email.split("@")[0] ?? email;
  const onSettings = navKeyForSegment(useSelectedLayoutSegment()) === "settings";
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const pressedOutside = useRef(false);
  const { entry: entryRef, contentRef } = useMenuEntry();

  // Focus goes back to the button here, in the same turn the menu closes, rather than through
  // Radix's own close handling (a timeout): a key pressed right after Escape reaches the button.
  const setMenuOpen = useCallback((next: boolean) => {
    if (next) pressedOutside.current = false;
    else if (!pressedOutside.current) buttonRef.current?.focus({ preventScroll: true });
    setOpen(next);
  }, []);

  return (
    <div className="relative">
      <DropdownMenu.Root modal={false} open={open} onOpenChange={setMenuOpen}>
        <DropdownMenu.Trigger asChild>
          <button
            ref={buttonRef}
            type="button"
            aria-label="Account menu"
            data-account-menu=""
            onKeyDown={(event) => {
              // Radix opens on Enter, Space and ArrowDown; a menu button also opens on ArrowUp, at the end.
              if (event.key === "ArrowUp" && !open) {
                event.preventDefault();
                entryRef.current = "last";
                setMenuOpen(true);
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
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            ref={contentRef}
            aria-label="Account"
            aria-labelledby={undefined}
            loop
            side="top"
            align="start"
            sideOffset={6}
            collisionPadding={8}
            onInteractOutside={() => {
              pressedOutside.current = true;
            }}
            // Focus is returned in `setMenuOpen`, never by Radix's own close handling.
            onCloseAutoFocus={(event) => event.preventDefault()}
            // Only the menu reacts to Escape.
            onEscapeKeyDown={(event) => event.stopPropagation()}
            className="z-40 flex w-(--radix-dropdown-menu-trigger-width) flex-col rounded-md border border-ink-line bg-ink-raised p-1 text-on-ink"
          >
            <DropdownMenu.Item asChild>
              <Link
                href="/settings"
                aria-current={onSettings ? "page" : undefined}
                className={ITEM}
              >
                Settings &amp; billing
              </Link>
            </DropdownMenu.Item>
            <form action={signOut} className="m-0">
              <DropdownMenu.Item asChild onSelect={(event) => event.preventDefault()}>
                <button type="submit" className={ITEM}>
                  Sign out
                </button>
              </DropdownMenu.Item>
            </form>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  );
}
