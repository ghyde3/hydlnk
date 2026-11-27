"use client";

import { useId } from "react";
import { POST_TEST_IDS } from "@/lib/blog/test-ids";

/**
 * The plain Markdown box (M16-13): what a body opens in when the rich editor could not hold it
 * without loss (a table, raw HTML, a syntax it would rewrite). A 16px textarea that stores exactly
 * what is typed, byte for byte.
 */
export function SourceBox({
  value,
  onChange,
  disabled,
  labelledBy,
}: {
  value: string;
  onChange: (next: string) => void;
  disabled: boolean;
  labelledBy: string;
}) {
  const noteId = useId();
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <p id={noteId} className="m-0 text-xs text-text-2">
        This post uses Markdown the editor can’t show (a table or HTML, for example), so it opens as
        plain Markdown. It is saved exactly as written.
      </p>
      <textarea
        data-testid={POST_TEST_IDS.bodySource}
        aria-labelledby={labelledBy}
        aria-describedby={noteId}
        value={value}
        disabled={disabled}
        rows={16}
        spellCheck
        onChange={(event) => onChange(event.target.value)}
        className="min-h-[320px] w-full min-w-0 resize-y rounded-md border border-line-3 bg-surface px-3 py-2.5 font-mono text-base leading-relaxed text-ink disabled:opacity-60"
      />
    </div>
  );
}
