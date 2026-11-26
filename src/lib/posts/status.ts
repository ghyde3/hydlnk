/**
 * Where a post stands, in the one vocabulary of the publish bar (DESIGN.md): Draft, Live,
 * Unpublished changes, plus Trashed for the Posts list (M16-12). Pure.
 */
export type PostState = "draft" | "live" | "changes" | "trashed";

export const POST_STATE_LABEL: Record<PostState, string> = {
  draft: "Draft",
  live: "Live",
  changes: "Unpublished changes",
  trashed: "Trashed",
};

export function postState(entry: {
  status: "draft" | "published" | "trashed";
  hasUnpublishedChanges: boolean;
}): PostState {
  if (entry.status === "trashed") return "trashed";
  if (entry.status === "draft") return "draft";
  return entry.hasUnpublishedChanges ? "changes" : "live";
}

/** The filter values of the Posts list's status select: "" is everything outside the trash. */
export const POST_FILTERS = [
  { value: "", label: "All posts" },
  { value: "draft", label: "Drafts" },
  { value: "published", label: "Live" },
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
