import type { Block, DraftDoc, PublishDoc } from "@/lib/document";
import { PROFILE_OPTION_DEFAULTS, toPublishForm } from "@/lib/document";
import { bannerRef, fullPublished, noirTokens, photoRef } from "./page-document";

/**
 * The two documents the live-page builder is compared on (M8-02, M8-08): the M2-31 nine-block
 * fixture (`fullPublished`) and the Wave G fixture below, which holds what Waves G and H added: all
 * eight embed providers, link icons and thumbnails, a featured link, image focus and shapes, text
 * marks and links, a share card, a gradient and block overrides, a profile photo with shape, size and
 * border options. Plain data, no React.
 */

export const PAGE_ID = "00000000-0000-4000-8000-0000000000b1";

const EMBEDS: Array<[string, string, string]> = [
  ["youtube", "https://www.youtube.com/watch?v=jNQXAC9IVRw", "Behind the lens"],
  ["spotify", "https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC", "Studio playlist"],
  ["vimeo", "https://vimeo.com/76979871", "Showreel"],
  ["tiktok", "https://www.tiktok.com/@mara/video/7234567890123456789", ""],
  ["instagram", "https://www.instagram.com/reel/CxYz12AbCde/", "A reel"],
  ["soundcloud", "https://soundcloud.com/maraokafor/night-market-mix", "Night market mix"],
  ["apple", "https://music.apple.com/us/album/the-album/1440857781", "The album"],
  ["twitch", "https://www.twitch.tv/mara_plays", "Live"],
];

const embedBlocks: Block[] = EMBEDS.map(([name, url, caption]) => ({
  id: `embed-${name}-0001`,
  type: "embed" as const,
  visible: true,
  url,
  caption,
}));

export const waveGDraft: DraftDoc = {
  version: 1,
  rev: 3,
  profile: {
    name: "Mara <Okafor> & Co",
    bio: 'Portrait & studio "photographer" · Orlando, FL',
    photo: photoRef,
    ...PROFILE_OPTION_DEFAULTS,
    photoShape: "rounded",
    photoSize: "large",
    photoBorder: "thin",
  },
  theme: { ref: null, overrides: { accent: "#C46A4F", radius: 16 } },
  share: { title: "Mara on HYDLNK", description: "Book a session & see the work", image: null },
  blocks: [
    {
      id: "social-row-0001",
      type: "social",
      visible: true,
      icons: [
        { id: "icon-instagram", platform: "instagram", url: "https://instagram.com/maraokafor" },
        { id: "icon-tiktok-01", platform: "tiktok", url: "https://tiktok.com/@maraokafor" },
        { id: "icon-youtube-1", platform: "youtube", url: "https://youtube.com/@maraokafor" },
        { id: "icon-email-001", platform: "email", address: "hello@maraokafor.com" },
      ],
    },
    { id: "header-booking", type: "header", visible: true, text: "Book a session" },
    {
      id: "link-featured-1",
      type: "link",
      visible: true,
      label: "Portrait sessions",
      url: "https://maraokafor.com/book",
      icon: { type: "builtin", name: "camera" },
      featured: "pulse",
      overrides: { buttonStyle: "pill", accent: "#9DB3C4" },
    },
    {
      id: "link-thumb-0001",
      type: "link",
      visible: true,
      label: "Studio rental",
      url: "https://maraokafor.com/studio",
      icon: { type: "image", image: photoRef },
    },
    {
      id: "link-plain-0001",
      type: "link",
      visible: true,
      label: "Workshops",
      url: "https://maraokafor.com/workshops",
    },
    {
      id: "text-marks-0001",
      type: "text",
      visible: true,
      text: "Bold, italic and a link inside one text block.",
      marks: [
        { type: "bold", start: 0, end: 4 },
        { type: "italic", start: 6, end: 12 },
        {
          type: "link",
          id: "mark-link-0001",
          start: 27,
          end: 31,
          url: "https://maraokafor.com/about",
        },
      ],
    },
    {
      id: "card-night-mkt",
      type: "card",
      visible: true,
      title: "Night Market",
      caption: 'The "gallery"',
      url: "https://maraokafor.com/night-market",
      image: { ...bannerRef, focus: { x: 0.25, y: 0.75 } },
    },
    {
      id: "image-shaped-01",
      type: "image",
      visible: true,
      image: { ...bannerRef, focus: { x: 0.2, y: 0.4 } },
      alt: "The studio at golden hour",
      shape: "wide",
      url: "https://maraokafor.com/studio",
    },
    ...embedBlocks,
    {
      id: "grid-prints-01",
      type: "grid",
      visible: true,
      cells: [
        { id: "cell-prints-01", title: "Prints", subtitle: "Shop", url: "https://maraokafor.com/p" },
        { id: "cell-works-001", title: "Workshops", subtitle: "", url: "https://maraokafor.com/w" },
      ],
    },
    { id: "divider-0001", type: "divider", visible: true },
    { id: "header-hidden-1", type: "header", visible: false, text: "Coming soon" },
  ],
};

const waveGTokens = {
  ...noirTokens,
  fontHeading: "Fraunces" as const,
  weightHeading: 700 as const,
  fontBody: "Inter" as const,
  bgType: "gradient" as const,
  gradientAngle: 135 as const,
  gradientFrom: "#221B13",
  gradientTo: "#16120E",
};

export const waveGPublished: PublishDoc = toPublishForm(waveGDraft, waveGTokens);

/** The two comparison documents, by name. */
export const PARITY_DOCS: Array<[string, PublishDoc]> = [
  ["the M2-31 nine-block fixture", fullPublished],
  ["the Wave G fixture", waveGPublished],
];

/** A published document with one block of each given type's worth of text replaced by hostile strings. */
export const HOSTILE_STRINGS = [
  "<script>window.__x=1</script>",
  '"><img src=x onerror=window.__x=1>',
  "</style><script>window.__x=1</script>",
  "javascript:window.__x=1",
] as const;
