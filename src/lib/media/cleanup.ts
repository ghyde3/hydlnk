import "server-only";
import { IMAGE_PATH_PATTERN } from "@/lib/document";
import { UNDO_WINDOW_MS } from "./cleanup-client";

/**
 * The cleanup of replaced and removed images (M5-14), written against injected dependencies so the
 * rules are tested without Storage or a database; `cleanupMediaFor` in "./cleanup-admin" is the
 * real one (secret key).
 *
 * A draft is saved from the browser with the user's own session, so the database is what notices
 * an image reference being dropped: triggers on `pages` and `themes` write the dropped path into
 * `image_cleanup_queue` (migration 20261003000003). This function works that queue off for ONE
 * owner:
 *
 *   1. read the owner's queued paths;
 *   2. a path that is not exactly `{ownerId}/{name}.{jpg|png|webp}` is discarded from the queue and
 *      never reaches Storage: the folder prefix of the path, not the queue's owner column, decides
 *      what may be deleted, so no queued value can name another account's object or climb out of
 *      the owner's folder;
 *   3. `inUse` asks which of the rest any draft, published document or saved theme of the owner
 *      still names (one database statement, one snapshot, every page counted);
 *   4. the unused ones are removed from Storage, and only then taken off the queue. A path that is
 *      still used stays queued: a live page keeps the object it shows until the Publish that drops
 *      it (the trigger queues it again then), so replacing a background never breaks the live page;
 *   5. a Storage failure throws before anything is dequeued, so the next run tries again.
 *
 * Freed bytes lower `account_upload_bytes` at once, because that function sums the objects in the
 * bucket (M4-31).
 */

/**
 * What one cleanup run may see (team access): the rows queued before `before` (past the editor's Undo
 * window, for EVERY run, the owner's included, so no run deletes what anyone dropped a moment ago and
 * may still bring back with Undo), and, when `siteId` is set, only the rows that site's writes queued.
 * `siteId` null is the owner's whole queue. Never built by a caller: `cleanupScopeFor` derives it from
 * who is acting, inside the one entry point (`cleanupMediaFor` in "./cleanup-admin").
 */
export interface CleanupScope {
  siteId: string | null;
  before: Date;
}

/**
 * Who runs a cleanup and on what (team access re-review, finding 1): the acting user (`actorId`, null
 * for the system: a scheduled publish), the site OWNER whose folder and queue it is, and the site the
 * call is about (null: the owner's own account-wide call, such as the cleanup route without a site).
 * Every caller passes this, never a bare owner id, so none can forget the scope.
 */
export interface CleanupAccess {
  actorId: string | null;
  ownerId: string;
  siteId: string | null;
}

/**
 * The scope of a run (finding 1): the owner acting works the whole queue, a member or the system only
 * the named site's rows; either way only rows queued more than UNDO_WINDOW_MS before `now`. A call
 * that is not the owner's and names no site may see nothing (null).
 */
export function cleanupScopeFor(access: CleanupAccess, now: Date = new Date()): CleanupScope | null {
  const before = new Date(now.getTime() - UNDO_WINDOW_MS);
  if (access.actorId !== null && access.actorId === access.ownerId) return { siteId: null, before };
  if (access.siteId === null) return null;
  return { siteId: access.siteId, before };
}

export interface CleanupDeps {
  /** The owner's queued paths (only those `scope` allows, when given), oldest first, at most `limit`. */
  listQueue(ownerId: string, limit: number, scope?: CleanupScope): Promise<string[]>;
  /** The subset of `paths` that any draft, published document or saved theme of the owner names. */
  inUse(ownerId: string, paths: string[]): Promise<string[]>;
  /** Removes these objects from Storage. Every path starts with `{ownerId}/`; a missing object is fine. */
  remove(paths: string[]): Promise<void>;
  /** Takes these paths off the owner's queue. */
  dequeue(ownerId: string, paths: string[]): Promise<void>;
  /**
   * Moves still-referenced paths to the back of the queue (queued_at = now), so the oldest-first
   * batch of CLEANUP_QUEUE_LIMIT is never filled for good by images a page still uses.
   */
  requeue?(ownerId: string, paths: string[]): Promise<void>;
}

export interface CleanupResult {
  /** Removed from Storage. */
  deleted: string[];
  /** Still referenced: left in Storage and in the queue. */
  kept: string[];
  /** Not a path of this owner's folder: dropped from the queue, Storage never touched. */
  discarded: string[];
}

/**
 * Most queue rows one run (one request) works on, and how many paths go in one `inUse` or `remove`
 * call: 25 (Wave M1 review, M11-12), so one call cannot make the database test thousands of paths
 * against every document. A longer queue is worked off over the next runs.
 */
export const CLEANUP_QUEUE_LIMIT = 25;
const CHUNK = 25;

/** True only for `{ownerId}/{name}.{jpg|png|webp}` with `ownerId` exactly the given uid. */
export function isOwnedMediaPath(ownerId: string, path: string): boolean {
  return (
    typeof path === "string" && path.startsWith(`${ownerId}/`) && IMAGE_PATH_PATTERN.test(path)
  );
}

export async function cleanupOwnerMedia(
  ownerId: string,
  deps: CleanupDeps,
  scope?: CleanupScope,
): Promise<CleanupResult> {
  const result: CleanupResult = { deleted: [], kept: [], discarded: [] };
  const queued = [
    ...new Set(
      await (scope ? deps.listQueue(ownerId, CLEANUP_QUEUE_LIMIT, scope) : deps.listQueue(ownerId, CLEANUP_QUEUE_LIMIT)),
    ),
  ];
  if (queued.length === 0) return result;

  const owned: string[] = [];
  for (const path of queued) {
    if (isOwnedMediaPath(ownerId, path)) owned.push(path);
    else result.discarded.push(path);
  }
  if (result.discarded.length > 0) await deps.dequeue(ownerId, result.discarded);

  for (let i = 0; i < owned.length; i += CHUNK) {
    const chunk = owned.slice(i, i + CHUNK);
    const used = new Set(await deps.inUse(ownerId, chunk));
    const unused = chunk.filter((path) => !used.has(path));
    const keptHere = chunk.filter((path) => used.has(path));
    result.kept.push(...keptHere);
    if (keptHere.length > 0 && deps.requeue) await deps.requeue(ownerId, keptHere);
    if (unused.length === 0) continue;
    // The guard again, at the last moment before Storage: nothing outside `{ownerId}/` goes out.
    const safe = unused.filter((path) => isOwnedMediaPath(ownerId, path));
    await deps.remove(safe);
    await deps.dequeue(ownerId, safe);
    result.deleted.push(...safe);
  }
  return result;
}
