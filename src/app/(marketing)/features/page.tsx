import type { Metadata } from "next";
import type { ReactNode } from "react";
import { BLOCK_CATALOG } from "@/components/marketing/block-catalog";
import { CtaBand } from "@/components/marketing/cta-band";
import { WRENHAVEN } from "@/components/marketing/demo/brands";
import { DemoPage, PhoneFrame } from "@/components/marketing/demo/demo-page";
import { EditorMock } from "@/components/marketing/editor-mock";
import { marketingMetadata } from "@/components/marketing/metadata";
import { PageHero } from "@/components/marketing/page-hero";
import {
  ArrowLink,
  Icon,
  IconTile,
  Section,
  SectionIntro,
} from "@/components/marketing/primitives";
import { MarketingShell } from "@/components/marketing/shell";
import { guideHref } from "@/components/marketing/site-map";
import { pagesPerSiteText } from "@/lib/marketing/plan-limits";

export const metadata: Metadata = marketingMetadata({
  path: "/features",
  title: "Features",
  description:
    "Fifteen kinds of blocks, pages with a menu, price lists and opening hours, a profile with your logo, link tools, a branded QR code, CSV analytics, an editor with a live phone preview and a Publish button you control. Every feature is on every plan, free included, except version history and redirect mode on Pro and Studio.",
  image: "features",
});

function FeatureList({ items }: { items: { title: string; body: string; icon: ReactNode }[] }) {
  return (
    <ul className="grid gap-3 min-[640px]:grid-cols-2">
      {items.map((item) => (
        <li
          key={item.title}
          className="flex gap-4 rounded-md border border-line bg-surface p-[18px]"
        >
          <IconTile>{item.icon}</IconTile>
          <div className="min-w-0">
            <h3 className="text-base font-semibold">{item.title}</h3>
            <p className="mt-1 text-[15px] leading-[1.6] text-text-2">{item.body}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}

const EDITOR = [
  {
    title: "A preview you can trust",
    body: "The phone preview beside the editor shows your page exactly as visitors will see it, so what you see is what they get.",
    icon: (
      <Icon>
        <rect x="7" y="3" width="10" height="18" rx="2" />
        <path d="M11 18h2" />
      </Icon>
    ),
  },
  {
    title: "Edit from the preview",
    body: "On a phone, a small live preview stays docked while you work, and you can open it full size. Tap anything in it to edit that part, and add a block anywhere with the plus between blocks.",
    icon: (
      <Icon>
        <path d="M12 5v14M5 12h14" />
      </Icon>
    ),
  },
  {
    title: "Drag to reorder",
    body: "Move blocks with a mouse, a finger or the keyboard. Order on the page is order in the list.",
    icon: (
      <Icon>
        <path d="M12 3v18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3" />
      </Icon>
    ),
  },
  {
    title: "Drafts that save themselves",
    body: "Every change is saved to your draft as you work. Close the tab and pick up where you left off.",
    icon: (
      <Icon>
        <path d="M5 4h11l3 3v13H5z" />
        <path d="M8 4v5h7V4M8 20v-6h8v6" />
      </Icon>
    ),
  },
  {
    title: "Undo, redo and duplicate",
    body: "Change your mind as often as you like. Undo and redo work on every change, and one tap duplicates a block.",
    icon: (
      <Icon>
        <path d="M9 7H5v4M5 7l4-3M15 17h4v-4M19 17l-4 3" />
      </Icon>
    ),
  },
  {
    title: "Text with some style",
    body: "Format a text block with bold, italic, underline, strikethrough, links and left, center or right alignment. A toolbar with large buttons sits right above the text, with undo and redo.",
    icon: (
      <Icon>
        <path d="M6 5h7a3.5 3.5 0 0 1 0 7H6zM6 12h8a3.5 3.5 0 0 1 0 7H6z" />
      </Icon>
    ),
  },
  {
    title: "A real color picker",
    body: "Drag to pick a color, or type its hex code. It works in your page’s Design colors and in the colors of each block.",
    icon: (
      <Icon>
        <path d="M12 3.5a8.5 8.5 0 1 0 0 17c1.2 0 1.7-.8 1.7-1.6 0-.5-.2-.9-.5-1.3-.3-.4-.5-.8-.5-1.3 0-.9.7-1.6 1.6-1.6H17a3.5 3.5 0 0 0 3.5-3.5C20.5 6.9 16.7 3.5 12 3.5z" />
        <circle cx="8" cy="11" r="1" />
        <circle cx="11" cy="7.5" r="1" />
        <circle cx="15.5" cy="8.5" r="1" />
      </Icon>
    ),
  },
  {
    title: "Frame your photo by hand",
    body: "Drag your photo or a link’s picture into place and zoom with a pinch or a slider, until the crop shows what matters.",
    icon: (
      <Icon>
        <path d="M8 4v12h12M4 8h12v12" />
      </Icon>
    ),
  },
  {
    title: "Start from a template",
    body: "Pick a starting point for musicians, podcasters, artists, shops, coaches or streamers, then change anything you like.",
    icon: (
      <Icon>
        <rect x="4" y="4" width="16" height="16" rx="2" />
        <path d="M4 10h16M10 10v10" />
      </Icon>
    ),
  },
  {
    title: "Hide without deleting",
    body: "Switch a block off to keep it for later. Hidden blocks stay in your draft and never reach the live page.",
    icon: (
      <Icon>
        <path d="M3 12s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6z" />
        <path d="M4 20L20 4" />
      </Icon>
    ),
  },
];

const PUBLISHING = [
  {
    title: "Publish is a button you press",
    body: "Your live page changes only when you press Publish. Until then the editor says Unpublished changes, and visitors see the last version you published.",
    icon: (
      <Icon>
        <path d="M12 16V4M7 9l5-5 5 5" />
        <path d="M5 20h14" />
      </Icon>
    ),
  },
  {
    title: "Preview your draft, privately",
    body: "See your unpublished draft any time. Share a private preview link, good for 7 days, so a friend or a client can look first. You can turn it off whenever you like.",
    icon: (
      <Icon>
        <path d="M3 12s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6z" />
        <circle cx="12" cy="12" r="2.5" />
      </Icon>
    ),
  },
  {
    title: "Checked before it goes live",
    body: "Publish checks that every link is a complete web address and every visible block is filled in, and tells you what to fix.",
    icon: (
      <Icon>
        <path d="M5 12.5l4.5 4.5L19 7.5" />
      </Icon>
    ),
  },
  {
    title: "Your share card, your way",
    body: "Choose the title, description and image people see when your link is shared, with a preview card as you type. Without one, your page gets its own preview image.",
    icon: (
      <Icon>
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="M7 15l3-3 2 2 3-4 3 5" />
      </Icon>
    ),
  },
  {
    title: "A QR code in your colors",
    body: "Choose the code’s colors, put your logo in the center and add a Scan me frame. Download it as a PNG or an SVG, for flyers, menus and printed cards.",
    icon: (
      <Icon>
        <rect x="4" y="4" width="6" height="6" />
        <rect x="14" y="4" width="6" height="6" />
        <rect x="4" y="14" width="6" height="6" />
        <path d="M14 14h2v2h-2zM18 18h2M14 19h2" />
      </Icon>
    ),
  },
  {
    title: "Version history on Pro and Studio",
    body: "Your recent published versions are kept. Preview an earlier one and restore it, and your live page stays as it is until you publish again.",
    icon: (
      <Icon>
        <circle cx="12" cy="12" r="8" />
        <path d="M12 8v4l3 2" />
      </Icon>
    ),
  },
  {
    title: "Fast under load",
    body: "Published pages are stored close to your visitors, so they open fast and keep working through traffic spikes, on every plan.",
    icon: (
      <Icon>
        <path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z" />
      </Icon>
    ),
  },
];

const LINKS = [
  {
    title: "Real logos for your icons",
    body: "Social icons and link icons show the real mark of each site. The social row now also covers Reddit, Snapchat, Pinterest, Discord, Twitch and Spotify.",
    icon: (
      <Icon>
        <circle cx="6" cy="12" r="2.5" />
        <circle cx="12" cy="12" r="2.5" />
        <circle cx="18" cy="12" r="2.5" />
      </Icon>
    ),
  },
  {
    title: "Lock a link",
    body: "Ask visitors for an age check or a code before a link opens. The real address stays out of your page until they pass.",
    icon: (
      <Icon>
        <rect x="5" y="11" width="14" height="9" rx="2" />
        <path d="M8 11V8a4 4 0 0 1 8 0v3" />
      </Icon>
    ),
  },
  {
    title: "UTM tags on your links",
    body: "Add a source, medium and campaign to every link once, and change them on any single link. Sites you link to can then see which visits came from your page.",
    icon: (
      <Icon>
        <path d="M4 12.5V5a1 1 0 0 1 1-1h7.5l7.5 7.5-8.5 8.5z" />
        <circle cx="8.5" cy="8.5" r="1.2" />
      </Icon>
    ),
  },
  {
    title: "Redirect mode on Pro and Studio",
    body: "Send visitors straight to one link instead of showing your page. Every visit is counted as a click on that link. Turn it on and off from the Share tab.",
    icon: (
      <Icon>
        <path d="M5 12h12M13 7l5 5-5 5" />
      </Icon>
    ),
  },
  {
    title: "Export your numbers as CSV",
    body: "Download daily totals or clicks per link for a spreadsheet. Free covers the last 7 and 30 days. Pro and Studio add 90 days and a year.",
    icon: (
      <Icon>
        <path d="M5 4h11l3 3v13H5z" />
        <path d="M12 10v6M9.5 13.5L12 16l2.5-2.5" />
      </Icon>
    ),
  },
];

const SITES = [
  {
    title: "Home and pages",
    body: `Your link page is Home. Add pages beside it at addresses like you.hydlnk.com/menu, each with its own title, description and blocks. Free sites have ${pagesPerSiteText("free")}, Pro sites ${pagesPerSiteText("pro")}, and Studio sites ${pagesPerSiteText("studio")}.`,
    icon: (
      <Icon>
        <rect x="4" y="4" width="10" height="13" rx="2" />
        <path d="M17 8h3v12H9v-3" />
      </Icon>
    ),
  },
  {
    title: "A menu you control",
    body: "Show a menu on every page of the site, choose which pages are in it and put them in order. Or switch the menu off and link to pages from a Page link block instead.",
    icon: (
      <Icon>
        <path d="M5 7h14M5 12h14M5 17h14" />
      </Icon>
    ),
  },
  {
    title: "Items and prices",
    body: "List what you sell, with a name, a price shown exactly as you type it, a short description, a photo and a link for each item. Mark an item Sold and its price is struck through. Show the list as rows or as a grid. There is no checkout and no fee: it is a price list.",
    icon: (
      <Icon>
        <path d="M4 5h16M4 10h10M4 15h16M4 20h10" />
      </Icon>
    ),
  },
  {
    title: "Opening hours",
    body: "Set each day of the week as closed or open with one or two time ranges, pick your time zone and add a short note. The table shows today, and visitors see whether you are open now.",
    icon: (
      <Icon>
        <circle cx="12" cy="12" r="8" />
        <path d="M12 8v4l3 2" />
      </Icon>
    ),
  },
  {
    title: "Three templates to start from",
    body: "Garage sale, Small business or Musician: each gives you Home and two pages with sample text to replace, so it fits the free plan. A template fills your draft only. Nothing goes live until you press Publish.",
    icon: (
      <Icon>
        <rect x="4" y="4" width="16" height="16" rx="2" />
        <path d="M4 10h16M10 10v10" />
      </Icon>
    ),
  },
  {
    title: "One Publish for the whole site",
    body: "Publish sends Home and every page live together, or none of them if something needs fixing. Private preview links show Home and each page with a working menu. Analytics can show the whole site or one page, and a visitor who sees two pages in a day is counted once.",
    icon: (
      <Icon>
        <path d="M12 16V4M7 9l5-5 5 5" />
        <path d="M5 20h14" />
      </Icon>
    ),
  },
];

const SAFETY = [
  {
    title: "Only real web links",
    body: "Links have to be real web addresses, starting with http:// or https://. Anything else is refused when you save.",
    icon: (
      <Icon>
        <path d="M10 14l4-4" />
        <path d="M8.5 16.5l-1 1a3.5 3.5 0 0 1-5-5l3-3a3.5 3.5 0 0 1 5 0" />
        <path d="M15.5 7.5l1-1a3.5 3.5 0 0 1 5 5l-3 3a3.5 3.5 0 0 1-5 0" />
      </Icon>
    ),
  },
  {
    title: "Reports and a blocklist",
    body: "Every page has a report link, links are checked against a blocklist of known bad sites, and pages that break the rules are suspended.",
    icon: (
      <Icon>
        <path d="M5 21V4h11l-2 4 2 4H5" />
      </Icon>
    ),
  },
  {
    title: "Reserved names",
    body: "Handles that could pass for HYDLNK itself or for well-known services are reserved, so nobody can claim them to pose as someone else.",
    icon: (
      <Icon>
        <rect x="5" y="11" width="14" height="9" rx="2" />
        <path d="M8 11V8a4 4 0 0 1 8 0v3" />
      </Icon>
    ),
  },
  {
    title: "Nothing tracks your visitors",
    body: "No cookies and no ad scripts on your page. Embedded videos, except Spotify players, load only when someone taps to play.",
    icon: (
      <Icon>
        <path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" />
      </Icon>
    ),
  },
];

export default function FeaturesPage() {
  return (
    <MarketingShell current="features">
      <PageHero
        eyebrow="Features"
        title="Everything a link page needs. Nothing it doesn’t."
        lead="Fifteen kinds of block, a profile with your logo, tools for your links, an editor with a live phone preview and a page that goes live only when you press Publish. All of it is on every plan, free included, apart from version history and redirect mode on Pro and Studio."
        aside={
          <figure className="flex flex-col items-center gap-3">
            <PhoneFrame>
              <DemoPage brand={WRENHAVEN} />
            </PhoneFrame>
            <figcaption className="font-mono text-xs text-text-2">
              Wrenhaven Roasters, a demo page in Noir
            </figcaption>
          </figure>
        }
      />

      <Section id="blocks" tone="page" labelledBy="blocks-title">
        <SectionIntro
          eyebrow="Blocks"
          titleId="blocks-title"
          title="Fifteen blocks, in any order."
          lead="A page is a column of blocks under your profile. Add up to 50, drag them into order, style each one and switch any of them off without deleting it. Links take an icon or a small thumbnail, and up to 3 can be featured with a bolder look. The last six blocks are for what you sell, answer and share: FAQ, contact details, discount codes, books, apps and places."
        />
        <ul className="mt-10 grid gap-3 min-[640px]:grid-cols-2 min-[1024px]:grid-cols-3">
          {BLOCK_CATALOG.map((block) => (
            <li
              key={block.id}
              className="flex flex-col gap-3 rounded-md border border-line bg-surface p-[20px]"
            >
              <div className="flex items-center gap-3">
                <IconTile>{block.icon}</IconTile>
                <h3 className="text-base font-semibold">{block.name}</h3>
              </div>
              <p className="text-[15px] leading-[1.6] text-ink">{block.short}</p>
              <p className="text-sm leading-[1.6] text-text-2">{block.detail}</p>
            </li>
          ))}
        </ul>
      </Section>

      <Section id="profile" labelledBy="profile-title">
        <div className="grid items-center gap-12 min-[1024px]:grid-cols-2">
          <div>
            <SectionIntro
              eyebrow="Profile"
              titleId="profile-title"
              title="A profile that introduces you."
              lead="Your photo or logo, your name and one line about what you do sit at the top of every page, with an optional message above them."
            />
            <ul className="mt-6 flex flex-col gap-3 text-[15px] leading-[1.6] text-text-2">
              <li>
                <strong className="font-semibold text-ink">Photo.</strong> Upload, replace or remove
                it, and choose its position, shape, size and border, or hide it. Without one, your
                initials stand in, drawn in your accent color.
              </li>
              <li>
                <strong className="font-semibold text-ink">Logo.</strong> Show a logo beside your
                name, or in place of it.
              </li>
              <li>
                <strong className="font-semibold text-ink">Display name.</strong> Up to 60
                characters. It uses your heading font unless you pick another font and a size from
                small to extra large for the name alone. Hide the name and bio if you would rather
                build the top of your page from blocks.
              </li>
              <li>
                <strong className="font-semibold text-ink">Bio.</strong> Up to 160 characters: say
                what you do and what you want people to tap.
              </li>
              <li>
                <strong className="font-semibold text-ink">Support banner.</strong> A short message,
                up to 100 characters, with an optional link, above your profile. Visitors can
                dismiss it for their visit, and it sets no cookie.
              </li>
            </ul>
          </div>
          <div aria-hidden="true" className="grid grid-cols-2 gap-3">
            <div className="flex flex-col items-center gap-2 rounded-md border border-line bg-page p-6 text-center">
              <span className="flex size-16 items-center justify-center rounded-[50%] border border-ink bg-brass-soft text-xl font-semibold text-brass-soft-text">
                FC
              </span>
              <span className="mt-1 text-base font-semibold">Fennmoor Ceramics</span>
              <span className="font-mono text-xs text-text-2">No photo: initials</span>
            </div>
            <div className="flex flex-col items-center gap-2 rounded-md border border-line bg-page p-6 text-center">
              <picture>
                <source srcSet="/marketing/demo/fennmoor-avatar.avif" type="image/avif" />
                <img
                  src="/marketing/demo/fennmoor-avatar.webp"
                  alt=""
                  width={160}
                  height={160}
                  loading="lazy"
                  decoding="async"
                  className="size-16 rounded-[50%] border border-ink object-cover"
                />
              </picture>
              <span className="mt-1 text-base font-semibold">Fennmoor Ceramics</span>
              <span className="font-mono text-xs text-text-2">With a photo</span>
            </div>
          </div>
        </div>
      </Section>

      <Section id="editor" tone="page" labelledBy="editor-title">
        <div className="grid items-start gap-12 min-[1024px]:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]">
          <div>
            <SectionIntro
              eyebrow="The editor"
              titleId="editor-title"
              title="An editor built around the preview."
              lead="Blocks on one side, your page on the other. On a phone the two become a Blocks and Preview switch, so you can build the whole page from the device your visitors use."
            />
            <div className="mt-8">
              <FeatureList items={EDITOR} />
            </div>
          </div>
          <EditorMock />
        </div>
      </Section>

      <Section id="publishing" labelledBy="publishing-title">
        <SectionIntro
          eyebrow="Publishing"
          titleId="publishing-title"
          title="Publish when it’s right, not when you save."
          lead="Drafts and the live page are kept apart. You can experiment as much as you like, and nothing reaches your visitors until you decide it should."
        />
        <div className="mt-10">
          <FeatureList items={PUBLISHING} />
        </div>
        <ArrowLink href={guideHref("getting-started")} className="mt-6">
          Build and publish your first page
        </ArrowLink>
      </Section>

      <Section id="ai-apps" tone="page" labelledBy="ai-apps-title">
        <SectionIntro
          eyebrow="AI apps"
          titleId="ai-apps-title"
          title="Use it from Claude or ChatGPT"
          lead="Connect HYDLNK to Claude or ChatGPT and ask for changes in plain words: add a link, reword your bio, switch your theme or check last week’s numbers. The AI works on your draft, so you can look it over in the editor, and it publishes only if you allowed that when you connected. It works on every plan, free included, and you can disconnect it at any time."
        />
        <ArrowLink href="/connect" className="mt-6">
          See how to connect
        </ArrowLink>
      </Section>

      <Section id="safety" labelledBy="safety-title">
        <SectionIntro
          eyebrow="Safe by default"
          titleId="safety-title"
          title="A link people can trust tapping."
          lead="Anyone can sign up, so the safety checks are built in, not bolted on."
        />
        <div className="mt-10">
          <FeatureList items={SAFETY} />
        </div>
      </Section>

      <Section id="links" tone="page" labelledBy="links-title">
        <SectionIntro
          eyebrow="Links and numbers"
          titleId="links-title"
          title="Control where each tap goes."
          lead="Lock a link, tag it for your campaigns, point your whole page at one link, and take your click numbers into a spreadsheet."
        />
        <div className="mt-10">
          <FeatureList items={LINKS} />
        </div>
      </Section>

      <Section id="pages" labelledBy="pages-title">
        <SectionIntro
          eyebrow="Sites with pages"
          titleId="pages-title"
          title="More than one page, when you need it."
          lead="A garage sale, a small shop or a band can want a price list, opening hours or a page for shows. Keep one link, and give each of those its own page on the same site."
        />
        <div className="mt-10">
          <FeatureList items={SITES} />
        </div>
      </Section>

      <CtaBand
        title="Nearly every feature here is on the free plan."
        note="Upgrade only when you want your own domain, more sites and pages, a year of analytics, version history or redirect mode."
      />
    </MarketingShell>
  );
}
