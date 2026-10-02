import type { Metadata } from "next";
import Link from "next/link";
import { CtaBand } from "@/components/marketing/cta-band";
import { marketingMetadata } from "@/components/marketing/metadata";
import { PageHero } from "@/components/marketing/page-hero";
import { ArrowLink, Section } from "@/components/marketing/primitives";
import { MarketingShell } from "@/components/marketing/shell";
import { GUIDES, SUPPORT_EMAIL, guideHref } from "@/components/marketing/site-map";

export const metadata: Metadata = marketingMetadata({
  path: "/learn",
  title: "Learn",
  description:
    "Six short guides: getting started, choosing a handle, designing your page, connecting a domain, understanding analytics, and plans and billing.",
  image: "learn",
});

export default function LearnPage() {
  return (
    <MarketingShell current="learn">
      <PageHero
        eyebrow="Learn"
        title="Everything you need to know, in six short guides."
        lead="From picking a handle to pointing your own domain at your page. Read them before you sign up, or come back when you need them."
        secondary={{ href: "/faq", label: "Read the FAQ" }}
      />

      <Section id="guides" tone="page" labelledBy="guides-title">
        <h2 id="guides-title" className="sr-only">
          Guides
        </h2>
        <ol className="grid gap-3 min-[760px]:grid-cols-2 min-[1080px]:grid-cols-3">
          {GUIDES.map((guide, index) => (
            <li key={guide.slug}>
              <Link
                href={guideHref(guide.slug)}
                className="group flex h-full flex-col gap-3 rounded-md border border-line bg-surface p-[22px] hover:border-ink"
              >
                <span className="flex items-center justify-between font-mono text-xs text-text-2">
                  <span className="text-brass-text">{String(index + 1).padStart(2, "0")}</span>
                  <span>{guide.minutes} min read</span>
                </span>
                <span className="text-lg font-semibold tracking-[-0.01em] group-hover:underline group-hover:underline-offset-4">
                  {guide.title}
                </span>
                <span className="text-[15px] leading-[1.6] text-text-2">{guide.summary}</span>
                <span className="mt-auto inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold">
                  Read the guide <span aria-hidden="true">→</span>
                </span>
              </Link>
            </li>
          ))}
        </ol>
      </Section>

      <Section id="help" labelledBy="help-title">
        <div className="grid gap-3 min-[760px]:grid-cols-2">
          <div className="rounded-md border border-line bg-surface p-[22px]">
            <h2 id="help-title" className="text-lg font-semibold">
              Short answers
            </h2>
            <p className="mt-2 text-[15px] leading-[1.6] text-text-2">
              Pricing, privacy, domains, safety: the questions people ask most, answered in a
              sentence or two.
            </p>
            <ArrowLink href="/faq" className="mt-2">
              All questions
            </ArrowLink>
          </div>
          <div className="rounded-md border border-line bg-surface p-[22px]">
            <h2 className="text-lg font-semibold">Still stuck?</h2>
            <p className="mt-2 text-[15px] leading-[1.6] text-text-2">
              Email us and a person will reply. Include your handle and, for domains, a screenshot
              of your DNS records.
            </p>
            <a
              href={`mailto:${SUPPORT_EMAIL}`}
              className="mt-2 inline-flex min-h-11 items-center font-mono text-sm text-ink underline decoration-line-3 underline-offset-4"
            >
              {SUPPORT_EMAIL}
            </a>
          </div>
        </div>
      </Section>

      <CtaBand />
    </MarketingShell>
  );
}
