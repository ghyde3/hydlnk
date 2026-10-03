/**
 * Demo pages for the marketing site. The three brands are invented (no real studio, roaster or
 * person); their photographs were generated for the site and contain no people, text or marks.
 * The themes are HYDLNK's own system themes (Noir, Ivory, Smoke from the reference-data
 * migration), so what the demos show is what a page with that theme looks like.
 *
 * These are tenant theme values rendered as data inside demo frames only; the marketing UI itself
 * uses the --hl-* tokens.
 */

export type DemoButtonStyle = "fill" | "outline" | "soft" | "shadow" | "pill";
export type DemoFont = "Fraunces" | "Instrument Serif" | "Geist";

export interface DemoTheme {
  name: string;
  bg: string;
  surface: string;
  text: string;
  textMuted: string;
  accent: string;
  buttonBg: string;
  buttonText: string;
  border: string;
  fontHeading: DemoFont;
  weightHeading: number;
  radius: number;
  buttonStyle: DemoButtonStyle;
  density: "compact" | "regular" | "airy";
  bgType: "solid" | "gradient" | "image";
  /** Only for bgType "image": a picture under public/marketing/demo (no extension). */
  bgImage?: string;
  overlayOpacity?: number;
}

export const NOIR: DemoTheme = {
  name: "Noir",
  bg: "#16120E",
  surface: "#221B13",
  text: "#EFE8DC",
  textMuted: "#A79E90",
  accent: "#C9A86A",
  buttonBg: "#C9A86A",
  buttonText: "#15110B",
  border: "#3A342D",
  fontHeading: "Instrument Serif",
  weightHeading: 400,
  radius: 12,
  buttonStyle: "outline",
  density: "regular",
  bgType: "solid",
};

export const IVORY: DemoTheme = {
  name: "Ivory",
  bg: "#F3EEE4",
  surface: "#E6DDCD",
  text: "#1B1814",
  textMuted: "#5E564B",
  accent: "#1B1814",
  buttonBg: "#1B1814",
  buttonText: "#F7F3EC",
  border: "#CCC7BF",
  fontHeading: "Fraunces",
  weightHeading: 600,
  radius: 4,
  buttonStyle: "fill",
  density: "airy",
  bgType: "solid",
};

export const SMOKE: DemoTheme = {
  name: "Smoke",
  bg: "#1C2023",
  surface: "#262C30",
  text: "#E6EAEC",
  textMuted: "#9AA4AA",
  accent: "#9DB3C4",
  buttonBg: "#9DB3C4",
  buttonText: "#15110B",
  border: "#404447",
  fontHeading: "Geist",
  weightHeading: 600,
  radius: 20,
  buttonStyle: "pill",
  density: "regular",
  bgType: "gradient",
};

/** Smoke with a photograph behind it: the image background, an overlay and pill buttons. */
export const SMOKE_PHOTO: DemoTheme = {
  ...SMOKE,
  name: "Smoke + image",
  bgType: "image",
  bgImage: "northfold-bg",
  overlayOpacity: 0.5,
};

export type DemoSocial = "instagram" | "website" | "email" | "youtube";

export type DemoBlock =
  | { type: "link"; label: string; style?: DemoButtonStyle }
  | { type: "card"; title: string; caption: string; image: string; alt: string }
  | { type: "image"; image: string; alt: string }
  | { type: "header"; text: string }
  | { type: "text"; text: string }
  | { type: "grid"; cells: { title: string; subtitle: string }[] }
  | { type: "divider" };

export interface DemoBrand {
  id: "fennmoor" | "wrenhaven" | "northfold";
  name: string;
  handle: string;
  /** What the brand is, for captions: "a pottery studio". */
  kind: string;
  bio: string;
  avatar: { image: string; alt: string };
  social: DemoSocial[];
  blocks: DemoBlock[];
  theme: DemoTheme;
}

export const FENNMOOR: DemoBrand = {
  id: "fennmoor",
  name: "Fennmoor Ceramics",
  handle: "fennmoor",
  kind: "a pottery studio",
  bio: "Small-batch stoneware, thrown and glazed by hand.",
  avatar: { image: "fennmoor-avatar", alt: "A celadon stoneware bowl on linen" },
  social: ["instagram", "website", "email"],
  blocks: [
    { type: "link", label: "Shop the spring kiln opening" },
    { type: "link", label: "Book a wheel class" },
    {
      type: "card",
      title: "Spring kiln",
      caption: "New celadon and iron glazes",
      image: "fennmoor-card",
      alt: "Stoneware bowls and cups on a sunlit studio shelf",
    },
    { type: "header", text: "In the studio" },
    {
      type: "grid",
      cells: [
        { title: "Classes", subtitle: "Saturday mornings" },
        { title: "Commissions", subtitle: "Open in May" },
      ],
    },
    { type: "image", image: "fennmoor-image", alt: "A freshly thrown cylinder on a potter's wheel" },
  ],
  theme: IVORY,
};

export const WRENHAVEN: DemoBrand = {
  id: "wrenhaven",
  name: "Wrenhaven Roasters",
  handle: "wrenhaven",
  kind: "a coffee roaster",
  bio: "Small-lot coffee, roasted every Thursday.",
  avatar: { image: "wrenhaven-avatar", alt: "Freshly roasted coffee beans in a scoop" },
  social: ["instagram", "youtube", "website", "email"],
  blocks: [
    { type: "link", label: "This week’s roast", style: "fill" },
    { type: "link", label: "Coffee subscriptions" },
    { type: "link", label: "Visit the roastery" },
    {
      type: "card",
      title: "Roast notes",
      caption: "How we profile a new lot",
      image: "wrenhaven-card",
      alt: "A drum roaster cooling a batch of beans in a dim roastery",
    },
    { type: "image", image: "wrenhaven-image", alt: "Coffee dripping through a glass pour-over" },
  ],
  theme: NOIR,
};

export const NORTHFOLD: DemoBrand = {
  id: "northfold",
  name: "Northfold Studio",
  handle: "northfold",
  kind: "a photography studio",
  bio: "Landscape and still-life photography. Prints, licensing and studio rental.",
  avatar: { image: "northfold-avatar", alt: "A pine forest in morning fog" },
  social: ["instagram", "website", "email"],
  blocks: [
    { type: "link", label: "Print shop" },
    { type: "link", label: "Rent the studio" },
    { type: "image", image: "northfold-image", alt: "A misty headland above a calm sea at blue hour" },
    {
      type: "grid",
      cells: [
        { title: "Landscapes", subtitle: "Coast and forest" },
        { title: "Still life", subtitle: "Studio work" },
      ],
    },
    {
      type: "card",
      title: "The studio",
      caption: "Daylight room, paper sweeps, by the hour",
      image: "northfold-card",
      alt: "An empty photo studio with a gray paper backdrop and a softbox",
    },
  ],
  theme: SMOKE,
};

export const DEMO_BRANDS: readonly DemoBrand[] = [FENNMOOR, WRENHAVEN, NORTHFOLD];
