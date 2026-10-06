import { SMOKE, type DemoButtonStyle, type DemoTheme } from "../demo/brands";
import { fontStack } from "../try/fonts";
import { tryTheme, type TryThemeId } from "../try/themes";

/**
 * The "See it in action" carousel: twelve invented brands, one per platform and kind of work, each
 * on a real system theme (Noir is used once; the rest repeat with a different block layout). None is a
 * real person, shop or show; their photographs were generated for the site and contain no text,
 * logos or real people. Photos live under public/marketing/demo, named <brand>-<slot>.
 *
 * These are tenant theme values shown inside phone frames only; the section around them uses the
 * --hl-* tokens.
 */

export type ShowSocial =
  "instagram" | "tiktok" | "youtube" | "x" | "email" | "linkedin" | "website" | "threads";

export type ShowBlock =
  | { type: "link"; label: string; style?: DemoButtonStyle; live?: boolean }
  | { type: "header"; text: string }
  | { type: "text"; text: string }
  | { type: "card"; title: string; caption: string; image: string; alt: string }
  | { type: "image"; image: string; alt: string }
  | { type: "grid"; cells: { title: string; subtitle: string }[] }
  | { type: "gallery"; tiles: { image: string; alt: string; label: string }[] }
  | {
      type: "embed";
      kind: "audio" | "video";
      title: string;
      caption: string;
      image: string;
      alt: string;
    }
  | { type: "faq"; items: { q: string; a?: string }[] }
  | { type: "discount"; code: string; description: string }
  | { type: "map"; name: string; address: string };

/** A theme as the demo stylesheet reads it, plus the real faces the theme names. */
export interface ShowTheme extends DemoTheme {
  headingStack: string;
  bodyStack: string;
}

export interface ShowBrand {
  id: string;
  /** The kind of work or platform: "Musician", "TikTok creator". */
  role: string;
  name: string;
  handle: string;
  bio: string;
  avatar: { image: string; alt: string };
  social: ShowSocial[];
  blocks: ShowBlock[];
  theme: ShowTheme;
  /** The audience page this setup matches (a slug in audiences/data.ts), and the link's text. */
  audience: string;
  setup: string;
}

function themeOf(id: TryThemeId): ShowTheme {
  const { name, tokens: t } = tryTheme(id);
  return {
    name,
    bg: t.bg,
    surface: t.surface,
    text: t.text,
    textMuted: t.textMuted,
    accent: t.accent,
    buttonBg: t.buttonBg,
    buttonText: t.buttonText,
    border: t.border,
    // The demo stylesheet's own three-face union is not used here: the stacks below carry the
    // real faces, and this field only picks the heading size tweak for Instrument Serif.
    fontHeading: "Geist",
    weightHeading: t.weightHeading,
    radius: t.radius,
    buttonStyle: t.buttonStyle as DemoButtonStyle,
    density: t.density as DemoTheme["density"],
    bgType: t.bgType === "gradient" ? "gradient" : "solid",
    headingStack: fontStack(t.fontHeading),
    bodyStack: fontStack(t.fontBody),
  };
}

/** Smoke is not in the try-it builder's set; its values are the demo set's own. */
const SMOKE_THEME: ShowTheme = {
  ...SMOKE,
  headingStack: "var(--font-demo-geist), system-ui, sans-serif",
  bodyStack: "var(--font-demo-geist), system-ui, sans-serif",
};

const BRANDS: readonly ShowBrand[] = [
  {
    id: "juno",
    role: "Musician",
    name: "Juno Vale",
    handle: "juno",
    bio: "Songs for late drives. New single out now.",
    avatar: {
      image: "juno-avatar",
      alt: "A singer-songwriter with dark wavy hair, looking down at her guitar",
    },
    social: ["instagram", "tiktok", "youtube"],
    audience: "musicians",
    setup: "Musician setup",
    theme: themeOf("midnight"),
    blocks: [
      { type: "header", text: "Listen now" },
      {
        type: "embed",
        kind: "audio",
        title: "Night Shift",
        caption: "Latest single",
        image: "juno-embed",
        alt: "The neck of an acoustic guitar in blue light",
      },
      { type: "link", label: "Tour dates" },
      { type: "link", label: "Merch" },
      {
        type: "card",
        title: "Live at the Lantern",
        caption: "Watch the full set",
        image: "juno-card",
        alt: "A singer with an acoustic guitar on a small club stage in blue and amber light",
      },
      { type: "image", image: "juno-image", alt: "A record spinning on a turntable beside a lamp" },
    ],
  },
  {
    id: "statichours",
    role: "Podcaster",
    name: "Static Hours",
    handle: "hours",
    bio: "Two friends, one microphone and a new episode every Tuesday.",
    avatar: {
      image: "statichours-avatar",
      alt: "A vintage condenser microphone with a pop filter",
    },
    social: ["instagram", "x", "email"],
    audience: "podcasters",
    setup: "Podcaster setup",
    theme: SMOKE_THEME,
    blocks: [
      { type: "header", text: "Listen on" },
      { type: "link", label: "Apple Podcasts" },
      { type: "link", label: "Spotify" },
      { type: "link", label: "YouTube" },
      {
        type: "embed",
        kind: "audio",
        title: "Episode 84",
        caption: "Why we stopped planning",
        image: "statichours-embed",
        alt: "Two studio microphones on boom arms beside headphones",
      },
      {
        type: "card",
        title: "Behind the mic",
        caption: "How we record",
        image: "statichours-card",
        alt: "Hands holding a coffee mug beside an open notebook and headphones",
      },
      {
        type: "image",
        image: "statichours-image",
        alt: "A cozy recording room with two armchairs and acoustic panels",
      },
    ],
  },
  {
    id: "odile",
    role: "Artist",
    name: "Odile Marsh",
    handle: "odile",
    bio: "Oil paintings, prints and commissions from a sunny studio.",
    avatar: { image: "odile-avatar", alt: "A painter in a paint-smudged linen apron, smiling" },
    social: ["instagram", "threads", "email"],
    audience: "artists",
    setup: "Artist setup",
    theme: themeOf("ivory"),
    blocks: [
      {
        type: "image",
        image: "odile-image",
        alt: "A large abstract painting on an easel in a sunlit studio",
      },
      { type: "header", text: "Work" },
      {
        type: "gallery",
        tiles: [
          { image: "odile-g1", alt: "A framed abstract print on a white wall", label: "Prints" },
          {
            image: "odile-g2",
            alt: "Abstract canvases leaning against a studio wall",
            label: "Originals",
          },
        ],
      },
      { type: "link", label: "Commission a piece" },
      { type: "text", text: "Commissions open this autumn." },
    ],
  },
  {
    id: "tallow",
    role: "Shop",
    name: "Tallow & Twine",
    handle: "tallow",
    bio: "Hand-poured candles and small-batch home goods.",
    avatar: { image: "tallow-avatar", alt: "A hand-poured candle in a matte ceramic jar" },
    social: ["instagram", "tiktok", "email"],
    audience: "small-business",
    setup: "Shop setup",
    theme: themeOf("paper"),
    blocks: [
      { type: "header", text: "Shop" },
      {
        type: "card",
        title: "Best sellers",
        caption: "Shop now",
        image: "tallow-card",
        alt: "Candles, linen, a ceramic dish and dried flowers laid out flat",
      },
      {
        type: "gallery",
        tiles: [
          { image: "tallow-g1", alt: "A parcel wrapped in kraft paper and twine", label: "Gifts" },
          {
            image: "tallow-g2",
            alt: "A shelf of ceramics, candles and folded linens",
            label: "New in",
          },
        ],
      },
      { type: "discount", code: "FIRSTBATCH", description: "Free shipping on your first order" },
      { type: "map", name: "The Workshop", address: "14 Mill Lane, Saturdays 10 to 4" },
    ],
  },
  {
    id: "bea",
    role: "Coach",
    name: "Bea Lindqvist",
    handle: "bea",
    bio: "Movement and habit coaching, one on one or in small groups.",
    avatar: { image: "bea-avatar", alt: "A smiling coach in a sage-green linen top" },
    social: ["linkedin", "instagram", "email"],
    audience: "coaches",
    setup: "Coach setup",
    theme: themeOf("sage"),
    blocks: [
      { type: "text", text: "Work with me one on one or join a small group." },
      { type: "link", label: "Book a free call" },
      {
        type: "card",
        title: "Free starter guide",
        caption: "Download",
        image: "bea-card",
        alt: "Someone in a calm lunge stretch on a mat in a bright room",
      },
      {
        type: "embed",
        kind: "video",
        title: "Watch an intro",
        caption: "Three minutes on how we start",
        image: "bea-embed",
        alt: "A journal and a cup of tea on a wooden table by a window",
      },
      {
        type: "faq",
        items: [
          { q: "Do I need experience?", a: "None at all. We start where you are." },
          { q: "How long is a session?" },
          { q: "Can I try one first?" },
        ],
      },
      {
        type: "image",
        image: "bea-image",
        alt: "A small outdoor class stretching on mats at golden hour",
      },
    ],
  },
  {
    id: "kestrel",
    role: "Streamer",
    name: "Kestrel Nine",
    handle: "kestrel",
    bio: "Live most weeknights. Cozy games, loud chat.",
    avatar: {
      image: "kestrel-avatar",
      alt: "A streamer in headphones, grinning in warm lamp light",
    },
    social: ["youtube", "tiktok", "x"],
    audience: "twitch",
    setup: "Streamer setup",
    theme: themeOf("ember"),
    blocks: [
      { type: "link", label: "Watch live", live: true },
      { type: "link", label: "Stream schedule" },
      {
        type: "card",
        title: "The setup",
        caption: "What I stream on",
        image: "kestrel-card",
        alt: "A dark desk with two glowing monitors, a microphone arm and a keyboard",
      },
      {
        type: "gallery",
        tiles: [
          { image: "kestrel-g1", alt: "A backlit mechanical keyboard", label: "Clips" },
          {
            image: "kestrel-g2",
            alt: "A controller and headphones under a warm lamp",
            label: "Gear",
          },
        ],
      },
      { type: "link", label: "Support the stream" },
    ],
  },
  {
    id: "mateo",
    role: "Photographer",
    name: "Mateo Lindgren",
    handle: "mateo",
    bio: "Weddings, portraits and quiet landscapes. Booking 2027.",
    avatar: {
      image: "mateo-avatar",
      alt: "A photographer with a camera strap around his neck in low light",
    },
    social: ["instagram", "website", "email"],
    theme: themeOf("noir"),
    audience: "artists",
    setup: "Photographer setup",
    blocks: [
      {
        type: "gallery",
        tiles: [
          {
            image: "mateo-g1",
            alt: "A black and white photo of a rainy street with a lone figure under an umbrella",
            label: "Street",
          },
          {
            image: "mateo-g2",
            alt: "A couple laughing together in a meadow at golden hour",
            label: "Weddings",
          },
        ],
      },
      {
        type: "image",
        image: "mateo-image",
        alt: "Misty mountains at blue hour with one lit cabin window",
      },
      { type: "header", text: "Prints" },
      {
        type: "card",
        title: "The print shop",
        caption: "Signed, numbered editions",
        image: "mateo-card",
        alt: "Fine-art prints and a framed photograph on a dark table",
      },
      { type: "link", label: "Book a session" },
      { type: "text", text: "Now booking weddings and portraits for 2027." },
    ],
  },
  {
    id: "remy",
    role: "TikTok creator",
    name: "Remy Castellanos",
    handle: "remy",
    bio: "Thrift flips and 30-second DIYs. New video every day.",
    avatar: { image: "remy-avatar", alt: "A young man laughing in a thrifted denim jacket" },
    social: ["tiktok", "instagram", "youtube"],
    theme: themeOf("ember"),
    audience: "tiktok",
    setup: "TikTok setup",
    blocks: [
      { type: "header", text: "Start here" },
      { type: "link", label: "Today's flip", live: true },
      {
        type: "card",
        title: "The denim flip",
        caption: "Watch the full build",
        image: "remy-card",
        alt: "A thrifted denim jacket being patched on a craft table",
      },
      {
        type: "gallery",
        tiles: [
          {
            image: "remy-g1",
            alt: "A rack of colorful vintage jackets in a thrift store",
            label: "Hauls",
          },
          {
            image: "remy-g2",
            alt: "A sewing machine with a patchwork garment and bright thread",
            label: "Flips",
          },
        ],
      },
      { type: "discount", code: "FLIP10", description: "10% off the patch kit" },
      { type: "link", label: "Brand inquiries" },
    ],
  },
  {
    id: "hana",
    role: "Instagram creator",
    name: "Hana Whitlock",
    handle: "sunday",
    bio: "Slow Sunday cooking for friends. A new recipe every week.",
    avatar: {
      image: "hana-avatar",
      alt: "A smiling cook with curly auburn hair in a bright kitchen",
    },
    social: ["instagram", "threads", "email"],
    theme: themeOf("sage"),
    audience: "instagram",
    setup: "Instagram setup",
    blocks: [
      { type: "link", label: "This week's recipe" },
      {
        type: "image",
        image: "hana-image",
        alt: "A rustic table with a vegetable tart, salads, bread and wine",
      },
      {
        type: "gallery",
        tiles: [
          {
            image: "hana-g1",
            alt: "A bowl of fresh pasta with basil and cherry tomatoes",
            label: "Pasta",
          },
          { image: "hana-g2", alt: "A fruit galette on a cooling rack", label: "Baking" },
        ],
      },
      { type: "link", label: "Cookbook pre-order" },
      { type: "text", text: "New recipe every Sunday." },
    ],
  },
  {
    id: "dev",
    role: "YouTuber",
    name: "Dev Ramanathan",
    handle: "tinker",
    bio: "Electronics for the curious. Builds, repairs and honest failures.",
    avatar: { image: "dev-avatar", alt: "A bearded man with glasses smiling in his workshop" },
    social: ["youtube", "x", "website"],
    theme: themeOf("midnight"),
    audience: "youtube",
    setup: "YouTube setup",
    blocks: [
      {
        type: "embed",
        kind: "video",
        title: "Build a radio from scrap",
        caption: "New video, 14 minutes",
        image: "dev-embed",
        alt: "A workbench with a soldering iron, a circuit board and a camera on a tripod",
      },
      { type: "link", label: "Subscribe" },
      { type: "header", text: "Playlists" },
      {
        type: "grid",
        cells: [
          { title: "Soldering 101", subtitle: "Start here" },
          { title: "Build logs", subtitle: "Every project" },
        ],
      },
      {
        type: "card",
        title: "Parts list",
        caption: "Everything on my bench",
        image: "dev-card",
        alt: "A flat lay of electronics parts, a breadboard and a multimeter",
      },
      { type: "link", label: "Join the Discord" },
    ],
  },
  {
    id: "priya",
    role: "Writer on X",
    name: "Priya Nand",
    handle: "priya",
    bio: "The Slow Take: one long idea in your inbox every Thursday.",
    avatar: {
      image: "priya-avatar",
      alt: "A thoughtful woman with a short bob beside a window and bookshelves",
    },
    social: ["x", "threads", "email"],
    theme: themeOf("ivory"),
    audience: "x",
    setup: "X setup",
    blocks: [
      { type: "text", text: "Join 12,000 readers. Free, and you can leave any time." },
      { type: "link", label: "Subscribe to The Slow Take" },
      { type: "header", text: "Latest issues" },
      {
        type: "grid",
        cells: [
          { title: "No. 41", subtitle: "On doing less" },
          { title: "No. 40", subtitle: "The long way home" },
        ],
      },
      {
        type: "faq",
        items: [
          {
            q: "How often does it come out?",
            a: "Every Thursday morning, about a ten minute read.",
          },
          { q: "Is it free?" },
          { q: "Can I read back issues?" },
        ],
      },
      { type: "link", label: "Read the archive" },
    ],
  },
  {
    id: "fig",
    role: "Café",
    name: "Fig & Ladle",
    handle: "fig",
    bio: "Neighborhood coffee, fresh pastries and soup of the day.",
    avatar: {
      image: "fig-avatar",
      alt: "A latte with leaf art beside a croissant on a marble table",
    },
    social: ["instagram", "website", "email"],
    theme: themeOf("paper"),
    audience: "small-business",
    setup: "Café setup",
    blocks: [
      { type: "map", name: "Fig & Ladle", address: "22 Alder Street, open daily 7 to 3" },
      { type: "link", label: "Order ahead" },
      {
        type: "card",
        title: "Today's pastries",
        caption: "Baked every morning",
        image: "fig-card",
        alt: "A glass pastry case full of croissants, cinnamon rolls and fruit tarts",
      },
      { type: "discount", code: "FIRSTCUP", description: "A free cookie with your first latte" },
      {
        type: "image",
        image: "fig-image",
        alt: "A sunny neighborhood cafe with wooden tables and plants",
      },
      { type: "link", label: "Catering and events" },
    ],
  },
];

/** Strong visuals first, then platforms and kinds of work alternating. */
const ORDER = [
  "mateo",
  "remy",
  "juno",
  "hana",
  "tallow",
  "dev",
  "odile",
  "priya",
  "kestrel",
  "fig",
  "statichours",
  "bea",
];

export const SHOW_BRANDS: readonly ShowBrand[] = ORDER.map((id) => {
  const brand = BRANDS.find((b) => b.id === id);
  if (!brand) throw new Error(`Unknown showcase brand: ${id}`);
  return brand;
});
