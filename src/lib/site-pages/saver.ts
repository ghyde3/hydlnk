import type { BlockedLinkError } from "@/lib/blocklist/error";
import { LIMITS, draftSubPageSchema, type SubPageDraft } from "@/lib/document";
import { jsonbTextBytes } from "@/lib/editor/size";

/**
 * The autosave of sub-pages (M11-08): one debounced queue for all the sub-pages of the open site.
 * Home's draft keeps its own `AutosaveQueue` (a stale-tab guard on `draft->>rev`); a sub-page has no
 * rev, so a write is a plain update of that page's own row and the newest document wins. The queue
 * follows the same rules as Home's: about 800 ms after the last edit, a failed write is retried with
 * backoff, a draft over the size limit or one that does not pass the draft schema is not sent, a 401
 * is not retried on a timer, and a link to a blocked site (HL005) is permanent until that page is
 * edited again. Framework-free and timer-injectable, so it is unit-tested with fake timers.
 */

export type SubSaveStatus =
  | "idle"
  | "pending"
  | "saving"
  | "saved"
  | "error"
  | "too-large"
  /** The account's 64 MiB sub-page cap (HL009): permanent until something is removed. */
  | "storage-full"
  | "invalid"
  | "signed-out"
  | "blocked"
  /** A page it tried to write no longer exists (deleted in another tab). */
  | "missing";

export type SubSaveResult =
  | { kind: "ok" }
  | { kind: "unauthorized" }
  | { kind: "missing" }
  | { kind: "too-large" }
  | { kind: "storage-full" }
  | ({ kind: "blocked" } & BlockedLinkError)
  | { kind: "error" };

export type SubSaveFn = (id: string, doc: SubPageDraft) => Promise<SubSaveResult>;

export type SubBlocked = BlockedLinkError & { doc: SubPageDraft };

export interface SubPageSaverOptions {
  save: SubSaveFn;
  onStatus: (status: SubSaveStatus) => void;
  onBlocked?: (id: string, blocked: SubBlocked | null) => void;
  debounceMs?: number;
  retryDelaysMs?: readonly number[];
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export const SUB_SAVE_DEBOUNCE_MS = 800;
export const SUB_SAVE_RETRY_DELAYS_MS = [1000, 2000, 4000, 5000] as const;

interface Entry {
  doc: SubPageDraft;
  version: number;
}

export class SubPageSaver {
  private readonly save: SubSaveFn;
  private readonly onStatus: (status: SubSaveStatus) => void;
  private readonly onBlocked: (id: string, blocked: SubBlocked | null) => void;
  private readonly debounceMs: number;
  private readonly retryDelays: readonly number[];
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;

  /** Pages with edits that are not stored. */
  private readonly dirty = new Map<string, Entry>();
  /** Pages whose last write was refused for good until they are edited. */
  private readonly refused = new Map<string, SubBlocked>();
  /** Pages the schema or the size limit refused, flagged until they are edited again. */
  private readonly unsendable = new Map<string, "too-large" | "storage-full" | "invalid">();
  private version = 0;
  private timer: unknown = null;
  private retryIndex = 0;
  private inFlight: Promise<void> | null = null;
  private current: SubSaveStatus = "idle";
  private disposed = false;

  constructor(options: SubPageSaverOptions) {
    this.save = options.save;
    this.onStatus = options.onStatus;
    this.onBlocked = options.onBlocked ?? (() => {});
    this.debounceMs = options.debounceMs ?? SUB_SAVE_DEBOUNCE_MS;
    this.retryDelays = options.retryDelaysMs ?? SUB_SAVE_RETRY_DELAYS_MS;
    this.setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle as never));
  }

  get status(): SubSaveStatus {
    return this.current;
  }

  get hasUnsaved(): boolean {
    return this.dirty.size > 0;
  }

  /** The page `id` was edited: `doc` is its newest document. */
  schedule(id: string, doc: SubPageDraft): void {
    if (this.disposed) return;
    this.version += 1;
    this.dirty.set(id, { doc, version: this.version });
    this.unsendable.delete(id);
    if (this.refused.delete(id)) this.onBlocked(id, null);
    if (this.current === "signed-out" || this.current === "missing") return;
    if (this.current === "error") return;
    this.setStatus("pending");
    this.arm(this.debounceMs);
  }

  /** Forget a page without writing it (it was deleted). */
  drop(id: string): void {
    this.dirty.delete(id);
    this.unsendable.delete(id);
    if (this.refused.delete(id)) this.onBlocked(id, null);
    if (this.dirty.size === 0 && (this.current === "pending" || this.current === "saving")) {
      this.cancelTimer();
      if (!this.inFlight) this.setStatus("saved");
    }
  }

  /** Writes now. Resolves true when everything edited is stored. */
  async flush(): Promise<boolean> {
    const stored = () =>
      this.dirty.size === 0 &&
      this.refused.size === 0 &&
      this.unsendable.size === 0 &&
      (this.current === "idle" || this.current === "saved");
    if (this.disposed) return stored();
    this.cancelTimer();
    for (let attempt = 0; attempt < 3; attempt++) {
      if (this.inFlight) await this.inFlight;
      if (this.current === "signed-out" || this.current === "missing") return false;
      if (this.dirty.size === 0) return stored();
      await this.run();
      if (this.current !== "pending" && this.current !== "saving") return stored();
    }
    return stored();
  }

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

  private setStatus(status: SubSaveStatus): void {
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

  private run(): Promise<void> {
    if (this.inFlight) return this.inFlight;
    const work = this.write().finally(() => {
      this.inFlight = null;
    });
    this.inFlight = work;
    return work;
  }

  /** Writes every dirty page once; a page that cannot be sent is flagged and the rest still go. Stops at a failure worth retrying. */
  private async write(): Promise<void> {
    if (this.disposed || this.dirty.size === 0) return;
    if (this.current !== "error" && this.current !== "signed-out") this.setStatus("saving");
    for (const [id, entry] of [...this.dirty]) {
      if (this.disposed) return;
      // Client-side gate: never send what the schema or the size limit would refuse.
      if (jsonbTextBytes(entry.doc) > LIMITS.draftBytes) {
        // This page stays flagged; the others are still written.
        this.dirty.delete(id);
        this.unsendable.set(id, "too-large");
        continue;
      }
      if (!draftSubPageSchema.safeParse(entry.doc).success) {
        this.dirty.delete(id);
        this.unsendable.set(id, "invalid");
        continue;
      }
      let result: SubSaveResult;
      try {
        result = await this.save(id, entry.doc);
      } catch {
        result = { kind: "error" };
      }
      if (this.disposed) return;
      const newer = this.dirty.get(id)?.version !== entry.version;
      switch (result.kind) {
        case "ok":
          this.retryIndex = 0;
          if (!newer) this.dirty.delete(id);
          break;
        case "missing":
          this.dirty.delete(id);
          this.cancelTimer();
          this.setStatus("missing");
          return;
        case "too-large":
          if (!newer) {
            this.dirty.delete(id);
            this.unsendable.set(id, "too-large");
          }
          break;
        case "storage-full":
          // Refused for good until something is removed: not retried on a timer; the next edit tries again.
          if (!newer) {
            this.dirty.delete(id);
            this.unsendable.set(id, "storage-full");
          }
          break;
        case "unauthorized":
          this.cancelTimer();
          this.setStatus("signed-out");
          return;
        case "blocked":
          if (!newer) {
            this.dirty.delete(id);
            const refusal: SubBlocked = {
              hosts: result.hosts,
              blockIds: result.blockIds,
              doc: entry.doc,
            };
            this.refused.set(id, refusal);
            this.onBlocked(id, refusal);
          }
          break;
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
    if (this.dirty.size > 0) {
      this.setStatus("pending");
      this.arm(this.debounceMs);
    } else {
      const flagged = [...this.unsendable.values()];
      this.setStatus(
        flagged.length > 0
          ? flagged[flagged.length - 1]!
          : this.refused.size > 0
            ? "blocked"
            : "saved",
      );
    }
  }
}
