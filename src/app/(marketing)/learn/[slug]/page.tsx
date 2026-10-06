import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CtaBand } from "@/components/marketing/cta-band";
import { GUIDE_BODIES } from "@/components/marketing/guides";
import { marketingMetadata } from "@/components/marketing/metadata";
import { Container, Eyebrow, H1, LEAD } from "@/components/marketing/primitives";
import { MarketingShell } from "@/components/marketing/shell";
import { GUIDES, guideHref } from "@/components/marketing/site-map";

/** Every guide is known at build time; any other slug is a 404. */
export const dynamicParams = false;

export function generateStaticParams() {
  return GUIDES.map((guide) => ({ slug: guide.slug }));
}

export async function generateMetadata({ params }: PageProps<"/learn/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const guide = GUIDES.find((item) => item.slug === slug);
  if (!guide) return {};
  return marketingMetadata({
    path: guideHref(guide.slug),
    title: `${guide.title} · Learn`,
    description: guide.summary,
    image: "learn",
  });
}

export default async function GuidePage({ params }: PageProps<"/learn/[slug]">) {
  const { slug } = await params;
  const index = GUIDES.findIndex((item) => item.slug === slug);
  const guide = GUIDES[index];
  const body = GUIDE_BODIES[slug];
  if (!guide || !body) notFound();
  const previous = GUIDES[index - 1];
  const next = GUIDES[index + 1];

  return (
    <MarketingShell current="learn">
      <article aria-labelledby="page-title">
        <header className="border-b border-line bg-surface pt-[clamp(32px,7vw,64px)] pb-[clamp(36px,7vw,64px)]">
          <Container>
            <nav aria-label="Breadcrumb" className="font-mono text-xs tracking-[0.06em] uppercase">
              <ol className="flex flex-wrap items-center gap-x-2 text-text-2">
                <li>
                  <Link href="/learn" className="inline-flex min-h-11 min-w-11 items-center underline-offset-4 hover:underline">
                    Learn
                  </Link>
                </li>
                <li aria-hidden="true">/</li>
                <li aria-current="page" className="text-ink">
                  {guide.title}
                </li>
              </ol>
            </nav>
            <h1 id="page-title" className={`mt-3 max-w-[880px] ${H1}`}>
              {guide.title}
            </h1>
            <p className={`mt-5 max-w-[680px] ${LEAD}`}>{guide.summary}</p>
            <Eyebrow className="mt-5">
              Guide {index + 1} of {GUIDES.length} · {guide.minutes} min read
            </Eyebrow>
          </Container>
        </header>

        <div className="border-b border-line bg-surface py-[clamp(40px,8vw,72px)]">
          <Container className="grid gap-10 min-[1080px]:grid-cols-[240px_minmax(0,1fr)] min-[1080px]:gap-16">
            <nav aria-label="On this page" className="min-[1080px]:sticky min-[1080px]:top-6 min-[1080px]:self-start">
              <p className="font-mono text-[11px] tracking-[0.08em] text-text-2 uppercase">On this page</p>
              <ol className="mt-2 border-l border-line">
                {body.toc.map(([id, title]) => (
                  <li key={id}>
                    <a
                      href={`#${id}`}
                      className="flex min-h-11 items-center border-l-2 border-transparent py-1 pl-3 -ml-px text-sm text-text-2 hover:border-ink hover:text-ink"
                    >
                      {title}
                    </a>
                  </li>
                ))}
              </ol>
            </nav>
            <div className="prose-hl min-w-0">{body.content}</div>
          </Container>
        </div>

        <nav aria-label="More guides" className="border-b border-line bg-page py-8">
          <Container className="grid gap-3 min-[760px]:grid-cols-2">
            {previous ? (
              <Link
                href={guideHref(previous.slug)}
                className="flex min-h-11 flex-col gap-1 rounded-md border border-line bg-surface p-[18px] hover:border-ink"
              >
                <span className="font-mono text-xs text-text-2">← Previous</span>
                <span className="font-semibold">{previous.title}</span>
              </Link>
            ) : (
              <Link
                href="/learn"
                className="flex min-h-11 flex-col gap-1 rounded-md border border-line bg-surface p-[18px] hover:border-ink"
              >
                <span className="font-mono text-xs text-text-2">← All guides</span>
                <span className="font-semibold">Learn</span>
              </Link>
            )}
            {next ? (
              <Link
                href={guideHref(next.slug)}
                className="flex min-h-11 flex-col items-end gap-1 rounded-md border border-line bg-surface p-[18px] text-right hover:border-ink"
              >
                <span className="font-mono text-xs text-text-2">Next →</span>
                <span className="font-semibold">{next.title}</span>
              </Link>
            ) : (
              <Link
                href="/faq"
                className="flex min-h-11 flex-col items-end gap-1 rounded-md border border-line bg-surface p-[18px] text-right hover:border-ink"
              >
                <span className="font-mono text-xs text-text-2">Next →</span>
                <span className="font-semibold">Questions and answers</span>
              </Link>
            )}
          </Container>
        </nav>
      </article>

      <CtaBand />
    </MarketingShell>
  );
}
