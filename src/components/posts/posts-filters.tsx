"use client";

import { useId } from "react";
import { controlClass } from "@/components/blocks/field";
import type { TermSummary } from "@/lib/content/schemas/summaries";
import { POSTS_TEST_IDS } from "@/lib/blog/test-ids";
import { POST_FILTERS } from "@/lib/posts/status";
import { SCHEDULE_TEST_IDS } from "@/lib/schedule/test-ids";

/**
 * The Posts list's filters (M16-12): status, category, a title search and the sort. They only choose
 * what `GET posts` is asked for; the server does the filtering.
 */
export interface PostsFilterValue {
  status: string;
  term: string;
  q: string;
  sort: "updated_at" | "published_at";
}

export const NO_FILTERS: PostsFilterValue = { status: "", term: "", q: "", sort: "updated_at" };

const LABEL = "text-xs text-text-2";

export function PostsFilters({
  value,
  onChange,
  categories,
}: {
  value: PostsFilterValue;
  onChange: (next: PostsFilterValue) => void;
  categories: TermSummary[];
}) {
  const ids = { status: useId(), term: useId(), q: useId(), sort: useId() };
  return (
    <form
      role="search"
      aria-label="Filter posts"
      onSubmit={(event) => event.preventDefault()}
      className="grid min-w-0 grid-cols-1 gap-2 min-[520px]:grid-cols-2 hl:grid-cols-4"
    >
      <div className="flex min-w-0 flex-col gap-1">
        <label htmlFor={ids.q} className={LABEL}>
          Search titles
        </label>
        <input
          id={ids.q}
          type="search"
          data-testid={POSTS_TEST_IDS.search}
          value={value.q}
          maxLength={100}
          onChange={(event) => onChange({ ...value, q: event.target.value })}
          className={controlClass(false)}
        />
      </div>
      <div className="flex min-w-0 flex-col gap-1">
        <label htmlFor={ids.status} className={LABEL}>
          Status
        </label>
        <select
          id={ids.status}
          data-testid={POSTS_TEST_IDS.filterStatus}
          value={value.status}
          onChange={(event) => onChange({ ...value, status: event.target.value })}
          className={controlClass(false)}
        >
          {POST_FILTERS.map((option) => (
            <option
              key={option.value}
              value={option.value}
              {...(option.value === "scheduled"
                ? { "data-testid": SCHEDULE_TEST_IDS.postsFilterScheduled }
                : {})}
            >
              {option.label}
            </option>
          ))}
        </select>
      </div>
      <div className="flex min-w-0 flex-col gap-1">
        <label htmlFor={ids.term} className={LABEL}>
          Category
        </label>
        <select
          id={ids.term}
          data-testid={POSTS_TEST_IDS.filterCategory}
          value={value.term}
          onChange={(event) => onChange({ ...value, term: event.target.value })}
          className={controlClass(false)}
        >
          <option value="">All categories</option>
          {categories.map((term) => (
            <option key={term.id} value={term.id}>
              {term.name}
            </option>
          ))}
        </select>
      </div>
      <div className="flex min-w-0 flex-col gap-1">
        <label htmlFor={ids.sort} className={LABEL}>
          Sort by
        </label>
        <select
          id={ids.sort}
          data-testid="posts-sort"
          value={value.sort}
          onChange={(event) =>
            onChange({ ...value, sort: event.target.value as PostsFilterValue["sort"] })
          }
          className={controlClass(false)}
        >
          <option value="updated_at">Last edited</option>
          <option value="published_at">Published date</option>
        </select>
      </div>
    </form>
  );
}
