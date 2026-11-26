/**
 * The Markdown lexer's timing worker (M16-13): it lexes the bodies it is sent and reports how long
 * each took. It runs in a worker thread so that the test which asked can kill it: a lexer that
 * regressed to quadratic time fails that one test after its limit instead of hanging the suite.
 * Loaded with `--import tsx` (see `markdown-timing.ts`); it imports the lexer by relative path.
 */
import { parentPort } from "node:worker_threads";
import { getHeapStatistics, setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";
import { lexTokens } from "../../../src/lib/blog/markdown/lex";
import { LexRefused } from "../../../src/lib/blog/markdown/limits";
import type { LexRequest, LexTiming } from "./markdown-timing";

/** A full collection before each timed run, so a timing measures the lexer, not earlier garbage. */
const collectGarbage: () => void = (() => {
  try {
    setFlagsFromString("--expose-gc");
    return runInNewContext("gc") as () => void;
  } catch {
    return () => {};
  }
})();

/**
 * CPU time in ms (the machine may be shared and loaded; wall time is reported too). The process's:
 * the thread's own clock (`threadCpuUsage`) ticks in milliseconds here, too coarse for a small
 * body, and the test thread only waits meanwhile.
 */
const cpuNow = (): number => {
  const usage = process.cpuUsage();
  return (usage.user + usage.system) / 1000;
};

function lexOnce(body: string): Omit<LexTiming, "ms" | "cpu" | "heap"> {
  try {
    return { ok: true, nodes: lexTokens(body).nodes };
  } catch (err) {
    if (err instanceof LexRefused) return { ok: false, reason: err.reason, nodes: Number.NaN };
    return { ok: false, reason: "error", nodes: Number.NaN, message: String(err) };
  }
}

parentPort!.on("message", ({ bodies, runs, heap }: LexRequest) => {
  const best: LexTiming[] = bodies.map(() => ({
    ok: false,
    nodes: 0,
    ms: Infinity,
    cpu: Infinity,
    heap: 0,
  }));
  // Interleaved, so every body sees the same heap.
  for (let run = 0; run < runs; run += 1) {
    collectGarbage();
    bodies.forEach((body, k) => {
      const before = heap ? getHeapStatistics().used_heap_size : 0;
      const wall = performance.now();
      const cpu = cpuNow();
      const result = lexOnce(body);
      const timing = {
        ...result,
        ms: performance.now() - wall,
        cpu: cpuNow() - cpu,
        heap: heap ? getHeapStatistics().used_heap_size - before : 0,
      };
      const kept = best[k]!;
      best[k] = {
        ...timing,
        ms: Math.min(kept.ms, timing.ms),
        cpu: Math.min(kept.cpu, timing.cpu),
        heap: Math.max(kept.heap, timing.heap),
      };
    });
  }
  parentPort!.postMessage(best);
});
