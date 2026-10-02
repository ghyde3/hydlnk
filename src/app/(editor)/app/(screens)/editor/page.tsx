import type { Metadata } from "next";
import { EditorScreen } from "@/components/editor/editor-screen";
import { clientEnv } from "@/lib/env/client";
import { loadEditorPageData } from "@/lib/editor/page-data";
import { tenantOrigin } from "@/lib/editor/urls";
import { getAppContext } from "@/lib/pages/context";
import { handleAddress } from "@/lib/pages/plans";
import { pageChrome } from "@/lib/publish/chrome";

export const metadata: Metadata = { title: "Editor" };

/**
 * The editor (M2-03): the current page's draft, read with the signed-in user's own session under
 * RLS, handed to the client screen. The page is the one the gate picked (the `hl-page` cookie when
 * it names one of the user's own pages, else the oldest), so another user's page id in the cookie
 * never reaches this query. This module imports no secret-key client.
 */
export default async function EditorPage() {
  const { user, current, plan } = await getAppContext();
  const data = await loadEditorPageData(current, user.id);
  return (
    <EditorScreen
      key={current.id}
      pageId={current.id}
      address={handleAddress(current.handle)}
      liveUrl={tenantOrigin(current.handle, clientEnv.NEXT_PUBLIC_ROOT_DOMAIN)}
      draft={data.draft}
      revKey={data.revKey}
      repaired={data.repaired}
      themeTokens={data.themeTokens}
      hasPublished={data.hasPublished}
      published={data.published}
      chrome={pageChrome(plan, current.id)}
    />
  );
}
