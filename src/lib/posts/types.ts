/**
 * One post as `GET entries/{entryId}` answers it (M16-13): the draft, never the live copy. A plain
 * type in a module of its own, so the browser side (`client.ts`, the post editor) can name it
 * without importing the routes' server module, which reaches the writer and the secret-key client.
 */
export interface PostEntry {
  id: string;
  rev: number;
  status: "draft" | "published" | "trashed";
  hasUnpublishedChanges: boolean;
  draft: unknown;
  publishedAt: string | null;
  firstPublishedAt: string | null;
  updatedAt: string;
  deletedAt: string | null;
}
