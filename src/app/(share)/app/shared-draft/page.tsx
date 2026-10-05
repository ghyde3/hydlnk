import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { cache } from "react";
import { TenantFonts } from "@/components/design/tenant-fonts";
import { PageRenderer } from "@/components/page/page-renderer";
import { ShareBar } from "@/components/previews/preview-bars";
import { PreviewFrame } from "@/components/previews/preview-frame";
import { formatLinkDate } from "@/lib/previews/dates";
import { SHARE_PATH_HEADER, SHARE_TOKEN_HEADER } from "@/lib/previews/share-headers";
import { loadSharedPreview } from "@/lib/previews/shared";
import { showBadge } from "@/lib/publish/chrome";
import { createAdminSupabase } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * The shared preview (M6-10): GET /share/{token} on the app host. The proxy rewrites every
 * /share/* request here and hands the first path segment over in a request header, and what follows it
 * (a page of the site, `/share/{token}/{path}`, M12-06) in a second (see src/lib/previews/share-proxy.ts); it also rate limits, sets the response headers (never stored,
 * noindex, no Referer, the tenant CSP) and never reads or refreshes a session, so this page needs
 * none: it sits outside the signed-in screens, with no gate, sidebar or tab bar.
 *
 * The link finds its page by the SHA-256 of the token and draws that page's saved draft, as it is at
 * this moment, with the same renderer as the live page in `mode="preview"`: no view beacon, no click
 * tracking, no way out (the frame stops links), embeds stay inert. This is the one ungated route that
 * reads a draft, and it does so with the secret key under the rules of src/lib/previews/shared.ts.
 * Anything that is not an active link ends in `notFound()`: one 404 with one body.
 */

const load = cache(async (token: string, path: string) =>
  loadSharedPreview(createAdminSupabase(), token, new Date(), path),
);

async function currentToken(): Promise<string> {
  return (await headers()).get(SHARE_TOKEN_HEADER) ?? "";
}

async function currentPath(): Promise<string> {
  return (await headers()).get(SHARE_PATH_HEADER) ?? "";
}

export async function generateMetadata(): Promise<Metadata> {
  const shared = await load(await currentToken(), await currentPath());
  // No Open Graph and no Twitter tags: nothing about a draft is for a link preview in a chat app.
  const robots = { index: false, follow: false };
  if (shared.kind === "inactive") {
    return { title: { absolute: "Preview link not active" }, robots };
  }
  return {
    title: {
      absolute: shared.subPage
        ? `Preview of ${shared.subPage.title}`
        : `Preview of ${shared.doc.profile.name}`,
    },
    robots,
  };
}

export default async function SharedPreviewPage() {
  const shared = await load(await currentToken(), await currentPath());
  if (shared.kind === "inactive") notFound();

  return (
    <>
      <TenantFonts tokens={shared.doc.tokens} nameFont={shared.doc.profile.nameFont} />
      <ShareBar expires={formatLinkDate(shared.expiresAt)} />
      <PreviewFrame>
        <PageRenderer
          doc={shared.doc}
          pageId={shared.pageId}
          mode="preview"
          inertEmbeds
          {...(shared.site ? { site: shared.site } : {})}
          {...(shared.subPage ? { subPage: shared.subPage } : {})}
          chrome={{ badge: showBadge(shared.plan), reportHref: null }}
        />
      </PreviewFrame>
    </>
  );
}
