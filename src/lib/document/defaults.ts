import { newBlockId } from "./ids";
import type {
  Block,
  BlockType,
  DraftDoc,
  GridCell,
  ImageBlock,
  SocialBlock,
  SocialIcon,
  SocialPlatform,
} from "./schema";

/** A new, empty social icon (platform defaults to Instagram) with a fresh id. */
export function newSocialIcon(platform: SocialPlatform = "instagram"): SocialIcon {
  return platform === "email"
    ? { id: newBlockId(), platform, address: "" }
    : { id: newBlockId(), platform, url: "" };
}

/**
 * Switches an icon to another platform, keeping its id. Moving between Email and a web platform
 * swaps the `address` and `url` fields (the old value does not carry over).
 */
export function changeSocialPlatform(icon: SocialIcon, platform: SocialPlatform): SocialIcon {
  if (platform === icon.platform) return icon;
  if (platform === "email") return { id: icon.id, platform, address: "" };
  if (icon.platform === "email") return { id: icon.id, platform, url: "" };
  return { id: icon.id, platform, url: icon.url };
}

/** A new, empty grid cell with a fresh id. */
export function newGridCell(): GridCell {
  return { id: newBlockId(), title: "", subtitle: "", url: "" };
}

/**
 * What each "Add a block" chip appends (M2-10): a fresh block with a new id, visible, and the
 * default content. Every default passes `draftDocSchema`; none passes `publishDocSchema` until the
 * user fills it in (except header, text and divider).
 */
export const blockDefaults: Record<BlockType, () => Block> = {
  link: () => ({ id: newBlockId(), type: "link", visible: true, label: "New link", url: "" }),
  card: () => ({
    id: newBlockId(),
    type: "card",
    visible: true,
    title: "New card",
    caption: "",
    url: "",
    image: null,
  }),
  header: () => ({ id: newBlockId(), type: "header", visible: true, text: "New section" }),
  text: () => ({ id: newBlockId(), type: "text", visible: true, text: "New text block" }),
  image: (): ImageBlock => ({
    id: newBlockId(),
    type: "image",
    visible: true,
    image: null,
    alt: "",
    url: "",
  }),
  social: (): SocialBlock => ({
    id: newBlockId(),
    type: "social",
    visible: true,
    icons: [newSocialIcon("instagram")],
  }),
  embed: () => ({
    id: newBlockId(),
    type: "embed",
    visible: true,
    url: "",
    caption: "Video or music",
  }),
  grid: () => ({
    id: newBlockId(),
    type: "grid",
    visible: true,
    cells: [newGridCell(), newGridCell()],
  }),
  divider: () => ({ id: newBlockId(), type: "divider", visible: true }),
};

/**
 * The first draft of every new page (M1 claim): the handle as display name, no photo, no blocks,
 * no theme, no overrides. `rev` starts at 0.
 */
export function emptyDraft(handle: string): DraftDoc {
  return {
    version: 1,
    rev: 0,
    profile: { name: handle, bio: "", photo: null },
    theme: { ref: null, overrides: {} },
    blocks: [],
  };
}
