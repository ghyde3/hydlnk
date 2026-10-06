import type { Metadata } from "next";
import { HistoryError } from "@/components/versions/history-error";
import { HistoryHeader } from "@/components/versions/history-header";
import { HistoryScreen } from "@/components/versions/history-screen";
import { LockedCard } from "@/components/versions/locked-card";
import { PLAN_LIMITS } from "@/lib/limits";
import { getAppContext } from "@/lib/pages/context";
import { handleAddress } from "@/lib/pages/plans";
import { pageChrome } from "@/lib/publish/chrome";
import { failIfInjected } from "@/lib/testing/faults";
import { loadHistory, type HistoryData } from "@/lib/versions/load";

export const metadata: Metadata = { title: "Version history" };

/**
 * Version history (M6-50): the published versions of the current page, newest first, with Preview
 * and Restore (Pro and Studio). It lives under the Editor in the navigation (/editor/history).
 *
 * The page is the signed-in user's current page (`getAppContext`: the `hl-page` cookie names a
 * preference among their own pages, never another account's), and the plan is read from their own
 * account row. A plan that keeps no versions (Free, or a Pro account that was downgraded) gets the
 * locked card and the screen makes no request to `page_versions` at all. Otherwise the list is read
 * with the user's own session under RLS, never the secret key; a list that cannot be read shows the
 * "We couldn’t load your versions" card with Retry (the error goes to the server log).
 *
 * The page id and a version's id travel only as Server Action arguments, and the server checks both
 * again (M6-49), so editing them in the browser changes nothing.
 */
export default async function HistoryPage() {
  const { user, current, plan } = await getAppContext();
  const breadcrumb = `${handleAddress(current.handle)} / history`;
  const header = <HistoryHeader breadcrumb={breadcrumb} />;
  const body = (children: React.ReactNode) => (
    <>
      {header}
      <div className="flex-1 px-4 py-4 hl:px-8 hl:py-6">{children}</div>
    </>
  );

  const kept = PLAN_LIMITS[plan].versionsKept;
  if (kept <= 0)
    return body(
      <div className="max-w-[880px]">
        <LockedCard />
      </div>,
    );

  let data: HistoryData;
  try {
    await failIfInjected("versions-load");
    data = await loadHistory(current, user.id, kept);
  } catch (error) {
    console.error("[history] loading the versions failed", error);
    return body(
      <div className="max-w-[880px]">
        <HistoryError />
      </div>,
    );
  }

  return body(
    <HistoryScreen
      // Keyed by page: switching pages (the switcher refreshes the route) starts from fresh state.
      key={current.id}
      pageId={current.id}
      versions={data.versions}
      hasUnpublished={data.hasUnpublished}
      chrome={pageChrome(plan, current.id)}
    />,
  );
}
