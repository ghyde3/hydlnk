import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ComparePage, compareMetadata } from "@/components/marketing/compare/compare-page";
import { COMPETITORS, competitorBySlug } from "@/components/marketing/compare/data";

/** Every competitor is known at build time; any other slug is a 404. */
export const dynamicParams = false;

export function generateStaticParams() {
  return COMPETITORS.map((competitor) => ({ competitor: competitor.slug }));
}

export async function generateMetadata({
  params,
}: PageProps<"/vs/[competitor]">): Promise<Metadata> {
  const { competitor: slug } = await params;
  const competitor = competitorBySlug(slug);
  return competitor ? compareMetadata(competitor) : {};
}

export default async function VsPage({ params }: PageProps<"/vs/[competitor]">) {
  const { competitor: slug } = await params;
  const competitor = competitorBySlug(slug);
  if (!competitor) notFound();
  return <ComparePage competitor={competitor} />;
}
