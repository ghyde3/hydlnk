import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  AudiencePage,
  audienceMetadata,
  audienceSlugs,
} from "@/components/marketing/audiences/audience-page";
import { audienceBySlug } from "@/components/marketing/audiences/data";

/** Every page is known at build time; any other slug is a 404. */
export const dynamicParams = false;

export function generateStaticParams() {
  return audienceSlugs();
}

export async function generateMetadata({
  params,
}: PageProps<"/link-in-bio/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const audience = audienceBySlug(slug);
  return audience ? audienceMetadata(audience) : {};
}

export default async function LinkInBioAudiencePage({ params }: PageProps<"/link-in-bio/[slug]">) {
  const { slug } = await params;
  const audience = audienceBySlug(slug);
  if (!audience) notFound();
  return <AudiencePage audience={audience} />;
}
