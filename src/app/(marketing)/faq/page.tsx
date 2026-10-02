import type { Metadata } from "next";
import { CtaBand } from "@/components/marketing/cta-band";
import { FaqList } from "@/components/marketing/faq";
import { FAQ_GROUPS } from "@/components/marketing/faq-data";
import { marketingMetadata } from "@/components/marketing/metadata";
import { PageHero } from "@/components/marketing/page-hero";
import { Container, H2 } from "@/components/marketing/primitives";
import { MarketingShell } from "@/components/marketing/shell";
import { SUPPORT_EMAIL } from "@/components/marketing/site-map";

export const metadata: Metadata = marketingMetadata({
  path: "/faq",
  title: "FAQ",
  description:
    "Short answers about HYDLNK: the free plan, handles, design tokens, custom domains, cookieless analytics, billing, safety and your account.",
  image: "faq",
});

/** schema.org FAQPage, built from the same answers the page shows. */
function faqJsonLd(): string {
  const data = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQ_GROUPS.flatMap((group) => group.items).map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: { "@type": "Answer", text: item.answer },
    })),
  };
  // Escape "<" so the JSON can never close the script element.
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

export default function FaqPage() {
  return (
    <MarketingShell current="faq">
      <PageHero
        eyebrow="FAQ"
        title="Questions, answered."
        lead="Short answers about HYDLNK. For step-by-step help, the guides go further."
        secondary={{ href: "/learn", label: "Browse the guides" }}
      >
        <nav aria-label="Topics" className="mt-8">
          <ul className="flex flex-wrap gap-1.5">
            {FAQ_GROUPS.map((group) => (
              <li key={group.id}>
                <a
                  href={`#${group.id}`}
                  className="inline-flex min-h-11 items-center rounded-sm border border-line-3 px-3 text-sm hover:border-ink"
                >
                  {group.title}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </PageHero>

      {FAQ_GROUPS.map((group, index) => (
        <section
          key={group.id}
          id={group.id}
          aria-labelledby={`${group.id}-title`}
          className={`scroll-mt-4 border-b border-line py-[clamp(40px,8vw,72px)] ${index % 2 === 0 ? "bg-page" : "bg-surface"}`}
        >
          <Container className="flex flex-wrap gap-[clamp(24px,6vw,64px)]">
            <div className="flex-[1_1_300px]">
              <h2 id={`${group.id}-title`} className={H2}>
                {group.title}
              </h2>
            </div>
            <div className="min-w-0 flex-[2_1_560px]">
              <FaqList items={group.items} openFirst={index === 0} />
            </div>
          </Container>
        </section>
      ))}

      <section aria-labelledby="contact-title" className="border-b border-line bg-surface py-12">
        <Container>
          <h2 id="contact-title" className="text-lg font-semibold">
            Didn’t find your question?
          </h2>
          <p className="mt-2 text-[15px] leading-[1.6] text-text-2">
            Email{" "}
            <a
              href={`mailto:${SUPPORT_EMAIL}`}
              className="font-mono text-ink underline decoration-line-3 underline-offset-4"
            >
              {SUPPORT_EMAIL}
            </a>{" "}
            and we’ll get back to you.
          </p>
        </Container>
      </section>

      <CtaBand />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: faqJsonLd() }} />
    </MarketingShell>
  );
}
