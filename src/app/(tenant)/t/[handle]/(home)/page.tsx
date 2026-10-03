import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TenantFonts } from "@/components/design/tenant-fonts";
import { TenantPage } from "@/components/tenant/tenant-page";
import { UnpublishedPlaceholder } from "@/components/tenant/unpublished-placeholder";
import { HANDLE_DISPLAY_DOMAIN } from "@/lib/handles/rules";
import { ogImageUrl, tenantOrigin } from "@/lib/publish/urls";
import { getTenantPageState } from "../../../published-page";

/*
 * Static and cached (M2-22, M2-26): no request API is read here (no cookies, no headers), so the
 * page is generated on the first request for a handle and served from the cache after that, until
 * Publish expires its tag (src/lib/publish/tags.ts). `generateStaticParams` returns nothing to
 * prebuild: every handle is generated on demand, and `dynamicParams` (the default) allows that.
 * A handle with nothing to show ends in notFound(), whose tenant 404 reads the Host header and so
 * is rendered per request and never stored; claiming the handle shows the placeholder at once.
 */
export const dynamicParams = true;

export function generateStaticParams() {
  return [];
}

export async function generateMetadata({ params }: PageProps<"/t/[handle]">): Promise<Metadata> {
  const { handle } = await params;
  const state = await getTenantPageState(handle);

  if (state.kind === "published") {
    const { profile } = state.page.document;
    const description = profile.bio || undefined;
    const image = ogImageUrl(handle, state.page.publishedAt);
    return {
      title: `${profile.name} - links`,
      description,
      openGraph: {
        type: "website",
        title: profile.name,
        description,
        url: `${tenantOrigin(handle)}/`,
        images: [{ url: image, width: 1200, height: 630, alt: profile.name }],
      },
      twitter: { card: "summary_large_image", title: profile.name, description, images: [image] },
    };
  }
  if (state.kind === "unpublished") {
    return { title: `${handle}.${HANDLE_DISPLAY_DOMAIN}`, robots: { index: false } };
  }
  if (state.kind === "suspended") {
    // Nothing of the page: no name, no bio, no OG tags (M5-08).
    return { title: "Page not available", robots: { index: false } };
  }
  return { title: "Page not found", robots: { index: false } };
}

export default async function TenantRoute({ params }: PageProps<"/t/[handle]">) {
  const { handle } = await params;
  const state = await getTenantPageState(handle);

  if (state.kind === "missing" || state.kind === "suspended") notFound();
  if (state.kind === "unpublished") return <UnpublishedPlaceholder handle={handle} />;

  const { page } = state;
  return (
    <>
      <TenantFonts tokens={page.document.tokens} />
      <TenantPage document={page.document} pageId={page.pageId} plan={page.plan} />
    </>
  );
}
