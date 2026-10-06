"use client";

import { useId } from "react";
import {
  FEATURED_LIMIT_MESSAGE,
  LIMITS,
  LINK_FEATURED,
  LINK_FEATURED_LABELS,
  isLinkFeatured,
  type LinkBlock,
  type LinkFeatured,
  type PublishError,
} from "@/lib/document";
import { Field, controlClass } from "../field";
import { useOtherFeaturedCount } from "./featured-context";

/** The Publish gate's message for a link's `featured` field (a fourth featured link, a bad value). */
export function featuredError(errors: readonly PublishError[], blockId: string): string | null {
  const hit = errors.find(
    (error) =>
      error.blockId === blockId && error.itemId === undefined && error.field === "featured",
  );
  return hit ? hit.message : null;
}

export const FEATURE_HINT = `Makes this link stand out. You can feature up to ${LIMITS.featuredLinks}.`;
export const MOTION_HINT = "Motion turns off for people who ask their device for less motion.";

/**
 * "Feature this link" (M6-22): a toggle switch in a 44px row with its hint, and, once on, a
 * "Motion" select (None, Gentle pulse, Soft shine). Off removes `featured`. On a fourth featured
 * link the switch is disabled and says why. Available on every plan.
 */
export function LinkFeatureField({
  block,
  error,
  onChange,
}: {
  block: LinkBlock;
  /** The Publish gate's message for this field, or null. */
  error: string | null;
  onChange: (next: LinkBlock) => void;
}) {
  const hintId = useId();
  const limitId = useId();
  const errorId = useId();
  const others = useOtherFeaturedCount(block.id);
  const featured: LinkFeatured | undefined = isLinkFeatured(block.featured)
    ? block.featured
    : undefined;
  const on = featured !== undefined;
  // A hidden link takes no part in the limit (Publish drops it), so only a visible one is held back.
  const blocked = !on && block.visible !== false && others >= LIMITS.featuredLinks;

  function setFeatured(next: LinkFeatured | undefined): void {
    if (next === undefined) {
      const { featured: dropped, ...rest } = block;
      void dropped; // not featured means no key
      onChange(rest);
    } else {
      onChange({ ...block, featured: next });
    }
  }

  return (
    <div data-testid="link-feature-field" className="flex min-w-0 flex-col gap-1">
      <button
        type="button"
        aria-pressed={on}
        disabled={blocked}
        aria-describedby={[hintId, blocked ? limitId : null, error ? errorId : null]
          .filter((id) => id !== null)
          .join(" ")}
        onClick={() => setFeatured(on ? undefined : "bold")}
        className="flex min-h-12 min-w-[52px] max-w-full items-center justify-between gap-3 text-left text-[13px] font-semibold text-ink-2 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <span className="min-w-0">Feature this link</span>
        <span
          aria-hidden="true"
          className={`relative block h-[18px] w-8 shrink-0 rounded-full ${on ? "bg-ink" : "bg-line-3"}`}
        >
          <span
            className={`absolute top-0.5 block size-3.5 rounded-full bg-surface ${on ? "left-4" : "left-0.5"}`}
          />
        </span>
      </button>
      <p id={hintId} className="m-0 text-xs text-text-2">
        {FEATURE_HINT}
      </p>
      {blocked ? (
        <p id={limitId} className="m-0 text-[13px] text-text-2">
          {FEATURED_LIMIT_MESSAGE}
        </p>
      ) : null}
      <div aria-live="polite" className="empty:hidden">
        {error ? (
          <p id={errorId} data-field="featured" className="text-[13px] text-bad">
            {error}
          </p>
        ) : null}
      </div>

      {on ? (
        <Field label="Motion" hint={MOTION_HINT} className="mt-2 max-w-[360px]">
          {(control) => (
            <select
              {...control}
              value={featured}
              data-field="featured-motion"
              onChange={(event) => setFeatured(event.target.value as LinkFeatured)}
              className={controlClass(false, "py-0")}
            >
              {LINK_FEATURED.map((value) => (
                <option key={value} value={value}>
                  {LINK_FEATURED_LABELS[value]}
                </option>
              ))}
            </select>
          )}
        </Field>
      ) : null}
    </div>
  );
}
