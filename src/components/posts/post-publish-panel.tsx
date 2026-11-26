"use client";

import Link from "next/link";
import { FORM_BUTTON } from "@/components/blocks/field";
import { POST_TEST_IDS } from "@/lib/blog/test-ids";
import type { FieldIssue } from "@/lib/posts/client";
import { POST_FIELD_LABEL, fieldOfIssue, postFieldId } from "@/lib/posts/draft";
import type { PostSaveView } from "@/lib/posts/save-queue";
import type { PostState, PublishedState } from "@/lib/posts/status";
import { PostChip } from "./post-chip";

/**
 * The post editor's bar (M16-15): where the post stands, whether it is saved, and Preview, Unpublish
 * and Publish. Publish makes only this post live. What Publish refused is listed under the bar by
 * field, each with a link to its field. Built from DESIGN.md's tokens (no mockup): a white card,
 * 44px buttons, the charcoal primary. Below 760px the bar sticks to the top of the screen, so
 * Publish stays one tap away on a long post.
 */

const PRIMARY =
  "inline-flex min-h-11 cursor-pointer items-center justify-center rounded-md bg-ink px-4 text-sm font-semibold text-surface disabled:cursor-not-allowed disabled:opacity-50";

const SAVE_TEXT: Record<PostSaveView["state"], string> = {
  saved: "Saved",
  saving: "Saving…",
  unsaved: "Unsaved changes",
  conflict: "Not saved",
  error: "Not saved",
};

export type PostBusy =
  "publish" | "unpublish" | "trash" | "restore" | "preview" | "revision" | null;

export function PostPublishPanel({
  state,
  chipState,
  save,
  busy,
  disabled,
  publishOff,
  publishForbidden = null,
  previewUrl,
  onPublish,
  onUnpublish,
  onPreview,
}: {
  state: PublishedState;
  /** The chip's word, when a schedule changes it (Scheduled, Didn't publish); else `state`. */
  chipState?: PostState;
  save: PostSaveView;
  busy: PostBusy;
  /** Nothing can be done (the account is suspended, or the post changed somewhere else). */
  disabled: boolean;
  /** Why Publish is off, or null when it can be pressed. */
  publishOff: string | null;
  /**
   * An editor on a shared site (Wave F, M19-10): this sentence stands where Publish and Unpublish
   * would be, and neither is drawn. Null for the owner and a publisher.
   */
  publishForbidden?: string | null;
  /** The share address of the last preview, kept as a link in case the new tab was blocked. */
  previewUrl: string | null;
  onPublish: () => void;
  onUnpublish: () => void;
  onPreview: () => void;
}) {
  const trashed = state === "trashed";
  const live = state === "live" || state === "changes";
  return (
    <section
      aria-label="Publish"
      data-testid="post-bar"
      data-sticky=""
      className="sticky top-0 z-10 flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-md border border-line bg-surface p-3 hl:static"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
        <Link
          href="/posts"
          className="inline-flex min-h-11 items-center text-sm font-semibold text-ink underline"
        >
          All posts
        </Link>
        <PostChip state={chipState ?? state} live />
        <span
          data-testid={POST_TEST_IDS.saveState}
          data-save-state={save.state}
          aria-live="polite"
          className="font-mono text-xs text-text-2"
        >
          {SAVE_TEXT[save.state]}
        </span>
      </div>
      {trashed ? null : (
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {previewUrl ? (
            <a
              href={previewUrl}
              target="_blank"
              rel="noopener"
              data-testid="post-preview-link"
              className="inline-flex min-h-11 items-center text-[13px] font-medium text-ink underline"
            >
              Open preview
            </a>
          ) : null}
          <button
            type="button"
            data-testid={POST_TEST_IDS.preview}
            disabled={busy !== null || save.state === "conflict"}
            onClick={onPreview}
            className={FORM_BUTTON}
          >
            {busy === "preview" ? "Opening…" : "Preview"}
          </button>
          {publishForbidden ? (
            <span data-testid="post-publish-forbidden" className="min-w-0 text-sm text-text-2">
              {publishForbidden}
            </span>
          ) : null}
          {live && !publishForbidden ? (
            <button
              type="button"
              data-testid={POST_TEST_IDS.unpublish}
              disabled={disabled || busy !== null}
              onClick={onUnpublish}
              className={FORM_BUTTON}
            >
              {busy === "unpublish" ? "Unpublishing…" : "Unpublish"}
            </button>
          ) : null}
          {publishForbidden ? null : (
            <button
              type="button"
              data-testid={POST_TEST_IDS.publish}
              disabled={disabled || busy !== null || publishOff !== null}
              title={publishOff ?? undefined}
              onClick={onPublish}
              className={PRIMARY}
            >
              {busy === "publish"
                ? "Publishing…"
                : state === "changes"
                  ? "Publish changes"
                  : "Publish"}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

/** What Publish found, by field, each a link to the field it is about. */
export function PostIssues({ issues }: { issues: FieldIssue[] }) {
  if (issues.length === 0) return null;
  return (
    <div
      role="alert"
      data-testid="post-issues"
      className="flex min-w-0 flex-col gap-1 rounded-md border border-bad-line bg-surface px-4 py-3 text-sm text-bad"
    >
      <p className="m-0 font-semibold">Fix these to publish.</p>
      <ul className="m-0 flex list-none flex-col p-0">
        {issues.map((issue, index) => {
          const field = fieldOfIssue(issue.path);
          return (
            <li key={`${issue.path}-${index}`} data-issue-field={field}>
              <a
                href={`#${postFieldId(field)}`}
                className="inline-flex min-h-11 items-center gap-1.5 text-bad underline [overflow-wrap:anywhere]"
              >
                <span className="font-semibold">{POST_FIELD_LABEL[field]}:</span>
                <span>{issue.message}</span>
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
