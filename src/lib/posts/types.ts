/**
 * One post as `GET entries/{entryId}` answers it (M16-13): the draft, and the owner's own live copy
 * (`published`, null unless the post is live) only so the editor can tell Live from Unpublished
 * changes as the draft is edited (back to the live copy reads Live again). A plain
 * type in a module of its own, so the browser side (`client.ts`, the post editor) can name it
 * without importing the routes' server module, which reaches the writer and the secret-key client.
 */
import type { EntryScheduleSummary } from "@/lib/content/schemas/summaries";

export interface PostEntry {
  id: string;
  rev: number;
  status: "draft" | "published" | "trashed";
  hasUnpublishedChanges: boolean;
  draft: unknown;
  /** The live copy, while `status` is "published"; else null. */
  published: unknown;
  publishedAt: string | null;
  firstPublishedAt: string | null;
  updatedAt: string;
  deletedAt: string | null;
  /** Its pending schedules and the newest failure (Wave E, M20-10). */
  schedule: EntryScheduleSummary;
}
