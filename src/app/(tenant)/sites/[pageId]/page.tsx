import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TenantFonts } from "@/components/design/tenant-fonts";
import { TenantPage } from "@/components/tenant/tenant-page";
import { getPrimaryDomain } from "@/lib/domains/primary";
import { customOgImageUrl } from "@/lib/domains/urls";
import { clientEnv } from "@/lib/env/client";
import { customOrigin } from "@/lib/routing/urls";
import { getTenantPageStateById } from "../../published-page";

/*
 * A verified custom domain's page (M4-09). The proxy rewrites a custom host here as
 * /sites/<pageId> after looking the host up in `domains` (verified, page published); this route is
 * never reachable by typing the path on any host (the proxy answers 404), and it validates the id
 * itself as well. It renders exactly what /t/[handle] renders, from the same cached public read
 * under the same per-page tag, so a publish changes both at once. Static like the handle page: no
 * request API is read, so og:url names the page's primary domain (the oldest verified one,
 * `getPrimaryDomain`), which is also what a search engine should treat as canonical.
 */
export const dynamicParams = true;

export function generateStaticParams() {
  return [];
}

export async function generateMetadata({ params }: PageProps<"/sites/[pageId]">): Promise<Metadata> {
  const { pageId } = await params;
  const state = await getTenantPageStateById(pageId);
  if (state.kind !== "published") return { title: "Page not found", robots: { index: false } };

  const { profile } = state.page.document;
  const description = profile.bio || undefined;
  const base: Metadata = { title: `${profile.name} - links`, description };

  const hostname = await getPrimaryDomain(pageId);
  if (!hostname) return base;
  const rootDomain = clientEnv.NEXT_PUBLIC_ROOT_DOMAIN;
  const image = customOgImageUrl(hostname, state.page.publishedAt, rootDomain);
  return {
    ...base,
    openGraph: {
      type: "website",
      title: profile.name,
      description,
      url: `${customOrigin(hostname, rootDomain)}/`,
      images: [{ url: image, width: 1200, height: 630, alt: profile.name }],
    },
    twitter: { card: "summary_large_image", title: profile.name, description, images: [image] },
  };
}

export default async function SitePage({ params }: PageProps<"/sites/[pageId]">) {
  const { pageId } = await params;
  const state = await getTenantPageStateById(pageId);
  // Unknown id, a draft-only page and a suspended owner are all the plain 404.
  if (state.kind !== "published") notFound();

  const { page } = state;
  return (
    <>
      <TenantFonts tokens={page.document.tokens} />
      <TenantPage document={page.document} pageId={page.pageId} plan={page.plan} />
    </>
  );
}
