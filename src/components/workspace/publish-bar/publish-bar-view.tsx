"use client";

import { useId, type ReactNode } from "react";
import { ItemChip } from "./item-chip";
import { NOT_LIVE_NOTE, changeCount, changeCountLabel, type PublishRow } from "./rows";

/** The secondary button of DESIGN.md: white, 1px `--hl-line-3`, at least 44px tall, 16px side padding. */
export const ROW_BUTTON =
  "inline-flex min-h-11 shrink-0 cursor-pointer items-center justify-center rounded-md border border-line-3 bg-surface px-4 text-sm font-semibold whitespace-nowrap text-ink disabled:cursor-not-allowed disabled:opacity-50 aria-busy:cursor-progress";
/** The primary button: charcoal, the only one in the bar. */
export const PRIMARY_BUTTON =
  "inline-flex min-h-11 w-full cursor-pointer items-center justify-center rounded-md bg-ink px-4 text-sm font-semibold whitespace-nowrap text-surface disabled:cursor-not-allowed disabled:opacity-50 aria-busy:cursor-progress hl:w-auto";

export interface PublishBarViewProps {
  rows: readonly PublishRow[];
  /** The site was published at least once. Until then only Publish all changes is on. */
  siteLive: boolean;
  /** The row key being published, "all", or null. Everything else is off while one runs. */
  publishingItem: string | null;
  /** Why publishing is off altogether (a suspended account, a link to a blocked site), or null. */
  disabledReason: string | null;
  onPublishDesign: () => void;
  onPublishPage: (key: string) => void;
  onPublishAll: () => void;
  onRevisions: (row: PublishRow) => void;
  /** A slot above the rows (a refusal the bar itself shows). */
  notice?: ReactNode;
}

/**
 * The content of the publish bar (M15-10), with no state of its own: the rows (Design, Home, each
 * page) with their chip and their one publish button, and the footer with Publish all changes and
 * the count. Every row is at least 56px tall and every button at least 44px. The buttons are named
 * exactly "Publish design", "Publish page", "Revisions" and "Publish all changes"; a page's two
 * buttons are described by its title, so a screen reader says which page.
 *
 * A row's button is off when the row is live (nothing to publish), while anything is publishing
 * (the running one is `aria-busy`), when publishing is off altogether, and, until the site was
 * published once, on every row: only Publish all changes can put a site online.
 */
export function PublishBarView(props: PublishBarViewProps) {
  const { rows, siteLive, publishingItem, disabledReason, notice } = props;
  const busy = publishingItem !== null;
  const blocked = disabledReason !== null;
  const count = changeCount(rows);
  const titleBase = useId();

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {notice}
      {siteLive ? null : (
        <p
          data-testid="publish-bar-not-live"
          className="m-0 border-b border-line bg-page px-4 py-3 text-sm leading-relaxed text-ink-2"
        >
          {NOT_LIVE_NOTE}
        </p>
      )}
      <ul className="m-0 flex min-h-0 list-none flex-col overflow-y-auto overscroll-contain p-0">
        {rows.map((row) => {
          const running = publishingItem === row.key;
          const label = row.kind === "design" ? "Publish design" : "Publish page";
          return (
            <li
              key={row.key}
              data-testid={`publish-row-${row.key}`}
              data-state={row.state}
              className="flex min-h-14 shrink-0 flex-col gap-2 border-b border-line px-4 py-2.5"
            >
              <div className="flex min-w-0 items-center justify-between gap-3">
                <div className="min-w-0">
                  {/* Cut with an ellipsis when long: the title attribute shows it in full on hover. */}
                  <p
                    id={`${titleBase}-${row.key}`}
                    title={row.title}
                    className="m-0 truncate text-sm font-semibold text-ink"
                  >
                    {row.title}
                  </p>
                  <p
                    title={row.detail}
                    className={`m-0 truncate text-xs text-text-2 ${row.kind === "page" ? "font-mono" : ""}`}
                  >
                    {row.detail}
                  </p>
                </div>
                <ItemChip state={row.state} />
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                {row.kind === "page" ? (
                  <button
                    type="button"
                    aria-describedby={`${titleBase}-${row.key}`}
                    onClick={() => props.onRevisions(row)}
                    disabled={busy}
                    className={ROW_BUTTON}
                  >
                    Revisions
                  </button>
                ) : null}
                <button
                  type="button"
                  aria-describedby={`${titleBase}-${row.key}`}
                  onClick={() =>
                    row.kind === "design" ? props.onPublishDesign() : props.onPublishPage(row.key)
                  }
                  disabled={busy || blocked || !siteLive || row.state === "live"}
                  aria-busy={running}
                  title={disabledReason ?? undefined}
                  className={ROW_BUTTON}
                >
                  {label}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      <div className="flex flex-col gap-2 px-4 py-3 hl:flex-row-reverse hl:items-center hl:justify-between">
        <button
          type="button"
          onClick={props.onPublishAll}
          disabled={busy || blocked || (siteLive && count === 0)}
          aria-busy={publishingItem === "all"}
          title={disabledReason ?? undefined}
          className={PRIMARY_BUTTON}
        >
          Publish all changes
        </button>
        <p
          data-testid="publish-bar-count"
          aria-live="polite"
          className="m-0 text-center font-mono text-xs text-text-2 hl:text-left"
        >
          {changeCountLabel(count)}
        </p>
      </div>
    </div>
  );
}
