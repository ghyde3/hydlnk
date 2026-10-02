import type { Metadata } from "next";
import Link from "next/link";
import { Container, Eyebrow, H1, LEAD } from "@/components/marketing/primitives";
import { ReportForm } from "@/components/marketing/report-form";
import { MarketingShell } from "@/components/marketing/shell";
import { handleAddress } from "@/lib/reports/address";
import { REPORT_MESSAGES } from "@/lib/reports/constants";
import { findReportPageById } from "@/lib/reports/server";

export const metadata: Metadata = {
  title: "Report a page",
  description: "Tell HYDLNK about a page that is phishing, spreading malware, impersonating someone or breaking the law.",
  alternates: { canonical: "/report" },
  // A tool, not content: it stays out of search results.
  robots: { index: false, follow: true },
};

// The page's address comes from the database for the id in the link: never cached.
export const dynamic = "force-dynamic";

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/**
 * /report (M5-05). With `?page={pageId}` (the "Report this page" link in every public page's
 * footer) the form names the page by its address, read here on the server: the handle and nothing
 * else about the page. Without it, or when the id names no published page, the form asks for the
 * address.
 */
export default async function ReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const requested = first(params.page)?.trim();
  const found = requested ? await findReportPageById(requested.toLowerCase()).catch(() => null) : null;
  const unknownLink = Boolean(requested) && !found;

  return (
    <MarketingShell>
      <article aria-labelledby="page-title">
        <header className="border-b border-line bg-surface pt-[clamp(32px,7vw,64px)] pb-[clamp(28px,6vw,48px)]">
          <Container>
            <Eyebrow>Safety</Eyebrow>
            <h1 id="page-title" className={`mt-3 ${H1}`}>
              Report a page
            </h1>
            <p className={`mt-4 max-w-[60ch] ${LEAD}`}>
              Seen a HYDLNK page that is phishing, spreading malware, impersonating someone or
              breaking the law? Tell us and we’ll look at it. We only need the page and what’s wrong.
            </p>
          </Container>
        </header>
        <div className="bg-surface py-[clamp(32px,7vw,56px)]">
          <Container>
            <div className="max-w-[560px]">
              <ReportForm
                page={found ? { id: found.id, address: handleAddress(found.handle) } : null}
                initialAddressError={unknownLink ? REPORT_MESSAGES.notFound : null}
              />
              <p className="mt-6 text-sm leading-[1.6] text-text-2">
                Want to know what happens next? Read{" "}
                <Link href="/terms#reports" className="text-ink underline underline-offset-4">
                  how reports and enforcement work
                </Link>
                .
              </p>
            </div>
          </Container>
        </div>
      </article>
    </MarketingShell>
  );
}
