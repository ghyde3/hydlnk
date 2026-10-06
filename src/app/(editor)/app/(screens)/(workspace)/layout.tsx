import type { ReactNode } from "react";
import { LoadFailure } from "@/components/editor/load-failure";
import { WorkspaceProvider } from "@/components/workspace/workspace-provider";
import { WorkspaceShell } from "@/components/workspace/workspace-shell";
import { clientEnv } from "@/lib/env/client";
import { loadPrimaryDomain } from "@/lib/editor/page-address";
import { loadEditorPageData } from "@/lib/editor/page-data";
import { tenantOrigin } from "@/lib/editor/urls";
import { getAppContext } from "@/lib/pages/context";
import { handleAddress } from "@/lib/pages/plans";
import { pageChrome } from "@/lib/publish/chrome";
import { loadSubPages } from "@/lib/site-pages/load";
import { publicPageAddress } from "@/lib/qr/address";
import { loadTemplateThemes } from "@/lib/templates/load";
import { failIfInjected } from "@/lib/testing/faults";
import { loadThemeLibrary } from "@/lib/themes/load";

/**
 * The workspace (M7-02): one layout for the three tabs, Edit (/editor), Design (/design) and Share
 * (/share). It reads everything the tabs share ONCE, when the workspace opens, with the signed-in
 * user's own session under RLS (the page is the one the gate picked: the `hl-page` cookie when it
 * names one of the user's own pages, else the oldest, so another user's page id in the cookie never
 * reaches these queries). This module imports no secret-key client.
 *
 *   the draft            required (with the site's sub-pages, M11-08): without it nothing can be edited, so the workspace is the page
 *                        header and a "We couldn’t load your page" card with Retry (M5-15), no
 *                        toolbar, no tabs, no preview
 *   the theme library    system and the user's own saved themes: if it cannot be read the Design
 *                        tab's Themes card says so with its own Retry and everything else works
 *                        (M5-16)
 *   the template themes  the six themes the starter templates use (never fails: {} instead)
 *   the primary domain   the address the QR code and the share card use (never fails: null)
 *
 * Errors go to the server log, never to the page. `failIfInjected` is the end-to-end specs' switch
 * for the two reads that can fail (src/lib/testing/faults.ts) and does nothing in production.
 *
 * A layout does not re-run on a soft navigation between its pages, so a tab switch reads nothing
 * here: the provider (keyed by the page id) holds the draft, its history and its one save queue
 * across Edit, Design and Share. `router.refresh()` (a rename, Publish) re-runs this layout with
 * fresh props; the provider takes the live ones (name, address) and ignores the draft-shaped ones.
 */
export default async function WorkspaceLayout({ children }: { children: ReactNode }) {
  const { user, current, plan } = await getAppContext();
  const [draftRead, themesRead, primaryDomain, templateThemes] = await Promise.all([
    (async () => {
      try {
        await failIfInjected("draft-load");
        const [data, subPages] = await Promise.all([
          loadEditorPageData(current, user.id),
          loadSubPages(current.id),
        ]);
        return { ok: true as const, data, subPages };
      } catch (error) {
        console.error("[workspace] loading the draft failed", error);
        return { ok: false as const };
      }
    })(),
    (async () => {
      try {
        await failIfInjected("themes-load");
        return { ok: true as const, themes: await loadThemeLibrary() };
      } catch (error) {
        console.error("[workspace] loading the themes failed", error);
        return { ok: false as const };
      }
    })(),
    loadPrimaryDomain(current.id),
    loadTemplateThemes(),
  ]);

  if (!draftRead.ok) {
    return <LoadFailure breadcrumb={handleAddress(current.handle)} title={current.name} />;
  }
  const data = draftRead.data;

  return (
    <WorkspaceProvider
      // Keyed by the page: choosing another page in the switcher starts from fresh state, and the
      // old page's queue flushes what it still holds.
      key={current.id}
      pageId={current.id}
      ownerId={user.id}
      plan={plan}
      handle={current.handle}
      address={handleAddress(current.handle)}
      name={current.name}
      liveUrl={tenantOrigin(current.handle, clientEnv.NEXT_PUBLIC_ROOT_DOMAIN)}
      // The QR code's address and the share card's host come from the page's own rows, here on the
      // server (M6-31, M6-33): the primary custom domain when there is one, else the handle address.
      publicAddress={publicPageAddress({
        handle: current.handle,
        primaryDomain,
        rootDomain: clientEnv.NEXT_PUBLIC_ROOT_DOMAIN,
      })}
      primaryDomain={primaryDomain}
      chrome={pageChrome(plan, current.id)}
      draft={data.draft}
      revKey={data.revKey}
      repaired={data.repaired}
      hasPublished={data.hasPublished}
      published={data.published}
      publishedAt={data.publishedAt}
      themeTokens={data.themeTokens}
      templateThemes={templateThemes}
      themes={themesRead.ok ? themesRead.themes : []}
      themesFailed={!themesRead.ok}
      subPages={draftRead.subPages}
    >
      <WorkspaceShell>{children}</WorkspaceShell>
    </WorkspaceProvider>
  );
}
