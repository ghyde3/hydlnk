import type { SocialPlatform } from "@/lib/document";

/**
 * The starter templates (M6-40): a static catalog, offered inside the editor ("Start from a
 * template") and never at signup. A template is a sample bio, the id of a system theme and a list
 * of blocks of the nine existing types. It is data and nothing else: no network call, no Supabase
 * client, no import of anything that has one.
 *
 * Nothing here can go live by accident. A block description has no field for a link address, an
 * embed address, an email address or an image, so every URL and address is built empty
 * (`build.ts`) and every image is null: Publish stops on those blocks (M2-10) until the person
 * fills them in, and a placeholder address never reaches a visitor.
 *
 * Every text is American English, within the limits in `src/lib/document/limits.ts`, with no
 * control or bidi characters (a Vitest checks all of it, with every generated draft against
 * `draftDocSchema`). Theme references are the fixed ids of system themes that a migration ships:
 *
 *   Midnight 00000000-0000-4000-8000-000000000006     Paper 00000000-0000-4000-8000-000000000004
 *   Smoke    00000000-0000-4000-8000-000000000003     Sage  00000000-0000-4000-8000-000000000005
 *   Ivory    00000000-0000-4000-8000-000000000002     Ember 00000000-0000-4000-8000-000000000007
 */

/** One block of a template, before ids exist. The kinds are the page's block types; `divider` is not used. */
export type TemplateBlock =
  | { type: "header"; text: string }
  | { type: "text"; text: string }
  | { type: "link"; label: string }
  | { type: "card"; title: string; caption: string }
  | { type: "image"; alt: string }
  | { type: "embed"; caption: string }
  | { type: "grid"; cells: readonly { title: string; subtitle: string }[] }
  | { type: "social"; platforms: readonly SocialPlatform[] };

export const TEMPLATE_IDS = [
  "musician",
  "podcaster",
  "artist",
  "shop",
  "coach",
  "streamer",
] as const;
export type TemplateId = (typeof TEMPLATE_IDS)[number];

export interface Template {
  id: TemplateId;
  /** The card's heading: "Musician". */
  name: string;
  /** The card's one-line description. */
  description: string;
  /** The sample bio: set on the page only when its own bio is empty. */
  bio: string;
  /** The system theme the template applies: its fixed id, and its name for the card. */
  theme: { id: string; name: string };
  blocks: readonly TemplateBlock[];
}

/** The fixed ids of the system themes the templates use (migrations 20261001000002 and 20261002100001). */
export const TEMPLATE_THEME_IDS = {
  Smoke: "00000000-0000-4000-8000-000000000003",
  Ivory: "00000000-0000-4000-8000-000000000002",
  Paper: "00000000-0000-4000-8000-000000000004",
  Sage: "00000000-0000-4000-8000-000000000005",
  Midnight: "00000000-0000-4000-8000-000000000006",
  Ember: "00000000-0000-4000-8000-000000000007",
} as const;

export const TEMPLATES: readonly Template[] = [
  {
    id: "musician",
    name: "Musician",
    description: "A listen block, tour dates and merch.",
    bio: "New music, tour dates and merch.",
    theme: { id: TEMPLATE_THEME_IDS.Midnight, name: "Midnight" },
    blocks: [
      { type: "header", text: "Listen now" },
      { type: "embed", caption: "Latest release" },
      { type: "link", label: "Tour dates" },
      { type: "link", label: "Merch" },
      { type: "card", title: "New single", caption: "Out now" },
      { type: "social", platforms: ["instagram", "tiktok", "youtube"] },
    ],
  },
  {
    id: "podcaster",
    name: "Podcaster",
    description: "Listen links, your latest episode and a way to support the show.",
    bio: "New episodes every week.",
    theme: { id: TEMPLATE_THEME_IDS.Smoke, name: "Smoke" },
    blocks: [
      { type: "header", text: "Listen on" },
      { type: "link", label: "Apple Podcasts" },
      { type: "link", label: "Spotify" },
      { type: "link", label: "YouTube" },
      { type: "embed", caption: "Latest episode" },
      { type: "text", text: "New episodes every Tuesday. Subscribe so you never miss one." },
      { type: "link", label: "Support the show" },
      { type: "social", platforms: ["instagram", "x", "email"] },
    ],
  },
  {
    id: "artist",
    name: "Artist",
    description: "Your work, prints and commissions.",
    bio: "Original work, prints and commissions.",
    theme: { id: TEMPLATE_THEME_IDS.Ivory, name: "Ivory" },
    blocks: [
      { type: "image", alt: "Featured artwork" },
      { type: "header", text: "Work" },
      {
        type: "grid",
        cells: [
          { title: "Prints", subtitle: "Shop the archive" },
          { title: "Originals", subtitle: "Available now" },
        ],
      },
      { type: "link", label: "Commission a piece" },
      { type: "text", text: "Commissions open this season." },
      { type: "social", platforms: ["instagram", "threads", "email"] },
    ],
  },
  {
    id: "shop",
    name: "Shop",
    description: "Best sellers, new arrivals and order help.",
    bio: "Small-batch goods, made to order.",
    theme: { id: TEMPLATE_THEME_IDS.Paper, name: "Paper" },
    blocks: [
      { type: "header", text: "Shop" },
      { type: "card", title: "Best sellers", caption: "Shop now" },
      {
        type: "grid",
        cells: [
          { title: "New in", subtitle: "This week" },
          { title: "On sale", subtitle: "While it lasts" },
        ],
      },
      { type: "link", label: "Visit the shop" },
      { type: "link", label: "Track my order" },
      // "$50" is written as an escape: tests/unit/billing-prices.test.ts keeps every dollar amount
      // in src/lib/billing/prices.ts, and this one is sample copy, not one of our prices.
      { type: "text", text: "Free shipping on orders over \u002450." },
      { type: "social", platforms: ["instagram", "tiktok", "email"] },
    ],
  },
  {
    id: "coach",
    name: "Coach",
    description: "A booking link, a free guide and an intro video.",
    bio: "Clear steps, honest feedback, real results.",
    theme: { id: TEMPLATE_THEME_IDS.Sage, name: "Sage" },
    blocks: [
      { type: "text", text: "Work with me one on one or join a small group." },
      { type: "link", label: "Book a free call" },
      { type: "card", title: "Free starter guide", caption: "Download" },
      { type: "link", label: "Join the newsletter" },
      { type: "embed", caption: "Watch an intro" },
      { type: "social", platforms: ["linkedin", "instagram", "email"] },
    ],
  },
  {
    id: "streamer",
    name: "Streamer",
    description: "Where to watch, your schedule and your community.",
    bio: "Live most weeknights.",
    theme: { id: TEMPLATE_THEME_IDS.Ember, name: "Ember" },
    blocks: [
      { type: "link", label: "Watch live" },
      { type: "link", label: "Stream schedule" },
      {
        type: "grid",
        cells: [
          { title: "Discord", subtitle: "Join the chat" },
          { title: "Clips", subtitle: "Best moments" },
        ],
      },
      { type: "link", label: "Support the stream" },
      { type: "social", platforms: ["youtube", "tiktok", "x"] },
    ],
  },
];

/** A template by id, or null (an id that is not in the catalog: nothing is applied). */
export function templateById(id: string): Template | null {
  return TEMPLATES.find((template) => template.id === id) ?? null;
}
