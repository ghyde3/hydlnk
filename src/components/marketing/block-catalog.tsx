import type { ReactNode } from "react";
import { Icon } from "./primitives";

/**
 * Every block type (src/lib/document/schema.ts BLOCK_TYPES, in the same order; a unit test holds the two together) as the
 * marketing site describes them. `short` is the home page line; `detail` adds the limits for /features.
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
    detail: "An image banner with a title over it and a caption below. The whole card is the link.",
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
    detail:
      "Up to 600 characters, with line breaks kept. Add bold, italic, underline, strikethrough, links and left, center or right alignment.",
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
      "Upload a JPEG, PNG or WebP. Choose the focus point so the crop keeps what matters, and pick a shape. A short description (alt text) is required, so screen readers can describe it.",
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
      "Up to 8 icons: Instagram, TikTok, YouTube, X, Facebook, LinkedIn, GitHub, Threads, Reddit, Snapchat, Pinterest, Discord, Twitch, Spotify, email and your website. Each one shows the real logo.",
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
    short: "A video, a song or a stream, playing right on the page.",
    detail:
      "YouTube, Spotify, Vimeo, TikTok, Instagram, SoundCloud, Apple Music and Twitch. Everything except Spotify loads only when a visitor taps to play.",
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
  {
    id: "faq",
    name: "FAQ",
    short: "Questions and answers that open with a tap: shipping, sizing, how booking works.",
    detail:
      "Up to 10 questions. Each answer is up to 600 characters. Answers open and close even when a visitor has JavaScript turned off.",
    icon: (
      <Icon>
        <circle cx="12" cy="12" r="8.5" />
        <path d="M9.7 9.6a2.4 2.4 0 1 1 3.4 2.2c-.7.4-1.1.9-1.1 1.7M12 16.6v.1" />
      </Icon>
    ),
  },
  {
    id: "contact",
    name: "Contact details",
    short:
      "Your name, phone, email and opening hours, with a button that saves you to a phone’s contacts.",
    detail:
      "Phone and email are tappable. Save contact gives the visitor a contact card (a vCard file) they can add to their address book.",
    icon: (
      <Icon>
        <rect x="3.5" y="5" width="17" height="14" rx="2" />
        <circle cx="9" cy="11" r="2" />
        <path d="M5.8 16c.6-1.4 1.8-2 3.2-2s2.6.6 3.2 2M14.5 10h3.5M14.5 13.5h3.5" />
      </Icon>
    ),
  },
  {
    id: "discount",
    name: "Discount code",
    short: "A code visitors tap to copy, with an optional link to your shop.",
    detail:
      "Codes can be up to 32 characters. With JavaScript off, the code is still there to select and copy by hand.",
    icon: (
      <Icon>
        <path d="M4 12.5V5a1 1 0 0 1 1-1h7.5l7.5 7.5-8.5 8.5z" />
        <circle cx="8.5" cy="8.5" r="1.2" />
      </Icon>
    ),
  },
  {
    id: "book",
    name: "Book links",
    short: "A book’s cover, title and author, with buttons to buy it.",
    detail:
      "Up to 3 buy buttons: Amazon, Apple Books and Bookshop.org. Upload the cover, or leave it out.",
    icon: (
      <Icon>
        <path d="M5 4.5h10.5a2 2 0 0 1 2 2V20H7a2 2 0 0 1-2-2z" />
        <path d="M5 18a2 2 0 0 1 2-2h10.5M9 8h5" />
      </Icon>
    ),
  },
  {
    id: "apps",
    name: "App store buttons",
    short: "Download buttons for your app on the App Store and Google Play.",
    detail: "Add one or both. Each button shows the store’s own logo and goes to your listing.",
    icon: (
      <Icon>
        <rect x="7" y="3" width="10" height="18" rx="2" />
        <path d="M12 7.5v6M9.5 11.5l2.5 2.5 2.5-2.5" />
      </Icon>
    ),
  },
  {
    id: "map",
    name: "Map location",
    short: "Your address on a card, with a button that opens it in Maps.",
    detail:
      "A place name and an address, with Open in Maps for Google Maps or Apple Maps. There is no map picture on the page, and no code from Google.",
    icon: (
      <Icon>
        <path d="M12 21s6.5-5.6 6.5-11a6.5 6.5 0 0 0-13 0c0 5.4 6.5 11 6.5 11z" />
        <circle cx="12" cy="10" r="2.3" />
      </Icon>
    ),
  },
  {
    id: "page_link",
    name: "Page link",
    short: "A button to another page of your site: the menu, the shop, the bookings page.",
    detail:
      "Pick Home or any of your pages and it stays right if you rename the page or change its address. It takes the page’s button style, or its own.",
    icon: (
      <Icon>
        <rect x="3.5" y="4.5" width="10" height="13" rx="2" />
        <path d="M10.5 7.5h10v13h-10z" className="opacity-60" />
        <path d="M14 14h4M16.5 11.5l2.5 2.5-2.5 2.5" />
      </Icon>
    ),
  },
  {
    id: "items",
    name: "Items",
    short:
      "A price list or a menu: a name, a price, a short description and a photo for each item.",
    detail:
      "Up to 100 items as a list or a grid. Prices are shown exactly as you type them, an item can link out, and one tap marks it sold out.",
    icon: (
      <Icon>
        <path d="M4 7h10M4 12h10M4 17h10M17.5 7h2.5M17.5 12h2.5M17.5 17h2.5" />
      </Icon>
    ),
  },
  {
    id: "hours",
    name: "Opening hours",
    short: "Seven days of opening times in your time zone, with today marked.",
    detail:
      "Up to two time ranges a day, or closed. Today is marked in the visitor’s browser, so the page stays fast and cached; with JavaScript off the table shows the week and marks no day.",
    icon: (
      <Icon>
        <circle cx="12" cy="12" r="8.5" />
        <path d="M12 7.5V12l3 2" />
      </Icon>
    ),
  },
];

const NUMBER_WORDS = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
  "twenty",
  "twenty-one",
  "twenty-two",
  "twenty-three",
  "twenty-four",
  "twenty-five",
] as const;

/** How many block types there are, as a word ("eighteen"), derived from the catalog so copy never goes stale. */
export const BLOCK_COUNT_WORD: string =
  NUMBER_WORDS[BLOCK_CATALOG.length] ?? String(BLOCK_CATALOG.length);
/** The same with a capital, for the start of a sentence. */
export const BLOCK_COUNT_WORD_CAP: string =
  BLOCK_COUNT_WORD.charAt(0).toUpperCase() + BLOCK_COUNT_WORD.slice(1);
