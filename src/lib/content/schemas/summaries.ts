import type { EntryStatus } from "./enums";

/**
 * The schedule state an entry list row and the editor bar draw (Wave E, M20-10): the pending publish
 * and unpublish times, the rev the pending publish was taken at, and the code of the newest failed
 * publish while nothing replaced it.
 */
export interface EntryScheduleSummary {
  publishAt: string | null;
  unpublishAt: string | null;
  scheduledRev: number | null;
  /** When the pending publish's snapshot was taken (Schedule was pressed), for "Your scheduled version is from …". */
  snapshotAt: string | null;
  failed: string | null;
  /**
   * The newest fire that ran (M20-10 step 3): the rev it found and the rev it left. An editor that
   * still holds `fromRev` adopts `rev` without the conflict notice (`firedRevToAdopt`).
   */
  fired: { fromRev: number; rev: number } | null;
}

/**
 * The shapes the writer's reads answer with, as plain types (Wave B): what the Posts screen's
 * client components hold. They live here, in the one part of `src/lib/content` a browser module may
 * import (no `server-only`, no secret-key client), so client code never has to name the writer's
 * index, which imports the admin client. The cores build these and re-export them; the index
 * exports them as before.
 */

export type ContentSource = "editor" | "mcp" | "builder" | "system";

export type TypeSummary = {
  typeId: string;
  key: string;
  label: string;
  labelPlural: string;
  enabled: boolean;
  archivePath: string | null;
};

export type TermSummary = {
  id: string;
  typeId: string;
  taxonomy: "category" | "tag";
  name: string;
  slug: string;
  parentId: string | null;
};

export interface EntrySummary {
  id: string;
  rev: number;
  status: EntryStatus;
  title: string | null;
  slug: string | null;
  path: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  /** A live entry whose draft is not what is published. Always false for a draft or a trashed entry. */
  hasUnpublishedChanges: boolean;
  /** The entry's pending schedules and the newest failure (Wave E, M20-10). */
  schedule: EntryScheduleSummary;
}

export type RevisionSummary = {
  rev: number;
  wasPublished: boolean;
  source: ContentSource;
  createdAt: string;
};
