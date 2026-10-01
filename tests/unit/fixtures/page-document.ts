import type { PageDocument, PublishedDocument } from "@/lib/schemas";
import { resolveTokens, type TokenSet } from "@/lib/theme";

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
  letterCase: "none",
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

/** A valid page document with one block of every type (embed appears once per provider). */
export const fullDocument: PageDocument = {
  version: 1,
  profile: {
    displayName: "Mara Okafor",
    bio: "Portrait & studio photographer · Orlando, FL",
    avatarUrl: "https://images.example.com/mara/avatar.webp",
  },
  themeId: "6f1c2a52-3a1e-4c0b-9d57-0b8f2f7a1e01",
  tokens: { accent: "#C46A4F", radius: 16 },
  blocks: [
    {
      id: "social-row-01",
      type: "social_row",
      visible: true,
      links: [
        { platform: "instagram", url: "https://www.instagram.com/maraokafor" },
        { platform: "tiktok", url: "https://www.tiktok.com/@maraokafor" },
        { platform: "youtube", url: "https://www.youtube.com/@maraokafor" },
        { platform: "email", url: "mailto:hello@maraokafor.com" },
        { platform: "website", url: "https://maraokafor.com" },
      ],
    },
    { id: "hdr_booking", type: "header", visible: true, text: "Book a session" },
    {
      id: "btn-portraits",
      type: "link_button",
      visible: true,
      label: "Portrait sessions — fall dates",
      url: "https://maraokafor.com/book/portraits",
    },
    {
      id: "btn-studio-01",
      type: "link_button",
      visible: true,
      label: "Studio rental by the hour",
      url: "https://maraokafor.com/studio?ref=links#rates",
      overrides: { buttonStyle: "outline", accent: "#9DB3C4", radius: 4 },
    },
    {
      id: "card-night-mkt",
      type: "link_card",
      visible: true,
      title: "Night Market",
      description: "A new series shot after dark. View the gallery.",
      url: "https://maraokafor.com/night-market",
      imageUrl: "https://images.example.com/mara/night-market.webp",
    },
    {
      id: "embed-yt-ep04",
      type: "embed",
      visible: true,
      provider: "youtube",
      url: "https://www.youtube.com/watch?v=jNQXAC9IVRw",
    },
    {
      id: "embed-spotify1",
      type: "embed",
      visible: true,
      provider: "spotify",
      url: "https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M",
    },
    { id: "divider-0001", type: "divider", visible: true },
    {
      id: "text-about-01",
      type: "text",
      visible: true,
      text: "Based in Orlando. Available for editorial and portrait work, worldwide.",
    },
    {
      id: "image-studio-1",
      type: "image",
      visible: true,
      url: "https://images.example.com/mara/studio.webp",
      alt: "The studio at golden hour",
      linkUrl: "https://maraokafor.com/studio",
      overrides: { surface: "#2A2118", border: "#4A4136" },
    },
    {
      id: "grid-prints-01",
      type: "grid2",
      visible: true,
      items: [
        { title: "Prints", url: "https://maraokafor.com/prints" },
        {
          title: "Workshops",
          url: "https://maraokafor.com/workshops",
          imageUrl: "https://images.example.com/mara/workshop.webp",
        },
      ],
    },
    { id: "hdr_hidden_01", type: "header", visible: false, text: "Coming soon" },
  ],
};

/** The same page as it would be stored after Publish: tokens resolved and frozen. */
export const fullPublishedDocument: PublishedDocument = {
  ...fullDocument,
  resolvedTokens: resolveTokens(noirTokens, fullDocument.tokens),
};
