import type { Metadata } from "next";
import { CtaBand } from "@/components/marketing/cta-band";
import { IVORY, NOIR, SMOKE, WRENHAVEN, type DemoTheme } from "@/components/marketing/demo/brands";
import { DemoPage, PhoneFrame } from "@/components/marketing/demo/demo-page";
import { TokenPlayground } from "@/components/marketing/design/token-playground";
import { marketingMetadata } from "@/components/marketing/metadata";
import { PageHero } from "@/components/marketing/page-hero";
import {
  ArrowLink,
  Eyebrow,
  Section,
  SectionIntro,
} from "@/components/marketing/primitives";
import { MarketingShell } from "@/components/marketing/shell";
import { guideHref } from "@/components/marketing/site-map";
import { NoirTokenCard, ResolveChain } from "@/components/marketing/theme-tokens";

export const metadata: Metadata = marketingMetadata({
  path: "/design",
  title: "Design",
  description:
    "Every visual choice on a HYDLNK page is one of 23 tokens: colour, type, shape, space and background. Start from a theme, override what you like, save it and reuse it.",
  image: "design",
});

const TOKEN_GROUPS: { group: string; tokens: [string, string][] }[] = [
  {
    group: "Colour",
    tokens: [
      ["bg", "Page background"],
      ["surface", "Cards and grid tiles"],
      ["text", "Main text"],
      ["textMuted", "Bio, captions and other secondary text"],
      ["accent", "Avatar ring, card titles, outlines and highlights"],
      ["buttonBg", "Button fill"],
      ["buttonText", "Text on filled buttons"],
      ["border", "Edges of cards, tiles and icons"],
    ],
  },
  {
    group: "Type",
    tokens: [
      ["fontHeading", "Your name, headers and card titles"],
      ["fontBody", "Everything else"],
      ["scale", "Overall text size, from 0.875× to 1.25×"],
      ["weightHeading", "Heading weight, 400 to 800"],
      ["letterCase", "Headings as written, or in capitals"],
    ],
  },
  {
    group: "Shape",
    tokens: [
      ["radius", "Corners, from 0 to 32 px"],
      ["borderWidth", "Edge thickness, from 0 to 4 px"],
      ["buttonStyle", "Fill, outline, soft, shadow or pill"],
    ],
  },
  {
    group: "Space",
    tokens: [
      ["density", "Compact, regular or airy spacing"],
      ["maxWidth", "Column width, from 360 to 720 px"],
      ["align", "Centred or left-aligned"],
    ],
  },
  {
    group: "Background",
    tokens: [
      ["bgType", "Solid colour, gradient or image"],
      ["bgImage", "A photo you upload"],
      ["overlayOpacity", "A wash of your background colour over the photo"],
      ["blur", "Softens the photo, up to 20 px"],
    ],
  },
];

const RESOLVE_STEPS = [
  ["system", "HYDLNK’s neutral defaults: every token has a value before you touch anything."],
  ["theme", "A system theme or one of your saved themes replaces all of them at once."],
  ["page", "Anything you change on the page itself wins over the theme."],
  ["block", "A single link or card can change its colours, button style and corner radius."],
] as const;

const FONTS = {
  Sans: ["Inter", "DM Sans", "Manrope", "Geist", "Space Grotesk", "Outfit", "Sora", "Poppins", "Plus Jakarta Sans", "Bricolage Grotesque"],
  Serif: ["Instrument Serif", "Fraunces", "Playfair Display", "DM Serif Display", "Lora", "Cormorant Garamond"],
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
      <p className="font-mono text-xs leading-[1.7] text-text-2">
        {theme.fontHeading} · radius {theme.radius} · {theme.buttonStyle} · {theme.bgType}
      </p>
      <p className="text-sm leading-[1.6] text-text-2">{note}</p>
    </li>
  );
}

export default function DesignPage() {
  return (
    <MarketingShell current="design">
      <PageHero
        eyebrow="Design"
        title="Design control is the product."
        lead="Every visual choice on your page is one of 23 tokens. Start from a theme, change any token, and the whole page follows. Save the result as a theme and use it again on any page."
        secondary={{ href: guideHref("designing-your-page"), label: "Read the design guide" }}
      />

      <Section id="playground" tone="page" labelledBy="playground-title">
        <SectionIntro
          eyebrow="Try it"
          titleId="playground-title"
          title="Change a token. Watch the page follow."
          lead="A demo page in the Smoke theme. Switch the theme, then override single tokens on top of it."
        />
        <div className="mt-10">
          <TokenPlayground />
        </div>
      </Section>

      <Section id="tokens" labelledBy="tokens-title">
        <SectionIntro
          eyebrow="The token system"
          titleId="tokens-title"
          title="23 tokens in five groups."
          lead="Blocks never carry their own colours or fonts: they read these tokens. That’s why a theme can change everything at once without breaking anything."
        />
        <div className="mt-10 grid gap-3 min-[760px]:grid-cols-2 min-[1080px]:grid-cols-3">
          {TOKEN_GROUPS.map(({ group, tokens }) => (
            <div key={group} className="overflow-hidden rounded-md border border-line bg-surface">
              <div className="flex items-center justify-between border-b border-line bg-page px-4 py-3">
                <h3 className="text-[15px] font-semibold">{group}</h3>
                <span className="font-mono text-xs text-text-2">
                  {tokens.length} {tokens.length === 1 ? "token" : "tokens"}
                </span>
              </div>
              <dl>
                {tokens.map(([name, description]) => (
                  <div key={name} className="border-b border-line px-4 py-2.5 last:border-b-0">
                    <dt className="font-mono text-[13px] text-ink">{name}</dt>
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
              eyebrow="How a style resolves"
              titleId="resolve-title"
              title="Later wins."
              lead="Four layers decide each token’s final value, and each one only changes what it sets."
            />
            <div className="mt-6">
              <ResolveChain />
            </div>
            <ol className="mt-6 flex flex-col gap-3">
              {RESOLVE_STEPS.map(([name, body]) => (
                <li key={name} className="flex gap-3 text-[15px] leading-[1.6]">
                  <span className="w-14 shrink-0 font-mono text-[13px] leading-[1.9] text-brass-text">
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
          lead="A theme is a complete set of tokens. HYDLNK ships with system themes; your saved themes sit next to them."
        />
        <ul className="mt-10 grid gap-3 min-[760px]:grid-cols-3">
          <ThemeCard theme={NOIR} note="Warm black, brass accent, Instrument Serif and outlined buttons." />
          <ThemeCard theme={IVORY} note="Paper white, ink buttons, Fraunces and generous spacing." />
          <ThemeCard theme={SMOKE} note="Cool slate, a soft gradient and pill buttons in Geist." />
        </ul>
        <div className="mt-10 grid gap-3 min-[760px]:grid-cols-2">
          <div className="rounded-md border border-line bg-surface p-[22px]">
            <h3 className="text-base font-semibold">Saved themes</h3>
            <ul className="mt-3 flex list-disc flex-col gap-2 pl-5 text-[15px] leading-[1.6] text-text-2">
              <li>“Save as theme” copies every resolved token on the page into a theme of your own.</li>
              <li>Apply it to any of your pages. Applying a theme clears that page’s own overrides, and you can undo it.</li>
              <li>Free accounts keep up to 3 saved themes. Pro and Studio have no limit.</li>
            </ul>
          </div>
          <div className="rounded-md border border-line bg-surface p-[22px]">
            <h3 className="text-base font-semibold">Changes wait for Publish</h3>
            <ul className="mt-3 flex list-disc flex-col gap-2 pl-5 text-[15px] leading-[1.6] text-text-2">
              <li>Applying or editing a theme only changes drafts. Pages that use it show Unpublished changes.</li>
              <li>Live pages keep the look they were published with until you publish them again.</li>
              <li>Delete a saved theme and the drafts that used it fall back to the system default.</li>
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
            lead="Choose one Google Font for headings and one for body text. The list is short on purpose: every face on it holds up at link-page sizes, so any pairing stays readable."
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
              eyebrow="Per-block overrides"
              titleId="overrides-title"
              title="Make one link stand out."
              lead="A link or a card can override the page’s colours, button style and corner radius. The rest of the page keeps the theme, so a highlight never turns into a mess."
            />
            <p className="mt-5 text-[15px] leading-[1.6] text-text-2">
              On this demo page every button is outlined, as the Noir theme says, except “This
              week’s roast”, which is filled. That’s one block override: buttonStyle set to fill.
            </p>
            <p className="mt-3 text-[15px] leading-[1.6] text-text-2">
              Block overrides cover accent, button colours, text, surface, border, button style
              and radius, and nothing else, so fonts and spacing stay consistent down the page.
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
        note="Every token, every block and the system themes are yours on Free."
      />
    </MarketingShell>
  );
}
