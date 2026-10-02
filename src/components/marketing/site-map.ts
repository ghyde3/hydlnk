/**
 * The marketing site's pages, in one place: the header and footer navigation, the Learn index and
 * the root host's sitemap.xml all read from here, so a page cannot be linked in one and missing
 * from another. Paths are root-relative; the root host is the only host that serves them.
 */

export type NavKey =
  | "home"
  | "features"
  | "design"
  | "domains"
  | "analytics"
  | "pricing"
  | "learn"
  | "faq"
  | "privacy"
  | "terms";

export interface NavItem {
  key: NavKey;
  href: string;
  label: string;
}

/** The header's page links, left to right. "Log in" and "Claim your link" sit after them. */
export const MAIN_NAV: readonly NavItem[] = [
  { key: "features", href: "/features", label: "Features" },
  { key: "design", href: "/design", label: "Design" },
  { key: "domains", href: "/domains", label: "Domains" },
  { key: "analytics", href: "/analytics", label: "Analytics" },
  { key: "pricing", href: "/pricing", label: "Pricing" },
  { key: "learn", href: "/learn", label: "Learn" },
];

export interface Guide {
  slug: string;
  title: string;
  /** One sentence for the Learn index, the guide's lead and its meta description. */
  summary: string;
  minutes: number;
}

/** The Learn guides, in reading order. Each one is a page at /learn/<slug>. */
export const GUIDES: readonly Guide[] = [
  {
    slug: "getting-started",
    title: "Getting started",
    summary: "From sign-up to a published page in about ten minutes: handle, profile, blocks, theme and Publish.",
    minutes: 6,
  },
  {
    slug: "choosing-a-handle",
    title: "Choosing a handle",
    summary: "What a handle is, the rules it has to follow and how to pick one people remember.",
    minutes: 4,
  },
  {
    slug: "designing-your-page",
    title: "Designing your page",
    summary: "Themes, tokens, fonts, backgrounds and per-block overrides, with the choices that keep a page readable.",
    minutes: 7,
  },
  {
    slug: "connecting-a-domain",
    title: "Connecting a domain",
    summary: "Point a domain you own at your page, step by step, and what to check if it doesn’t verify.",
    minutes: 6,
  },
  {
    slug: "understanding-analytics",
    title: "Understanding analytics",
    summary: "What views, clicks, click-through rate, referrers, devices and countries tell you, and what they can’t.",
    minutes: 5,
  },
  {
    slug: "plans-and-billing",
    title: "Plans and billing",
    summary: "What each plan includes, how upgrading and the billing portal work, and how to cancel or delete your account.",
    minutes: 4,
  },
];

export function guideHref(slug: string): string {
  return `/learn/${slug}`;
}

/** Footer columns. Privacy and Terms are the legal pair the sign-up page links to as well. */
export const FOOTER_COLUMNS: readonly { title: string; links: readonly { href: string; label: string }[] }[] = [
  {
    title: "Product",
    links: [
      { href: "/features", label: "Features" },
      { href: "/design", label: "Design" },
      { href: "/domains", label: "Custom domains" },
      { href: "/analytics", label: "Analytics" },
      { href: "/pricing", label: "Pricing" },
    ],
  },
  {
    title: "Learn",
    links: [
      { href: "/learn", label: "All guides" },
      { href: guideHref("getting-started"), label: "Getting started" },
      { href: guideHref("connecting-a-domain"), label: "Connecting a domain" },
      { href: "/faq", label: "FAQ" },
    ],
  },
  {
    title: "Legal",
    links: [
      { href: "/privacy", label: "Privacy" },
      { href: "/terms", label: "Terms" },
    ],
  },
];

/** Every indexable page on the root host, for sitemap.xml. */
export const SITEMAP_PATHS: readonly string[] = [
  "/",
  ...MAIN_NAV.map((item) => item.href),
  ...GUIDES.map((guide) => guideHref(guide.slug)),
  "/faq",
  "/privacy",
  "/terms",
];

/** Contact addresses shown on the site and in the legal pages. */
export const SUPPORT_EMAIL = "support@hydlnk.com";
export const PRIVACY_EMAIL = "privacy@hydlnk.com";
