"use client";

import { useRef, type KeyboardEvent } from "react";

export type DesignView = "tokens" | "preview";

const TABS: readonly { id: DesignView; label: string }[] = [
  { id: "tokens", label: "Tokens" },
  { id: "preview", label: "Preview" },
];

export const designTabId = (view: DesignView) => `design-tab-${view}`;
export const designPanelId = (view: DesignView) => `design-panel-${view}`;

/**
 * The phone's "Tokens | Preview" segmented control (M3-06), a WAI-ARIA tabs widget: one tab in the
 * tab order, ArrowLeft/ArrowRight (wrapping), Home and End move and select. Same look as the
 * editor's "Blocks | Preview": 6px track on --hl-track, white selected item on a 1px ring, 44px
 * tall, hidden from 760px up.
 */
export function DesignTabs({
  view,
  onChange,
}: {
  view: DesignView;
  onChange: (view: DesignView) => void;
}) {
  const refs = useRef<Record<DesignView, HTMLButtonElement | null>>({
    tokens: null,
    preview: null,
  });

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    const index = TABS.findIndex((tab) => tab.id === view);
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % TABS.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + TABS.length) % TABS.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = TABS.length - 1;
    else if (event.key === "Enter") {
      // Selection already follows focus; Enter re-selects the focused tab.
      const focused = TABS.find((tab) => refs.current[tab.id] === document.activeElement);
      if (focused) {
        event.preventDefault();
        onChange(focused.id);
      }
      return;
    } else return;
    event.preventDefault();
    const target = TABS[next]!.id;
    onChange(target);
    refs.current[target]?.focus();
  }

  return (
    <div
      role="tablist"
      aria-label="Design view"
      onKeyDown={onKeyDown}
      className="mx-4 mt-3 flex gap-0.5 rounded-md border border-line bg-track p-[3px] hl:hidden"
    >
      {TABS.map((tab) => {
        const selected = tab.id === view;
        return (
          <button
            key={tab.id}
            ref={(element) => {
              refs.current[tab.id] = element;
            }}
            type="button"
            role="tab"
            id={designTabId(tab.id)}
            aria-selected={selected}
            aria-controls={designPanelId(tab.id)}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab.id)}
            className={`min-h-11 flex-1 rounded-sm text-sm font-semibold ${
              selected ? "bg-surface text-ink ring-1 ring-line-2" : "bg-transparent text-text-2"
            }`}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
