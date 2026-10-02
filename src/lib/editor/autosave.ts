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
  | "invalid" //    the draft does not pass the draft schema: not sent
  | "conflict"; //  another tab saved first; reload to continue

/** Outcome of one write, as the transport reports it. */
export type SaveResult =
  { kind: "ok" } | { kind: "conflict" } | { kind: "too-large" } | { kind: "error" };

/** Writes `doc` if the stored draft still has `expectedRevKey` (null: the stored draft has no rev). */
export type SaveFn = (doc: DraftDoc, expectedRevKey: string | null) => Promise<SaveResult>;

export interface AutosaveOptions {
  save: SaveFn;
  onStatus: (status: SaveStatus) => void;
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
  private disposed = false;

  constructor(options: AutosaveOptions) {
    this.save = options.save;
    this.onStatus = options.onStatus;
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
    if (this.current === "conflict") return; // keep the edits; the screen asks for a reload
    // After a failed write the indicator stays "Not saved" until a write succeeds; the retry timer
    // (already running) picks the new draft up.
    if (this.current === "error") return;
    this.setStatus("pending");
    this.arm(this.debounceMs);
  }

  /**
   * Writes now (tab hidden, Publish, leaving the screen). Resolves true when everything edited is
   * stored (status "idle" or "saved"): it waits for a write in flight and runs another one if
   * edits arrived meanwhile. A conflict, a failed write or an oversized draft resolves false.
   */
  async flush(): Promise<boolean> {
    const stored = () => this.current === "idle" || this.current === "saved";
    if (this.disposed) return stored();
    this.cancelTimer();
    for (let attempt = 0; attempt < 3; attempt++) {
      if (this.inFlight) await this.inFlight;
      if (this.current === "conflict") return false;
      if (!this.hasUnsaved) return stored();
      await this.run();
      if (this.current !== "pending" && this.current !== "saving") return stored();
    }
    return stored();
  }

  /** The browser came back online: retry a failed write now instead of waiting for the backoff. */
  retryNow(): void {
    if (this.current === "error") {
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

    // After a failure the indicator stays "Not saved" during the retry, so it does not flicker.
    if (this.current !== "error") this.setStatus("saving");
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
