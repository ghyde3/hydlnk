"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useIsDesktop } from "@/components/editor/use-is-desktop";
import type { PageChrome } from "@/components/page/page-renderer";
import { readDraft, undoRestore, type SavedDraft } from "@/lib/versions/client";
import { loadVersionPreview, restorePageVersion } from "@/lib/versions/actions";
import type { HistoryRow } from "@/lib/versions/load";
import {
  EMPTY_MESSAGE,
  UNDONE,
  UNDO_FAILED,
  restoreFailureMessage,
  restoredMessage,
} from "@/lib/versions/messages";
import { LockedCard } from "./locked-card";
import { PreviewColumn } from "./preview-column";
import { PreviewSheet } from "./preview-sheet";
import type { PreviewState } from "./version-preview";
import { VersionRow, type RowOutcome } from "./version-row";

/** How long Undo stays on the success line. The spec asks for at least 10 seconds. */
const UNDO_WINDOW_MS = 30_000;

type Restore =
  | { phase: "idle" }
  | { phase: "confirming"; id: string }
  | { phase: "restoring"; id: string }
  | { phase: "finished"; id: string; outcome: RowOutcome };

/**
 * The version history list and its preview (M6-50). The list arrives from the server, read with the
 * user's own session; nothing else is requested until the person acts:
 *
 *   Preview  `loadVersionPreview` (a read): drawn in the sticky 330px column at 760px and up, in a
 *            full-screen sheet on a phone. Previewing writes nothing.
 *   Restore  an inline confirmation, then `restorePageVersion`. Just before it the screen reads the
 *            draft with its own session; Undo writes that draft back through the normal draft save,
 *            guarded by the rev the restore left behind. A second press while it runs sends nothing.
 *
 * Both actions re-check everything on the server (the page and version ids travel only as
 * arguments); a `plan_required` answer, a downgrade while the screen was open, turns the screen
 * into the locked card.
 */
export function HistoryScreen({
  pageId,
  versions,
  hasUnpublished: initialUnpublished,
  chrome,
}: {
  pageId: string;
  versions: HistoryRow[];
  hasUnpublished: boolean;
  chrome: PageChrome;
}) {
  const isDesktop = useIsDesktop();
  const [locked, setLocked] = useState(false);
  const [unpublished, setUnpublished] = useState(initialUnpublished);
  const [preview, setPreview] = useState<PreviewState>({ status: "idle" });
  const [sheetOpen, setSheetOpen] = useState(false);
  const [restore, setRestore] = useState<Restore>({ phase: "idle" });
  const previewSeq = useRef(0);
  /** A restore is on its way: a second press (double click) sends nothing. */
  const running = useRef(false);
  /** The draft read just before the restore, and what `hasUnpublished` was then: what Undo puts back. */
  const undoState = useRef<{ saved: SavedDraft; unpublished: boolean; id: string } | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (undoTimer.current) clearTimeout(undoTimer.current);
    },
    [],
  );

  const showPreview = useCallback(
    async (row: HistoryRow) => {
      const seq = ++previewSeq.current;
      setPreview({ status: "loading", version: row });
      try {
        const result = await loadVersionPreview(pageId, row.id);
        if (seq !== previewSeq.current) return;
        if (result.ok) {
          setPreview({
            status: "ready",
            version: row,
            doc: result.doc,
            missingImages: result.missingImages,
          });
        } else if (result.reason === "plan_required") {
          setLocked(true);
        } else {
          setPreview({ status: "failed", version: row });
        }
      } catch {
        if (seq === previewSeq.current) setPreview({ status: "failed", version: row });
      }
    },
    [pageId],
  );

  function openPreview(row: HistoryRow): void {
    if (!isDesktop) setSheetOpen(true);
    void showPreview(row);
  }

  const startRestore = useCallback(
    async (row: HistoryRow) => {
      if (running.current) return;
      running.current = true;
      setRestore({ phase: "restoring", id: row.id });
      if (undoTimer.current) clearTimeout(undoTimer.current);
      try {
        // The draft as it is now, read with the user's own session: what Undo will put back.
        const saved = await readDraft(pageId);
        const result = await restorePageVersion(pageId, row.id);
        if (result.ok) {
          undoState.current = saved ? { saved, unpublished, id: row.id } : null;
          // The draft is now this version: it differs from the live page unless this is the live one.
          setUnpublished(!row.live);
          const message = restoredMessage(result.restored, result.missingImages);
          setRestore({
            phase: "finished",
            id: row.id,
            outcome: { kind: "done", message, canUndo: saved !== null, undoing: false },
          });
          if (saved) {
            undoTimer.current = setTimeout(() => {
              setRestore((current) =>
                current.phase === "finished" && current.outcome.kind === "done"
                  ? { ...current, outcome: { ...current.outcome, canUndo: false } }
                  : current,
              );
            }, UNDO_WINDOW_MS);
          }
          return;
        }
        if (result.reason === "plan_required") {
          setLocked(true);
          return;
        }
        const failure = restoreFailureMessage(result);
        setRestore({
          phase: "finished",
          id: row.id,
          outcome: { kind: "failed", ...failure },
        });
      } catch {
        setRestore({
          phase: "finished",
          id: row.id,
          outcome: { kind: "failed", ...restoreFailureMessage({ ok: false, reason: "error" }) },
        });
      } finally {
        running.current = false;
      }
    },
    [pageId, unpublished],
  );

  async function undo(row: HistoryRow): Promise<void> {
    const kept = undoState.current;
    if (!kept || kept.id !== row.id || running.current) return;
    running.current = true;
    setRestore((current) =>
      current.phase === "finished" && current.outcome.kind === "done"
        ? { ...current, outcome: { ...current.outcome, undoing: true } }
        : current,
    );
    if (undoTimer.current) clearTimeout(undoTimer.current);
    try {
      const outcome = await undoRestore(pageId, kept.saved);
      if (outcome === "ok") {
        undoState.current = null;
        setUnpublished(kept.unpublished);
        setRestore({ phase: "finished", id: row.id, outcome: { kind: "undone", message: UNDONE } });
      } else {
        const message =
          outcome === "conflict"
            ? restoreFailureMessage({ ok: false, reason: "conflict" }).message
            : UNDO_FAILED;
        setRestore({ phase: "finished", id: row.id, outcome: { kind: "undo-failed", message } });
      }
    } catch {
      setRestore({
        phase: "finished",
        id: row.id,
        outcome: { kind: "undo-failed", message: UNDO_FAILED },
      });
    } finally {
      running.current = false;
    }
  }

  const cancelConfirm = useCallback(() => setRestore({ phase: "idle" }), []);

  function askRestore(row: HistoryRow): void {
    if (running.current) return;
    setRestore({ phase: "confirming", id: row.id });
  }

  if (locked) return <LockedCard />;
  if (versions.length === 0) {
    return (
      <p
        data-testid="history-empty"
        className="m-0 rounded-md border border-line bg-surface p-4 text-[15px] leading-relaxed text-text-2 hl:p-5"
      >
        {EMPTY_MESSAGE}
      </p>
    );
  }

  const previewed = preview.status === "idle" ? null : preview.version;
  const retryPreview = () => {
    if (previewed) void showPreview(previewed);
  };
  const sheetVersion = previewed;

  return (
    <div className="flex flex-col gap-4 hl:flex-row hl:items-start hl:gap-6">
      <ol
        aria-label="Published versions"
        data-testid="version-list"
        className="m-0 flex min-w-0 list-none flex-col gap-2 p-0 hl:w-[720px] hl:max-w-full"
      >
        {versions.map((row) => (
          <VersionRow
            key={row.id}
            row={row}
            selected={previewed?.id === row.id}
            confirming={
              (restore.phase === "confirming" || restore.phase === "restoring") &&
              restore.id === row.id
            }
            restoring={restore.phase === "restoring" && restore.id === row.id}
            hasUnpublished={unpublished}
            outcome={restore.phase === "finished" && restore.id === row.id ? restore.outcome : null}
            onPreview={() => openPreview(row)}
            onAskRestore={() => askRestore(row)}
            onCancelRestore={cancelConfirm}
            onConfirmRestore={() => void startRestore(row)}
            onRetry={() => void startRestore(row)}
            onUndo={() => void undo(row)}
          />
        ))}
      </ol>

      {isDesktop ? (
        <PreviewColumn state={preview} pageId={pageId} chrome={chrome} onRetry={retryPreview} />
      ) : (
        <PreviewSheet
          open={sheetOpen}
          state={preview}
          pageId={pageId}
          chrome={chrome}
          onClose={() => setSheetOpen(false)}
          onRestore={() => {
            setSheetOpen(false);
            if (sheetVersion) askRestore(sheetVersion);
          }}
          onRetry={retryPreview}
        />
      )}
    </div>
  );
}
