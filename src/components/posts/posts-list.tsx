"use client";

import Link from "next/link";
import { FORM_BUTTON } from "@/components/blocks/field";
import type { EntrySummary } from "@/lib/content";
import { POSTS_TEST_IDS } from "@/lib/blog/test-ids";
import { postDateLabel, postState } from "@/lib/posts/status";
import { PostChip } from "./post-chip";

/**
 * The rows of the Posts screen (M16-12): title, state chip and date, each row a link to the post's
 * editor (a trashed post opens there too, where Restore is). 20 at a time, then "Load more".
 */
export function PostsList({
  items,
  loading,
  hasMore,
  onMore,
  filtered,
}: {
  items: EntrySummary[];
  loading: boolean;
  hasMore: boolean;
  onMore: () => void;
  /** A filter or a search is on: the empty state says so. */
  filtered: boolean;
}) {
  if (items.length === 0) {
    return (
      <p data-testid="posts-empty" className="m-0 py-3 text-sm text-text-2">
        {loading
          ? "Loading posts…"
          : filtered
            ? "No posts match. Change the filters to see more."
            : "No posts yet. Write the first one."}
      </p>
    );
  }
  return (
    <div className="flex min-w-0 flex-col gap-2" aria-busy={loading}>
      <ul className="m-0 flex list-none flex-col gap-1.5 p-0" data-testid="posts-list">
        {items.map((item) => (
          <li key={item.id} className="min-w-0">
            <Link
              href={`/posts/${item.id}`}
              data-testid={POSTS_TEST_IDS.row}
              data-post-id={item.id}
              className="flex min-h-14 w-full min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-md border border-line-3 bg-surface px-3 py-2 text-left"
            >
              <span className="min-w-0 flex-1 basis-48 text-sm font-semibold [overflow-wrap:anywhere] text-ink">
                {item.title?.trim() ? item.title : "Untitled post"}
              </span>
              <span className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
                <PostChip state={postState(item)} />
                <span className="font-mono text-xs text-text-2">{postDateLabel(item)}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {hasMore ? (
        <button
          type="button"
          data-testid="posts-more"
          disabled={loading}
          onClick={onMore}
          className={`${FORM_BUTTON} self-start`}
        >
          {loading ? "Loading…" : "Load more"}
        </button>
      ) : null}
    </div>
  );
}
