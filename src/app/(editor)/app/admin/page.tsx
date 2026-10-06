import Link from "next/link";
import { OverviewNumbersSection } from "@/components/admin/overview-numbers";
import { Card, ScreenBody, ScreenHeader } from "@/components/app/screen";
import { requireAdmin } from "@/lib/admin/auth";
import { healthTile } from "@/lib/admin/health";
import { readHealth, readOverviewNumbers, readSignups } from "@/lib/admin/overview-queries";
import { countOpenReports, countSuspendedAccounts } from "@/lib/admin/queries";
import { countBlockedDomains } from "@/lib/blocklist/admin-queries";

export const metadata = { title: "Overview" };
export const dynamic = "force-dynamic";

const TILE =
  "flex min-h-11 flex-col gap-1 rounded-md border border-line bg-surface p-4 no-underline hover:border-line-3";

export default async function AdminOverview() {
  await requireAdmin();
  const [open, suspended, blocked, numbers, signups, health] = await Promise.all([
    countOpenReports().catch(() => null),
    countSuspendedAccounts().catch(() => null),
    countBlockedDomains().catch(() => null),
    readOverviewNumbers().catch(() => null),
    readSignups().catch(() => null),
    readHealth().catch(() => null),
  ]);
  // Red when a job failed or is late; unknown (a dash) when the jobs could not be read.
  const tile = healthTile(health);
  const unhealthy = tile.state === "bad";
  return (
    <>
      <ScreenHeader breadcrumb="admin / overview" title="Admin" />
      <ScreenBody>
        <div className="grid gap-3 hl:grid-cols-2 min-[1100px]:grid-cols-5">
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
          <Link
            href="/admin/health"
            data-testid="health-tile"
            data-health={tile.state}
            className={`${TILE} ${unhealthy ? "!border-bad bg-bad-line/30" : ""}`}
          >
            <span className="font-mono text-xs text-text-2">Health</span>
            <span
              className={`text-sm font-semibold ${unhealthy ? "text-bad" : tile.state === "ok" ? "text-good" : "text-text-2"}`}
            >
              {tile.text}
            </span>
          </Link>
        </div>
        <OverviewNumbersSection numbers={numbers} signups={signups} />
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
