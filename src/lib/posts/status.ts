import type { EntryScheduleSummary } from "@/lib/content/schemas/summaries";

/**
 * Where a post stands, in the one vocabulary of the publish bar (DESIGN.md): Draft, Live,
 * Unpublished changes, plus Trashed for the Posts list (M16-12), and (Wave E, M20-10) Scheduled
 * (a pending scheduled publish wins over Draft and Unpublished changes) and Didn't publish (the
 * newest scheduled publish failed and nothing replaced it). Pure.
 */
export type PostState = "draft" | "live" | "changes" | "trashed" | "scheduled" | "failed";

export const POST_STATE_LABEL: Record<PostState, string> = {
  draft: "Draft",
  live: "Live",
  changes: "Unpublished changes",
  trashed: "Trashed",
  scheduled: "Scheduled",
  failed: "Didn’t publish",
};

/** The publish state as the draft and the live copy give it (without schedules). */
export type PublishedState = Extract<PostState, "draft" | "live" | "changes" | "trashed">;

/** A schedule's word on top of the publish state: Scheduled wins over Draft and Unpublished changes. */
export function withSchedule(
  state: PublishedState,
  schedule: EntryScheduleSummary | null | undefined,
): PostState {
  if (state === "trashed" || !schedule) return state;
  if (schedule.publishAt !== null) return "scheduled";
  if (schedule.failed !== null && state !== "live") return "failed";
  return state;
}

export function postState(entry: {
  status: "draft" | "published" | "trashed";
  hasUnpublishedChanges: boolean;
  schedule?: EntryScheduleSummary | null;
}): PostState {
  const base: PublishedState =
    entry.status === "trashed"
      ? "trashed"
      : entry.status === "draft"
        ? "draft"
        : entry.hasUnpublishedChanges
          ? "changes"
          : "live";
  return withSchedule(base, entry.schedule);
}

/** The filter values of the Posts list's status select: "" is everything outside the trash. */
export const POST_FILTERS = [
  { value: "", label: "All posts" },
  { value: "draft", label: "Drafts" },
  { value: "published", label: "Live" },
  { value: "scheduled", label: "Scheduled" },
  { value: "trashed", label: "Trashed" },
] as const;

/** A post's date line: when it went live, else when it was last saved. `now` only decides the year. */
export function postDateLabel(
  entry: {
    status: string;
    publishedAt: string | null;
    updatedAt: string;
    deletedAt: string | null;
  },
  now: Date = new Date(),
): string {
  const [verb, iso] =
    entry.status === "trashed" && entry.deletedAt
      ? ["Trashed", entry.deletedAt]
      : entry.status === "published" && entry.publishedAt
        ? ["Published", entry.publishedAt]
        : ["Edited", entry.updatedAt];
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return verb;
  const text = date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
    ...(date.getUTCFullYear() === now.getUTCFullYear() ? {} : { year: "numeric" }),
  });
  return `${verb} ${text}`;
}
