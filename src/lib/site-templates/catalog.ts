import { newBlockId, type Block, type DraftDoc, type HoursTimezone } from "@/lib/document";
import { TEMPLATE_THEME_IDS } from "@/lib/templates/catalog";

/**
 * The site templates (M12-03): Garage sale, Small business and Musician. Each is exactly Home and
 * two pages, so every one fits the Free plan (3 pages per site). One module holds all the data; the
 * editor and the new-site flow read it, and a unit test holds every document to the draft schemas
 * and the publish forms.
 *
 * These are not the starter templates of `src/lib/templates` (a Home-only list whose links are built
 * empty so Publish stops). A site template is meant to publish as it is, so every visible block is
 * complete without a link: items, hours, a map, headings, text and page links (which need no
 * address). Where a block needs the owner's own address (a music embed, an outside link) it is
 * placed hidden, with a caption that says what to paste; Publish skips hidden blocks, so a sample
 * address never reaches a visitor. All text is plainly sample text and there are no photos.
 *
 * Applying only fills drafts (`instantiateSiteTemplate` makes the documents; the editor writes
 * them) and never publishes.
 */

export const SITE_TEMPLATE_IDS = ["garage-sale", "small-business", "musician"] as const;
export type SiteTemplateId = (typeof SITE_TEMPLATE_IDS)[number];

export function isSiteTemplateId(value: unknown): value is SiteTemplateId {
  return typeof value === "string" && (SITE_TEMPLATE_IDS as readonly string[]).includes(value);
}

/** What a template page is, before ids exist. `blocks` are made with fresh ids on each instantiate. */
interface PageSpec {
  title: string;
  description: string;
  blocks: (fresh: () => string) => Block[];
}

interface HomeSpec {
  bio: string;
  blocks: (fresh: () => string, pageIds: readonly [string, string]) => Block[];
}

export interface SiteTemplate {
  id: SiteTemplateId;
  name: string;
  /** The card's one line. */
  description: string;
  /** The names of its pages, Home first: "Home, Items, Directions". */
  pages: readonly [string, string, string];
  theme: { id: string; name: string };
  home: HomeSpec;
  subPages: readonly [PageSpec, PageSpec];
}

const header = (id: string, text: string): Block => ({ id, type: "header", visible: true, text });
const text = (id: string, body: string): Block => ({ id, type: "text", visible: true, text: body });
const pageLink = (id: string, label: string, target: string): Block => ({
  id,
  type: "page_link",
  visible: true,
  label,
  target,
});

const day = (open: string, close: string) => ({ closed: false, ranges: [{ open, close }] });
const closedDay = () => ({ closed: true, ranges: [] });

function hours(id: string, timezone: HoursTimezone, note: string): Block {
  return {
    id,
    type: "hours",
    visible: true,
    timezone,
    days: {
      mon: day("09:00", "17:00"),
      tue: day("09:00", "17:00"),
      wed: day("09:00", "17:00"),
      thu: day("09:00", "17:00"),
      fri: day("09:00", "17:00"),
      sat: day("10:00", "14:00"),
      sun: closedDay(),
    },
    note,
  };
}

function item(
  fresh: () => string,
  name: string,
  price: string,
  description: string,
  sold = false,
): Extract<Block, { type: "items" }>["items"][number] {
  return { id: fresh(), name, price, description, sold };
}

function items(
  id: string,
  heading: string,
  layout: "list" | "grid",
  list: Extract<Block, { type: "items" }>["items"],
): Block {
  return { id, type: "items", visible: true, heading, layout, items: list };
}

function map(fresh: () => string, name: string, address: string): Block {
  return {
    id: fresh(),
    type: "map",
    visible: true,
    name,
    address,
    googleId: fresh(),
    appleId: fresh(),
  };
}

/** A music embed. Hidden and addressless: the owner pastes a link and shows it. */
function embedPlaceholder(id: string, caption: string): Block {
  return { id, type: "embed", visible: false, url: "", caption };
}

export const SITE_TEMPLATES: readonly SiteTemplate[] = [
  {
    id: "garage-sale",
    name: "Garage sale",
    description: "A price list of what you are selling and directions to your door.",
    pages: ["Home", "Items", "Directions"],
    theme: { id: TEMPLATE_THEME_IDS.Sage, name: "Sage" },
    home: {
      bio: "Sample text: Saturday, 8 am to 1 pm. Everything must go.",
      blocks: (fresh, [itemsId, directionsId]) => [
        header(fresh(), "Garage sale this Saturday"),
        text(
          fresh(),
          "Sample text: Furniture, books, tools and kids’ clothes. Replace this with what you are selling and when.",
        ),
        pageLink(fresh(), "See what’s for sale", itemsId),
        pageLink(fresh(), "Get directions", directionsId),
      ],
    },
    subPages: [
      {
        title: "Items",
        description: "Sample text: what is for sale and what it costs.",
        blocks: (fresh) => [
          items(fresh(), "For sale", "list", [
            item(fresh, "Sample: oak side table", "$25", "Sample text: a few scratches, sturdy."),
            item(fresh, "Sample: box of paperbacks", "$5", "Sample text: about 30 books."),
            item(fresh, "Sample: bicycle", "$40", "Sample text: adult size, new tires.", true),
            item(fresh, "Sample: board games", "Free", "Sample text: take any you like."),
          ]),
          text(fresh(), "Sample text: Cash only. Prices are firm after noon."),
        ],
      },
      {
        title: "Directions",
        description: "Sample text: where to find the sale.",
        blocks: (fresh) => [
          header(fresh(), "Find us"),
          map(fresh, "Sample: the garage sale", "123 Sample Street, Sampletown"),
          text(fresh(), "Sample text: Park on the street. The sale is in the driveway."),
        ],
      },
    ],
  },
  {
    id: "small-business",
    name: "Small business",
    description: "A menu or price list, plus your hours and where to find you.",
    pages: ["Home", "Menu or services", "Visit"],
    theme: { id: TEMPLATE_THEME_IDS.Ivory, name: "Ivory" },
    home: {
      bio: "Sample text: a short line about what you do.",
      blocks: (fresh, [menuId, visitId]) => [
        header(fresh(), "Welcome"),
        text(
          fresh(),
          "Sample text: Say in a sentence or two what your business does and who it is for.",
        ),
        pageLink(fresh(), "Menu and services", menuId),
        pageLink(fresh(), "Hours and location", visitId),
      ],
    },
    subPages: [
      {
        title: "Menu or services",
        description: "Sample text: what you offer and what it costs.",
        blocks: (fresh) => [
          items(fresh(), "Services", "list", [
            item(fresh, "Sample: consultation", "$40", "Sample text: thirty minutes."),
            item(fresh, "Sample: standard service", "$90", "Sample text: what is included."),
            item(fresh, "Sample: premium service", "$150", "Sample text: the full works."),
          ]),
        ],
      },
      {
        title: "Visit",
        description: "Sample text: when we are open and where to find us.",
        blocks: (fresh) => [
          header(fresh(), "Opening hours"),
          hours(fresh(), "America/New_York", "Sample text: replace these hours with your own."),
          map(fresh, "Sample: our shop", "123 Sample Street, Sampletown"),
        ],
      },
    ],
  },
  {
    id: "musician",
    name: "Musician",
    description: "Music embeds on Home, your shows and your merch.",
    pages: ["Home", "Shows", "Merch"],
    theme: { id: TEMPLATE_THEME_IDS.Midnight, name: "Midnight" },
    home: {
      bio: "Sample text: new music and live dates.",
      blocks: (fresh, [showsId, merchId]) => [
        header(fresh(), "Listen"),
        embedPlaceholder(
          fresh(),
          "Sample: paste a Spotify, YouTube or SoundCloud link, then show this block.",
        ),
        embedPlaceholder(fresh(), "Sample: add a second track or video the same way."),
        pageLink(fresh(), "Upcoming shows", showsId),
        pageLink(fresh(), "Merch", merchId),
      ],
    },
    subPages: [
      {
        title: "Shows",
        description: "Sample text: upcoming dates.",
        blocks: (fresh) => [
          items(fresh(), "Upcoming shows", "list", [
            item(fresh, "Sample: The Sample Room", "$15", "Sample text: 12 March, doors at 8 pm."),
            item(fresh, "Sample: Example Hall", "$20", "Sample text: 19 March, doors at 7 pm."),
            item(fresh, "Sample: Placeholder Club", "Free", "Sample text: 2 April.", true),
          ]),
        ],
      },
      {
        title: "Merch",
        description: "Sample text: what is for sale.",
        blocks: (fresh) => [
          items(fresh(), "Merch", "grid", [
            item(fresh, "Sample: t-shirt", "$25", "Sample text: sizes S to XL."),
            item(fresh, "Sample: tote bag", "$15", "Sample text: cotton canvas."),
            item(fresh, "Sample: vinyl", "$30", "Sample text: first pressing.", true),
            item(fresh, "Sample: sticker pack", "$5", "Sample text: five stickers."),
          ]),
          text(fresh(), "Sample text: Ask about shipping at a show."),
        ],
      },
    ],
  },
];

export function siteTemplateById(id: unknown): SiteTemplate | null {
  return SITE_TEMPLATES.find((template) => template.id === id) ?? null;
}

export interface SitePageDocument {
  title: string;
  description: string;
  blocks: Block[];
}

export interface InstantiatedSiteTemplate {
  /** The two pages to create, in menu order, with their blocks (fresh ids). */
  pages: [SitePageDocument, SitePageDocument];
  /**
   * Home's draft after the pages exist: `pageIds` are the two new pages' ids, in the same order. The
   * display name and photo stay the owner's; the bio is the template's sample only when it is empty.
   */
  home: (current: DraftDoc, pageIds: readonly [string, string]) => DraftDoc;
}

/**
 * Makes the documents of a template. Every id is fresh and not in `taken` (the ids already on the
 * site: block ids are unique across Home and every page), and none repeats. Pure but for the ids.
 */
export function instantiateSiteTemplate(
  template: SiteTemplate,
  taken: Set<string> = new Set(),
): InstantiatedSiteTemplate {
  const fresh = (): string => {
    let id = newBlockId();
    while (taken.has(id)) id = newBlockId();
    taken.add(id);
    return id;
  };
  const pages = template.subPages.map((page) => ({
    title: page.title,
    description: page.description,
    blocks: page.blocks(fresh),
  })) as [SitePageDocument, SitePageDocument];
  // Home's block ids are made now, with the same `fresh`, and the page ids are filled in later.
  const homeBlocks = (pageIds: readonly [string, string]) => template.home.blocks(fresh, pageIds);
  return {
    pages,
    home: (current, pageIds) => ({
      ...current,
      profile:
        current.profile.bio.trim() === ""
          ? { ...current.profile, bio: template.home.bio }
          : current.profile,
      theme: { ref: template.theme.id, overrides: {} },
      blocks: homeBlocks(pageIds),
      nav: { show: true, items: [pageIds[0], pageIds[1]] },
    }),
  };
}
