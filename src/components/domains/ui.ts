/**
 * Class strings shared by the Domains screen's components (docs/DESIGN.md -> Components): the
 * 44px button, its three variants, and the 44px field. HYDLNK UI tokens only.
 */
export const BUTTON =
  "inline-flex min-h-11 cursor-pointer items-center justify-center rounded-md px-4 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60";
export const PRIMARY = `${BUTTON} border border-ink bg-ink text-surface`;
export const SECONDARY = `${BUTTON} border border-line-3 bg-surface text-ink`;
export const DANGER = `${BUTTON} border border-bad-line bg-surface text-bad`;
export const FIELD =
  "min-h-11 w-full rounded-md border border-line-3 bg-surface px-3 text-ink disabled:cursor-not-allowed disabled:opacity-60";
export const FIELD_LABEL = "text-[13px] font-semibold text-ink-2";
