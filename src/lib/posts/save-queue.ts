import type { EntrySaveAnswer } from "@/lib/site-pages/entry-save-client";

/**
 * The post editor's save queue (M16-13, M16-15). Pure: timers and one injected `save`.
 *
 *   - An edit is sent 1.5 s after the last one, the newest draft only, one request at a time, at the
 *     rev the server last answered; the answered rev is adopted.
 *   - A stale rev is a `conflict`: the post was changed somewhere else (another tab, an MCP client).
 *     Nothing is sent again and nothing is overwritten; the screen offers Reload.
 *   - A refusal (`too-large`, `invalid`, ...) is an `error` with its reason; the next edit tries
 *     again. A network failure is retried by itself.
 *   - `exclusive` is how Publish, Unpublish, Trash and a revision restore run: the pending edit is
 *     stored first, then the action runs with no save on the wire, at the stored rev, and the queue
 *     adopts only the rev the action answers. Edits typed meanwhile wait and are saved after it. So
 *     a save and a publish of the same post never overlap (the rule of `AutosaveQueue.hold()`).
 */

export const POST_SAVE_DEBOUNCE_MS = 1500;
const RETRY_MS = 5000;

export type PostSaveState = "saved" | "saving" | "unsaved" | "conflict" | "error";
export type PostSaveProblem = Exclude<EntrySaveAnswer["kind"], "ok" | "conflict">;

export interface PostSaveView {
  state: PostSaveState;
  /** Why the last save was refused, while `state` is "error". */
  problem: PostSaveProblem | null;
  /** What the server said is wrong with the body, for an `invalid` refusal that named it. */
  message?: string;
}

export interface PostSaveOptions<Draft> {
  rev: number;
  save: (rev: number, draft: Draft) => Promise<EntrySaveAnswer>;
  onChange?: (view: PostSaveView) => void;
}

export class PostSaveQueue<Draft> {
  private currentRev: number;
  private pending: { draft: Draft } | null = null;
  private sending: Promise<void> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private holds = 0;
  private disposed = false;
  private current: PostSaveView = { state: "saved", problem: null };
  private readonly listeners = new Set<() => void>();

  constructor(private readonly options: PostSaveOptions<Draft>) {
    this.currentRev = options.rev;
  }

  get rev(): number {
    return this.currentRev;
  }

  get view(): PostSaveView {
    return this.current;
  }

  /** Tells `listener` whenever `view` changes (for `useSyncExternalStore`). Returns the unsubscribe. */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Whether an edit is waiting or on the wire. */
  get dirty(): boolean {
    return this.pending !== null || this.sending !== null;
  }

  /** Take the newest draft. It is sent 1.5 s after the last push. */
  push(draft: Draft): void {
    if (this.disposed) return;
    this.pending = { draft };
    if (this.current.state === "conflict") return;
    if (this.sending === null) this.set({ state: "unsaved", problem: null });
    this.schedule(POST_SAVE_DEBOUNCE_MS);
  }

  /** Send what is waiting now. Resolves true once everything typed so far is stored. */
  async flush(): Promise<boolean> {
    this.cancel();
    for (;;) {
      if (this.disposed || this.current.state === "conflict") return false;
      if (this.sending) {
        await this.sending;
        continue;
      }
      if (this.pending === null) return this.current.state === "saved";
      if (this.holds > 0) return false;
      const before = this.pending;
      await this.send();
      // The same draft is still waiting: the save was refused, and asking again would loop.
      if (this.pending === before) return false;
    }
  }

  /**
   * Run `action` with the post to itself: everything typed is stored first, no save is on the wire
   * while it runs, and it gets the stored rev. Its answered `rev`, if any, becomes the queue's.
   * `{ok: false}` means the pending edit could not be stored, so the action did not run.
   */
  async exclusive<T>(
    action: (rev: number) => Promise<{ rev?: number; value: T }>,
  ): Promise<{ ok: true; value: T } | { ok: false }> {
    if (!(await this.flush())) return { ok: false };
    this.holds += 1;
    try {
      const out = await action(this.currentRev);
      if (out.rev !== undefined) this.currentRev = out.rev;
      return { ok: true, value: out.value };
    } finally {
      this.holds -= 1;
      if (this.holds === 0 && this.pending !== null && !this.disposed) {
        this.schedule(POST_SAVE_DEBOUNCE_MS);
      }
    }
  }

  /** Try a refused or failed save again, now. */
  retry(): void {
    if (this.current.state === "error" && this.pending !== null) void this.flush();
  }

  /** The post was changed somewhere else (an action answered `conflict`): stop saving, as a stale save does. */
  markConflict(): void {
    this.cancel();
    this.set({ state: "conflict", problem: null });
  }

  dispose(): void {
    this.disposed = true;
    this.cancel();
  }

  /** Undo `dispose` (React mounts an effect twice in development). What was waiting is sent again. */
  resume(): void {
    if (!this.disposed) return;
    this.disposed = false;
    if (this.pending !== null && this.current.state !== "conflict") {
      this.schedule(POST_SAVE_DEBOUNCE_MS);
    }
  }

  // -----------------------------------------------------------------------------------------

  private set(view: PostSaveView): void {
    if (
      view.state === this.current.state &&
      view.problem === this.current.problem &&
      view.message === this.current.message
    ) {
      return;
    }
    this.current = view;
    this.options.onChange?.(view);
    for (const listener of this.listeners) listener();
  }

  private cancel(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private schedule(ms: number): void {
    this.cancel();
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.sending === null && this.holds === 0) void this.send();
    }, ms);
  }

  private send(): Promise<void> {
    const job = this.pending;
    if (job === null || this.disposed || this.current.state === "conflict") {
      return Promise.resolve();
    }
    this.pending = null;
    this.set({ state: "saving", problem: null });
    const run = (async () => {
      let answer: EntrySaveAnswer;
      try {
        answer = await this.options.save(this.currentRev, job.draft);
      } catch {
        answer = { kind: "error" };
      }
      this.sending = null;
      if (this.disposed) return;
      if (answer.kind === "ok") {
        this.currentRev = answer.rev;
        if (this.pending === null) this.set({ state: "saved", problem: null });
        else {
          this.set({ state: "unsaved", problem: null });
          if (this.timer === null && this.holds === 0) this.schedule(0);
        }
        return;
      }
      if (answer.kind === "conflict") {
        this.cancel();
        this.set({ state: "conflict", problem: null });
        return;
      }
      // Refused: the draft stays the one to save, unless a newer edit has arrived since.
      // Only a network failure or a server error is retried by itself: a refusal (an `invalid` body
      // included) gets the same answer again, so it waits for the next edit or Try again.
      this.pending ??= job;
      this.set({
        state: "error",
        problem: answer.kind,
        ...((answer.kind === "invalid" || answer.kind === "forbidden") && answer.message
          ? { message: answer.message }
          : {}),
      });
      if (answer.kind === "error" && this.timer === null) this.schedule(RETRY_MS);
    })();
    this.sending = run;
    return run;
  }
}
