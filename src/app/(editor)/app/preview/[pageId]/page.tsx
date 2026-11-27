import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TenantFonts } from "@/components/design/tenant-fonts";
import { InteractivePageRenderer } from "@/components/previews/interactive-page";
import { DraftPreviewBar } from "@/components/previews/preview-bars";
import { PreviewFrame } from "@/components/previews/preview-frame";
import { requireUser } from "@/lib/auth/session";
import { publishedDocSchema, toPublishForm } from "@/lib/document";
import { loadEditorPageData } from "@/lib/editor/page-data";
import { loadDraft } from "@/lib/editor/load";
import { computePublishStatus } from "@/lib/editor/status";
import { siteAccessFor } from "@/lib/access/server";
import { pageChrome } from "@/lib/publish/chrome";
import {
  getHomeDraftWithClient,
  getPublishedHomeWithClient,
  mergeHomePublished,
} from "@/lib/site/page-entries";
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
 * Gated: signed out goes to /login before anything of the draft is read. Access is the one helper's
 * (Wave F: the owner or a member may read; C14), never the `hl-page` cookie, so another account's
 * page id (or a malformed one) answers the app's 404 with none of the page's text. The draft itself
 * is read with the signed-in user's own session under RLS. A suspended owner can still open it:
 * reads are never blocked. The badge and chrome follow the site OWNER's plan.
 */
export default async function DraftPreviewPage({ params }: PageProps<"/app/preview/[pageId]">) {
  const user = await requireUser();
  const { pageId } = await params;
  if (!PAGE_ID.test(pageId)) notFound();

  const allowed = await siteAccessFor({
    actorId: user.id,
    siteId: pageId.toLowerCase(),
    need: "read",
    source: "editor",
  });
  if (!allowed.ok) {
    if (allowed.reason === "error") throw new Error("Loading the page's access for a preview failed");
    notFound();
  }
  const supabase = await createServerSupabase();
  const owned = await supabase.from("pages").select("id, handle").eq("id", allowed.access.siteId).maybeSingle();
  if (owned.error) throw new Error(`Loading the page for a preview failed: ${owned.error.message}`);
  if (!owned.data) notFound();

  const data = await loadEditorPageData(owned.data);

  // Home's blocks are its page entry's (the copies in pages.draft and pages.published are frozen),
  // read with the same signed-in session under RLS.
  const [homeDraft, homePublished] = await Promise.all([
    getHomeDraftWithClient(supabase as never, owned.data.id),
    getPublishedHomeWithClient(supabase as never, owned.data.id),
  ]);
  // A site with no Home entry has not been moved: pages.draft is the whole document.
  const draft = loadDraft(
    homeDraft ? { ...data.draft, blocks: homeDraft.draft.blocks } : data.draft,
    owned.data.handle,
  ).draft;
  const merged = data.published === null ? null : mergeHomePublished(data.published, homePublished);
  const published = merged === null ? null : publishedDocSchema.safeParse(merged);

  const doc = toPublishForm(draft, data.themeTokens);
  const status = computePublishStatus({
    hasPublished: data.hasPublished,
    published: published?.success ? published.data : null,
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
          chrome={pageChrome(allowed.access.plan, owned.data.id)}
        />
      </PreviewFrame>
    </>
  );
}
