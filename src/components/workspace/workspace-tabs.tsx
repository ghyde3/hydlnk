"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, type KeyboardEvent } from "react";
import { cn } from "@/lib/cn";
import {
  WORKSPACE_PANEL_ID,
  WORKSPACE_TABS,
  workspaceTabId,
  type WorkspaceTab,
} from "./workspace-context";

/**
 * The 'Workspace' tablist (M7-02): Edit, Design and Share as three real links (a middle click opens
 * one in a new browser tab), in the segmented-control look of the app (a #EFEDE9 track, the
 * selected tab white on a ring). A WAI-ARIA tabs widget over routes: exactly one tab is selected
 * (`aria-selected`), only the selected one is in the tab order, ArrowLeft and ArrowRight move and
 * wrap, Home and End jump, every move selects and navigates (a soft navigation: the layout, the
 * toolbar and the draft stay), and focus stays on the tab that was moved to. Every tab controls
 * the one tab panel, `WORKSPACE_PANEL_ID`, which the shell renders with `aria-labelledby` set to
 * the selected tab's id.
 *
 * The toolbar (M7-05) mounts this: in its 56px row from 1280px up and under the pinned phone row
 * below. `className` sizes the track (`w-full` on a phone).
 */
export function WorkspaceTabs({
  active,
  className = "",
}: {
  active: WorkspaceTab;
  className?: string;
}) {
  const router = useRouter();
  const refs = useRef<Partial<Record<WorkspaceTab, HTMLAnchorElement | null>>>({});

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    const index = WORKSPACE_TABS.findIndex((tab) => tab.id === active);
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % WORKSPACE_TABS.length;
    else if (event.key === "ArrowLeft")
      next = (index - 1 + WORKSPACE_TABS.length) % WORKSPACE_TABS.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = WORKSPACE_TABS.length - 1;
    else return;
    event.preventDefault();
    const target = WORKSPACE_TABS[next]!;
    if (target.id !== active) router.push(target.href);
    refs.current[target.id]?.focus();
  }

  return (
    <div
      role="tablist"
      aria-label="Workspace"
      data-testid="workspace-tabs"
      onKeyDown={onKeyDown}
      className={cn("flex gap-0.5 rounded-md border border-line bg-track p-[3px]", className)}
    >
      {WORKSPACE_TABS.map((tab) => {
        const selected = tab.id === active;
        return (
          <Link
            key={tab.id}
            ref={(element) => {
              refs.current[tab.id] = element;
            }}
            href={tab.href}
            role="tab"
            id={workspaceTabId(tab.id)}
            aria-selected={selected}
            aria-controls={WORKSPACE_PANEL_ID}
            tabIndex={selected ? 0 : -1}
            data-workspace-tab={tab.id}
            className={cn(
              "inline-flex min-h-11 min-w-0 flex-1 items-center justify-center rounded-sm px-3.5 text-sm font-semibold no-underline",
              selected ? "bg-surface text-ink ring-1 ring-line-2" : "bg-transparent text-text-2",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
