"use client";

import { useOptionalWorkspace } from "@/components/workspace/workspace-context";
import { LIMITS } from "@/lib/document";
import { Field, controlClass } from "../field";
import { TextField } from "../text-field";
import { useLatestPosts } from "../use-latest-posts";
import { OverrideControls } from "./override-controls";
import { fieldError, type BlockFormProps } from "./types";

/**
 * Latest posts (M16-07): the newest published posts of the site's blog as links. An optional
 * heading, how many to show (1 to 6) and an optional category. The posts are not stored in the
 * block: the page reads them when it is drawn, so a new post shows without republishing the page.
 * While the blog is off or has no published post the live page draws nothing, and this form says so.
 */
export function LatestPostsForm({ block, onChange, errors }: BlockFormProps) {
  const workspace = useOptionalWorkspace();
  const { state, latest, categories } = useLatestPosts(workspace?.pageId ?? null);
  if (block.type !== "latest_posts") return null;
  const counts = Array.from(
    { length: LIMITS.latestPostsMax - LIMITS.latestPostsMin + 1 },
    (_, index) => LIMITS.latestPostsMin + index,
  );
  const category = block.categoryId ?? "";
  const known = category === "" || categories.some((entry) => entry.id === category);
  const categoryError =
    fieldError(errors, block.id, "categoryId") ??
    (known || state !== "ready" ? null : "That category no longer exists. Choose another.");
  const hint =
    state !== "ready"
      ? null
      : latest === null
        ? "Your blog is off, so this block is hidden on your live page. Turn it on from Pages."
        : latest.posts.length === 0
          ? "No published posts yet, so this block is hidden on your live page."
          : null;
  return (
    <div className="flex flex-col gap-3">
      {hint ? (
        <p data-testid="latest-posts-hint" className="m-0 text-[13px] text-text-2">
          {hint}
        </p>
      ) : null}
      <TextField
        label="Heading (optional)"
        field="heading"
        max={LIMITS.latestPostsHeading}
        value={block.heading ?? ""}
        error={fieldError(errors, block.id, "heading")}
        onChange={(heading) => {
          const { heading: _dropped, ...rest } = block;
          void _dropped;
          onChange(heading === "" ? rest : { ...rest, heading });
        }}
      />
      <Field label="Posts to show" error={fieldError(errors, block.id, "count")}>
        {(control) => (
          <select
            {...control}
            data-field="count"
            value={String(block.count)}
            onChange={(event) => onChange({ ...block, count: Number(event.target.value) })}
            className={controlClass(fieldError(errors, block.id, "count") !== null)}
          >
            {counts.map((count) => (
              <option key={count} value={count}>
                {count}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label="Category" error={categoryError}>
        {(control) => (
          <select
            {...control}
            data-field="categoryId"
            value={known ? category : ""}
            onChange={(event) => {
              const { categoryId: _dropped, ...rest } = block;
              void _dropped;
              onChange(
                event.target.value === "" ? rest : { ...rest, categoryId: event.target.value },
              );
            }}
            className={controlClass(categoryError !== null)}
          >
            <option value="">All posts</option>
            {categories.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name}
              </option>
            ))}
          </select>
        )}
      </Field>
      <OverrideControls block={block} onChange={onChange} errors={errors} />
    </div>
  );
}
