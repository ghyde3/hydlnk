import type { BlockedLinkError } from "@/lib/blocklist/error";
import { LIMITS, draftDocSchema, type DraftDoc } from "@/lib/document";
import { jsonbTextBytes } from "./size";

/**
 * The autosave queue (M2-04): one place that decides when a draft is written, so the screen only
 * says "this is the latest draft" (`schedule`) and "write it now" (`flush`).
 *
 *   - Debounced: one write about 800 ms after the last edit, however fast the user types.
 *   - Every write carries `rev + 1` and is conditional on the stored rev (the stale-tab guard): a
 *     write that matches no row is `conflict`, which stops the queue until the page is reloaded.
 *   - A failed write keeps the edits here and retries with backoff (and when the browser comes
 *     back online); a draft over the size limit or one the database refuses is not retried.
 *   - A write refused with 401 (the session expired, M5-15) is not retried on a timer at all: the
 *     status is "signed-out", the edits stay in the queue, and the screen asks the user to sign
 *     in. `retryNow` (the tab is visible again, the browser is online) tries once more.
 *   - A write the database refuses because a link points to a blocked site (M5-03, SQLSTATE HL005)
 *     is permanent for that draft, so it is not retried on a timer either: the status is "blocked"
 *     and `blocked` says which hosts. The very next edit is written like any other (that is how
 *     the status goes back to "saved" once the link is fixed). A refusal that arrives after the
 *     user has typed on is not shown at all: it is about a draft that is already out of date, and
 *     a URL being typed (`https://exam`) is refused on its way to a valid one.
 *
 * Framework-free and timer-injectable, so it is unit-tested with fake timers.
 */

export type SaveStatus =
  | "idle" //       nothing edited yet
  | "pending" //    edited, waiting for the debounce
  | "saving" //     a write is in flight
  | "saved" //      everything edited is stored
  | "error" //      the last write failed; retrying
  | "too-large" //  over the size limit: not sent (or refused by the database)
  | "storage-full" // the account's 64 MiB sub-page cap (HL009): sub-page saves only, not retried
  | "invalid" //    the draft does not pass the draft schema: not sent
  | "conflict" //   another tab saved first; reload to continue
  | "signed-out" // the session ended (the write was refused with 401): edits stay, no retry loop
  | "blocked"; //   a link points to a blocked site (M5-03): refused for good, until it is edited

/** Outcome of one write, as the transport reports it. */
export type SaveResult =
  | { kind: "ok" }
  | { kind: "conflict" }
  | { kind: "too-large" }
  /** The write was refused with 401: the session is gone. Not retried until the user is back. */
  | { kind: "unauthorized" }
  /** The database refused the draft: a link points to a blocked site (M5-03). Not retried. */
  | ({ kind: "blocked" } & BlockedLinkError)
  | { kind: "error" };

/** What a refused draft was refused for, and which draft it was (the exact object that was sent). */
export type BlockedSave = BlockedLinkError & { draft: DraftDoc };

/** Writes `doc` if the stored draft still has `expectedRevKey` (null: the stored draft has no rev). */
export type SaveFn = (doc: DraftDoc, expectedRevKey: string | null) => Promise<SaveResult>;

export interface AutosaveOptions {
  save: SaveFn;
  onStatus: (status: SaveStatus) => void;
  /** The blocked-link refusal in force (or null once a write succeeds): for the screen's field errors. */
  onBlocked?: (blocked: BlockedSave | null) => void;
  /** The rev the database holds today: `rev` (0 when it has none) and `revKey` (the text of it). */
  initial: { rev: number; revKey: string | null };
  debounceMs?: number;
  /** Delays between retries after a failed write; the last one repeats. */
  retryDelaysMs?: readonly number[];
  /** Injectable for tests. */
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  now?: () => number;
}

export const AUTOSAVE_DEBOUNCE_MS = 800;
export const AUTOSAVE_RETRY_DELAYS_MS = [1000, 2000, 4000, 5000] as const;

export class AutosaveQueue {
  private readonly save: SaveFn;
  private readonly onStatus: (status: SaveStatus) => void;
  private readonly onBlocked: (blocked: BlockedSave | null) => void;
  private readonly debounceMs: number;
  private readonly retryDelays: readonly number[];
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;
  private readonly now: () => number;

  private committed: { rev: number; revKey: string | null };
  private latest: DraftDoc | null = null;
  private stored: DraftDoc | null = null;
  /** Bumped by every `schedule`: a write is current when no edit arrived while it was in flight. */
  private version = 0;
  private savedVersion = 0;
  private lastEditAt = 0;
  private timer: unknown = null;
  private retryIndex = 0;
  private inFlight: Promise<void> | null = null;
  private current: SaveStatus = "idle";
  private blockedSave: BlockedSave | null = null;
  private disposed = false;

  constructor(options: AutosaveOptions) {
    this.save = options.save;
    this.onStatus = options.onStatus;
    this.onBlocked = options.onBlocked ?? (() => {});
    this.committed = { ...options.initial };
    this.debounceMs = options.debounceMs ?? AUTOSAVE_DEBOUNCE_MS;
    this.retryDelays = options.retryDelaysMs ?? AUTOSAVE_RETRY_DELAYS_MS;
    this.setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle as never));
    this.now = options.now ?? (() => Date.now());
  }

  get status(): SaveStatus {
    return this.current;
  }

  /** The blocked-link refusal in force, or null. Cleared by the next write that succeeds. */
  get blocked(): BlockedSave | null {
    return this.blockedSave;
  }

  /** The newest draft the database is known to hold (the one Publish will freeze), or null. */
  get savedDraft(): DraftDoc | null {
    return this.stored;
  }

  /** True while an edit is not stored yet. */
  get hasUnsaved(): boolean {
    return this.latest !== null && this.savedVersion < this.version;
  }

  /** The user edited: `draft` is the newest document. Starts (or restarts) the debounce. */
  schedule(draft: DraftDoc): void {
    if (this.disposed) return;
    this.latest = draft;
    this.version += 1;
    this.lastEditAt = this.now();
    // Keep the edits; the screen asks for a reload or a sign-in, and nothing is sent until then.
    if (this.current === "conflict" || this.current === "signed-out") return;
    // After a failed write the indicator stays "Not saved" until a write succeeds; the retry timer
    // (already running) picks the new draft up.
    if (this.current === "error") return;
    this.setStatus("pending");
    this.arm(this.debounceMs);
  }

  /**
   * Writes now (tab hidden, Publish, leaving the screen). Resolves true when everything edited is
   * stored (status "idle" or "saved"): it waits for a write in flight and runs another one if
   * edits arrived meanwhile. A conflict, a signed-out session, a failed write or an oversized draft
   * resolves false.
   */
  async flush(): Promise<boolean> {
    const stored = () => this.current === "idle" || this.current === "saved";
    if (this.disposed) return stored();
    this.cancelTimer();
    // Refused for a link to a blocked site and not edited since: the same draft would be refused
    // again, so there is nothing to send (no wasted 400 on every tab hide, no flicker of the banner).
    if (this.current === "blocked") return false;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (this.inFlight) await this.inFlight;
      if (this.current === "conflict" || this.current === "signed-out") return false;
      if (!this.hasUnsaved) return stored();
      await this.run();
      if (this.current !== "pending" && this.current !== "saving") return stored();
    }
    return stored();
  }

  /**
   * The browser came back online or the tab is visible again: retry a failed write now instead of
   * waiting for the backoff, or (signed out) find out whether the user signed in elsewhere. One
   * attempt per call; a 401 puts the status straight back to "signed-out".
   */
  retryNow(): void {
    if (this.current === "error" || this.current === "signed-out") {
      this.cancelTimer();
      void this.run();
    }
  }

  dispose(): void {
    this.disposed = true;
    this.cancelTimer();
  }

  // -----------------------------------------------------------------------------------------

  private setStatus(status: SaveStatus): void {
    if (this.current === status) return;
    this.current = status;
    this.onStatus(status);
  }

  private setBlocked(blocked: BlockedSave | null): void {
    if (this.blockedSave === blocked) return;
    this.blockedSave = blocked;
    this.onBlocked(blocked);
  }

  private arm(delay: number): void {
    this.cancelTimer();
    this.timer = this.setTimer(() => {
      this.timer = null;
      void this.run();
    }, delay);
  }

  private cancelTimer(): void {
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = null;
  }

  /** One write of the newest draft. Never runs two at once. */
  private run(): Promise<void> {
    if (this.inFlight) return this.inFlight;
    const work = this.write().finally(() => {
      this.inFlight = null;
    });
    this.inFlight = work;
    return work;
  }

  private async write(): Promise<void> {
    if (this.disposed || this.latest === null || this.savedVersion >= this.version) return;
    const version = this.version;
    const sent = this.latest;
    const payload: DraftDoc = { ...sent, rev: this.committed.rev + 1 };

    // Client-side gate: never send what the schema or the size limit would refuse.
    if (jsonbTextBytes(payload) > LIMITS.draftBytes) {
      this.cancelTimer();
      this.setStatus("too-large");
      return;
    }
    if (!draftDocSchema.safeParse(payload).success) {
      this.cancelTimer();
      this.setStatus("invalid");
      return;
    }

    // After a failure the indicator stays "Not saved" during the retry, so it does not flicker; the
    // signed-out banner stays up while a retry finds out whether the user is back.
    if (this.current !== "error" && this.current !== "signed-out") this.setStatus("saving");
    let result: SaveResult;
    try {
      result = await this.save(payload, this.committed.revKey);
    } catch {
      result = { kind: "error" };
    }
    if (this.disposed) return;

    switch (result.kind) {
      case "ok": {
        this.committed = { rev: payload.rev, revKey: String(payload.rev) };
        this.savedVersion = version;
        this.stored = sent;
        this.retryIndex = 0;
        this.setBlocked(null);
        if (this.version > version) {
          // Edited while this write was in flight: the next one follows the debounce.
          this.setStatus("pending");
          this.arm(Math.max(0, this.lastEditAt + this.debounceMs - this.now()));
        } else {
          this.setStatus("saved");
        }
        return;
      }
      case "conflict":
        this.cancelTimer();
        this.setStatus("conflict");
        return;
      case "too-large":
        this.cancelTimer();
        this.setStatus("too-large");
        return;
      case "unauthorized":
        // No timer: a 401 does not get better with waiting, and a loop would hammer the API.
        this.cancelTimer();
        this.setStatus("signed-out");
        return;
      case "blocked": {
        // No timer: the same draft is refused again. But if the user typed on while this write was
        // in flight, the refusal is about a draft that is already out of date (a URL half typed
        // is refused on its way to a good one): say nothing and follow the debounce.
        this.cancelTimer();
        if (this.version > version) {
          this.setStatus("pending");
          this.arm(Math.max(0, this.lastEditAt + this.debounceMs - this.now()));
          return;
        }
        this.setBlocked({ hosts: result.hosts, blockIds: result.blockIds, draft: sent });
        this.setStatus("blocked");
        return;
      }
      case "error": {
        this.setStatus("error");
        const delay =
          this.retryDelays[Math.min(this.retryIndex, this.retryDelays.length - 1)] ?? 5000;
        this.retryIndex += 1;
        this.arm(delay);
        return;
      }
    }
  }
}
