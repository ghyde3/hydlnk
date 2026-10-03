import type { Block } from "@/lib/document";

/**
 * Tap to edit (M6-03): what a tap on the editor's preview means. The renderer marks what can be
 * edited with plain attributes that it outputs the same way everywhere (`data-block-id` on a block,
 * `data-item-id` on a social icon or grid cell, `data-profile-part` on the avatar, name and bio);
 * the editor's preview frame reads them from the event target. The renderer imports nothing from
 * the editor and handles no click (see tests/unit/m6-preview-static.test.ts).
 *
 * Tenant text cannot forge a target: it is rendered as React text, never as markup, so a label of
 * `<i data-block-id='x'>` is a string on screen. The ids are checked against the draft anyway
 * (`checkTap`), so nothing opens for an id that is not on the page.
 */

export type ProfilePart = "avatar" | "name" | "bio";

export type PreviewTap =
  { kind: "block"; blockId: string; itemId?: string } | { kind: "profile"; part: ProfilePart };

const PROFILE_PARTS: readonly string[] = ["avatar", "name", "bio"];

/**
 * The tap target under `target`, or null when the tap means nothing (the page background, empty
 * space, the footer links). `boundary` is the preview frame: nothing outside it counts.
 */
export function resolvePreviewTap(
  target: EventTarget | null,
  boundary?: Element | null,
): PreviewTap | null {
  if (!target || typeof (target as Element).closest !== "function") return null;
  const element = target as Element;
  const inside = (found: Element | null): found is Element =>
    found !== null && (!boundary || boundary.contains(found));

  const profile = element.closest("[data-profile-part]");
  if (inside(profile)) {
    const part = profile.getAttribute("data-profile-part") ?? "";
    return PROFILE_PARTS.includes(part) ? { kind: "profile", part: part as ProfilePart } : null;
  }

  const item = element.closest("[data-item-id]");
  const block = (inside(item) ? item : element).closest("[data-block-id]");
  if (!inside(block)) return null;
  const blockId = block.getAttribute("data-block-id");
  if (!blockId) return null;
  const itemId = inside(item) ? item.getAttribute("data-item-id") : null;
  return itemId ? { kind: "block", blockId, itemId } : { kind: "block", blockId };
}

/** Whether `block` has a social icon or a grid cell with this id. */
function hasItem(block: Block, itemId: string): boolean {
  if (block.type === "social") return block.icons.some((icon) => icon.id === itemId);
  if (block.type === "grid") return block.cells.some((cell) => cell.id === itemId);
  return false;
}

/**
 * The tap, if it is for something that is on the page now: a block that is in the draft (an item id
 * that is not in that block is dropped, and the block still opens). Null for anything else.
 */
export function checkTap(tap: PreviewTap, blocks: readonly Block[]): PreviewTap | null {
  if (tap.kind === "profile") return tap;
  const block = blocks.find((candidate) => candidate.id === tap.blockId);
  if (!block) return null;
  if (tap.itemId !== undefined && hasItem(block, tap.itemId)) return tap;
  return { kind: "block", blockId: block.id };
}

/**
 * Moves focus to the profile control a tap on the avatar, name or bio stands for: the Upload or
 * Replace photo button, the Display name input, the Bio textarea. They are found through the Profile
 * card (the section around the display name input), so the card's own markup can change. Returns
 * false when the card is not on screen.
 */
export function focusProfilePart(part: ProfilePart, root: ParentNode = document): boolean {
  const name = root.querySelector<HTMLInputElement>('input[autocomplete="name"]');
  const card = name?.closest("section");
  if (!name || !card) return false;
  let target: HTMLElement | null;
  if (part === "name") target = name;
  else if (part === "bio") target = card.querySelector<HTMLElement>("textarea");
  else {
    const buttons = Array.from(card.querySelectorAll<HTMLButtonElement>("button"));
    target =
      buttons.find((button) => /^(Upload|Replace)\b/.test(button.textContent?.trim() ?? "")) ??
      buttons[0] ??
      null;
  }
  if (!target) return false;
  target.scrollIntoView({ block: "center" });
  target.focus({ preventScroll: true });
  return true;
}
