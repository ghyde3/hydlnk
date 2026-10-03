import Link from "next/link";
import { ArrowLink, Eyebrow, Section, SectionIntro } from "../primitives";
import { CREATOR_AUDIENCES, PLATFORM_AUDIENCES, audienceHref, type Audience } from "./data";

const CHIP =
  "inline-flex min-h-11 items-center rounded-sm border border-line-3 bg-surface px-4 text-sm font-semibold text-ink hover:border-ink";

function ChipRow({ label, items }: { label: string; items: readonly Audience[] }) {
  return (
    <div className="min-w-0">
      <Eyebrow>{label}</Eyebrow>
      <ul className="mt-3 flex flex-wrap gap-2">
        {items.map((audience) => (
          <li key={audience.slug}>
            <Link href={audienceHref(audience.slug)} className={CHIP}>
              {audience.name}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * A full-width band for the home page: one chip for each link-in-bio page, grouped by where people
 * post and what they do. Plain links with no script, so it adds nothing to the page's weight.
 * `tone` picks the band's background so it can sit between either of the home page's two.
 */
export function AudienceStrip({ tone = "white" }: { tone?: "white" | "page" }) {
  return (
    <Section id="link-in-bio-for" tone={tone} labelledBy="link-in-bio-for-title">
      <SectionIntro
        eyebrow="Link in bio for"
        titleId="link-in-bio-for-title"
        title="Set up for where you post and what you make."
        lead="Pick your app or your kind of work for the exact steps to add your link, and a page that fits."
      />
      <div className="mt-8 grid gap-8 min-[1080px]:grid-cols-2">
        <ChipRow label="Where you post" items={PLATFORM_AUDIENCES} />
        <ChipRow label="What you do" items={CREATOR_AUDIENCES} />
      </div>
      <ArrowLink href={audienceHref()} className="mt-6">
        All link in bio pages
      </ArrowLink>
    </Section>
  );
}
