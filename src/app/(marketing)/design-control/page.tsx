import type { Metadata } from "next";
import { CtaBand } from "@/components/marketing/cta-band";
import { IVORY, NOIR, SMOKE, WRENHAVEN, type DemoTheme } from "@/components/marketing/demo/brands";
import { lookLine } from "@/components/marketing/demo/demo-gallery";
import { DemoPage, PhoneFrame } from "@/components/marketing/demo/demo-page";
import { TokenPlayground } from "@/components/marketing/design/token-playground";
import { marketingMetadata } from "@/components/marketing/metadata";
import { PageHero } from "@/components/marketing/page-hero";
import { ArrowLink, Eyebrow, Section, SectionIntro } from "@/components/marketing/primitives";
import { MarketingShell } from "@/components/marketing/shell";
import { guideHref } from "@/components/marketing/site-map";
import { NoirTokenCard, ResolveChain } from "@/components/marketing/theme-tokens";

export const metadata: Metadata = marketingMetadata({
  path: "/design-control",
  title: "Design",
  description:
    "Start from a theme, then change any color, font, button or background until your page looks like your brand. Save your look and use it on every page.",
  image: "design",
});

const SETTING_GROUPS: { group: string; settings: [string, string][] }[] = [
  {
    group: "Color",
    settings: [
      ["Page background", "The color behind everything"],
      ["Cards and panels", "The fill of cards and grid tiles"],
      ["Text", "Your main text"],
      ["Secondary text", "Bio, captions and other small print"],
      ["Accent", "Avatar ring, card titles, outlines and highlights"],
      ["Button color", "The fill of buttons"],
      ["Button text", "Text on filled buttons"],
      ["Lines and borders", "Edges of cards, tiles and icons"],
    ],
  },
  {
    group: "Type",
    settings: [
      ["Heading font", "Your name, headers and card titles"],
      ["Body font", "Everything else"],
      ["Text size", "Make all text smaller or larger"],
      ["Heading boldness", "How bold your headings are"],
      ["Capital letters", "Headings as written, in capitals or in lowercase"],
    ],
  },
  {
    group: "Shape",
    settings: [
      ["Corner radius", "From square corners to fully rounded"],
      ["Border thickness", "How thick the edges are, from none to 4 px"],
      ["Button style", "Solid, outline, soft, shadow or pill"],
    ],
  },
  {
    group: "Space",
    settings: [
      ["Space between blocks", "Compact, regular or airy"],
      ["Page width", "How wide the column gets, from 360 to 720 px"],
      ["Text alignment", "Centered or left-aligned"],
    ],
  },
  {
    group: "Background",
    settings: [
      ["Background", "A solid color, a gradient or a photo"],
      ["Gradient", "Pick one of eight directions and two colors, or start from a preset"],
      ["Background photo", "A photo you upload"],
      ["Image overlay", "A wash of your background color over the photo"],
      ["Image blur", "Softens the photo, up to 20 px"],
    ],
  },
];

const RESOLVE_STEPS = [
  [
    "Default",
    "HYDLNK’s neutral starting point. Every setting has a value before you touch anything.",
  ],
  ["Theme", "A HYDLNK theme or one of your saved themes sets all of them at once."],
  ["Page", "Anything you change on your page itself wins over the theme."],
  ["Block", "A single link or card can change its own colors, button style and corner radius."],
] as const;

const FONTS = {
  Sans: [
    "Inter",
    "DM Sans",
    "Manrope",
    "Geist",
    "Space Grotesk",
    "Outfit",
    "Sora",
    "Poppins",
    "Plus Jakarta Sans",
    "Bricolage Grotesque",
  ],
  Serif: [
    "Instrument Serif",
    "Fraunces",
    "Playfair Display",
    "DM Serif Display",
    "Lora",
    "Cormorant Garamond",
  ],
  Mono: ["Space Mono", "Geist Mono"],
} as const;

function ThemeCard({ theme, note }: { theme: DemoTheme; note: string }) {
  const swatches = [theme.bg, theme.surface, theme.text, theme.textMuted, theme.accent];
  return (
    <li className="flex flex-col gap-3 rounded-md border border-line bg-surface p-[18px]">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold">{theme.name}</h3>
        <span className="font-mono text-xs text-text-2">System theme</span>
      </div>
      <div className="flex gap-1.5" aria-hidden="true">
        {swatches.map((color) => (
          <span
            key={color}
            style={{ background: color }}
            className="h-8 flex-1 rounded-sm border border-line-2"
          />
        ))}
      </div>
      <p className="font-mono text-xs leading-[1.7] text-text-2">{lookLine(theme)}</p>
      <p className="text-sm leading-[1.6] text-text-2">{note}</p>
    </li>
  );
}

export default function DesignPage() {
  return (
    <MarketingShell current="design">
      <PageHero
        eyebrow="Design"
        title="Make your page look like your brand."
        lead="Start from a theme, then change any color, font, button or background. The whole page follows, and you can save your look and use it again on any page."
        secondary={{ href: guideHref("designing-your-page"), label: "Read the design guide" }}
      />

      <Section id="playground" tone="page" labelledBy="playground-title">
        <SectionIntro
          eyebrow="Try it"
          titleId="playground-title"
          title="Change one thing. Watch the page follow."
          lead="A demo page you can restyle. Pick a theme, then change just the buttons, the corners, the font or the background on top of it."
        />
        <div className="mt-10">
          <TokenPlayground />
        </div>
      </Section>

      <Section id="tokens" labelledBy="tokens-title">
        <SectionIntro
          eyebrow="What you can change"
          titleId="tokens-title"
          title="23 settings in five groups."
          lead="Every block follows these settings. That’s why changing one changes the whole page, and nothing ever looks out of place."
        />
        <div className="mt-10 grid gap-3 min-[760px]:grid-cols-2 min-[1080px]:grid-cols-3">
          {SETTING_GROUPS.map(({ group, settings }) => (
            <div key={group} className="overflow-hidden rounded-md border border-line bg-surface">
              <div className="flex items-center justify-between border-b border-line bg-page px-4 py-3">
                <h3 className="text-[15px] font-semibold">{group}</h3>
                <span className="font-mono text-xs text-text-2">
                  {settings.length} {settings.length === 1 ? "setting" : "settings"}
                </span>
              </div>
              <dl>
                {settings.map(([name, description]) => (
                  <div key={name} className="border-b border-line px-4 py-2.5 last:border-b-0">
                    <dt className="text-[15px] font-semibold text-ink">{name}</dt>
                    <dd className="mt-0.5 text-sm leading-[1.5] text-text-2">{description}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
      </Section>

      <Section id="resolve" tone="page" labelledBy="resolve-title">
        <div className="grid items-center gap-12 min-[1024px]:grid-cols-2">
          <div>
            <SectionIntro
              eyebrow="How your choices stack"
              titleId="resolve-title"
              title="The most specific choice wins."
              lead="Four layers decide how each part of your page looks. Each layer only changes what it sets."
            />
            <div className="mt-6">
              <ResolveChain />
            </div>
            <ol className="mt-6 flex flex-col gap-3">
              {RESOLVE_STEPS.map(([name, body]) => (
                <li key={name} className="flex gap-3 text-[15px] leading-[1.6]">
                  <span className="w-16 shrink-0 font-mono text-[13px] leading-[1.9] text-brass-text">
                    {name}
                  </span>
                  <span className="text-text-2">{body}</span>
                </li>
              ))}
            </ol>
          </div>
          <NoirTokenCard />
        </div>
      </Section>

      <Section id="themes" labelledBy="themes-title">
        <SectionIntro
          eyebrow="Themes"
          titleId="themes-title"
          title="Start from a theme, save your own."
          lead="A theme is a complete look in one tap: colors, fonts, buttons and spacing. Pick one of HYDLNK’s 16 themes, preview it on your own page before you apply it, or save your own."
        />
        <ul className="mt-10 grid gap-3 min-[760px]:grid-cols-3">
          <ThemeCard
            theme={NOIR}
            note="Warm black, brass accent, Instrument Serif and outlined buttons."
          />
          <ThemeCard
            theme={IVORY}
            note="Paper white, ink buttons, Fraunces and generous spacing."
          />
          <ThemeCard theme={SMOKE} note="Cool slate, a soft gradient and pill buttons in Geist." />
        </ul>
        <div className="mt-10 grid gap-3 min-[760px]:grid-cols-2">
          <div className="rounded-md border border-line bg-surface p-[22px]">
            <h3 className="text-base font-semibold">Saved themes</h3>
            <ul className="mt-3 flex list-disc flex-col gap-2 pl-5 text-[15px] leading-[1.6] text-text-2">
              <li>“Save as theme” saves your page’s whole look as a theme of your own.</li>
              <li>
                Apply it to any of your pages. Applying a theme clears the changes you made on that
                page, and you can undo it.
              </li>
              <li>Free accounts keep up to 3 saved themes. Pro and Studio have no limit.</li>
            </ul>
          </div>
          <div className="rounded-md border border-line bg-surface p-[22px]">
            <h3 className="text-base font-semibold">Changes wait for Publish</h3>
            <ul className="mt-3 flex list-disc flex-col gap-2 pl-5 text-[15px] leading-[1.6] text-text-2">
              <li>
                Applying or editing a theme only changes drafts. Pages that use it show Unpublished
                changes.
              </li>
              <li>
                Live pages keep the look they were published with until you publish them again.
              </li>
              <li>
                Delete a saved theme and the drafts that used it fall back to the system default.
              </li>
            </ul>
          </div>
        </div>
      </Section>

      <Section id="fonts" tone="page" labelledBy="fonts-title">
        <div className="grid gap-12 min-[1024px]:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <SectionIntro
            eyebrow="Type"
            titleId="fonts-title"
            title="Eighteen fonts, picked for link pages."
            lead="Pick one font for headings and one for body text. The list is short on purpose: every font on it reads well on a phone, so any pairing looks good."
          />
          <div className="grid gap-3 min-[640px]:grid-cols-3">
            {Object.entries(FONTS).map(([kind, names]) => (
              <div key={kind} className="rounded-md border border-line bg-surface p-[18px]">
                <Eyebrow>{kind}</Eyebrow>
                <ul className="mt-3 flex flex-col gap-1.5 text-[15px]">
                  {names.map((name) => (
                    <li key={name}>{name}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </Section>

      <Section id="overrides" labelledBy="overrides-title">
        <div className="grid items-center gap-12 min-[1024px]:grid-cols-[minmax(0,1fr)_auto]">
          <div>
            <SectionIntro
              eyebrow="One-off changes"
              titleId="overrides-title"
              title="Make one link stand out."
              lead="Give any block its own color, button style or corner radius, or mark up to 3 links as featured for a bolder look and an optional gentle motion. The rest of the page keeps the theme, so one highlight never turns into a mess."
            />
            <p className="mt-5 text-[15px] leading-[1.6] text-text-2">
              On this demo page every button is outlined, the way the Noir theme draws them, except
              “This week’s roast”, which is filled. That one change was made on a single link.
            </p>
            <p className="mt-3 text-[15px] leading-[1.6] text-text-2">
              A single link or card can change its colors, button style and corner radius, and
              nothing else, so fonts and spacing stay consistent down the page.
            </p>
            <ArrowLink href={guideHref("designing-your-page")} className="mt-5">
              Designing your page
            </ArrowLink>
          </div>
          <figure className="flex flex-col items-center gap-3 justify-self-center">
            <PhoneFrame>
              <DemoPage brand={WRENHAVEN} />
            </PhoneFrame>
            <figcaption className="font-mono text-xs text-text-2">
              Wrenhaven Roasters: Noir, one filled button
            </figcaption>
          </figure>
        </div>
      </Section>

      <CtaBand
        title="Design is free on every plan."
        note="Every block, theme and design option is yours on Free."
      />
    </MarketingShell>
  );
}
