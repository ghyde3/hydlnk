import Link from "next/link";
import { clientEnv } from "@/lib/env/client";
import { rootOrigin } from "@/lib/routing/urls";
import { ClaimForm } from "../claim-form";
import { CtaBand } from "../cta-band";
import { FaqList } from "../faq";
import { marketingMetadata } from "../metadata";
import {
  ArrowLink,
  ButtonLink,
  Chip,
  Container,
  H1,
  H2,
  IconTile,
  LEAD,
  Section,
  SectionIntro,
} from "../primitives";
import { MarketingShell } from "../shell";
import { GUIDES, guideHref } from "../site-map";
import { TryBuilder } from "../try/try-builder";
import { AUDIENCES, audienceBySlug, audienceHref, type Audience } from "./data";
import { AudienceIcon, blockName } from "./icons";
import { breadcrumbJsonLd, faqPageJsonLd, jsonLdScript } from "./json-ld";

/** Title, description, canonical and social card for one link-in-bio page. */
export function audienceMetadata(audience: Audience) {
  return marketingMetadata({
    path: audienceHref(audience.slug),
    title: audience.title,
    description: audience.description,
    image: "home",
  });
}

const CARD = "rounded-md border border-line bg-surface p-[22px]";

/** The page behind /link-in-bio/<slug>. Everything on it comes from the audience's entry in data.ts. */
export function AudiencePage({ audience }: { audience: Audience }) {
  const origin = rootOrigin(clientEnv.NEXT_PUBLIC_ROOT_DOMAIN);
  const related = audience.related
    .map((slug) => audienceBySlug(slug))
    .filter((item): item is Audience => item !== undefined);
  const guides = audience.guides
    .map((slug) => GUIDES.find((guide) => guide.slug === slug))
    .filter((guide): guide is (typeof GUIDES)[number] => guide !== undefined);
  const claimTitle =
    audience.kind === "platform"
      ? `Claim your handle, then add it to ${audience.name}.`
      : undefined;

  return (
    <MarketingShell>
      <section
        aria-labelledby="page-title"
        className="border-b border-line bg-surface pt-[clamp(28px,6vw,56px)] pb-[clamp(40px,8vw,80px)]"
      >
        <Container className="grid items-center gap-x-16 gap-y-8 min-[1080px]:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
          <div className="min-w-0">
            <nav aria-label="Breadcrumb" className="font-mono text-xs tracking-[0.06em] uppercase">
              <ol className="flex flex-wrap items-center gap-x-2 text-text-2">
                <li>
                  <Link
                    href={audienceHref()}
                    className="inline-flex min-h-11 min-w-11 items-center underline-offset-4 hover:underline"
                  >
                    Link in bio
                  </Link>
                </li>
                <li aria-hidden="true">/</li>
                <li aria-current="page" className="text-ink">
                  {audience.name}
                </li>
              </ol>
            </nav>
            <h1 id="page-title" className={`mt-2 max-w-[880px] ${H1}`}>
              {audience.h1}
            </h1>
            <p className={`mt-5 max-w-[640px] ${LEAD}`}>{audience.lead}</p>
          </div>
          <div className="min-w-0">
            <ClaimForm id="audience-hero-handle" rootDomain={clientEnv.NEXT_PUBLIC_ROOT_DOMAIN} />
            <p className="mt-4">
              <a
                href="#how"
                className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold underline decoration-line-3 underline-offset-4 hover:decoration-ink"
              >
                {audience.kind === "platform" ? "Jump to the steps" : "See how to set it up"}
                <span aria-hidden="true">↓</span>
              </a>
            </p>
          </div>
        </Container>
      </section>

      <Section id="how" tone="page" labelledBy="steps-title" className="scroll-mt-4">
        <div className="grid gap-x-16 gap-y-8 min-[1080px]:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
          <div className="min-w-0">
            <SectionIntro
              eyebrow="Step by step"
              titleId="steps-title"
              title={audience.stepsTitle}
            />
            {audience.stepsNote ? (
              <p className="mt-6 max-w-[520px] rounded-md border border-line bg-brass-soft p-[18px] text-[15px] leading-[1.6] text-brass-soft-text">
                <strong className="font-semibold">Good to know. </strong>
                {audience.stepsNote}
              </p>
            ) : null}
          </div>
          <ol className="grid min-w-0 gap-3">
            {audience.steps.map((step, index) => (
              <li key={step.title} className={`flex gap-4 ${CARD}`}>
                <span
                  aria-hidden="true"
                  className="w-6 shrink-0 pt-0.5 font-mono text-xs tracking-[0.08em] text-brass-text"
                >
                  {String(index + 1).padStart(2, "0")}
                </span>
                <div className="min-w-0">
                  <h3 className="text-base font-semibold">{step.title}</h3>
                  <p className="mt-1 text-[15px] leading-[1.6] text-text-2">{step.body}</p>
                  {step.link ? (
                    <ArrowLink href={step.link.href} className="mt-1">
                      {step.link.label}
                    </ArrowLink>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        </div>
      </Section>

      <Section id="why" labelledBy="why-title">
        <SectionIntro eyebrow="Why HYDLNK" titleId="why-title" title={audience.fitTitle} />
        <ul className="mt-10 grid gap-3 min-[760px]:grid-cols-2">
          {audience.fits.map((fit) => (
            <li
              key={fit.title}
              className="flex gap-4 rounded-md border border-line bg-surface p-[18px]"
            >
              <IconTile>
                <AudienceIcon name={fit.icon} />
              </IconTile>
              <div className="min-w-0">
                <h3 className="text-base font-semibold">{fit.title}</h3>
                <p className="mt-1 text-[15px] leading-[1.6] text-text-2">{fit.body}</p>
              </div>
            </li>
          ))}
        </ul>
      </Section>

      <Section id="first-page" tone="page" labelledBy="first-page-title">
        <div className="grid gap-x-16 gap-y-8 min-[1080px]:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
          <SectionIntro
            eyebrow="What goes on it"
            titleId="first-page-title"
            title={audience.starterTitle}
            lead="Top to bottom, the way a visitor sees it. Reorder, swap or hide any of it later."
          />
          <ol className="grid min-w-0 gap-3">
            {audience.starter.map((item) => (
              <li key={`${item.block}-${item.title}`} className={`flex gap-4 ${CARD} p-[18px]`}>
                <IconTile>
                  <AudienceIcon name={item.block} />
                </IconTile>
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                    <Chip tone="neutral">{blockName(item.block)}</Chip>
                    <span className="text-base font-semibold">{item.title}</span>
                  </p>
                  <p className="mt-1.5 text-[15px] leading-[1.6] text-text-2">{item.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </Section>

      <Section id="try" labelledBy="try-title">
        <SectionIntro
          eyebrow="Try it"
          titleId="try-title"
          title={audience.tryTitle}
          lead="Change the look and the blocks on a sample page, right here, before you sign up."
        />
        <div className="mt-10">
          <TryBuilder preset={audience.preset} />
        </div>
      </Section>

      <Section id="faq" tone="page" labelledBy="faq-title">
        <div className="flex flex-wrap gap-[clamp(24px,6vw,64px)]">
          <div className="flex-[1_1_300px]">
            <h2 id="faq-title" className={H2}>
              Questions
            </h2>
            <p className="mt-4 text-[15px] leading-[1.6] text-text-2">
              Short answers for{" "}
              {audience.kind === "platform"
                ? `${audience.name} users`
                : audience.name.toLowerCase()}
              . Prices and plan limits are on the pricing page.
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              <ButtonLink href="/pricing" variant="secondary">
                See pricing
              </ButtonLink>
              <ButtonLink href="/faq" variant="secondary">
                All questions
              </ButtonLink>
            </div>
          </div>
          <div className="min-w-0 flex-[2_1_560px]">
            <FaqList items={audience.faq} openFirst />
          </div>
        </div>
      </Section>

      <Section id="more" labelledBy="more-title">
        <SectionIntro eyebrow="Keep going" titleId="more-title" title="More link in bio pages" />
        <ul className="mt-8 grid gap-3 min-[760px]:grid-cols-3">
          {related.map((item) => (
            <li key={item.slug}>
              <Link
                href={audienceHref(item.slug)}
                className="group flex h-full min-h-11 flex-col gap-2 rounded-md border border-line bg-surface p-[22px] hover:border-ink"
              >
                <span className="text-lg font-semibold tracking-[-0.01em] group-hover:underline group-hover:underline-offset-4">
                  {item.h1}
                </span>
                <span className="text-[15px] leading-[1.6] text-text-2">{item.blurb}</span>
              </Link>
            </li>
          ))}
        </ul>
        <div className="mt-6 flex flex-wrap gap-x-6">
          <ArrowLink href={audienceHref()}>All link in bio pages</ArrowLink>
          <ArrowLink href="/pricing">What each plan includes</ArrowLink>
          {guides.map((guide) => (
            <ArrowLink key={guide.slug} href={guideHref(guide.slug)}>
              {guide.title}
            </ArrowLink>
          ))}
        </div>
      </Section>

      <CtaBand title={claimTitle} />

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(faqPageJsonLd(audience.faq)) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLdScript(
            breadcrumbJsonLd(origin, [
              { name: "Link in bio", path: audienceHref() },
              { name: audience.name, path: audienceHref(audience.slug) },
            ]),
          ),
        }}
      />
    </MarketingShell>
  );
}

/** Every slug, for generateStaticParams. */
export function audienceSlugs(): { slug: string }[] {
  return AUDIENCES.map((audience) => ({ slug: audience.slug }));
}
