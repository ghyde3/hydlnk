import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TenantPage } from "@/components/tenant/tenant-page";
import { UnpublishedPlaceholder } from "@/components/tenant/unpublished-placeholder";
import { clientEnv } from "@/lib/env/client";
import { HANDLE_DISPLAY_DOMAIN } from "@/lib/handles/rules";
import { rootOrigin } from "@/lib/routing/urls";
import { getTenantPageState } from "../../published-page";

// Reads Postgres on every request until Milestone 2 adds tag-based caching. Without this Next.js
// would render the first request statically and keep serving it after the page is republished,
// or after a handle is claimed.
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps<"/t/[handle]">): Promise<Metadata> {
  const { handle } = await params;
  const state = await getTenantPageState(handle);

  if (state.kind === "published") {
    const { profile } = state.page.document;
    return { title: profile.displayName, description: profile.bio || undefined };
  }
  if (state.kind === "unpublished") {
    return { title: `${handle}.${HANDLE_DISPLAY_DOMAIN}`, robots: { index: false } };
  }
  return { title: "Page not found", robots: { index: false } };
}

export default async function TenantRoute({ params }: PageProps<"/t/[handle]">) {
  const { handle } = await params;
  const state = await getTenantPageState(handle);

  if (state.kind === "missing") notFound();
  if (state.kind === "unpublished") return <UnpublishedPlaceholder handle={handle} />;

  return (
    <TenantPage
      document={state.page.document}
      handle={handle}
      rootOrigin={rootOrigin(clientEnv.NEXT_PUBLIC_ROOT_DOMAIN)}
    />
  );
}
