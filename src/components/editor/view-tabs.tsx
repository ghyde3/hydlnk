"use client";

import { useRef, type KeyboardEvent } from "react";

export type EditorView = "blocks" | "preview";

const TABS: readonly { id: EditorView; label: string }[] = [
  { id: "blocks", label: "Blocks" },
  { id: "preview", label: "Preview" },
];

export const tabId = (view: EditorView) => `editor-tab-${view}`;
export const panelId = (view: EditorView) => `editor-panel-${view}`;

/**
 * The phone's "Blocks | Preview" segmented control (M2-06), a WAI-ARIA tabs widget: one tab in the
 * tab order, ArrowLeft/ArrowRight (wrapping), Home and End move and select. 6px track on #EFEDE9
 * with a 1px #E2DFD9 border; the selected item is white on a 1px #D9D6D0 ring; 44px tall.
 */
export function ViewTabs({
  view,
  onChange,
}: {
  view: EditorView;
  onChange: (view: EditorView) => void;
}) {
  const refs = useRef<Record<EditorView, HTMLButtonElement | null>>({
    blocks: null,
    preview: null,
  });

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    const index = TABS.findIndex((tab) => tab.id === view);
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % TABS.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + TABS.length) % TABS.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = TABS.length - 1;
    else return;
    event.preventDefault();
    const target = TABS[next]!.id;
    onChange(target);
    refs.current[target]?.focus();
  }

  return (
    <div
      role="tablist"
      aria-label="Editor view"
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
            id={tabId(tab.id)}
            aria-selected={selected}
            aria-controls={panelId(tab.id)}
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
