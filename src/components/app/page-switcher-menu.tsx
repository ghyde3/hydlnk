"use client";

import { Check, ChevronDown, LogOut, Plus, Users } from "lucide-react";
import Link from "next/link";
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
import { leaveSite } from "@/lib/team/actions";
import { ROLE_LABELS, type MemberRole } from "@/lib/team/constants";
import { handleAddress } from "@/lib/pages/plans";
import { Icon } from "./icon";

export interface SwitcherPage {
  id: string;
  handle: string;
  /** The page's private name (M6-13): the first line of its menu item, the address under it. */
  name: string;
  published: boolean;
}

/** A site shared with the user (Wave F): listed with its owner; a paused one is not selectable. */
export interface SwitcherShared extends SwitcherPage {
  ownerEmail: string | null;
  role: MemberRole;
  active: boolean;
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
 * Page switcher menu button (the client half; "./page-switcher" is the server wrapper that reads
 * the plan). Two placements share it: the sidebar's "Page" section (variant
 * "sidebar": full-width, the address wraps so a long handle shows in full) and the phone top-bar
 * chip (variant "chip": the address truncates). Choosing another page stores its id in the `hl-page`
 * cookie (server action) and refreshes the screen; every page-scoped screen reads that cookie.
 *
 * Below the pages the menu offers "New page" (M4-18), a link to /pages/new. At the plan's page limit
 * it is disabled instead (aria-disabled, so it stays readable and focusable, and a click sends
 * nothing anywhere): the plan-specific message sits under it with a "See plans" link to
 * /settings#plans. `limitMessage` is that message, or null while the account can add a page; the
 * server wrapper decides it from the account's plan, and the server enforces the limit regardless.
 *
 * Keyboard: the button opens the menu (Enter, Space, ArrowDown, ArrowUp); inside, arrows, Home and
 * End move between all items (pages, then New page, then See plans), Escape closes and returns
 * focus to the button, Tab leaves, and Enter on the current item just closes.
 */
export function PageSwitcherMenu({
  pages,
  shared = [],
  currentId,
  variant,
  limitMessage,
  suspended = false,
}: {
  pages: SwitcherPage[];
  /** Sites shared with the user (Wave F, M19-10), paused ones included. */
  shared?: SwitcherShared[];
  currentId: string;
  variant: "sidebar" | "chip";
  limitMessage: string | null;
  /** The account is suspended (M5-09): `limitMessage` is the reason, and there is no plans link. */
  suspended?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [, startTransition] = useTransition();
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLElement | null)[]>([]);
  const menuId = useId();

  const sharedCurrent = shared.find((site) => site.id === currentId) ?? null;
  const current = pages.find((page) => page.id === currentId) ?? sharedCurrent ?? pages[0];
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
      [...pages, ...shared].findIndex((page) => page.id === currentId),
    );
    itemRefs.current[index]?.focus();
  }, [open, pages, shared, currentId]);

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

  // Own sites, shared sites, then Members (an own site) or Leave (a shared one), then "New site",
  // then (at the limit) "See plans".
  const afterSites = pages.length + shared.length;
  const itemCount = afterSites + 1 + (limitMessage === null || suspended ? 1 : 2);

  const moveFocus = (from: number, delta: number | "first" | "last") => {
    const count = itemCount;
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

  // Leaving the current shared site (M19-10): the gate then lands on the user's own site or /claim.
  const leave = () => {
    if (!sharedCurrent) return;
    close(true);
    if (
      !window.confirm(
        `Leave ${handleAddress(sharedCurrent.handle)}? You’ll need a new invite to come back.`,
      )
    )
      return;
    startTransition(async () => {
      await leaveSite(sharedCurrent.id);
      router.push("/editor");
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
        aria-label={`Switch site, current: ${address}`}
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
          <Icon icon={ChevronDown} size={isChip ? 14 : 15} />
        </span>
      </button>

      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label="Sites"
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
                <span className="flex min-w-0 flex-1 flex-col gap-px">
                  <span data-page-name="" className="truncate font-sans text-[13px] font-semibold">
                    {page.name}
                  </span>
                  <span className="text-[11px] text-on-ink-muted [overflow-wrap:anywhere]">
                    {handleAddress(page.handle)}
                  </span>
                </span>
                {checked && (
                  <span className="text-brass">
                    <Icon icon={Check} size={14} />
                  </span>
                )}
              </button>
            );
          })}
          {shared.length > 0 ? (
            <>
              <div className="my-1 border-t border-ink-line" role="separator" />
              <p className="px-2.5 pt-1 pb-0.5 font-mono text-[11px] tracking-[0.08em] text-on-ink-muted uppercase">
                Shared with you
              </p>
              {shared.map((site, offset) => {
                const index = pages.length + offset;
                const checked = site.id === currentId;
                return (
                  <button
                    key={site.id}
                    ref={(node) => {
                      itemRefs.current[index] = node;
                    }}
                    type="button"
                    role="menuitemradio"
                    aria-checked={checked}
                    aria-disabled={site.active ? undefined : "true"}
                    tabIndex={-1}
                    data-shared-site=""
                    onClick={(event) => (site.active ? choose(site) : event.preventDefault())}
                    className={`flex min-h-11 w-full items-center gap-2.5 rounded-sm px-2.5 py-2 text-left font-mono text-[13px] hover:bg-ink-raised-2 focus-visible:bg-ink-raised-2 ${
                      site.active ? "" : "cursor-not-allowed text-on-ink-muted"
                    }`}
                  >
                    <StatusDot published={site.published} />
                    <span className="flex min-w-0 flex-1 flex-col gap-px">
                      <span className="truncate font-sans text-[13px] font-semibold">
                        {site.name}
                      </span>
                      <span className="text-[11px] text-on-ink-muted [overflow-wrap:anywhere]">
                        {handleAddress(site.handle)} · {ROLE_LABELS[site.role]}
                        {site.active ? "" : " · Paused"}
                      </span>
                      {site.ownerEmail ? (
                        <span className="text-[11px] text-on-ink-muted [overflow-wrap:anywhere]">
                          Owner: {site.ownerEmail}
                        </span>
                      ) : null}
                    </span>
                    {checked && (
                      <span className="text-brass">
                        <Icon icon={Check} size={14} />
                      </span>
                    )}
                  </button>
                );
              })}
            </>
          ) : null}
          <div className="my-1 border-t border-ink-line" role="separator" />
          {sharedCurrent ? (
            <button
              ref={(node) => {
                itemRefs.current[afterSites] = node;
              }}
              type="button"
              role="menuitem"
              tabIndex={-1}
              onClick={leave}
              className="flex min-h-11 w-full items-center gap-2.5 rounded-sm px-2.5 py-2 text-left text-[13px] font-semibold text-on-ink hover:bg-ink-raised-2 focus-visible:bg-ink-raised-2"
            >
              <Icon icon={LogOut} size={15} />
              Leave this site
            </button>
          ) : (
            <Link
              ref={(node) => {
                itemRefs.current[afterSites] = node;
              }}
              href="/members"
              role="menuitem"
              tabIndex={-1}
              onClick={() => close(false)}
              className="flex min-h-11 w-full items-center gap-2.5 rounded-sm px-2.5 py-2 text-left text-[13px] font-semibold text-on-ink no-underline hover:bg-ink-raised-2 focus-visible:bg-ink-raised-2"
            >
              <Icon icon={Users} size={15} />
              Members
            </Link>
          )}
          {limitMessage === null ? (
            <Link
              ref={(node) => {
                itemRefs.current[afterSites + 1] = node;
              }}
              href="/pages/new"
              role="menuitem"
              tabIndex={-1}
              onClick={() => close(false)}
              className="flex min-h-11 w-full items-center gap-2.5 rounded-sm px-2.5 py-2 text-left text-[13px] font-semibold text-on-ink no-underline hover:bg-ink-raised-2 focus-visible:bg-ink-raised-2"
            >
              <Icon icon={Plus} size={15} />
              New site
            </Link>
          ) : (
            <>
              <button
                ref={(node) => {
                  itemRefs.current[afterSites + 1] = node;
                }}
                type="button"
                role="menuitem"
                aria-disabled="true"
                aria-describedby={`${menuId}-limit`}
                tabIndex={-1}
                // Disabled but still focusable and readable: it does nothing, and sends nothing.
                onClick={(event) => event.preventDefault()}
                className="flex min-h-11 w-full cursor-not-allowed items-center gap-2.5 rounded-sm px-2.5 py-2 text-left text-[13px] font-semibold text-on-ink-muted"
              >
                <Icon icon={Plus} size={15} />
                New site
              </button>
              <p
                id={`${menuId}-limit`}
                className="px-2.5 pb-1 text-xs leading-snug text-on-ink-muted-2"
              >
                {limitMessage}
              </p>
              {suspended ? null : (
                <Link
                  ref={(node) => {
                    itemRefs.current[afterSites + 2] = node;
                  }}
                  href="/settings#plans"
                  role="menuitem"
                  tabIndex={-1}
                  onClick={() => close(false)}
                  className="flex min-h-11 w-full items-center rounded-sm px-2.5 py-2 text-left text-[13px] font-semibold text-ink-link no-underline hover:bg-ink-raised-2 focus-visible:bg-ink-raised-2"
                >
                  See plans
                </Link>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
