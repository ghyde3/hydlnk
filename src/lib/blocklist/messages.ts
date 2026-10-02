/**
 * Copy for the link blocklist (M5-03). No imports, so the editor (client) and the publish gate
 * (server) use the same words.
 */

/** Under a URL field after a save is refused, and on each affected field after a failed Publish. */
export const BLOCKED_FIELD_MESSAGE = "That site is blocked. Use a different link.";

/**
 * The Publish banner: "Can’t publish. 1 link points to a blocked site: blocked.example. Remove or
 * change it." `count` is how many links are affected, `hosts` the distinct hosts they point to.
 */
export function blockedPublishMessage(
  hosts: readonly string[],
  count: number = hosts.length,
): string {
  const links =
    count === 1 ? "1 link points to a blocked site" : `${count} links point to blocked sites`;
  return `Can’t publish. ${links}: ${hosts.join(", ")}. Remove or change ${count === 1 ? "it" : "them"}.`;
}
