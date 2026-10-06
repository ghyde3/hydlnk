import { describe, expect, it } from "vitest";
import {
  blockedLinksInPublished,
  loadBlockedDomains,
  type BlockedDomainsReader,
} from "@/lib/blocklist";
import type { PublishDoc } from "@/lib/document";

/**
 * M5-03: the list of blocked domains is read in ordered pages. PostgREST (and hosted Supabase) answer
 * at most 1000 rows whatever a request asks for, so a plain select would silently cut a longer table
 * and the Publish check would miss every domain past the cut.
 */

function reader(total: number, opts: { failAtPage?: number; cap?: number } = {}) {
  const rows = Array.from({ length: total }, (_, i) => ({
    domain: `d${String(i).padStart(5, "0")}.example`,
  }));
  const cap = opts.cap ?? 1000;
  const calls: [number, number][] = [];
  const admin: BlockedDomainsReader = {
    from: () => ({
      select: () => ({
        order: () => ({
          range: async (from: number, to: number) => {
            calls.push([from, to]);
            if (opts.failAtPage !== undefined && from === opts.failAtPage * 1000) {
              return { data: null, error: { message: "page failed" } };
            }
            // The server's row cap: never more than `cap` rows, whatever the range says.
            return { data: rows.slice(from, Math.min(to + 1, from + cap)), error: null };
          },
        }),
      }),
    }),
  };
  return { admin, rows, calls };
}

describe("M5-03 loadBlockedDomains", () => {
  it("reads a table longer than the row cap whole, in ordered pages", async () => {
    const { admin, rows, calls } = reader(2500);
    const domains = await loadBlockedDomains(admin);
    expect(domains).toEqual(rows.map((r) => r.domain));
    expect(calls).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });

  it("a domain deep in a long list is still found by the Publish check", async () => {
    const { admin } = reader(2500);
    const domains = await loadBlockedDomains(admin);
    const doc = {
      blocks: [
        { id: "b-1", type: "link", visible: true, label: "L", url: "https://www.d02400.example/x" },
      ],
    } as unknown as PublishDoc;
    expect(blockedLinksInPublished(doc, domains)).toHaveLength(1);
  });

  it("an exact multiple of the page size ends with an empty page, not a loop; a short list is one request", async () => {
    const exact = reader(2000);
    expect(await loadBlockedDomains(exact.admin)).toHaveLength(2000);
    expect(exact.calls).toHaveLength(3);
    const short = reader(12);
    expect(await loadBlockedDomains(short.admin)).toHaveLength(12);
    expect(short.calls).toEqual([[0, 999]]);
  });

  it("a page that cannot be read fails the whole read (closed), never a partial list", async () => {
    const { admin } = reader(2500, { failAtPage: 1 });
    await expect(loadBlockedDomains(admin)).rejects.toThrow(/page failed/);
  });
});
