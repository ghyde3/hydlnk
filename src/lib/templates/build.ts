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
 * The one choice an apply asks for (M7-08): `"template"` takes the template's blocks and its theme
 * (the theme becomes the page's, with no page-level overrides); `"keep"` takes the blocks only and
 * leaves the page's own style (the theme reference and the overrides) exactly as it was.
 */
export type TemplateStyle = "template" | "keep";

export const TEMPLATE_STYLES: readonly TemplateStyle[] = ["template", "keep"];

/** Whether a value is one of the two styles. The reducer refuses anything else. */
export function isTemplateStyle(value: unknown): value is TemplateStyle {
  return value === "template" || value === "keep";
}

/**
 * The draft with the template applied: its blocks replace the page's blocks, and its sample bio is
 * set when the page's bio is empty. With `style` `"template"` (the default) its theme also becomes
 * the page's theme with no page-level overrides; with `"keep"` the page's `theme` is left alone.
 * Nothing else changes: not the display name, not the photo or any profile option, not the share
 * settings, not `rev`. Never adds to the blocks, so the page can never go past 50.
 */
export function applyTemplate(
  draft: DraftDoc,
  template: Template,
  style: TemplateStyle = "template",
): DraftDoc {
  const blocks = buildTemplateBlocks(template, collectIds(draft));
  const writeBio = draft.profile.bio.trim() === "";
  return {
    ...draft,
    profile: writeBio ? { ...draft.profile, bio: template.bio } : draft.profile,
    theme: style === "keep" ? draft.theme : { ref: template.theme.id, overrides: {} },
    blocks,
  };
}

/**
 * Which style is selected when the choice opens (M7-08): the template's own for a page that has no
 * style of its own (no theme applied and no page-level overrides), and "keep my current style" for
 * a page that has one (any theme, page-level overrides only, or both). Blocks do not matter: this
 * is only a default, and the person can pick the other one.
 */
export function defaultTemplateStyle(draft: DraftDoc): TemplateStyle {
  return draft.theme.ref === null && Object.keys(draft.theme.overrides).length === 0
    ? "template"
    : "keep";
}

/**
 * Whether applying a template would throw away something the person set: any block, a theme, or
 * page-level style. M6-40's inline confirmation used it; since M7-08 every apply asks the style
 * question instead (`defaultTemplateStyle`), so the dialog no longer calls it.
 */
export function templateNeedsConfirmation(draft: DraftDoc): boolean {
  return (
    draft.blocks.length > 0 ||
    draft.theme.ref !== null ||
    Object.keys(draft.theme.overrides).length > 0
  );
}
