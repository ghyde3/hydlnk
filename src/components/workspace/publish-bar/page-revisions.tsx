"use client";

import { useEffect, useState } from "react";
import { LocalTime } from "@/components/versions/local-time";
import { fetchPageRevisions, type PageRevision } from "@/lib/site-pages/entry-revisions-client";
import { CHIP, CHIP_COLORS } from "./item-chip";
import { ROW_BUTTON } from "./publish-bar-view";

export const REVISIONS_NOTE =
  "Restoring changes the draft. It goes live when you publish the page.";
export const REVISIONS_EMPTY =
  "No revisions yet. Each time you publish this page, one is kept here.";
export const REVISIONS_FAILED = "We couldn’t load the revisions. Try again.";

type Load =
  { status: "loading" } | { status: "ready"; revisions: PageRevision[] } | { status: "failed" };

/**
 * One page's revisions (M15-10), inside the publish bar: newest first, each with its local time, a
 * "Published" tag when that revision went live, and Restore. Restore puts the revision into the
 * page's DRAFT (the workspace's `restoreRevision`: it writes pending edits first, then reloads);
 * nothing is published. A refusal stays here as an alert.
 */
export function PageRevisions({
  siteId,
  entryId,
  title,
  onBack,
  onRestore,
}: {
  siteId: string;
  entryId: string;
  title: string;
  onBack: () => void;
  onRestore: (rev: number) => Promise<{ ok: true } | { ok: false; message: string }>;
}) {
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [restoring, setRestoring] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    void fetchPageRevisions(siteId, entryId).then((answer) => {
      if (!current) return;
      setLoad(
        answer.kind === "ok"
          ? { status: "ready", revisions: answer.revisions }
          : { status: "failed" },
      );
    });
    return () => {
      current = false;
    };
  }, [siteId, entryId, attempt]);

  async function restore(rev: number): Promise<void> {
    if (restoring !== null) return;
    setRestoring(rev);
    setError(null);
    try {
      const result = await onRestore(rev);
      if (!result.ok) {
        setError(result.message);
        setRestoring(null);
      }
      // On success the workspace reloads: the button stays busy until it does.
    } catch {
      setError("Couldn’t restore that revision. Your draft is safe. Try again.");
      setRestoring(null);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-3 border-b border-line px-4 py-2.5">
        <button type="button" onClick={onBack} className={ROW_BUTTON}>
          Back
        </button>
        <div className="min-w-0">
          <p title={title} className="m-0 truncate text-sm font-semibold text-ink">
            {title}
          </p>
          <p className="m-0 text-xs text-text-2">Revisions</p>
        </div>
      </div>
      <p className="m-0 border-b border-line bg-page px-4 py-3 text-sm leading-relaxed text-ink-2">
        {REVISIONS_NOTE}
      </p>
      {error ? (
        <p role="alert" className="m-0 border-b border-line px-4 py-3 text-sm text-bad">
          {error}
        </p>
      ) : null}
      {load.status === "loading" ? (
        <p role="status" className="m-0 px-4 py-4 text-sm text-text-2">
          Loading revisions…
        </p>
      ) : null}
      {load.status === "failed" ? (
        <div role="alert" className="flex flex-col items-start gap-2 px-4 py-4">
          <p className="m-0 text-sm text-bad">{REVISIONS_FAILED}</p>
          <button
            type="button"
            className={ROW_BUTTON}
            onClick={() => {
              setLoad({ status: "loading" });
              setAttempt((n) => n + 1);
            }}
          >
            Retry
          </button>
        </div>
      ) : null}
      {load.status === "ready" ? (
        <ol
          data-testid="page-revisions"
          aria-label={`Revisions of ${title}`}
          className="m-0 flex min-h-0 list-none flex-col overflow-y-auto overscroll-contain p-0"
        >
          {load.revisions.length === 0 ? (
            <li className="px-4 py-4 text-sm text-text-2">{REVISIONS_EMPTY}</li>
          ) : null}
          {load.revisions.map((revision) => (
            <li
              key={revision.rev}
              data-rev={revision.rev}
              className="flex min-h-14 shrink-0 items-center justify-between gap-3 border-b border-line px-4 py-2"
            >
              <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                <LocalTime iso={revision.createdAt} className="font-mono text-xs text-text-2" />
                {revision.wasPublished ? (
                  <span data-revision-published="" className={`${CHIP} ${CHIP_COLORS.live.chip}`}>
                    Published
                  </span>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => void restore(revision.rev)}
                disabled={restoring !== null}
                aria-busy={restoring === revision.rev}
                className={ROW_BUTTON}
              >
                Restore
              </button>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}
