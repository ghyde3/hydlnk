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

export const metadata: Metadata = marketingMetadata({
  path: "/features",
  title: "Features",
  description:
    "Nine block types, a profile, an editor with a live phone preview, autosaved drafts and an explicit Publish. Every feature is on every plan, free included.",
  image: "features",
});

function FeatureList({ items }: { items: { title: string; body: string; icon: ReactNode }[] }) {
  return (
    <ul className="grid gap-3 min-[640px]:grid-cols-2">
      {items.map((item) => (
        <li key={item.title} className="flex gap-4 rounded-md border border-line bg-surface p-[18px]">
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
    body: "The phone preview beside the editor is drawn by the same code as your public page, so what you see is what visitors get.",
    icon: (
      <Icon>
        <rect x="7" y="3" width="10" height="18" rx="2" />
        <path d="M11 18h2" />
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
    title: "Checked before it goes live",
    body: "Publish checks that every link is a complete http or https address and that every visible block is filled in, and tells you what to fix.",
    icon: (
      <Icon>
        <path d="M5 12.5l4.5 4.5L19 7.5" />
      </Icon>
    ),
  },
  {
    title: "A preview image for every page",
    body: "Each published page gets its own social preview image, so your link looks like you when it’s shared.",
    icon: (
      <Icon>
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="M7 15l3-3 2 2 3-4 3 5" />
      </Icon>
    ),
  },
  {
    title: "Fast under load",
    body: "Published pages are cached at the edge, so they load quickly and keep serving through traffic spikes, on every plan.",
    icon: (
      <Icon>
        <path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z" />
      </Icon>
    ),
  },
];

const SAFETY = [
  {
    title: "Only real web links",
    body: "Links have to be http or https addresses. Anything else is refused when you save.",
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
    body: "Handles that could pass for HYDLNK itself or for well-known services are reserved, so nobody can claim them to impersonate.",
    icon: (
      <Icon>
        <rect x="5" y="11" width="14" height="9" rx="2" />
        <path d="M8 11V8a4 4 0 0 1 8 0v3" />
      </Icon>
    ),
  },
  {
    title: "Nothing tracks your visitors",
    body: "No cookies and no ad scripts on your page. YouTube videos load only when someone presses play.",
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
        lead="Nine kinds of block, a profile, an editor with a live phone preview, drafts that save themselves and a page that goes live only when you press Publish. All of it is on every plan, free included."
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
          title="Nine blocks, in any order."
          lead="A page is a column of blocks under your profile. Add up to 50, drag them into order and switch any of them off without deleting it."
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
              lead="Your photo, your name and one line about what you do sit at the top of every page, set in your theme’s fonts."
            />
            <ul className="mt-6 flex flex-col gap-3 text-[15px] leading-[1.6] text-text-2">
              <li>
                <strong className="font-semibold text-ink">Photo.</strong> Upload, replace or
                remove it. Without one, your initials stand in, drawn in your accent colour.
              </li>
              <li>
                <strong className="font-semibold text-ink">Display name.</strong> Up to 60
                characters, in your heading font.
              </li>
              <li>
                <strong className="font-semibold text-ink">Bio.</strong> Up to 160 characters: say
                what you do and what you want people to tap.
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

      <Section id="safety" tone="page" labelledBy="safety-title">
        <SectionIntro
          eyebrow="Safe by default"
          titleId="safety-title"
          title="A link people can trust tapping."
          lead="Open sign-up attracts scammers, so the guard rails are part of the product, not an add-on."
        />
        <div className="mt-10">
          <FeatureList items={SAFETY} />
        </div>
      </Section>

      <CtaBand
        title="Every feature here is on the free plan."
        note="Upgrade only when you want your own domain, more pages or a year of analytics."
      />
    </MarketingShell>
  );
}
