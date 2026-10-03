import {
  newBlockId,
  type Block,
  type DraftDoc,
  type SocialIcon,
  type SocialPlatform,
} from "@/lib/document";
import { collectIds } from "@/lib/editor/duplicate";
import type { Template, TemplateBlock } from "./catalog";

/**
 * Turning a template into page content (M6-40). Pure: the only randomness is the fresh block ids,
 * and the only input besides the template is the draft being replaced.
 *
 * Every block comes out visible, with an empty address (`url: ""`, an email icon's `address: ""`)
 * and no image, so the draft schema accepts it as is and Publish refuses it until the person fills
 * the address in. Every block, social icon and grid cell gets a fresh id (ids are analytics keys):
 * none repeats within the page and none matches an id in `taken`.
 */

function socialIcon(platform: SocialPlatform, id: string): SocialIcon {
  return platform === "email" ? { id, platform, address: "" } : { id, platform, url: "" };
}

function build(block: TemplateBlock, fresh: () => string): Block {
  switch (block.type) {
    case "header":
      return { id: fresh(), type: "header", visible: true, text: block.text };
    case "text":
      return { id: fresh(), type: "text", visible: true, text: block.text };
    case "link":
      return { id: fresh(), type: "link", visible: true, label: block.label, url: "" };
    case "card":
      return {
        id: fresh(),
        type: "card",
        visible: true,
        title: block.title,
        caption: block.caption,
        url: "",
        image: null,
      };
    case "image":
      return { id: fresh(), type: "image", visible: true, image: null, alt: block.alt, url: "" };
    case "embed":
      return { id: fresh(), type: "embed", visible: true, url: "", caption: block.caption };
    case "grid":
      return {
        id: fresh(),
        type: "grid",
        visible: true,
        cells: block.cells.map((cell) => ({
          id: fresh(),
          title: cell.title,
          subtitle: cell.subtitle,
          url: "",
        })),
      };
    case "social":
      return {
        id: fresh(),
        type: "social",
        visible: true,
        icons: block.platforms.map((platform) => socialIcon(platform, fresh())),
      };
  }
}

/**
 * The template's blocks with fresh ids, in order. `taken` is the set of ids already in use (the
 * page being replaced): none of them is reused, and the new ones are added to it.
 */
export function buildTemplateBlocks(template: Template, taken: Set<string> = new Set()): Block[] {
  const fresh = (): string => {
    let id = newBlockId();
    while (taken.has(id)) id = newBlockId();
    taken.add(id);
    return id;
  };
  return template.blocks.map((block) => build(block, fresh));
}

/**
 * The draft with the template applied: its blocks replace the page's blocks, its theme becomes the
 * page's theme with no page-level overrides, and its sample bio is set when the page's bio is
 * empty. Nothing else changes: not the display name, not the photo or any profile option, not the
 * share settings, not `rev`. Never adds to the blocks, so the page can never go past 50.
 */
export function applyTemplate(draft: DraftDoc, template: Template): DraftDoc {
  const blocks = buildTemplateBlocks(template, collectIds(draft));
  const writeBio = draft.profile.bio.trim() === "";
  return {
    ...draft,
    profile: writeBio ? { ...draft.profile, bio: template.bio } : draft.profile,
    theme: { ref: template.theme.id, overrides: {} },
    blocks,
  };
}

/**
 * Whether applying a template would throw away something the person set: any block, a theme, or
 * page-level style. An empty page with no theme and no overrides applies at once; anything else
 * asks first ("Replace your blocks and style ..."). The answer does not depend on which template.
 */
export function templateNeedsConfirmation(draft: DraftDoc): boolean {
  return (
    draft.blocks.length > 0 ||
    draft.theme.ref !== null ||
    Object.keys(draft.theme.overrides).length > 0
  );
}
