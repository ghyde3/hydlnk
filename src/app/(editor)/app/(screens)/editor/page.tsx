import type { Metadata } from "next";
import { EditorScreen } from "@/components/editor/editor-screen";
import { LoadFailure } from "@/components/editor/load-failure";
import { clientEnv } from "@/lib/env/client";
import { loadPrimaryDomain } from "@/lib/editor/page-address";
import { loadEditorPageData } from "@/lib/editor/page-data";
import { tenantOrigin } from "@/lib/editor/urls";
import { getAppContext } from "@/lib/pages/context";
import { handleAddress } from "@/lib/pages/plans";
import { pageChrome } from "@/lib/publish/chrome";
import { publicPageAddress } from "@/lib/qr/address";
import { loadTemplateThemes } from "@/lib/templates/load";
import { failIfInjected } from "@/lib/testing/faults";

export const metadata: Metadata = { title: "Editor" };

/**
 * The editor (M2-03): the current page's draft, read with the signed-in user's own session under
 * RLS, handed to the client screen. The page is the one the gate picked (the `hl-page` cookie when
 * it names one of the user's own pages, else the oldest), so another user's page id in the cookie
 * never reaches this query. This module imports no secret-key client.
 *
 * A draft that cannot be read (Supabase down, a timeout) shows the screen's header and a card, "We
 * couldn’t load your page. Try again." with Retry (M5-15), never a blank screen or the error text:
 * the error goes to the server log. `failIfInjected` is the end-to-end specs' switch for it
 * (src/lib/testing/faults.ts) and does nothing in production.
 */
export default async function EditorPage() {
  const { user, current, plan } = await getAppContext();
  let data: Awaited<ReturnType<typeof loadEditorPageData>>;
  let primaryDomain: string | null;
  let templateThemes: Awaited<ReturnType<typeof loadTemplateThemes>>;
  try {
    await failIfInjected("draft-load");
    [data, primaryDomain, templateThemes] = await Promise.all([
      loadEditorPageData(current, user.id),
      loadPrimaryDomain(current.id),
      // The themes the starter templates use (M6-40): never fails the page, reads {} instead.
      loadTemplateThemes(),
    ]);
  } catch (error) {
    console.error("[editor] loading the draft failed", error);
    return <LoadFailure breadcrumb={handleAddress(current.handle)} title={current.name} />;
  }
  return (
    <EditorScreen
      key={current.id}
      pageId={current.id}
      address={handleAddress(current.handle)}
      name={current.name}
      liveUrl={tenantOrigin(current.handle, clientEnv.NEXT_PUBLIC_ROOT_DOMAIN)}
      handle={current.handle}
      // The QR code's address and the share card's host come from the page's own rows, here on the
      // server (M6-31, M6-33): the primary custom domain when there is one, else the handle address.
      publicAddress={publicPageAddress({
        handle: current.handle,
        primaryDomain,
        rootDomain: clientEnv.NEXT_PUBLIC_ROOT_DOMAIN,
      })}
      primaryDomain={primaryDomain}
      publishedAt={data.publishedAt}
      draft={data.draft}
      revKey={data.revKey}
      repaired={data.repaired}
      themeTokens={data.themeTokens}
      templateThemes={templateThemes}
      hasPublished={data.hasPublished}
      published={data.published}
      chrome={pageChrome(plan, current.id)}
    />
  );
}
