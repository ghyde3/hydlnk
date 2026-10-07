import { AppsTable } from "@/components/admin/apps-table";
import { ScreenBody, ScreenHeader } from "@/components/app/screen";
import { requireAdmin } from "@/lib/admin/auth";
import { listConnectedApps } from "@/lib/admin/apps-queries";

export const metadata = { title: "Connected apps" };
export const dynamic = "force-dynamic";

/**
 * /admin/apps (M13-10): the AI apps people have connected, by active connections and tool calls in
 * the last 7 days (counts only, from mcp_activity: no content, no person). Revoke for everyone ends
 * every grant and token of an app and blocks it at the authorize and token endpoints until an admin
 * restores it. A non-admin gets the app's 404 from `requireAdmin`; every change is guarded again on
 * the server (`block_app` and `unblock_app`, both audited).
 */
export default async function AdminApps() {
  await requireAdmin();
  const rows = await listConnectedApps();
  return (
    <>
      <ScreenHeader breadcrumb="admin / connected apps" title="Connected apps" />
      <ScreenBody maxWidth="max-w-[1200px]">
        <p className="text-sm leading-relaxed text-text-2">
          Apps people have connected to HYDLNK, busiest first. Revoking an app ends its connections
          for everyone and stops it connecting again until you restore it.
        </p>
        <AppsTable rows={rows} />
      </ScreenBody>
    </>
  );
}
