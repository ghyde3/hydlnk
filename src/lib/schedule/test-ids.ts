/**
 * The `data-testid` values of the scheduling controls (Wave E): the block Schedule section, the
 * schedule dialog and its notes, and the Posts filter. One list, so the components and the
 * Playwright specs agree. Pure.
 */
export const SCHEDULE_TEST_IDS = {
  blockSchedule: "block-schedule",
  blockFrom: "block-schedule-from",
  blockUntil: "block-schedule-until",
  blockClear: "block-schedule-clear",
  blockZone: "block-schedule-zone",
  blockChip: "block-schedule-chip",
  blockUpgrade: "block-schedule-upgrade",
  open: "schedule-open",
  time: "schedule-time",
  unpublishTime: "schedule-unpublish-time",
  confirm: "schedule-confirm",
  cancel: "schedule-cancel",
  update: "schedule-update",
  note: "schedule-note",
  failed: "schedule-failed",
  postsFilterScheduled: "posts-filter-scheduled",
} as const;
