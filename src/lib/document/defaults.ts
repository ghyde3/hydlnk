import { newBlockId } from "./ids";
import { PROFILE_OPTION_DEFAULTS } from "./profile-options";
import type { AppStore, BookStore } from "./stores";
import type {
  AppLink,
  Block,
  BlockType,
  BookLink,
  DraftDoc,
  FaqItem,
  ListItem,
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

/** A new, empty store button of a book block (Amazon unless another store is asked for), with a fresh id. */
export function newBookLink(store: BookStore = "amazon"): BookLink {
  return { id: newBlockId(), store, url: "" };
}

/** A new, empty store button of an app block (the App Store unless another is asked for), with a fresh id. */
export function newAppLink(store: AppStore = "appstore"): AppLink {
  return { id: newBlockId(), store, url: "" };
}

/** A new, empty grid cell with a fresh id. */
export function newGridCell(): GridCell {
  return { id: newBlockId(), title: "", subtitle: "", url: "" };
}

/** A new, empty FAQ question with a fresh id (M9-16). */
export function newFaqItem(): FaqItem {
  return { id: newBlockId(), question: "", answer: "" };
}

/** A new, empty item of an items block, with a fresh id (M12-01). */
export function newListItem(): ListItem {
  return { id: newBlockId(), name: "", price: "", description: "", sold: false };
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
  faq: () => ({ id: newBlockId(), type: "faq", visible: true, items: [newFaqItem()] }),
  contact: () => ({
    id: newBlockId(),
    type: "contact",
    visible: true,
    name: "",
    phone: "",
    email: "",
    hours: "",
  }),
  discount: () => ({
    id: newBlockId(),
    type: "discount",
    visible: true,
    code: "",
    description: "",
    url: "",
  }),
  book: () => ({
    id: newBlockId(),
    type: "book",
    visible: true,
    title: "",
    author: "",
    cover: null,
    links: [newBookLink()],
  }),
  apps: () => ({ id: newBlockId(), type: "apps", visible: true, links: [newAppLink()] }),
  // The two ids are made here and never reused: each button of the card is counted by its own.
  map: () => ({
    id: newBlockId(),
    type: "map",
    visible: true,
    name: "",
    address: "",
    googleId: newBlockId(),
    appleId: newBlockId(),
  }),
  // Points at Home until the owner picks a page (M11-07).
  page_link: () => ({
    id: newBlockId(),
    type: "page_link",
    visible: true,
    label: "New page link",
    target: "home",
  }),
  // Two sample items to overwrite (M12-01).
  items: () => ({
    id: newBlockId(),
    type: "items",
    visible: true,
    layout: "list",
    items: [
      { id: newBlockId(), name: "Sample item", price: "$10", description: "", sold: false },
      { id: newBlockId(), name: "Another item", price: "$20", description: "", sold: false },
    ],
  }),
  // Monday to Friday 09:00 to 17:00, the weekend closed (M12-02).
  hours: () => {
    const weekday = () => ({ closed: false, ranges: [{ open: "09:00", close: "17:00" }] });
    const closed = () => ({ closed: true, ranges: [] });
    return {
      id: newBlockId(),
      type: "hours",
      visible: true,
      timezone: "America/New_York",
      days: {
        mon: weekday(),
        tue: weekday(),
        wed: weekday(),
        thu: weekday(),
        fri: weekday(),
        sat: closed(),
        sun: closed(),
      },
    };
  },
};

/**
 * The first draft of every new page (M1 claim): the handle as display name, no photo, the profile
 * display options at their defaults (M6-15, M6-17), no blocks, no theme, no overrides. `rev` starts
 * at 0.
 */
export function emptyDraft(handle: string): DraftDoc {
  return {
    version: 1,
    rev: 0,
    profile: { name: handle, bio: "", photo: null, ...PROFILE_OPTION_DEFAULTS },
    theme: { ref: null, overrides: {} },
    blocks: [],
  };
}
