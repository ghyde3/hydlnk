"use client";

import Link from "next/link";
import { useEffect, useId, useRef } from "react";
import type { HistoryRow } from "@/lib/versions/load";
import { RESTORING, UNPUBLISHED_WARNING, confirmQuestion } from "@/lib/versions/messages";
import { LiveChip } from "./live-chip";
import { LocalTime } from "./local-time";

/** What a row shows under itself after a restore was tried, undone or refused. */
export type RowOutcome =
  | { kind: "failed"; message: string; retry: boolean }
  | { kind: "done"; message: string; canUndo: boolean; undoing: boolean }
  | { kind: "undone"; message: string }
  | { kind: "undo-failed"; message: string };

const BUTTON =
  "inline-flex min-h-11 items-center justify-center rounded-md px-4 text-sm font-semibold disabled:cursor-progress disabled:opacity-70";
const SECONDARY = `${BUTTON} border border-line-3 bg-surface text-ink`;
const PRIMARY = `${BUTTON} bg-ink text-surface`;

/**
 * One version in the list (M6-50): "Version 12", the publish time in the viewer's time zone, a "Live
 * now" chip on the one that is the page's current document, and Preview and Restore. Restore opens a
 * confirmation inline, in the row (so the preview beside the list does not move): it says what will
 * be replaced and what will not change, and asks. Escape and "Keep my draft" close it and put focus
 * back on Restore. A restore in flight, one that failed and one that worked each leave their line
 * under the row.
 */
export function VersionRow({
  row,
  selected,
  confirming,
  restoring,
  hasUnpublished,
  outcome,
  onPreview,
  onAskRestore,
  onCancelRestore,
  onConfirmRestore,
  onRetry,
  onUndo,
}: {
  row: HistoryRow;
  selected: boolean;
  confirming: boolean;
  /** This row's restore is running. */
  restoring: boolean;
  /** The draft's publish form differs from the live document: the confirmation says it will be replaced. */
  hasUnpublished: boolean;
  outcome: RowOutcome | null;
  onPreview: () => void;
  onAskRestore: () => void;
  onCancelRestore: () => void;
  onConfirmRestore: () => void;
  onRetry: () => void;
  onUndo: () => void;
}) {
  const restoreButton = useRef<HTMLButtonElement>(null);
  const confirmBox = useRef<HTMLDivElement>(null);
  const questionId = useId();
  const n = row.versionNo;

  function close(): void {
    onCancelRestore();
    restoreButton.current?.focus();
  }

  // On a phone the confirmation can open below the fold (the sheet's "Restore this version" opens it).
  useEffect(() => {
    if (confirming) confirmBox.current?.scrollIntoView?.({ block: "nearest" });
  }, [confirming]);

  // Escape closes the confirmation wherever focus is, unless the restore is already running.
  useEffect(() => {
    if (!confirming || restoring) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onCancelRestore();
      restoreButton.current?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [confirming, restoring, onCancelRestore]);

  return (
    <li
      data-testid="version-row"
      data-version-no={n}
      data-version-id={row.id}
      className={`rounded-md border bg-surface ${selected ? "border-ink" : "border-line"}`}
    >
      <div className="flex flex-col gap-3 p-3.5 hl:flex-row hl:items-center hl:justify-between hl:p-4">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-sm font-semibold">Version {n}</span>
          <LocalTime iso={row.publishedAt} className="font-mono text-xs text-text-2" />
          {row.live ? <LiveChip /> : null}
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            aria-label={`Preview version ${n}`}
            aria-pressed={selected}
            onClick={onPreview}
            className={`${SECONDARY} flex-1 hl:flex-none`}
          >
            Preview
          </button>
          <button
            ref={restoreButton}
            type="button"
            aria-label={`Restore version ${n}`}
            aria-expanded={confirming}
            onClick={onAskRestore}
            className={`${SECONDARY} flex-1 hl:flex-none`}
          >
            Restore
          </button>
        </div>
      </div>

      {confirming ? (
        <div
          ref={confirmBox}
          role="group"
          aria-labelledby={questionId}
          data-testid="restore-confirm"
          className="flex flex-col gap-3 border-t border-line bg-page p-3.5 hl:p-4"
        >
          <div className="flex flex-col gap-1.5">
            <p id={questionId} className="m-0 text-sm leading-relaxed">
              {confirmQuestion(n)}
            </p>
            {hasUnpublished ? (
              <p
                data-testid="restore-unpublished"
                className="m-0 text-sm leading-relaxed font-semibold text-brass-soft-text"
              >
                {UNPUBLISHED_WARNING}
              </p>
            ) : null}
          </div>
          <div className="flex flex-col gap-2 hl:flex-row">
            <button
              type="button"
              onClick={onConfirmRestore}
              disabled={restoring}
              aria-busy={restoring}
              className={`${PRIMARY} w-full hl:w-auto`}
            >
              {restoring ? RESTORING : `Restore version ${n}`}
            </button>
            <button
              type="button"
              onClick={close}
              disabled={restoring}
              autoFocus
              className={`${SECONDARY} w-full hl:w-auto`}
            >
              Keep my draft
            </button>
          </div>
        </div>
      ) : null}

      {outcome ? <Outcome outcome={outcome} onRetry={onRetry} onUndo={onUndo} /> : null}
    </li>
  );
}

function Outcome({
  outcome,
  onRetry,
  onUndo,
}: {
  outcome: RowOutcome;
  onRetry: () => void;
  onUndo: () => void;
}) {
  if (outcome.kind === "failed") {
    return (
      <div
        role="alert"
        data-testid="restore-failed"
        className="flex flex-col items-start gap-2 border-t border-line p-3.5 hl:p-4"
      >
        <p className="m-0 text-sm leading-relaxed text-bad">{outcome.message}</p>
        {outcome.retry ? (
          <button type="button" onClick={onRetry} className={SECONDARY}>
            Retry
          </button>
        ) : null}
      </div>
    );
  }
  if (outcome.kind === "done") {
    return (
      <div
        role="status"
        data-testid="restore-done"
        className="flex flex-col gap-2 border-t border-line p-3.5 hl:p-4"
      >
        <p className="m-0 text-sm leading-relaxed">{outcome.message}</p>
        <div className="flex flex-col gap-2 hl:flex-row">
          <Link href="/editor" className={`${PRIMARY} w-full no-underline hl:w-auto`}>
            Open editor
          </Link>
          {outcome.canUndo ? (
            <button
              type="button"
              onClick={onUndo}
              disabled={outcome.undoing}
              aria-busy={outcome.undoing}
              className={`${SECONDARY} w-full hl:w-auto`}
            >
              Undo
            </button>
          ) : null}
        </div>
      </div>
    );
  }
  return (
    <div
      role={outcome.kind === "undone" ? "status" : "alert"}
      data-testid={outcome.kind === "undone" ? "restore-undone" : "undo-failed"}
      className="border-t border-line p-3.5 hl:p-4"
    >
      <p className={`m-0 text-sm leading-relaxed ${outcome.kind === "undone" ? "" : "text-bad"}`}>
        {outcome.message}
      </p>
    </div>
  );
}
