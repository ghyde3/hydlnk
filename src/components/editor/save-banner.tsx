"use client";

import Link from "next/link";
import { SUSPENDED_SAVE_MESSAGE, useAccountSuspended } from "@/components/admin/suspension-context";
import type { SaveStatus } from "@/lib/editor/autosave";
import {
  INVALID_MESSAGE,
  blockedSaveMessage,
  SAVE_FAILED_MESSAGE,
  SIGNED_OUT_MESSAGE,
  STALE_MESSAGE,
} from "@/lib/editor/messages";

/** What the banner says for a queue status, or null when there is nothing to say. */
export type SaveProblem = {
  kind: "suspended" | "conflict" | "signed-out" | "invalid" | "error" | "blocked";
  message: string;
};

/**
 * The save problem for a queue status (M2-04, M5-15, M5-16): one table for the Editor and Design.
 * A suspended owner's draft writes match no row (RLS), which reads as a conflict or an error: say
 * why instead of "changed in another tab".
 */
export function saveProblemFor(
  status: SaveStatus,
  suspended: boolean,
  blockedHosts: readonly string[] = [],
): SaveProblem | null {
  if (suspended && (status === "conflict" || status === "error")) {
    return { kind: "suspended", message: SUSPENDED_SAVE_MESSAGE };
  }
  switch (status) {
    case "conflict":
      return { kind: "conflict", message: STALE_MESSAGE };
    case "signed-out":
      return { kind: "signed-out", message: SIGNED_OUT_MESSAGE };
    case "invalid":
      return { kind: "invalid", message: INVALID_MESSAGE };
    case "error":
      return { kind: "error", message: SAVE_FAILED_MESSAGE };
    case "blocked":
      // Permanent until the link changes, so never the "will retry" sentence (M5-03).
      return { kind: "blocked", message: blockedSaveMessage(blockedHosts) };
    default:
      return null;
  }
}

const ACTION =
  "inline-flex min-h-11 items-center rounded-md border border-bad-line bg-surface px-4 text-[13px] font-semibold text-bad no-underline";

/**
 * The red banner above the editing area when a save cannot go through, shared by the Editor and
 * Design screens so both say the same thing in the same words (M5-16). `role="alert"`, the DESIGN.md
 * error colors (--hl-bad text, #E8C4BD border), at most one action:
 *   conflict    Reload (another tab saved first)
 *   signed-out  Sign in, to /login in a NEW tab so the unsaved text stays on screen; coming back to
 *               this tab saves it (use-autosave retries when the tab is visible again)
 *   blocked     a link points to a blocked site (M5-03): which hosts, and to remove or change it
 * Edits are never discarded by any of these: they stay in the screen and in the queue.
 */
export function SaveBanner({
  status,
  blockedHosts,
  editorLink = false,
}: {
  status: SaveStatus;
  /** The hosts the database refused, for the "blocked" status. */
  blockedHosts?: readonly string[];
  /** The Design screen has no URL fields: its blocked banner links to the Editor, where the link is. */
  editorLink?: boolean;
}) {
  const suspended = useAccountSuspended();
  const problem = saveProblemFor(status, suspended, blockedHosts);
  if (!problem) return null;
  return (
    <div
      role="alert"
      data-save-problem={problem.kind}
      className="flex max-w-[720px] flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-bad-line bg-surface py-1 pr-1 pl-4 text-sm text-bad"
    >
      <span className="min-w-0 py-2 [overflow-wrap:anywhere]">{problem.message}</span>
      {problem.kind === "blocked" && editorLink ? (
        <Link href="/editor" className={ACTION}>
          Open Editor
        </Link>
      ) : null}
      {problem.kind === "conflict" ? (
        <button type="button" onClick={() => window.location.reload()} className={ACTION}>
          Reload
        </button>
      ) : null}
      {problem.kind === "signed-out" ? (
        <a href="/login" target="_blank" rel="noopener" className={ACTION}>
          Sign in
        </a>
      ) : null}
    </div>
  );
}
