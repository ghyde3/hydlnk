import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TenantFonts } from "@/components/design/tenant-fonts";
import { AdminDraftBar } from "@/components/admin/draft-bar";
import { PageRenderer } from "@/components/page/page-renderer";
import { PreviewFrame } from "@/components/previews/preview-frame";
import { logDraftView } from "@/lib/admin/account-queries";
import { requireAdmin } from "@/lib/admin/auth";
import { loadAdminDraftView } from "@/lib/admin/draft-view";
import { showBadge } from "@/lib/publish/chrome";
import { createAdminSupabase } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: { absolute: "Draft view" },
  robots: { index: false, follow: false },
};

/**
 * An admin's read-only view of a site's draft (M13-11): /admin-draft/{pageId} for Home and
 * /admin-draft/{pageId}/{path} for one of its pages, on the app host, for support requests and
 * reports. The proxy gives it the share preview's response headers (nonce CSP, `private, no-store`,
 * noindex, no Referer; src/lib/previews/admin-draft-proxy.ts) and the draft is loaded and drawn the
 * way a share link's is: the same loader, the same renderer in `mode="preview"` (no beacon, no click
 * tracking), links stopped by the preview frame, embeds inert.
 *
 * `requireAdmin` first: signed out goes to /login and a signed-in non-admin gets the app's 404 before
 * anything of the draft is read. Every opening appends one `view_draft` row to `admin_audit` (admin,
 * owner, page and path) before the draft is shown: if the row cannot be written the page fails and
 * shows nothing. Nothing here writes to the draft. The metadata is static so that only this render
 * logs.
 */
export default async function AdminDraftPage({
  params,
}: PageProps<"/app/admin-draft/[pageId]/[[...path]]">) {
  const admin = await requireAdmin();
  const { pageId, path: segments } = await params;
  // Home has no segments; a page of the site has exactly one. Anything deeper is not a page.
  if (segments && segments.length > 1) notFound();
  const path = segments?.[0] ?? "";

  const db = createAdminSupabase();
  const view = await loadAdminDraftView(db, pageId, path);
  if (view.kind === "missing") notFound();

  await logDraftView(db, { adminId: admin.id, accountId: view.ownerId, pageId: view.pageId, path });

  const { preview } = view;
  return (
    <>
      <TenantFonts tokens={preview.doc.tokens} nameFont={preview.doc.profile.nameFont} />
      <AdminDraftBar
        handle={view.handle}
        accountId={view.ownerId}
        pageId={view.pageId}
        current={path}
        pages={view.pages}
      />
      <PreviewFrame>
        <PageRenderer
          doc={preview.doc}
          pageId={preview.pageId}
          mode="preview"
          inertEmbeds
          {...(preview.site ? { site: preview.site } : {})}
          {...(preview.subPage ? { subPage: preview.subPage } : {})}
          chrome={{ badge: showBadge(preview.plan), reportHref: null }}
        />
      </PreviewFrame>
    </>
  );
}
