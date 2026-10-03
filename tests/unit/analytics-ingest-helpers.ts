import { vi } from "vitest";
import type { EventRow, IngestDeps } from "@/lib/analytics/ingest/types";

export const PAGE_ID = "00000000-0000-4000-8000-0000000000b1";
export const BLOCK_ID = "Bt5rJ1fGz6Os";
export const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
export const DESKTOP_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
export const ORIGIN = "http://mara.localhost:3000";

export interface Spies {
  deps: IngestDeps & { homeHref: string };
  rateLimit: ReturnType<typeof vi.fn>;
  insertEvent: ReturnType<typeof vi.fn>;
  lookupBeaconPage: ReturnType<typeof vi.fn>;
  resolveClickTarget: ReturnType<typeof vi.fn>;
  visitorHash: ReturnType<typeof vi.fn>;
  /** The tasks `after()` would run, in order; call `flush()` to run them. */
  scheduled: Array<() => Promise<void>>;
  flush: () => Promise<void>;
  inserted: EventRow[];
}

/** Spy dependencies: a page "mara" that is published, a link at BLOCK_ID, an open limiter. */
export function makeDeps(overrides: Partial<IngestDeps> = {}): Spies {
  const inserted: EventRow[] = [];
  const scheduled: Array<() => Promise<void>> = [];
  const rateLimit = vi.fn(async () => ({ allowed: true, retryAfter: 0 }));
  const insertEvent = vi.fn(async (row: EventRow) => {
    inserted.push(row);
  });
  const lookupBeaconPage = vi.fn(async (pageId: string) =>
    pageId === PAGE_ID ? { handle: "mara", customHosts: ["links.example.test"] } : null,
  );
  const resolveClickTarget = vi.fn(async (pageId: string, id: string) =>
    pageId === PAGE_ID && id === BLOCK_ID ? "https://example.com/book" : null,
  );
  const visitorHash = vi.fn(() => "a".repeat(64));
  const deps: IngestDeps & { homeHref: string } = {
    rateLimit,
    now: () => new Date("2026-10-03T12:00:00Z"),
    visitorHash,
    insertEvent,
    lookupBeaconPage,
    resolveClickTarget,
    schedule: (task) => {
      scheduled.push(task);
    },
    rootDomain: "localhost:3000",
    homeHref: "http://localhost:3000/",
    ...overrides,
  };
  return {
    deps,
    rateLimit,
    insertEvent,
    lookupBeaconPage,
    resolveClickTarget,
    visitorHash,
    scheduled,
    flush: async () => {
      for (const task of scheduled.splice(0)) await task();
    },
    inserted,
  };
}

/** Every console method a handler could log through. */
export function spyOnConsole() {
  const methods = ["log", "info", "warn", "error", "debug"] as const;
  const spies = methods.map((method) => vi.spyOn(console, method).mockImplementation(() => undefined));
  return {
    text: () => spies.flatMap((spy) => spy.mock.calls.flat()).map((arg) => String(arg)).join("\n"),
    restore: () => spies.forEach((spy) => spy.mockRestore()),
  };
}
