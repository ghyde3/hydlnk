import type { Metadata } from "next";
import { DesignScreen } from "@/components/design/design-screen";
import { LoadFailure } from "@/components/editor/load-failure";
import { loadEditorPageData } from "@/lib/editor/page-data";
import { getAppContext } from "@/lib/pages/context";
import { pageChrome } from "@/lib/publish/chrome";
import { failIfInjected } from "@/lib/testing/faults";
import { loadThemeLibrary } from "@/lib/themes/load";

export const metadata: Metadata = { title: "Design" };

/**
 * The Design screen (M3-06): the current page's draft and the themes the user may use, read with
 * the signed-in user's own session under RLS, handed to the client screen. The page is the one the
 * gate picked (the `hl-page` cookie when it names one of the user's own pages, else the oldest), so
 * another user's page id in the cookie never reaches these queries. This module imports no
 * secret-key client.
 *
 * Two reads can fail on their own (M5-16). The draft: the screen's header and a "We couldn’t load
 * your page" card with Retry (nothing can be edited without it). The themes: the screen still
 * opens, with the token controls and the preview, and the Saved themes row says "We couldn’t load
 * your themes" with its own Retry. Errors go to the server log, never to the page.
 */
export default async function DesignPage() {
  const { user, current, plan } = await getAppContext();
  const [draftRead, themesRead] = await Promise.allSettled([
    (async () => {
      await failIfInjected("draft-load");
      return loadEditorPageData(current, user.id);
    })(),
    (async () => {
      await failIfInjected("themes-load");
      return loadThemeLibrary();
    })(),
  ]);
  if (draftRead.status === "rejected") {
    console.error("[design] loading the draft failed", draftRead.reason);
    return <LoadFailure breadcrumb="Theme" title="Design" />;
  }
  if (themesRead.status === "rejected") {
    console.error("[design] loading the themes failed", themesRead.reason);
  }
  const data = draftRead.value;
  const themes = themesRead.status === "fulfilled" ? themesRead.value : [];
  return (
    <DesignScreen
      key={current.id}
      pageId={current.id}
      ownerId={user.id}
      plan={plan}
      draft={data.draft}
      revKey={data.revKey}
      repaired={data.repaired}
      themes={themes}
      themesFailed={themesRead.status === "rejected"}
      chrome={pageChrome(plan, current.id)}
    />
  );
}
