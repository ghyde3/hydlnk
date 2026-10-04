import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TenantFonts } from "@/components/design/tenant-fonts";
import { InteractivePageRenderer } from "@/components/previews/interactive-page";
import { DraftPreviewBar } from "@/components/previews/preview-bars";
import { PreviewFrame } from "@/components/previews/preview-frame";
import { requireUser } from "@/lib/auth/session";
import { toPublishForm } from "@/lib/document";
import { loadEditorPageData } from "@/lib/editor/page-data";
import { computePublishStatus } from "@/lib/editor/status";
import { toPlan } from "@/lib/pages/plans";
import { pageChrome } from "@/lib/publish/chrome";
import { createServerSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Draft preview",
  robots: { index: false, follow: false },
};

const PAGE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The owner's draft preview (M6-11): /preview/{pageId} on the app host, the page behind the editor's
 * "Preview" button. The saved draft, drawn by the same renderer as the live page in `mode="preview"`
 * at full width, under a slim bar with the publish status and a link back to the editor.
 *
 * Gated and owner-only: signed out goes to /login before anything of the draft is read. The page is
 * read with the signed-in user's own session under RLS, and ownership is checked from
 * `pages.owner_id`, never from the `hl-page` cookie, so another account's page id (or a malformed
 * one) answers the app's 404 with none of the page's text. This module imports no secret-key client.
 * A suspended owner can still open it: reads are never blocked.
 */
export default async function DraftPreviewPage({ params }: PageProps<"/app/preview/[pageId]">) {
  const user = await requireUser();
  const { pageId } = await params;
  if (!PAGE_ID.test(pageId)) notFound();

  const supabase = await createServerSupabase();
  const owned = await supabase
    .from("pages")
    .select("id, handle")
    .eq("id", pageId)
    .eq("owner_id", user.id)
    .maybeSingle();
  if (owned.error) throw new Error(`Loading the page for a preview failed: ${owned.error.message}`);
  if (!owned.data) notFound();

  const [data, account] = await Promise.all([
    loadEditorPageData(owned.data, user.id),
    supabase.from("accounts").select("plan").eq("id", user.id).maybeSingle(),
  ]);
  if (account.error) throw new Error(`Loading the account failed: ${account.error.message}`);

  const doc = toPublishForm(data.draft, data.themeTokens);
  const status = computePublishStatus({
    hasPublished: data.hasPublished,
    published: data.published,
    form: doc,
  });

  return (
    <>
      <TenantFonts tokens={doc.tokens} nameFont={doc.profile.nameFont} />
      <DraftPreviewBar status={status} />
      <PreviewFrame>
        <InteractivePageRenderer
          doc={doc}
          pageId={owned.data.id}
          mode="preview"
          chrome={pageChrome(toPlan(account.data?.plan), owned.data.id)}
        />
      </PreviewFrame>
    </>
  );
}
