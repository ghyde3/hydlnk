import { Worker } from "node:worker_threads";

/**
 * Timing the Markdown lexer without hanging the suite (M16-13). A timing test sends its bodies to a
 * worker thread (`markdown-timing-worker.ts`) and waits at most `limitMs`: past it the worker is
 * terminated (which stops even a busy loop) and the test fails, by name, in seconds. Before, a
 * regression to quadratic time ran a synchronous test for minutes and the suite never finished.
 */

export interface LexRequest {
  bodies: string[];
  /** Runs per body, interleaved; the fastest is reported. */
  runs: number;
  /** Also report the heap the lex grew (its largest, over the runs). */
  heap?: boolean;
}

export interface LexTiming {
  ok: boolean;
  reason?: string;
  message?: string;
  nodes: number;
  /** Wall time of the fastest run, ms. */
  ms: number;
  /** The CPU time of the fastest run, ms: what the ratios read (the machine is shared). */
  cpu: number;
  heap: number;
}

/** The kill: no single request of a test may take longer (a linear 512 KiB lex takes well under 1 s). */
export const LIMIT_MS = 5_000;

let worker: Worker | null = null;

function spawn(): Worker {
  worker ??= new Worker(new URL("./markdown-timing-worker.ts", import.meta.url), {
    execArgv: ["--import", "tsx"],
  });
  return worker;
}

/** Ends the worker (after the last test, or when a request ran out of time). */
export async function stopTiming(): Promise<void> {
  const running = worker;
  worker = null;
  await running?.terminate();
}

/**
 * The fastest of `runs` lexes of each body, from the worker. Rejects, naming `label`, when the
 * worker takes more than `limitMs` (it is killed, and the next request starts a fresh one).
 */
export function timeLex(
  label: string,
  request: LexRequest,
  limitMs = LIMIT_MS,
): Promise<LexTiming[]> {
  const thread = spawn();
  return new Promise<LexTiming[]>((resolve, reject) => {
    const done = () => {
      clearTimeout(timer);
      thread.off("message", onMessage);
      thread.off("error", onError);
    };
    const onMessage = (timings: LexTiming[]) => {
      done();
      resolve(timings);
    };
    const onError = (err: Error) => {
      done();
      worker = null;
      reject(err);
    };
    const timer = setTimeout(() => {
      done();
      // Rejected once the thread is gone, so it burns no CPU into the next test's timings.
      const failure = new Error(
        `${label}: killed after ${limitMs} ms (the lexer is not linear on this body)`,
      );
      void stopTiming().then(
        () => reject(failure),
        () => reject(failure),
      );
    }, limitMs);
    thread.on("message", onMessage);
    thread.on("error", onError);
    thread.postMessage(request);
  });
}
