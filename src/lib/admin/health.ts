/**
 * System health (M13-06): what each pg_cron job's last run means. `admin_cron_health()` returns the
 * facts; whether a job is late is decided here, from a small table of job name to the longest gap
 * that is still normal, never parsed out of the cron schedule.
 */

const MINUTE = 60;
const HOUR = 3600;

/** Seconds a job may go without starting before it is late: about three times its schedule. */
export const LATE_AFTER_SECONDS: Readonly<Record<string, number>> = {
  "verify-pending-domains": 15 * MINUTE, // every 5 minutes
  "end-expired-gifts": 30 * MINUTE, // every 10 minutes
  "purge-oauth-requests": 30 * MINUTE, // every 10 minutes
  "purge-rate-limit-hits": 45 * MINUTE, // every 15 minutes
  "purge-oauth-cimd-unused": 3 * HOUR, // hourly
};

/** Every other job is nightly: a day and two hours is still normal. */
export const DEFAULT_LATE_AFTER_SECONDS = 26 * HOUR;

export const lateAfterSeconds = (jobName: string): number =>
  LATE_AFTER_SECONDS[jobName] ?? DEFAULT_LATE_AFTER_SECONDS;

/** One row of `admin_cron_health()`. */
export interface CronJobRow {
  jobid: number | string;
  jobname: string | null;
  schedule: string | null;
  active: boolean | null;
  last_run_at: string | null;
  last_end_at: string | null;
  duration_ms: number | string | null;
  last_status: string | null;
  last_message: string | null;
  runs_24h: number | string | null;
  failed_24h: number | string | null;
}

export type JobState = "ok" | "failed" | "late" | "paused";

export interface JobHealth {
  name: string;
  schedule: string;
  state: JobState;
  /** The words shown for the last outcome: Succeeded, Failed, Running, Never ran. */
  outcome: string;
  lastRunAt: string | null;
  durationMs: number | null;
  /** Seconds since the last run started, null when it never ran. */
  sinceSeconds: number | null;
  lateAfterSeconds: number;
  runs24h: number;
  failed24h: number;
  message: string | null;
}

const num = (value: number | string | null): number | null => {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

/**
 * failed: the newest run failed. late: it has not started within the job's longest normal gap (a job
 * that never ran counts). A paused (inactive) job is neither: it is off on purpose. A failure wins
 * over lateness, since it is the more specific news.
 */
export function classifyJob(row: CronJobRow, now: Date): JobHealth {
  const name = row.jobname ?? `job ${row.jobid}`;
  const limit = lateAfterSeconds(name);
  const lastRun = row.last_run_at ? Date.parse(row.last_run_at) : NaN;
  const since = Number.isFinite(lastRun)
    ? Math.max(0, Math.round((now.getTime() - lastRun) / 1000))
    : null;
  const status = row.last_status?.toLowerCase() ?? null;

  let state: JobState;
  if (row.active === false) state = "paused";
  else if (status === "failed") state = "failed";
  else if (since === null || since > limit) state = "late";
  else state = "ok";

  const outcome =
    status === null
      ? "Never ran"
      : status === "succeeded"
        ? "Succeeded"
        : status === "failed"
          ? "Failed"
          : status === "running" ||
              status === "starting" ||
              status === "connecting" ||
              status === "sending"
            ? "Running"
            : status.charAt(0).toUpperCase() + status.slice(1);

  return {
    name,
    schedule: row.schedule ?? "",
    state,
    outcome,
    lastRunAt: row.last_run_at,
    durationMs: num(row.duration_ms),
    sinceSeconds: since,
    lateAfterSeconds: limit,
    runs24h: num(row.runs_24h) ?? 0,
    failed24h: num(row.failed_24h) ?? 0,
    message: row.last_message,
  };
}

export interface HealthSummary {
  jobs: JobHealth[];
  failed: number;
  late: number;
  /** True when no job is failed or late. */
  healthy: boolean;
  /** True when there is nothing to judge: no job is scheduled, or none has ever run. */
  noHistory: boolean;
}

export function summarizeHealth(rows: readonly CronJobRow[], now: Date): HealthSummary {
  const jobs = rows.map((row) => classifyJob(row, now));
  const failed = jobs.filter((job) => job.state === "failed").length;
  const late = jobs.filter((job) => job.state === "late").length;
  return {
    jobs,
    failed,
    late,
    healthy: failed === 0 && late === 0,
    noHistory: jobs.every((job) => job.lastRunAt === null),
  };
}

export type HealthTileState = "unknown" | "none" | "bad" | "ok";

/**
 * What the Overview's Health tile says. No job history is neutral ("No job history yet"), never green:
 * an empty list is not proof that anything runs. A failed or late job is red; green only when jobs
 * have run and all are on time.
 */
export function healthTile(summary: HealthSummary | null): {
  state: HealthTileState;
  text: string;
} {
  if (summary === null) return { state: "unknown", text: "Couldn’t be read" };
  if (summary.failed > 0 || summary.late > 0) {
    if (summary.noHistory && summary.failed === 0)
      return { state: "none", text: "No job history yet" };
    return { state: "bad", text: `${summary.failed} failed, ${summary.late} late` };
  }
  if (summary.noHistory) return { state: "none", text: "No job history yet" };
  return { state: "ok", text: "All jobs on time" };
}

/** "3 min ago", "2 h ago", "1 d ago": coarse on purpose. */
export function formatAgo(seconds: number | null): string {
  if (seconds === null) return "never";
  if (seconds < 90) return `${seconds} s ago`;
  if (seconds < 90 * 60) return `${Math.round(seconds / 60)} min ago`;
  if (seconds < 36 * 3600) return `${Math.round(seconds / 3600)} h ago`;
  return `${Math.round(seconds / 86400)} d ago`;
}

export function formatDuration(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.round(ms / 1000)} s`;
}
