"use client";

import type { Block, PublishError } from "@/lib/document";
import { blockRowSummary } from "@/lib/editor/contracts";

/**
 * The alert above the block list after a Publish that failed validation (M2-24): "Fix 3 blocks
 * before publishing." and one line per failing block, by its title, with what to do. Profile and
 * page-level problems are listed too. The failing rows themselves carry the inline messages.
 */
export function PublishAlert({ errors, blocks }: { errors: PublishError[]; blocks: Block[] }) {
  if (errors.length === 0) return null;

  const failing = blocks
    .map((block) => ({ block, messages: errors.filter((e) => e.blockId === block.id) }))
    .filter((entry) => entry.messages.length > 0);
  const profile = errors.filter((e) => e.blockId === null && e.field.startsWith("profile"));
  const page = errors.filter((e) => e.blockId === null && !e.field.startsWith("profile"));

  const count = failing.length;
  const heading =
    count > 0
      ? `Fix ${count} ${count === 1 ? "block" : "blocks"} before publishing.`
      : profile.length > 0
        ? "Fix your profile before publishing."
        : "Fix your page before publishing.";

  return (
    <div
      role="alert"
      className="flex flex-col gap-2 rounded-md border border-bad-line bg-surface p-4"
    >
      <span className="text-sm font-semibold text-bad">{heading}</span>
      <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[13px] text-ink">
        {profile.length > 0 ? (
          <li>
            <span className="font-semibold">Profile:</span>{" "}
            {profile.map((e) => e.message).join(" ")}
          </li>
        ) : null}
        {failing.map(({ block, messages }) => {
          const summary = blockRowSummary(block);
          return (
            <li key={block.id}>
              <span className="font-semibold">{summary.title || summary.typeLabel}:</span>{" "}
              {messages.map((e) => e.message).join(" ")}
            </li>
          );
        })}
        {page.map((e) => (
          <li key={`${e.field}-${e.message}`}>{e.message}</li>
        ))}
      </ul>
    </div>
  );
}
