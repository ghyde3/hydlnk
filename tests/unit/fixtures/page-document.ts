import type { Block, DraftDoc, ImageRef, PublishDoc } from "@/lib/document";
import { toPublishForm } from "@/lib/document";
import type { TokenSet } from "@/lib/theme";

/** A complete theme modelled on the Noir sample in design/mockups. */
export const noirTokens: TokenSet = {
  bg: "#16120E",
  surface: "#221B13",
  text: "#EFE8DC",
  textMuted: "#A79E90",
  accent: "#C9A86A",
  buttonBg: "#C9A86A",
  buttonText: "#15110B",
  border: "#3A342D",
  fontHeading: "Instrument Serif",
  fontBody: "Geist",
  scale: 1,
  weightHeading: 400,
  letterCase: "normal",
  radius: 12,
  borderWidth: 1,
  buttonStyle: "fill",
  density: "regular",
  maxWidth: 480,
  align: "center",
  bgType: "solid",
  bgImage: null,
  overlayOpacity: 0,
  blur: 0,
};

export const OWNER_UID = "6f1c2a52-3a1e-4c0b-9d57-0b8f2f7a1e01";

export const photoRef: ImageRef = {
  path: `${OWNER_UID}/0b8f2f7a-1e01-4c0b-9d57-6f1c2a523a1e.jpg`,
  width: 400,
  height: 400,
};

export const bannerRef: ImageRef = {
  path: `${OWNER_UID}/night-market-banner.webp`,
  width: 1200,
  height: 480,
};

/** A complete, publishable block of each type, with fixed ids. */
export const blocks = {
  link: {
    id: "link-portraits",
    type: "link",
    visible: true,
    label: "Portrait sessions — fall dates",
    url: "https://maraokafor.com/book/portraits",
  },
  card: {
    id: "card-night-mkt",
    type: "card",
    visible: true,
    title: "Night Market",
    caption: "View the gallery",
    url: "https://maraokafor.com/night-market",
    image: bannerRef,
  },
  header: { id: "header-booking", type: "header", visible: true, text: "Book a session" },
  text: {
    id: "text-about-01",
    type: "text",
    visible: true,
    text: "Based in Orlando.\nAvailable for editorial and portrait work.",
  },
  image: {
    id: "image-studio-1",
    type: "image",
    visible: true,
    image: bannerRef,
    alt: "The studio at golden hour",
    url: "https://maraokafor.com/studio",
  },
  social: {
    id: "social-row-01",
    type: "social",
    visible: true,
    icons: [
      { id: "icon-instagram", platform: "instagram", url: "https://instagram.com/maraokafor" },
      { id: "icon-threads-1", platform: "threads", url: "https://www.threads.net/@maraokafor" },
      { id: "icon-email-001", platform: "email", address: "hello@maraokafor.com" },
    ],
  },
  embed: {
    id: "embed-yt-ep04",
    type: "embed",
    visible: true,
    url: "https://www.youtube.com/watch?v=jNQXAC9IVRw",
    caption: "Behind the lens, ep. 4",
  },
  grid: {
    id: "grid-prints-01",
    type: "grid",
    visible: true,
    cells: [
      {
        id: "cell-prints-01",
        title: "Prints",
        subtitle: "Shop the archive",
        url: "https://maraokafor.com/prints",
      },
      {
        id: "cell-works-001",
        title: "Workshops",
        subtitle: "Small groups",
        url: "https://maraokafor.com/workshops",
      },
    ],
  },
  divider: { id: "divider-0001", type: "divider", visible: true },
} satisfies Record<string, Block>;

/** A valid draft with one block of every type, a hidden block, a block override and a page override. */
export const fullDraft: DraftDoc = {
  version: 1,
  rev: 7,
  profile: {
    name: "Mara Okafor",
    bio: "Portrait & studio photographer · Orlando, FL",
    photo: photoRef,
  },
  theme: {
    ref: "00000000-0000-4000-8000-000000000001",
    overrides: { accent: "#C46A4F", radius: 16 },
  },
  blocks: [
    blocks.social,
    blocks.header,
    { ...blocks.link, overrides: { buttonStyle: "pill", accent: "#9DB3C4", radius: 4 } },
    blocks.card,
    blocks.embed,
    blocks.image,
    blocks.grid,
    blocks.divider,
    blocks.text,
    { id: "header-hidden-1", type: "header", visible: false, text: "Coming soon" },
  ],
};

/** The same page as Publish stores it: Noir resolved under the page overrides, hidden block gone. */
export const fullPublished: PublishDoc = toPublishForm(fullDraft, noirTokens);

/** A draft holding only `block...` (fresh ids are the caller's job), for one-block schema tests. */
export function draftWith(...docBlocks: unknown[]): unknown {
  return {
    version: 1,
    rev: 1,
    profile: { name: "Mara Okafor", bio: "", photo: null },
    theme: { ref: null, overrides: {} },
    blocks: docBlocks,
  };
}
