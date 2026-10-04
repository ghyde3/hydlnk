import Link from "next/link";
import { Card, ScreenBody, ScreenHeader } from "@/components/app/screen";
import { requireAdmin } from "@/lib/admin/auth";
import { countOpenReports, countSuspendedAccounts } from "@/lib/admin/queries";
import { countBlockedDomains } from "@/lib/blocklist/admin-queries";

export const metadata = { title: "Overview" };
export const dynamic = "force-dynamic";

const TILE =
  "flex min-h-11 flex-col gap-1 rounded-md border border-line bg-surface p-4 no-underline hover:border-line-3";

export default async function AdminOverview() {
  await requireAdmin();
  const [open, suspended, blocked] = await Promise.all([
    countOpenReports().catch(() => null),
    countSuspendedAccounts().catch(() => null),
    countBlockedDomains().catch(() => null),
  ]);
  return (
    <>
      <ScreenHeader breadcrumb="admin / overview" title="Admin" />
      <ScreenBody>
        <div className="grid gap-3 hl:grid-cols-2 min-[1100px]:grid-cols-4">
          <Link href="/admin/reports" className={TILE}>
            <span className="font-mono text-xs text-text-2">Open reports</span>
            <span className="font-mono text-[22px] font-semibold">{open ?? "—"}</span>
          </Link>
          <Link href="/admin/pages" className={TILE}>
            <span className="font-mono text-xs text-text-2">Suspended accounts</span>
            <span className="font-mono text-[22px] font-semibold">{suspended ?? "—"}</span>
          </Link>
          <Link href="/admin/traffic" className={TILE}>
            <span className="font-mono text-xs text-text-2">Traffic</span>
            <span className="text-sm text-text-2">High-traffic pages on Free</span>
          </Link>
          <Link href="/admin/blocked-links" className={TILE}>
            <span className="font-mono text-xs text-text-2">Blocked links</span>
            <span className="font-mono text-[22px] font-semibold">{blocked ?? "—"}</span>
          </Link>
        </div>
        <Card>
          <p className="text-sm leading-relaxed text-text-2">
            Reports come from the link on every public page. Suspending an account takes all of its
            pages offline at once and blocks its owner from publishing, uploading or creating pages
            until you unsuspend it.
          </p>
        </Card>
      </ScreenBody>
    </>
  );
}
