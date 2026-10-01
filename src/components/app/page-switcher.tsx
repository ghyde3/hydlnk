"use client";

import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useTransition,
  type KeyboardEvent,
} from "react";
import { selectPage } from "@/lib/pages/actions";
import { handleAddress } from "@/lib/pages/plans";
import { CheckIcon, ChevronDownIcon } from "./icons";

export interface SwitcherPage {
  id: string;
  handle: string;
  published: boolean;
}

/** #6FBF8E once the page has been published, #A9A49B before (M1-18). */
function StatusDot({ published }: { published: boolean }) {
  return (
    <span
      aria-hidden="true"
      data-published={published}
      className="inline-block size-[7px] shrink-0 rounded-full"
      style={{ backgroundColor: published ? "#6fbf8e" : "#a9a49b" }}
    />
  );
}

/**
 * Page switcher menu button. Two placements share it: the sidebar's "Page" section (variant
 * "sidebar": full-width, the address wraps so a long handle shows in full) and the phone top-bar
 * chip (variant "chip": the address truncates). Choosing another page stores its id in the `hl-page`
 * cookie (server action) and refreshes the screen; every page-scoped screen reads that cookie.
 *
 * Keyboard: the button opens the menu (Enter, Space, ArrowDown, ArrowUp); inside, arrows, Home and
 * End move between items, Escape closes and returns focus to the button, Tab leaves, and Enter on
 * the current item just closes.
 */
export function PageSwitcher({
  pages,
  currentId,
  variant,
}: {
  pages: SwitcherPage[];
  currentId: string;
  variant: "sidebar" | "chip";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [, startTransition] = useTransition();
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const menuId = useId();

  const current = pages.find((page) => page.id === currentId) ?? pages[0];
  const address = handleAddress(current?.handle ?? "");

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) buttonRef.current?.focus();
  }, []);

  // Focus the current item (or the first) when the menu opens.
  useEffect(() => {
    if (!open) return;
    const index = Math.max(
      0,
      pages.findIndex((page) => page.id === currentId),
    );
    itemRefs.current[index]?.focus();
  }, [open, pages, currentId]);

  // Outside click closes the menu. Focus goes back to the button unless the click landed on
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

  const moveFocus = (from: number, delta: number | "first" | "last") => {
    const count = pages.length;
    const next =
      delta === "first" ? 0 : delta === "last" ? count - 1 : (from + delta + count) % count;
    itemRefs.current[next]?.focus();
  };

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const from = itemRefs.current.findIndex((item) => item === document.activeElement);
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        moveFocus(from, 1);
        break;
      case "ArrowUp":
        event.preventDefault();
        moveFocus(from, -1);
        break;
      case "Home":
        event.preventDefault();
        moveFocus(from, "first");
        break;
      case "End":
        event.preventDefault();
        moveFocus(from, "last");
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

  const choose = (page: SwitcherPage) => {
    close(true);
    if (page.id === currentId) return;
    startTransition(async () => {
      await selectPage(page.id);
      router.refresh();
    });
  };

  const isChip = variant === "chip";

  return (
    <div
      ref={rootRef}
      className={isChip ? "relative min-w-0" : "relative"}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.preventDefault();
          close(true);
        }
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        aria-label={`Switch page, current: ${address}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (!open && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
            event.preventDefault();
            setOpen(true);
          }
        }}
        className={
          isChip
            ? "flex min-h-11 max-w-full items-center gap-2 rounded-md border border-ink-line bg-ink-raised pr-2.5 pl-3 text-left font-mono text-xs text-on-ink"
            : "flex min-h-11 w-full items-center gap-2.5 rounded-md border border-ink-line bg-ink-raised px-2.5 py-2 text-left font-mono text-[13px] text-on-ink"
        }
      >
        <StatusDot published={current?.published ?? false} />
        <span
          className={isChip ? "min-w-0 flex-1 truncate" : "min-w-0 flex-1 [overflow-wrap:anywhere]"}
        >
          {address}
        </span>
        <span className="text-on-ink-muted">
          <ChevronDownIcon size={isChip ? 14 : 15} />
        </span>
      </button>

      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label="Pages"
          onKeyDown={onMenuKeyDown}
          className={`absolute top-full z-30 mt-1.5 flex flex-col rounded-md border border-ink-line bg-ink-raised p-1 text-on-ink ${
            isChip ? "right-0 w-[min(18rem,calc(100vw-2rem))]" : "inset-x-0"
          }`}
        >
          {pages.map((page, index) => {
            const checked = page.id === currentId;
            return (
              <button
                key={page.id}
                ref={(node) => {
                  itemRefs.current[index] = node;
                }}
                type="button"
                role="menuitemradio"
                aria-checked={checked}
                tabIndex={-1}
                onClick={() => choose(page)}
                className="flex min-h-11 w-full items-center gap-2.5 rounded-sm px-2.5 py-2 text-left font-mono text-[13px] hover:bg-ink-raised-2 focus-visible:bg-ink-raised-2"
              >
                <StatusDot published={page.published} />
                <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                  {handleAddress(page.handle)}
                </span>
                {checked && (
                  <span className="text-brass">
                    <CheckIcon size={14} />
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
