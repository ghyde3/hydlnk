"use client";

import { blockedHostsOf } from "@/lib/blocklist/check";
import { blockedPublishMessage } from "@/lib/blocklist/messages";
import type { Block, PublishError } from "@/lib/document";
import { blockRowSummary } from "@/lib/editor/contracts";

/**
 * The alert above the block list after a Publish that failed validation (M2-24): "Fix 3 blocks
 * before publishing." and one line per failing block, by its title, with what to do. Profile and
 * page-level problems are listed too. The failing rows themselves carry the inline messages.
 */
export function PublishAlert({
  errors,
  blocks,
  onDismiss,
}: {
  errors: PublishError[];
  blocks: Block[];
  onDismiss?: () => void;
}) {
  if (errors.length === 0) return null;

  const failing = blocks
    .map((block) => ({ block, messages: errors.filter((e) => e.blockId === block.id) }))
    .filter((entry) => entry.messages.length > 0);
  const profile = errors.filter((e) => e.blockId === null && e.field.startsWith("profile"));
  const page = errors.filter((e) => e.blockId === null && !e.field.startsWith("profile"));

  const count = failing.length;
  // A Publish the link blocklist refused (M5-03): the gate's errors carry the host, and the heading
  // names them ("Can’t publish. 1 link points to a blocked site: blocked.example. Remove or change it.").
  const blockedHosts = blockedHostsOf(errors);
  const heading =
    blockedHosts.length > 0 && errors.every((e) => (e as { host?: unknown }).host !== undefined)
      ? blockedPublishMessage(blockedHosts, errors.length)
      : count > 0
        ? `Fix ${count} ${count === 1 ? "block" : "blocks"} before publishing.`
        : profile.length > 0
          ? "Fix your profile before publishing."
          : "Fix your page before publishing.";

  return (
    <div
      role="alert"
      className="flex flex-col gap-2 rounded-md border border-bad-line bg-surface p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <span className="min-w-0 py-3 text-sm font-semibold text-bad [overflow-wrap:anywhere]">
          {heading}
        </span>
        {onDismiss ? (
          <button
            type="button"
            onClick={onDismiss}
            className="min-h-11 shrink-0 rounded-md border border-bad-line bg-surface px-4 text-[13px] font-semibold text-bad"
          >
            Dismiss
          </button>
        ) : null}
      </div>
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
