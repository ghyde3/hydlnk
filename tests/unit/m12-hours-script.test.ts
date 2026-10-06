import { readFileSync } from "node:fs";
import { join } from "node:path";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { DAY_KEYS, DAY_LABELS, hoursStatusAt, type HoursBlock } from "@/lib/document";

/**
 * M12-02 (script side): the one tenant script's hours branch runs in jsdom against the same cases
 * as `hoursStatusAt`, so the two cannot drift. The script reads the table the renderer wrote
 * (`data-tz`, `data-day`, `data-ranges`), marks today's row with `aria-current="date"`, writes
 * "Open now" or "Closed now" and sets `data-open`, with a fixed clock.
 */

const ROOT = process.cwd();
const SOURCE = readFileSync(join(ROOT, "src/lib/tenant-assets/script/tenant.js"), "utf8");

type Range = { open: string; close: string };
type Days = HoursBlock["days"];
const days = (over: Record<string, Range[]> = {}): Days =>
  Object.fromEntries(
    DAY_KEYS.map((key) => {
      const ranges = over[key] ?? [];
      return [key, { closed: ranges.length === 0, ranges }];
    }),
  ) as Days;

/** The markup the renderer writes for one hours block (see src/components/page/items-hours-blocks.tsx). */
function tableFor(block: Pick<HoursBlock, "timezone" | "days">): string {
  const rows = DAY_KEYS.map((key) => {
    const day = block.days[key];
    const data = day.closed ? "" : day.ranges.map((r) => `${r.open}-${r.close}`).join(",");
    return `<tr class="pg-hours-row" data-day="${key}" data-ranges="${data}"><th scope="row">${DAY_LABELS[key]}</th><td></td></tr>`;
  }).join("");
  return (
    `<section class="pg-hours" data-tz="${block.timezone}">` +
    `<p class="pg-hours-status" role="status" data-hours-status=""></p>` +
    `<table><tbody>${rows}</tbody></table></section>`
  );
}

/** Run the script on `block` with the clock at `now`; what the visitor sees. */
function run(block: Pick<HoursBlock, "timezone" | "days">, now: string) {
  const dom = new JSDOM(`<!DOCTYPE html><html><body>${tableFor(block)}</body></html>`, {
    url: "http://mara.localhost:3000/",
    runScripts: "outside-only",
  });
  const { window } = dom;
  const fixed = new Date(now).getTime();
  const RealDate = window.Date;
  class FixedDate extends RealDate {
    constructor(...args: unknown[]) {
      if (args.length === 0) super(fixed);
      else super(...(args as [number]));
    }
    static override now() {
      return fixed;
    }
  }
  (window as unknown as { Date: unknown }).Date = FixedDate;
  const intervals: number[] = [];
  (window as unknown as { setInterval: unknown }).setInterval = (_fn: unknown, ms: number) => {
    intervals.push(ms);
    return 1;
  };
  window.eval(SOURCE);
  const doc = window.document;
  const section = doc.querySelector(".pg-hours")!;
  return {
    status: doc.querySelector("[data-hours-status]")!.textContent,
    open: section.getAttribute("data-open"),
    today: [...doc.querySelectorAll("[aria-current]")].map((el) => el.getAttribute("data-day")),
    currentValue: doc.querySelector("[aria-current]")?.getAttribute("aria-current"),
    intervals,
  };
}

const at = (iso: string) => new Date(iso);
const nightShift = {
  timezone: "UTC",
  days: days({ mon: [{ open: "22:00", close: "02:00" }] }),
};
const ny = {
  timezone: "America/New_York",
  days: days({
    mon: [{ open: "09:00", close: "17:00" }],
    tue: [
      { open: "09:00", close: "12:00" },
      { open: "13:00", close: "17:00" },
    ],
    sun: [{ open: "23:00", close: "03:00" }],
  }),
};
const tokyo = {
  timezone: "Asia/Tokyo",
  days: days({ tue: [{ open: "08:00", close: "10:00" }] }),
};

const CASES: Array<[string, typeof ny, string]> = [
  ["a range passing midnight, before it opens", nightShift, "2026-01-05T21:59:00Z"],
  ["a range passing midnight, at its open", nightShift, "2026-01-05T22:00:00Z"],
  ["a range passing midnight, after midnight", nightShift, "2026-01-06T01:00:00Z"],
  ["a range passing midnight, at its close", nightShift, "2026-01-06T02:00:00Z"],
  ["Sunday into Monday", ny, "2026-01-05T07:00:00Z"],
  ["new york before opening", ny, "2026-01-05T13:59:00Z"],
  ["new york at opening (09:00 local, 14:00Z)", ny, "2026-01-05T14:00:00Z"],
  ["new york, Tuesday 02:00Z is Monday evening there", ny, "2026-01-06T02:00:00Z"],
  ["new york lunch gap", ny, "2026-01-06T17:30:00Z"],
  ["new york afternoon range", ny, "2026-01-06T19:00:00Z"],
  ["a zone ahead of UTC: Monday 23:30Z is Tuesday 08:30 in Tokyo", tokyo, "2026-01-05T23:30:00Z"],
  ["Tokyo at close", tokyo, "2026-01-06T01:00:00Z"],
  ["Tokyo, Tuesday UTC but already Wednesday there", tokyo, "2026-01-06T15:30:00Z"],
  ["summer time shifts the offset", ny, "2026-07-06T13:00:00Z"],
];

describe("M12-02 M12-11 the tenant script marks today in the block's time zone, and its open-now rule equals hoursStatusAt", () => {
  it.each(CASES)("%s", (_name, block, iso) => {
    const expected = hoursStatusAt(block, at(iso));
    const seen = run(block, iso);
    expect(seen.status).toBe(expected.open ? "Open now" : "Closed now");
    expect(seen.open).toBe(expected.open ? "true" : "false");
    expect(seen.today).toEqual([expected.todayKey]);
    expect(seen.currentValue).toBe("date");
  });

  it("agrees with hoursStatusAt on every quarter hour of a week, in two zones", () => {
    for (const block of [ny, tokyo, nightShift]) {
      const start = Date.parse("2026-01-04T00:00:00Z");
      for (let step = 0; step < 7 * 96; step += 5) {
        const iso = new Date(start + step * 15 * 60_000).toISOString();
        const expected = hoursStatusAt(block, at(iso));
        const seen = run(block, iso);
        expect(`${block.timezone} ${iso} ${seen.status} ${seen.today}`).toBe(
          `${block.timezone} ${iso} ${expected.open ? "Open now" : "Closed now"} ${expected.todayKey}`,
        );
      }
    }
  }, 30_000); // three zones across a week in jsdom: slow on CI runners

  it("refreshes every minute, and a block whose zone is unknown is read in UTC", () => {
    const seen = run({ ...nightShift, timezone: "Not/AZone" }, "2026-01-05T23:00:00Z");
    expect(seen.status).toBe("Open now");
    expect(seen.intervals).toEqual([60000]);
  });

  it("a page with no hours block sets no timer", () => {
    const dom = new JSDOM("<!DOCTYPE html><body><p>x</p></body>", { runScripts: "outside-only" });
    const timers: number[] = [];
    (dom.window as unknown as { setInterval: unknown }).setInterval = (_f: unknown, ms: number) =>
      timers.push(ms);
    dom.window.eval(SOURCE);
    expect(timers).toEqual([]);
  });
});
