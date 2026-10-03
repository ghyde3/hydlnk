import type { ReactNode } from "react";
import { Icon } from "./primitives";

/**
 * The nine block types (src/lib/document/schema.ts BLOCK_TYPES) as the marketing site describes
 * them. `short` is the home page line; `detail` adds the limits for /features.
 */
export interface BlockInfo {
  id: string;
  name: string;
  short: string;
  detail: string;
  icon: ReactNode;
}

export const BLOCK_CATALOG: readonly BlockInfo[] = [
  {
    id: "link",
    name: "Link",
    short: "A button to anywhere: shop, booking page, newsletter, latest post.",
    detail:
      "A full-width button with a label of up to 80 characters. It takes the page’s button style, or its own.",
    icon: (
      <Icon>
        <rect x="3.5" y="8" width="17" height="8" rx="2" />
        <path d="M8 12h8" />
      </Icon>
    ),
  },
  {
    id: "card",
    name: "Card",
    short: "A link with a picture, a title and a caption, for the things that deserve more room.",
    detail:
      "An image banner with a title over it and a caption below. The whole card is the link.",
    icon: (
      <Icon>
        <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
        <path d="M3.5 13.5h17M7 16.5h6" />
      </Icon>
    ),
  },
  {
    id: "header",
    name: "Header",
    short: "A heading that groups what follows: “Shop”, “Listen”, “Book a session”.",
    detail: "Set in your heading font, up to 80 characters.",
    icon: (
      <Icon>
        <path d="M6 5v14M18 5v14M6 12h12" />
      </Icon>
    ),
  },
  {
    id: "text",
    name: "Text",
    short: "A paragraph for opening hours, a short story or anything else worth saying.",
    detail: "Up to 600 characters, with line breaks kept.",
    icon: (
      <Icon>
        <path d="M4 6.5h16M4 11h16M4 15.5h11" />
      </Icon>
    ),
  },
  {
    id: "image",
    name: "Image",
    short: "A photo on its own, with a short description for screen readers. You can link it too.",
    detail:
      "Upload a JPEG, PNG or WebP. A short description (alt text) is required, so screen readers can describe it.",
    icon: (
      <Icon>
        <rect x="3.5" y="5" width="17" height="14" rx="2" />
        <circle cx="9" cy="10" r="1.8" />
        <path d="M20.5 16l-5-5-8 8" />
      </Icon>
    ),
  },
  {
    id: "social",
    name: "Social",
    short: "A row of icons for the places people follow you.",
    detail:
      "Up to 8 icons: Instagram, TikTok, YouTube, X, Facebook, LinkedIn, GitHub, Threads, email and your website.",
    icon: (
      <Icon>
        <circle cx="6" cy="12" r="2.5" />
        <circle cx="12" cy="12" r="2.5" />
        <circle cx="18" cy="12" r="2.5" />
      </Icon>
    ),
  },
  {
    id: "embed",
    name: "Embed",
    short: "A YouTube video or a Spotify player, right on the page.",
    detail:
      "YouTube videos, and Spotify tracks, albums, playlists, episodes, shows and artists. YouTube loads only when a visitor presses play.",
    icon: (
      <Icon>
        <rect x="3.5" y="5.5" width="17" height="13" rx="2.5" />
        <path d="M10.5 9.5v5l4.5-2.5z" />
      </Icon>
    ),
  },
  {
    id: "grid",
    name: "Grid",
    short: "Two to six tiles side by side, each with a title, a subtitle and a link.",
    detail: "Two columns of linked tiles: services, collections, episodes, anything in a set.",
    icon: (
      <Icon>
        <rect x="4" y="4" width="7" height="7" rx="1" />
        <rect x="13" y="4" width="7" height="7" rx="1" />
        <rect x="4" y="13" width="7" height="7" rx="1" />
        <rect x="13" y="13" width="7" height="7" rx="1" />
      </Icon>
    ),
  },
  {
    id: "divider",
    name: "Divider",
    short: "A quiet line that gives the page some rhythm.",
    detail: "A thin line in a color that matches your theme, with spacing that follows your page.",
    icon: (
      <Icon>
        <path d="M3.5 12h17" />
        <path d="M8 7.5h8M8 16.5h8" className="opacity-40" />
      </Icon>
    ),
  },
];
