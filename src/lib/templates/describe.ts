import type { Template } from "./catalog";

/** Block types whose name does not change with the count: "2 text", "2 social". */
const SAME_WHEN_MANY: ReadonlySet<string> = new Set(["text", "social"]);

/**
 * What a template holds, in plain words (M7-07): the count of blocks, then each block type in the
 * order it first appears, with its count when it appears more than once. "6 blocks: header, embed,
 * 2 links, card, social". The words are the lower-case type names with an "s" added above one
 * ("links", "cards", "headers", "embeds", "grids", "images"); "text" and "social" never change.
 *
 * Pure and derived from the catalog alone, so a change to a template changes its line and nothing
 * else needs an edit.
 */
export function describeTemplate(template: Template): string {
  const total = template.blocks.length;
  if (total === 0) return "No blocks";
  const counts = new Map<string, number>();
  for (const block of template.blocks) counts.set(block.type, (counts.get(block.type) ?? 0) + 1);
  const parts = [...counts].map(([type, count]) =>
    count === 1 ? type : `${count} ${SAME_WHEN_MANY.has(type) ? type : `${type}s`}`,
  );
  return `${total} ${total === 1 ? "block" : "blocks"}: ${parts.join(", ")}`;
}
