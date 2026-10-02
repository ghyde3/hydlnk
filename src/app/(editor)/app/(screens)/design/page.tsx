import type { Metadata } from "next";
import { DesignScreen } from "@/components/design/design-screen";
import { loadEditorPageData } from "@/lib/editor/page-data";
import { getAppContext } from "@/lib/pages/context";
import { pageChrome } from "@/lib/publish/chrome";
import { loadThemeLibrary } from "@/lib/themes/load";

export const metadata: Metadata = { title: "Design" };

/**
 * The Design screen (M3-06): the current page's draft and the themes the user may use, read with
 * the signed-in user's own session under RLS, handed to the client screen. The page is the one the
 * gate picked (the `hl-page` cookie when it names one of the user's own pages, else the oldest), so
 * another user's page id in the cookie never reaches these queries. This module imports no
 * secret-key client.
 */
export default async function DesignPage() {
  const { user, current, plan } = await getAppContext();
  const [data, themes] = await Promise.all([
    loadEditorPageData(current, user.id),
    loadThemeLibrary(),
  ]);
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
      chrome={pageChrome(plan, current.id)}
    />
  );
}
