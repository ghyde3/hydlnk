import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TenantPage } from "@/components/tenant/tenant-page";
import { clientEnv } from "@/lib/env/client";
import { rootOrigin } from "@/lib/routing/urls";
import { getPublishedPageByHandle } from "../../published-page";

// Reads Postgres on every request until Milestone 2 adds tag-based caching. Without this Next.js
// would render the first request statically and keep serving it after the page is republished.
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps<"/t/[handle]">): Promise<Metadata> {
  const { handle } = await params;
  const page = await getPublishedPageByHandle(handle);
  if (!page) return { title: "Page not found", robots: { index: false } };

  const { profile } = page.document;
  return {
    title: profile.displayName,
    description: profile.bio || undefined,
  };
}

export default async function TenantRoute({ params }: PageProps<"/t/[handle]">) {
  const { handle } = await params;
  const page = await getPublishedPageByHandle(handle);
  if (!page) notFound();

  return (
    <TenantPage
      document={page.document}
      handle={handle}
      rootOrigin={rootOrigin(clientEnv.NEXT_PUBLIC_ROOT_DOMAIN)}
    />
  );
}
