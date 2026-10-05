import {
  BLOCK_TYPES,
  BLOCK_TYPE_LABELS,
  blockDefaults,
  SOCIAL_PLATFORM_LABELS,
  type Block,
  type BlockType,
  type PublishDoc,
  type SocialIcon,
  type SocialPlatform,
} from "@/lib/document";
import { resolveTokens } from "@/lib/theme";
import { styleOverrides, tryTheme, type TryStyle, type TryThemeId } from "./themes";

/**
 * The sample page behind the try-it builder: a fictional creator's page as an in-memory
 * `PublishDoc`, drawn by the real page renderer. Nothing here is saved or sent anywhere. Every
 * link points at example.com (or a platform's home page) and the preview is inert, so nothing in it
 * can be followed. No uploaded images: the renderer builds image URLs from the storage bucket, so
 * the sample has none, and an Image block shows the renderer's own "empty image" placeholder.
 */

export type TryBlockKind = BlockType;
/**
 * The block kinds the demo offers: the nine v1 originals (M1-25). The Wave K blocks (M9-15: faq,
 * contact, discount, book, apps, map) are drawn by `makeBlock` all the same, but the landing page's
 * builder does not list them.
 */
export const TRY_BLOCK_KINDS: readonly TryBlockKind[] = BLOCK_TYPES.slice(0, 9);

/** The most blocks the demo page holds. The product allows 50; a phone preview has no use for that. */
export const TRY_MAX_BLOCKS = 12;

/** Under the phone until the first change: says what the phone is. */
export const PREVIEW_HINT = "This is a real HYDLNK page. Tap a theme to restyle it.";

export const DEFAULT_NAME = "Jordan Ellis";
export const DEFAULT_BIO = "Making things and sharing them. New every week.";
const DEFAULT_SOCIALS: readonly SocialPlatform[] = ["instagram", "tiktok", "youtube", "email"];
const DEFAULT_LINK_LABELS = [
  "Watch my latest video",
  "Join the newsletter",
  "Support my work",
  "Read the latest post",
];

/** Where the builder starts. Landing pages pass their own to open on a fitting theme and blocks. */
export interface TryPreset {
  theme?: TryThemeId;
  /** The name on the page until the visitor types their own. */
  name?: string;
  bio?: string;
  /** The blocks the page starts with, in order. */
  blocks?: readonly TryBlockKind[];
  /** The platforms in a social row (1 to 8). */
  socials?: readonly SocialPlatform[];
  /** Labels for link blocks, in order. */
  linkLabels?: readonly string[];
}

export const DEFAULT_PRESET: Required<Pick<TryPreset, "theme" | "blocks">> = {
  theme: "sage",
  blocks: ["social", "link", "link", "card"],
};

const SOCIAL_URLS: Record<Exclude<SocialPlatform, "email">, string> = {
  instagram: "https://www.instagram.com/",
  tiktok: "https://www.tiktok.com/",
  youtube: "https://www.youtube.com/",
  x: "https://x.com/",
  facebook: "https://www.facebook.com/",
  linkedin: "https://www.linkedin.com/",
  github: "https://github.com/",
  threads: "https://www.threads.net/",
  reddit: "https://www.reddit.com/",
  snapchat: "https://www.snapchat.com/",
  pinterest: "https://www.pinterest.com/",
  discord: "https://discord.com/",
  twitch: "https://www.twitch.tv/",
  spotify: "https://open.spotify.com/",
  website: "https://example.com/",
};

/** `try-link-0003`: 8 to 24 characters of the block-id alphabet, and the same on server and client. */
function blockId(kind: TryBlockKind, serial: number): string {
  return `try-${kind}-${String(serial).padStart(4, "0")}`;
}

function socialIcons(id: string, platforms: readonly SocialPlatform[]): SocialIcon[] {
  return platforms.slice(0, 8).map((platform, index): SocialIcon => {
    const iconId = `${id}-${index}`;
    return platform === "email"
      ? { id: iconId, platform, address: "hello@example.com" }
      : { id: iconId, platform, url: SOCIAL_URLS[platform] };
  });
}

/**
 * One block with sample content. `serial` makes the id unique; `variant` (how many blocks of this
 * kind the page already holds) rotates the link labels so two added links do not read the same.
 */
export function makeBlock(
  kind: TryBlockKind,
  serial: number,
  options: {
    variant?: number;
    socials?: readonly SocialPlatform[];
    linkLabels?: readonly string[];
  } = {},
): Block {
  const id = blockId(kind, serial);
  const common = { id, visible: true } as const;
  const variant = options.variant ?? 0;
  switch (kind) {
    case "link": {
      const labels = options.linkLabels?.length ? options.linkLabels : DEFAULT_LINK_LABELS;
      return {
        ...common,
        type: "link",
        label: labels[variant % labels.length]!,
        url: `https://example.com/link-${variant + 1}`,
      };
    }
    case "page_link":
      // M11-07: not a block the try-it page offers; a harmless link to Home keeps the switch total.
      return { ...common, type: "page_link", label: "Home", target: "home" };
    case "items":
      // M12-01: not a block the try-it page offers; the default keeps the switch total.
      return {
        ...common,
        type: "items",
        layout: "list",
        items: [{ id: `${id}-0`, name: "Print", price: "$20", description: "", sold: false }],
      };
    case "hours":
      // M12-02: not a block the try-it page offers; the default keeps the switch total.
      return { ...blockDefaults.hours(), id };
    case "card":
      return {
        ...common,
        type: "card",
        title: "Behind the scenes",
        caption: "A look at how it gets made",
        url: "https://example.com/behind-the-scenes",
        image: null,
      };
    case "header":
      return { ...common, type: "header", text: "Start here" };
    case "text":
      return {
        ...common,
        type: "text",
        text: "I make small things for people who like small things. Say hello any time.",
      };
    case "image":
      return { ...common, type: "image", image: null, alt: "Your photo goes here" };
    case "social":
      return {
        ...common,
        type: "social",
        icons: socialIcons(id, options.socials ?? DEFAULT_SOCIALS),
      };
    case "embed":
      return {
        ...common,
        type: "embed",
        url: "https://www.youtube.com/watch?v=aqz-KE-bpKQ",
        caption: "My latest video",
      };
    case "grid":
      return {
        ...common,
        type: "grid",
        cells: [
          {
            id: `${id}-0`,
            title: "Prints",
            subtitle: "Small batches",
            url: "https://example.com/prints",
          },
          { id: `${id}-1`, title: "Zines", subtitle: "Out now", url: "https://example.com/zines" },
        ],
      };
    case "divider":
      return { ...common, type: "divider" };
    case "faq":
      return {
        ...common,
        type: "faq",
        items: [
          {
            id: `${id}-0`,
            question: "Do you ship worldwide?",
            answer: "Yes. Orders leave the studio within three days.",
          },
          {
            id: `${id}-1`,
            question: "Can I commission a piece?",
            answer: "Send me a message with what you have in mind.",
          },
        ],
      };
    case "contact":
      return {
        ...common,
        type: "contact",
        name: "Mara Okafor",
        phone: "+1 555 123 4567",
        email: "hello@example.com",
        hours: "Mon to Fri, 9am to 5pm",
      };
    case "discount":
      return {
        ...common,
        type: "discount",
        code: "SAVE10",
        description: "10% off your first order",
        url: "https://example.com/shop",
      };
    case "book":
      return {
        ...common,
        type: "book",
        title: "The Night Market",
        author: "Mara Okafor",
        cover: null,
        links: [
          { id: `${id}-0`, store: "amazon", url: "https://example.com/amazon" },
          { id: `${id}-1`, store: "bookshop", url: "https://example.com/bookshop" },
        ],
      };
    case "apps":
      return {
        ...common,
        type: "apps",
        links: [
          { id: `${id}-0`, store: "appstore", url: "https://example.com/app-store" },
          { id: `${id}-1`, store: "googleplay", url: "https://example.com/google-play" },
        ],
      };
    case "map":
      return {
        ...common,
        type: "map",
        name: "Okafor Studio",
        address: "12 Canal Street, Brooklyn, NY",
        googleId: `${id}-g`,
        appleId: `${id}-a`,
      };
  }
}

/** The starting blocks of a preset, with serials 1..n. */
export function presetBlocks(preset: TryPreset = {}): Block[] {
  const kinds = preset.blocks?.length ? preset.blocks : DEFAULT_PRESET.blocks;
  const seen: Partial<Record<TryBlockKind, number>> = {};
  return kinds.map((kind, index) => {
    const variant = seen[kind] ?? 0;
    seen[kind] = variant + 1;
    return makeBlock(kind, index + 1, {
      variant,
      socials: preset.socials,
      linkLabels: preset.linkLabels,
    });
  });
}

/** What the builder holds: the theme, the visitor's style choices, the name and the blocks. */
export interface TryPageState {
  themeId: TryThemeId;
  style: TryStyle;
  /** What the visitor typed. Empty shows the preset's name. */
  name: string;
  blocks: Block[];
}

/** The page document for a state: the theme, the style overrides on top, resolved like the product does. */
export function buildTryDoc(state: TryPageState, preset: TryPreset = {}): PublishDoc {
  const theme = tryTheme(state.themeId);
  const overrides = styleOverrides(theme, state.style);
  const name = state.name.trim();
  return {
    version: 1,
    profile: {
      name: name === "" ? (preset.name ?? DEFAULT_NAME) : name,
      bio: preset.bio ?? DEFAULT_BIO,
      photo: null,
    },
    theme: { ref: null, overrides },
    tokens: resolveTokens(theme.tokens, overrides),
    blocks: state.blocks,
  };
}

/** "Link", "Social"…: the block's name in the editor. */
export function blockName(block: Block): string {
  return BLOCK_TYPE_LABELS[block.type];
}

function clip(value: string, max = 36): string {
  return value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value;
}

/** A short line that tells two blocks of the same kind apart: "Watch my latest video". */
export function blockSummary(block: Block): string {
  switch (block.type) {
    case "link":
      return clip(block.label);
    case "card":
      return clip(block.title);
    case "header":
      return clip(block.text);
    case "text":
      return clip(block.text);
    case "image":
      return "Your photo";
    case "social":
      return clip(block.icons.map((icon) => SOCIAL_PLATFORM_LABELS[icon.platform]).join(", "));
    case "embed":
      return clip(block.caption || "Video");
    case "grid":
      return clip(block.cells.map((cell) => cell.title).join(", "));
    case "divider":
      return "A quiet line";
    case "faq":
      return clip(block.items[0]?.question || "Questions and answers");
    case "contact":
      return clip(block.name || "Contact details");
    case "discount":
      return clip(block.code || "Discount code");
    case "book":
      return clip(block.title || "Book links");
    case "apps":
      return "App Store and Google Play";
    case "map":
      return clip(block.name || "Map location");
    case "page_link":
      // M11-07: not offered by the try-it page; the renderer worker may refine this.
      return clip(block.label);
    case "items":
      // M12-01: not offered by the try-it page.
      return clip(block.heading || "Items");
    case "hours":
      // M12-02: not offered by the try-it page.
      return "Opening hours";
  }
}
