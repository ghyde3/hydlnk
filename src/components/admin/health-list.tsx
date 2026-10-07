import { formatAgo, formatDuration, type JobHealth, type JobState } from "@/lib/admin/health";
import { formatWhen } from "./format";

const TH =
  "px-4 py-2.5 text-left font-mono text-[11px] font-medium tracking-[0.06em] text-text-2 uppercase";
const TD = "block px-4 py-1 hl:table-cell hl:px-4 hl:py-3 hl:align-middle";
const LABEL = "mr-2 font-mono text-[11px] tracking-[0.06em] text-text-3 uppercase hl:hidden";

const STATE_LABEL: Record<JobState, string> = {
  ok: "On time",
  failed: "Failed",
  late: "Late",
  paused: "Paused",
};

const STATE_CLASS: Record<JobState, string> = {
  ok: "bg-good-bg text-good",
  failed: "border border-bad-line text-bad",
  late: "border border-bad-line text-bad",
  paused: "bg-track text-text-2",
};

/** Each pg_cron job: last run, duration, outcome, and whether it is late (M13-06). Text only, all React text. */
export function HealthList({ jobs }: { jobs: JobHealth[] }) {
  return (
    <div className="overflow-hidden rounded-md border border-line bg-surface">
      <table className="block w-full border-collapse text-sm hl:table">
        <thead className="hidden bg-page hl:table-header-group">
          <tr>
            <th scope="col" className={TH}>
              Job
            </th>
            <th scope="col" className={TH}>
              Status
            </th>
            <th scope="col" className={TH}>
              Last run
            </th>
            <th scope="col" className={TH}>
              Duration
            </th>
            <th scope="col" className={TH}>
              Outcome
            </th>
            <th scope="col" className={TH}>
              Last 24 h
            </th>
          </tr>
        </thead>
        <tbody className="block hl:table-row-group">
          {jobs.map((job) => (
            <tr
              key={job.name}
              data-job={job.name}
              data-state={job.state}
              className="block border-b border-track py-3 last:border-b-0 hl:table-row hl:py-0"
            >
              <td className={`${TD} font-mono text-[13px] [overflow-wrap:anywhere]`}>
                <span className={LABEL}>Job</span>
                {job.name}
                <span className="block font-mono text-[11px] text-text-3">{job.schedule}</span>
              </td>
              <td className={TD}>
                <span className={LABEL}>Status</span>
                <span
                  className={`inline-flex min-h-6 items-center rounded-sm px-2 text-xs font-semibold whitespace-nowrap ${STATE_CLASS[job.state]}`}
                >
                  {STATE_LABEL[job.state]}
                </span>
                {job.state === "late" ? (
                  <span className="mt-0.5 block text-xs text-text-2">
                    Expected within {formatAgo(job.lateAfterSeconds).replace(" ago", "")}
                  </span>
                ) : null}
              </td>
              <td className={`${TD} font-mono text-[13px]`}>
                <span className={LABEL}>Last run</span>
                {job.lastRunAt
                  ? `${formatWhen(job.lastRunAt)}, ${formatAgo(job.sinceSeconds)}`
                  : "Never"}
              </td>
              <td className={`${TD} font-mono text-[13px]`}>
                <span className={LABEL}>Duration</span>
                {formatDuration(job.durationMs)}
              </td>
              <td className={`${TD} text-[13px] [overflow-wrap:anywhere]`}>
                <span className={LABEL}>Outcome</span>
                {job.outcome}
                {job.state === "failed" && job.message ? (
                  <span className="block font-mono text-xs text-bad">{job.message}</span>
                ) : null}
              </td>
              <td className={`${TD} font-mono text-[13px]`}>
                <span className={LABEL}>Last 24 h</span>
                {job.runs24h} runs, {job.failed24h} failed
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
