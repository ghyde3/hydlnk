import { priceSentence } from "@/lib/marketing/prices";

/**
 * Questions for /faq (all groups) and the home page (the `home` subset). Answers describe only
 * what PLAN.md puts in v1. Plain strings, so the same text feeds the FAQPage structured data.
 * Prices come from src/lib/marketing/prices.ts.
 */

export interface FaqItem {
  question: string;
  answer: string;
  /** Shown on the home page too, in this order. */
  home?: number;
}

export interface FaqGroup {
  id: string;
  title: string;
  items: FaqItem[];
}

export const FAQ_GROUPS: readonly FaqGroup[] = [
  {
    id: "getting-started",
    title: "Getting started",
    items: [
      {
        question: "Is the free plan actually free?",
        answer:
          "Yes. One page, every block, the full theme system and per-link analytics, with no time limit and no card on file.",
        home: 1,
      },
      {
        question: "What do I need to sign up?",
        answer:
          "An email address or a Google account. We email you a sign-in link, so there is no password to create or forget.",
      },
      {
        question: "What is a handle?",
        answer:
          "The name in your page’s address: choose “fennmoor” and your page lives at fennmoor.hydlnk.com. Handles are 3 to 30 characters of lowercase letters, numbers and hyphens, and each one belongs to one page.",
        home: 2,
      },
      {
        question: "Can I build my page on my phone?",
        answer:
          "Yes. The editor works at phone size, with a Blocks and Preview switch, and the preview uses the same renderer as your live page, so what you see is what you publish.",
      },
    ],
  },
  {
    id: "design",
    title: "Design",
    items: [
      {
        question: "How much of my page’s look can I change?",
        answer:
          "Everything on the page is a token: 8 colours, heading and body fonts, type scale and weight, letter case, corner radius, border width, button style, spacing, column width, alignment and the background (a solid colour, a gradient or your own image with an overlay and blur).",
        home: 3,
      },
      {
        question: "Can I make one link stand out?",
        answer:
          "Yes. Any link or card can override the page’s colours, button style and corner radius, so one button can be filled while the rest are outlined.",
      },
      {
        question: "What is a saved theme?",
        answer:
          "A snapshot of a page’s tokens that you can apply to any of your pages. Editing a saved theme updates the drafts that use it; live pages change only when you publish them again.",
      },
      {
        question: "Which fonts can I use?",
        answer:
          "Eighteen Google Fonts picked to work on link pages: ten sans serifs, six serifs and two monospaced faces. You set one for headings and one for body text.",
      },
    ],
  },
  {
    id: "domains",
    title: "Custom domains",
    items: [
      {
        question: "How do custom domains work?",
        answer:
          "On Pro and Studio you connect a domain you already own, like links.yourbrand.com: add it in the editor, then add the DNS record it shows you at your domain provider. We check the record automatically and issue SSL, so your page is served over https. Pro includes 1 custom domain and Studio 15.",
        home: 4,
      },
      {
        question: "Can I use my root domain, like yourbrand.com?",
        answer:
          "Yes. A root domain uses an A record instead of a CNAME, and the editor shows you the exact value. If your main website already lives on that domain, use a subdomain such as links.yourbrand.com instead.",
      },
      {
        question: "Does HYDLNK sell domains?",
        answer:
          "No. HYDLNK doesn’t sell or register domains. You connect a domain you already own, bought at any registrar. Pro includes 1 custom domain, Studio includes 15, and SSL is automatic.",
      },
    ],
  },
  {
    id: "analytics",
    title: "Analytics and privacy",
    items: [
      {
        question: "Does my page use cookies?",
        answer:
          "No. HYDLNK sets no cookies on your page and loads no ad or tracking scripts, so we never show your visitors a consent banner. Sign-in cookies exist only on app.hydlnk.com, where you edit.",
        home: 5,
      },
      {
        question: "What do the analytics show?",
        answer:
          "Views, clicks and click-through rate for every link. Pro and Studio add a year of history with referrers, devices and countries.",
      },
      {
        question: "How are unique visitors counted without cookies?",
        answer:
          "With a one-way hash of the visitor’s IP address and browser, mixed with a value that changes every day. The hash can’t be turned back into an IP address and can’t follow a visitor from one day to the next.",
      },
    ],
  },
  {
    id: "billing",
    title: "Plans and billing",
    items: [
      {
        question: "Do you take a cut of sales?",
        answer: "No. There are no commerce fees on any plan.",
        home: 6,
      },
      {
        question: "How do I upgrade, change my card or cancel?",
        answer:
          "Upgrade from your account settings through Stripe Checkout. Change your card, download invoices or cancel at any time in the Stripe billing portal, under Manage billing.",
      },
      {
        question: "How much do Pro and Studio cost, and is there a yearly price?",
        answer: `Pro is ${priceSentence("pro")}. Studio is ${priceSentence("studio")}. Paying yearly costs less than twelve monthly payments. Prices are in US dollars, and Free costs nothing with no time limit.`,
      },
    ],
  },
  {
    id: "safety",
    title: "Traffic, safety and your account",
    items: [
      {
        question: "What if my page gets a lot of traffic?",
        answer:
          "It keeps serving. Published pages are cached at the edge and built for traffic spikes, on every plan.",
      },
      {
        question: "How do you handle scams and phishing pages?",
        answer:
          "Links are checked against a blocklist when you save, every page has a report link, and accounts that break the rules are suspended.",
      },
      {
        question: "Can I delete my account?",
        answer:
          "Yes, from your account settings. Deleting your account deletes your pages, themes and analytics, frees your handles and signs you out everywhere.",
      },
    ],
  },
];

/** The home page's short list, in its own order. */
export const HOME_FAQ: readonly FaqItem[] = FAQ_GROUPS.flatMap((group) => group.items)
  .filter((item) => item.home !== undefined)
  .sort((a, b) => (a.home ?? 0) - (b.home ?? 0));
