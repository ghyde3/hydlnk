import { HealthList } from "@/components/admin/health-list";
import { Card, ScreenBody, ScreenHeader } from "@/components/app/screen";
import { requireAdmin } from "@/lib/admin/auth";
import { readHealth } from "@/lib/admin/overview-queries";

export const metadata = { title: "Health" };
export const dynamic = "force-dynamic";

/**
 * /admin/health (M13-06): each pg_cron job with its last run, duration and outcome, and whether it
 * is late. The late rule is a small table in code (`src/lib/admin/health.ts`), not the cron schedule.
 */
export default async function AdminHealth() {
  await requireAdmin();
  const summary = await readHealth().catch(() => null);
  return (
    <>
      <ScreenHeader breadcrumb="admin / health" title="Health" />
      <ScreenBody maxWidth="max-w-[1200px]">
        <p className="text-sm leading-relaxed text-text-2">
          The scheduled jobs. A job is late when it hasn’t started within its usual gap.
        </p>
        {summary === null ? (
          <Card>
            <p role="alert" className="text-[15px] leading-relaxed text-bad">
              The jobs couldn’t be read right now. Reload to try again.
            </p>
          </Card>
        ) : summary.jobs.length === 0 ? (
          <Card>
            <p className="text-[15px] leading-relaxed text-text-2">
              No scheduled jobs were found. pg_cron may not be enabled on this database.
            </p>
          </Card>
        ) : (
          <>
            <p
              data-testid="health-summary"
              data-healthy={summary.healthy}
              role="status"
              className={`text-sm font-semibold ${summary.healthy ? "text-good" : "text-bad"}`}
            >
              {summary.healthy
                ? "Every job is running on time."
                : `${summary.failed} failed, ${summary.late} late.`}
            </p>
            <HealthList jobs={summary.jobs} />
          </>
        )}
      </ScreenBody>
    </>
  );
}
