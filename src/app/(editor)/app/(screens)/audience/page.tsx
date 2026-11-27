import type { Metadata } from "next";
import { AudienceScreen } from "@/components/audience/audience-screen";
import { loadAudience, type AudienceData } from "@/lib/forms/audience";
import { parseFormFilter, parsePageNumber, AUDIENCE_ALL_FORMS } from "@/lib/forms/contract";
import { notFound } from "next/navigation";
import { getAppContext } from "@/lib/pages/context";

export const metadata: Metadata = { title: "Audience" };

/**
 * Audience (M17-08): the submissions of the current site's forms. The site is the signed-in user's
 * current one (`getAppContext`; the `hl-page` cookie names a preference among their own pages, never
 * another account's) and every read goes through their own session under RLS, so `?form=` and
 * `?page=` only narrow what is theirs. A load failure draws the failure card, never another site.
 */
export default async function AudiencePage({ searchParams }: PageProps<"/app/audience">) {
  const { user, current, plan } = await getAppContext();
  // Owner-only (Wave F, G3): a member never reads the site's submissions.
  if (!current.access.isOwner) notFound();
  const params = await searchParams;
  const form = parseFormFilter(params.form) ?? AUDIENCE_ALL_FORMS;
  const page = parsePageNumber(params.page);
  let data: AudienceData | null = null;
  try {
    data = await loadAudience({ userId: user.id, plan, siteId: current.id, form, page });
  } catch (error) {
    console.error(
      "[audience] loading the screen failed:",
      error instanceof Error ? error.message : "",
    );
  }
  return (
    <AudienceScreen key={current.id} siteName={current.name} plan={plan} form={form} data={data} />
  );
}
