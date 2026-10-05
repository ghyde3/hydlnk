import type { Block, DraftDoc, ImageRef, PublishDoc } from "@/lib/document";
import { PROFILE_OPTION_DEFAULTS, toPublishForm } from "@/lib/document";
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
  gradientAngle: 180,
  gradientFrom: null,
  gradientTo: null,
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

/** A book's cover (M9-20): a 2:3 portrait in the owner's folder. */
export const bookCoverRef: ImageRef = {
  path: `${OWNER_UID}/night-market-cover.webp`,
  width: 800,
  height: 1200,
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
  book: {
    id: "book-night-mkt1",
    type: "book",
    visible: true,
    title: "The Night Market",
    author: "Mara Okafor",
    cover: bookCoverRef,
    links: [
      { id: "book-amazon-001", store: "amazon", url: "https://www.amazon.com/dp/0000000000" },
      {
        id: "book-apple-0001",
        store: "apple",
        url: "https://books.apple.com/us/book/id0000000000",
      },
      {
        id: "book-bkshop-001",
        store: "bookshop",
        url: "https://bookshop.org/p/books/the-night-market",
      },
    ],
  },
  apps: {
    id: "apps-studio-001",
    type: "apps",
    visible: true,
    links: [
      { id: "app-appstore-01", store: "appstore", url: "https://apps.apple.com/app/id0000000000" },
      {
        id: "app-googleplay1",
        store: "googleplay",
        url: "https://play.google.com/store/apps/details?id=com.example.studio",
      },
    ],
  },
  map: {
    id: "map-studio-0001",
    type: "map",
    visible: true,
    name: "Okafor Studio",
    address: "12 Canal Street, Brooklyn, NY 11201",
    googleId: "map-google-0001",
    appleId: "map-apple-00001",
  },
  page_link: {
    id: "page-link-001",
    type: "page_link",
    visible: true,
    label: "Directions",
    target: "home",
  },
  items: {
    id: "items-block-001",
    type: "items",
    visible: true,
    heading: "Prints",
    layout: "list",
    items: [
      {
        id: "item-print-0001",
        name: "Night market print",
        price: "$40",
        description: "A3, signed.",
        sold: false,
        url: "https://example.com/prints/night-market",
      },
      { id: "item-print-0002", name: "Canal print", price: "$35", description: "", sold: true },
    ],
  },
  hours: {
    id: "hours-block-001",
    type: "hours",
    visible: true,
    timezone: "America/New_York",
    days: {
      mon: { closed: false, ranges: [{ open: "09:00", close: "17:00" }] },
      tue: { closed: false, ranges: [{ open: "09:00", close: "17:00" }] },
      wed: { closed: false, ranges: [{ open: "09:00", close: "17:00" }] },
      thu: { closed: false, ranges: [{ open: "09:00", close: "17:00" }] },
      fri: { closed: false, ranges: [{ open: "09:00", close: "17:00" }] },
      sat: { closed: true, ranges: [] },
      sun: { closed: true, ranges: [] },
    },
    note: "Closed on public holidays.",
  },
  faq: {
    id: "faq-block-001",
    type: "faq",
    visible: true,
    items: [
      {
        id: "faq-item-0001",
        question: "Do you ship worldwide?",
        answer: "Yes.\nOrders leave the studio within three days.",
      },
      {
        id: "faq-item-0002",
        question: "Can I commission a piece?",
        answer: "Send a message with what you have in mind.",
      },
    ],
  },
  contact: {
    id: "contact-0001",
    type: "contact",
    visible: true,
    name: "Mara Okafor",
    phone: "+1 (555) 123-4567",
    email: "hello@maraokafor.com",
    hours: "Mon to Fri, 9am to 5pm\nSat by appointment",
  },
  discount: {
    id: "discount-0001",
    type: "discount",
    visible: true,
    code: "SAVE10",
    description: "10% off your first print",
    url: "https://maraokafor.com/prints",
  },
} satisfies Record<string, Block>;

/** A valid draft with one block of every type, a hidden block, a block override and a page override. */
export const fullDraft: DraftDoc = {
  version: 1,
  rev: 7,
  profile: {
    name: "Mara Okafor",
    bio: "Portrait & studio photographer · Orlando, FL",
    photo: photoRef,
    // The loader and the schemas fill the profile display options (M6-15, M6-17), so a parsed or
    // loaded copy of this draft carries them explicitly.
    ...PROFILE_OPTION_DEFAULTS,
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
    blocks.faq,
    blocks.contact,
    blocks.discount,
    blocks.text,
    blocks.book,
    blocks.apps,
    blocks.map,
    blocks.page_link,
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
