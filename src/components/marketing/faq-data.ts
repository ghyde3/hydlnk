import { pagesPerSiteSentence, sitesPerPlanSentence, sitesText } from "@/lib/marketing/plan-limits";
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
        answer: `Yes. ${sitesText("free")}, every block, every theme and design option and per-link analytics, with no time limit and no card on file.`,
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
          "The name in your page’s address: choose “fennmoor” and your page lives at fennmoor.hydlnk.com. Handles are 3 to 30 characters of lowercase letters, numbers and hyphens, and each one belongs to one site.",
        home: 2,
      },
      {
        question: "Can I build my page on my phone?",
        answer:
          "Yes. The editor works at phone size, with a Blocks and Preview switch and a small live preview docked while you edit. Tap something in the preview to edit it, add a block anywhere, and undo or redo if you change your mind. What you see is what you publish.",
      },
      {
        question: "Can I start from a template?",
        answer:
          "Yes. Inside the editor you can start from a template for musicians, podcasters, artists, shops, coaches or streamers, then change anything you like. Templates are on every plan.",
      },
      {
        question: "Can I see my page before I publish it?",
        answer:
          "Yes. Preview shows your draft, and you can share a private preview link that works for 7 days, so a friend or a client can look before anything goes live. You can turn the link off at any time.",
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
          "Nearly everything you see. Start from one of 16 themes, and preview it on your own page before you apply it. Then change 8 colors, the heading and body fonts, text size and weight, capital or lowercase headings, corner roundness, border thickness, button style, spacing, column width, alignment and the background (a solid color, a gradient with a direction and two colors, or your own photo with an overlay and blur).",
        home: 3,
      },
      {
        question: "Can I make one link stand out?",
        answer:
          "Yes. Every block has style controls, so one button can be filled while the rest are outlined. You can also mark up to 3 links as featured, with a bolder style and an optional gentle motion.",
      },
      {
        question: "What is a saved theme?",
        answer:
          "A saved copy of a page’s look that you can apply to any of your pages. Editing a saved theme updates the drafts that use it; live pages change only when you publish them again.",
      },
      {
        question: "Can I choose how my link looks when someone shares it?",
        answer:
          "Yes. Set the title, the description and the image people see in a shared link, with a preview card that shows how it will look. Your page also has a QR code you can download as a PNG or an SVG. Choose its colors, add your logo in the center and put a Scan me frame around it, for flyers, menus and printed cards.",
      },
      {
        question: "Which fonts can I use?",
        answer:
          "Eighteen Google Fonts picked to work on link pages: ten sans serifs, six serifs and two monospaced faces. You set one for headings and one for body text.",
      },
    ],
  },
  {
    id: "links",
    title: "Links and blocks",
    items: [
      {
        question: "Can I lock a link?",
        answer:
          "Yes, on every plan. Add a lock to a link and visitors must pass an age check or enter a code you choose before it opens. The link’s address isn’t in your page until they do.",
      },
      {
        question: "How do I share a discount code?",
        answer:
          "Add a Discount code block. Visitors tap the code to copy it, and you can add a link to your shop. The code is just text on your page, so set it up in your own store.",
      },
      {
        question: "Can my page send visitors straight to one link?",
        answer:
          "On Pro and Studio, yes. Turn on redirect mode in the Share tab and pick a link. Visitors skip your page and go to that link, and each visit counts as a click on it. The link can’t be a locked one.",
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
          "Yes. A root domain uses an A record instead of a CNAME, and the editor shows you exactly what to enter. If your main website already lives on that domain, use a subdomain such as links.yourbrand.com instead.",
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
        question: "Can I export my analytics?",
        answer:
          "Yes, on every plan. On the Analytics screen, download your daily totals or your clicks per link as a CSV file for a spreadsheet. Free covers the last 7 and 30 days. Pro and Studio also cover 90 days and a year.",
      },
      {
        question: "How are unique visitors counted without cookies?",
        answer:
          "We turn the visitor’s IP address and browser into a scrambled code that can’t be reversed, mixed with a value that changes every day. The code can’t be turned back into an IP address and can’t follow a visitor from one day to the next.",
      },
    ],
  },
  {
    id: "billing",
    title: "Plans and billing",
    items: [
      {
        question: "Can I go back to an earlier version of my page?",
        answer:
          "On Pro and Studio, yes. Your recent published versions are kept, so you can preview an earlier one and restore it. Your live page doesn’t change until you publish again. Free doesn’t include version history.",
      },
      {
        question: "Do you take a cut of sales?",
        answer: "No. We never take a cut of your sales, on any plan.",
        home: 6,
      },
      {
        question: "How do I upgrade, change my card or cancel?",
        answer:
          "Upgrade from your account settings through Stripe Checkout. Change your card, download invoices or cancel at any time in the Stripe billing portal, under Manage billing.",
      },
      {
        question: "How many sites and pages do I get?",
        answer: `A site is what has its own handle, domain, theme and analytics, and its pages are Home plus the pages you add at addresses like you.hydlnk.com/menu. ${sitesPerPlanSentence()}. ${pagesPerSiteSentence()}.`,
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
          "It keeps working. Published pages are stored close to your visitors and built for traffic spikes, on every plan.",
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
  {
    id: "ai-apps",
    title: "Claude and ChatGPT",
    items: [
      {
        question: "Can I use HYDLNK from Claude or ChatGPT?",
        answer:
          "Yes. Connect HYDLNK to Claude or ChatGPT, then ask the AI to add a link, reword your bio, switch your theme or check your numbers. It works on your draft, and the connect page has the steps for each app.",
      },
      {
        question: "Is it on every plan?",
        answer:
          "Yes. Connecting an AI app works on Free, Pro and Studio. What it can read of your analytics follows your plan, the same as in the editor.",
      },
      {
        question: "Can the AI publish my page without asking?",
        answer:
          "Only if you allow it. When you connect an app you choose what it may do, and publishing is a separate choice you can leave off. Even when it is on, the AI app may ask you first. Without it, the AI can still edit your draft, and you publish yourself.",
      },
      {
        question: "What can the AI see?",
        answer:
          "What you allow and ask for: your page drafts, your numbers and your list of custom domains. It can’t see other people’s pages, and HYDLNK never sees your chats with the AI.",
      },
      {
        question: "How do I turn it off?",
        answer:
          "Open Settings & billing, find Connected apps and choose Revoke next to the app. It stops working at once. You can also remove HYDLNK inside Claude or ChatGPT.",
      },
    ],
  },
];

/** The home page's short list, in its own order. */
export const HOME_FAQ: readonly FaqItem[] = FAQ_GROUPS.flatMap((group) => group.items)
  .filter((item) => item.home !== undefined)
  .sort((a, b) => (a.home ?? 0) - (b.home ?? 0));
