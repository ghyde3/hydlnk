"use client";

import { useId, useState } from "react";
import { FORM_BUTTON } from "@/components/blocks/field";
import type { RevisionSummary } from "@/lib/content/schemas/summaries";
import { POST_TEST_IDS } from "@/lib/blog/test-ids";
import { fetchRevisions, refusalMessage } from "@/lib/posts/client";

/**
 * A post's revisions (M16-15): the list, newest first, and "Restore" on each. Restoring saves that
 * revision as the post's DRAFT; nothing goes live until Publish. The list carries no post text: each
 * row is when it was saved, where from, and whether it was the published copy.
 */

const SOURCE: Record<string, string> = {
  editor: "Editor",
  mcp: "An AI assistant",
  builder: "The builder",
  system: "HYDLNK",
};

const when = (iso: string) => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
};

export function PostRevisions({
  siteId,
  entryId,
  disabled,
  onRestore,
}: {
  siteId: string;
  entryId: string;
  disabled: boolean;
  /** Restores revision `rev` into the draft; resolves with a message when it was refused. */
  onRestore: (rev: number) => Promise<string | null>;
}) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<RevisionSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);

  async function load() {
    setError(null);
    const out = await fetchRevisions(siteId, entryId);
    if (out.kind === "ok") setRows(out.revisions);
    else setError(refusalMessage(out));
  }

  async function restore(rev: number) {
    setBusy(rev);
    setError(null);
    const refused = await onRestore(rev);
    setBusy(null);
    if (refused) setError(refused);
    else await load();
  }

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <button
        type="button"
        data-testid={POST_TEST_IDS.revisions}
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => {
          setOpen(!open);
          if (!open) void load();
        }}
        className={`${FORM_BUTTON} self-start`}
      >
        Revisions
      </button>
      <div id={listId} hidden={!open} className="flex min-w-0 flex-col gap-2">
        {rows === null && error === null ? (
          <p className="m-0 text-[13px] text-text-2">Loading revisions…</p>
        ) : null}
        {rows !== null && rows.length === 0 ? (
          <p className="m-0 text-[13px] text-text-2">
            No revisions yet. One is kept when you publish and as you edit.
          </p>
        ) : null}
        {rows !== null && rows.length > 0 ? (
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0" data-testid="post-revision-list">
            {rows.map((row) => (
              <li
                key={row.rev}
                data-revision={row.rev}
                className="flex min-h-11 min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-md border border-line-3 px-3 py-1.5"
              >
                <span className="flex min-w-0 flex-col text-[13px]">
                  <span className="font-medium text-ink">{when(row.createdAt)}</span>
                  <span className="text-xs text-text-2">
                    {SOURCE[row.source] ?? "Saved"}
                    {row.wasPublished ? " · Published" : ""}
                  </span>
                </span>
                <button
                  type="button"
                  disabled={disabled || busy !== null}
                  onClick={() => void restore(row.rev)}
                  className={FORM_BUTTON}
                >
                  {busy === row.rev ? "Restoring…" : "Restore"}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {rows !== null && rows.length > 0 ? (
          <p className="m-0 text-xs text-text-2">
            Restoring changes the draft only. It goes live when you publish.
          </p>
        ) : null}
        <div aria-live="polite" className="empty:hidden">
          {error ? <p className="m-0 text-[13px] text-bad">{error}</p> : null}
        </div>
      </div>
    </div>
  );
}
