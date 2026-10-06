import { describe, expect, it } from "vitest";
import {
  BLOCK_TYPES,
  DAY_KEYS,
  HOURS_TIMEZONES,
  LIMITS,
  blockDefaults,
  draftDocSchema,
  hoursStatusAt,
  isHoursTimezone,
  publishDocSchema,
  publishedDocSchema,
  toPublishForm,
  type DraftDoc,
  type HoursBlock,
} from "@/lib/document";
import { blocks, draftWith } from "./fixtures/page-document";

type Range = { open: string; close: string };
const days = (over: Record<string, { closed: boolean; ranges: Range[] }> = {}) => {
  const base = Object.fromEntries(DAY_KEYS.map((k) => [k, { closed: true, ranges: [] }]));
  return { ...base, ...over } as HoursBlock["days"];
};
const block = (over: Record<string, unknown> = {}) => ({
  id: "hours-test-001",
  type: "hours",
  visible: true,
  timezone: "America/New_York",
  days: days({ mon: { closed: false, ranges: [{ open: "09:00", close: "17:00" }] } }),
  ...over,
});
const draftOk = (b: unknown) => draftDocSchema.safeParse(draftWith(b)).success;
const publishOk = (b: unknown) => publishDocSchema.safeParse(draftWith(b)).success;

describe("M12-02 hours block schema", () => {
  it("is registered after items; the default is Mon-Fri 09:00-17:00 in New York", () => {
    expect(BLOCK_TYPES.indexOf("hours")).toBe(BLOCK_TYPES.indexOf("items") + 1);
    const b = blockDefaults.hours() as HoursBlock;
    expect(b.timezone).toBe("America/New_York");
    for (const k of ["mon", "tue", "wed", "thu", "fri"] as const) {
      expect(b.days[k]).toEqual({ closed: false, ranges: [{ open: "09:00", close: "17:00" }] });
    }
    expect(b.days.sat).toEqual({ closed: true, ranges: [] });
    expect(b.days.sun).toEqual({ closed: true, ranges: [] });
    expect(draftOk(b)).toBe(true);
    expect(publishOk(b)).toBe(true);
  });

  it("accepts a full block in both forms and round-trips through Publish", () => {
    expect(draftOk(blocks.hours)).toBe(true);
    const draft = draftDocSchema.parse(draftWith(blocks.hours)) as DraftDoc;
    const pub = toPublishForm(draft, null);
    expect(pub.blocks[0]).toMatchObject({ type: "hours", note: "Closed on public holidays." });
    expect(publishedDocSchema.safeParse(pub).success).toBe(true);
  });

  it("time zone: any short string in a draft; one of the fixed list at Publish", () => {
    expect(HOURS_TIMEZONES).toContain("UTC");
    expect(HOURS_TIMEZONES.length).toBeGreaterThanOrEqual(35);
    expect(new Set(HOURS_TIMEZONES).size).toBe(HOURS_TIMEZONES.length);
    for (const zone of HOURS_TIMEZONES) {
      expect(isHoursTimezone(zone)).toBe(true);
      // Every listed zone is one the runtime knows.
      expect(() => new Intl.DateTimeFormat("en-US", { timeZone: zone })).not.toThrow();
    }
    expect(publishOk(block({ timezone: "Europe/Paris" }))).toBe(true);
    for (const bad of ["EST", "Mars/Olympus", "", "america/new_york"]) {
      expect(isHoursTimezone(bad)).toBe(false);
      expect(publishOk(block({ timezone: bad })), bad).toBe(false);
      expect(draftOk(block({ timezone: bad })), bad).toBe(bad.length <= 64);
    }
  });

  it("ranges: HH:MM, at most two a day, open differs from close, close may be earlier", () => {
    const one = (open: string, close: string) =>
      block({ days: days({ mon: { closed: false, ranges: [{ open, close }] } }) });
    expect(publishOk(one("22:00", "02:00"))).toBe(true);
    expect(publishOk(one("00:00", "23:59"))).toBe(true);
    expect(publishOk(one("09:00", "09:00"))).toBe(false);
    for (const bad of ["9:00", "24:00", "09:60", "0900", "09:00:00", ""]) {
      expect(publishOk(one(bad, "17:00")), bad).toBe(false);
      expect(publishOk(one("09:00", bad)), bad).toBe(false);
    }
    // A draft keeps half-typed times.
    expect(draftOk(one("9", "17:00"))).toBe(true);
    const two = [
      { open: "09:00", close: "12:00" },
      { open: "13:00", close: "17:00" },
    ];
    expect(publishOk(block({ days: days({ mon: { closed: false, ranges: two } }) }))).toBe(true);
    const three = [...two, { open: "18:00", close: "20:00" }];
    expect(LIMITS.hoursRanges).toBe(2);
    expect(draftOk(block({ days: days({ mon: { closed: false, ranges: three } }) }))).toBe(false);
    expect(publishOk(block({ days: days({ mon: { closed: false, ranges: three } }) }))).toBe(false);
  });

  it("an open day needs a range at Publish; a closed day's ranges are not published", () => {
    expect(publishOk(block({ days: days({ mon: { closed: false, ranges: [] } }) }))).toBe(false);
    expect(draftOk(block({ days: days({ mon: { closed: false, ranges: [] } }) }))).toBe(true);
    const draft = draftDocSchema.parse(
      draftWith(
        block({
          days: days({ mon: { closed: true, ranges: [{ open: "09:00", close: "10:00" }] } }),
        }),
      ),
    ) as DraftDoc;
    const out = toPublishForm(draft, null).blocks[0] as unknown as HoursBlock;
    expect(out.days.mon).toEqual({ closed: true, ranges: [] });
  });

  it("needs all seven days", () => {
    const partial = { ...days() } as Record<string, unknown>;
    delete partial.sun;
    expect(draftOk(block({ days: partial }))).toBe(false);
  });

  it("note: up to 140 characters, optional", () => {
    expect(publishOk(block({ note: "n".repeat(140) }))).toBe(true);
    expect(publishOk(block({ note: "n".repeat(141) }))).toBe(false);
    expect(draftOk(block({ note: "n".repeat(141) }))).toBe(false);
    const draft = draftDocSchema.parse(draftWith(block({ note: "   " }))) as DraftDoc;
    expect(toPublishForm(draft, null).blocks[0]).not.toHaveProperty("note");
  });

  it("its own id is unique in the document", () => {
    const dup = draftWith(block(), block());
    expect(draftDocSchema.safeParse(dup).success).toBe(false);
  });
});

// 2026-01-05 is a Monday, 2026-01-06 a Tuesday. January: New York is UTC-5, Tokyo UTC+9.
const at = (iso: string) => new Date(iso);
const nightShift = {
  timezone: "UTC",
  days: days({ mon: { closed: false, ranges: [{ open: "22:00", close: "02:00" }] } }),
};

describe("M12-02 hoursStatusAt", () => {
  it("a Monday 22:00-02:00 range keeps the place open on Tuesday 01:00", () => {
    expect(hoursStatusAt(nightShift, at("2026-01-05T21:59:00Z")).open).toBe(false);
    expect(hoursStatusAt(nightShift, at("2026-01-05T22:00:00Z")).open).toBe(true);
    expect(hoursStatusAt(nightShift, at("2026-01-05T23:30:00Z"))).toMatchObject({
      open: true,
      todayKey: "mon",
    });
    const tuesday = hoursStatusAt(nightShift, at("2026-01-06T01:00:00Z"));
    expect(tuesday).toMatchObject({ open: true, todayKey: "tue", nextChange: "tue 02:00" });
    expect(hoursStatusAt(nightShift, at("2026-01-06T02:00:00Z")).open).toBe(false);
  });

  it("an overnight range on Sunday wraps to Monday", () => {
    const b = {
      timezone: "UTC",
      days: days({ sun: { closed: false, ranges: [{ open: "23:00", close: "03:00" }] } }),
    };
    expect(hoursStatusAt(b, at("2026-01-05T01:00:00Z"))).toMatchObject({
      open: true,
      todayKey: "mon",
    });
    expect(hoursStatusAt(b, at("2026-01-05T03:00:00Z")).open).toBe(false);
  });

  it("a closed day gets no overnight carry from a closed yesterday, and an open day with no ranges is closed", () => {
    const b = { timezone: "UTC", days: days({ mon: { closed: false, ranges: [] } }) };
    expect(hoursStatusAt(b, at("2026-01-05T12:00:00Z"))).toEqual({ open: false, todayKey: "mon" });
  });

  it("ordinary ranges: open at the start, closed at the end, two ranges a day", () => {
    const b = {
      timezone: "UTC",
      days: days({
        mon: {
          closed: false,
          ranges: [
            { open: "09:00", close: "12:00" },
            { open: "13:00", close: "17:00" },
          ],
        },
      }),
    };
    const s = (t: string) => hoursStatusAt(b, at(`2026-01-05T${t}:00Z`));
    expect(s("08:59").open).toBe(false);
    expect(s("09:00")).toMatchObject({ open: true, nextChange: "mon 12:00" });
    expect(s("12:30")).toMatchObject({ open: false, nextChange: "mon 13:00" });
    expect(s("16:59").open).toBe(true);
    expect(s("17:00")).toMatchObject({ open: false, nextChange: "mon 09:00" });
  });

  it("evaluates in the block's time zone, whose date differs from UTC", () => {
    // Monday 09:00-17:00 in New York.
    const ny = {
      timezone: "America/New_York",
      days: days({ mon: { closed: false, ranges: [{ open: "09:00", close: "17:00" }] } }),
    };
    // Monday 14:00Z is 09:00 in New York: open.
    expect(hoursStatusAt(ny, at("2026-01-05T14:00:00Z"))).toMatchObject({
      open: true,
      todayKey: "mon",
    });
    // Tuesday 02:00Z is still Monday 21:00 in New York: today is mon, and closed.
    expect(hoursStatusAt(ny, at("2026-01-06T02:00:00Z"))).toMatchObject({
      open: false,
      todayKey: "mon",
    });
    // Monday 03:00Z is Sunday 22:00 in New York.
    expect(hoursStatusAt(ny, at("2026-01-05T03:00:00Z"))).toMatchObject({
      open: false,
      todayKey: "sun",
    });
    // Tokyo is ahead: Sunday 20:00Z is Monday 05:00 there, Sunday 22:00Z is Monday 07:00.
    const tokyo = {
      timezone: "Asia/Tokyo",
      days: days({ mon: { closed: false, ranges: [{ open: "06:00", close: "10:00" }] } }),
    };
    expect(hoursStatusAt(tokyo, at("2026-01-04T20:00:00Z"))).toMatchObject({
      open: false,
      todayKey: "mon",
    });
    expect(hoursStatusAt(tokyo, at("2026-01-04T22:00:00Z"))).toMatchObject({
      open: true,
      todayKey: "mon",
    });
  });

  it("an overnight range crosses midnight in the block's zone, not in UTC", () => {
    const ny = {
      timezone: "America/New_York",
      days: days({ mon: { closed: false, ranges: [{ open: "22:00", close: "02:00" }] } }),
    };
    // Tuesday 06:00Z is Tuesday 01:00 in New York: still Monday's shift.
    expect(hoursStatusAt(ny, at("2026-01-06T06:00:00Z"))).toMatchObject({
      open: true,
      todayKey: "tue",
    });
    expect(hoursStatusAt(ny, at("2026-01-06T07:00:00Z")).open).toBe(false);
  });

  it("follows daylight saving: 09:00 New York is 13:00Z in July, 14:00Z in January", () => {
    const ny = {
      timezone: "America/New_York",
      days: days({ wed: { closed: false, ranges: [{ open: "09:00", close: "17:00" }] } }),
    };
    // 2026-07-01 is a Wednesday.
    expect(hoursStatusAt(ny, at("2026-07-01T13:00:00Z")).open).toBe(true);
    expect(hoursStatusAt(ny, at("2026-07-01T12:59:00Z")).open).toBe(false);
  });

  it("never flips: always closed and open all week have no nextChange", () => {
    expect(hoursStatusAt({ timezone: "UTC", days: days() }, at("2026-01-05T12:00:00Z"))).toEqual({
      open: false,
      todayKey: "mon",
    });
    const all = Object.fromEntries(
      DAY_KEYS.map((k) => [k, { closed: false, ranges: [{ open: "00:00", close: "23:59" }] }]),
    );
    // 23:59 to 00:00 is a gap of one minute, so a nextChange exists; a fully open week is two ranges.
    const full = Object.fromEntries(
      DAY_KEYS.map((k) => [
        k,
        {
          closed: false,
          ranges: [
            { open: "00:00", close: "12:00" },
            { open: "12:00", close: "00:01" },
          ],
        },
      ]),
    ) as HoursBlock["days"];
    expect(all.mon).toBeDefined();
    expect(
      hoursStatusAt({ timezone: "UTC", days: full }, at("2026-01-05T12:00:00Z")),
    ).toMatchObject({
      open: true,
      todayKey: "mon",
    });
  });

  it("a zone the runtime does not know is read as UTC instead of throwing", () => {
    const b = {
      timezone: "Not/AZone",
      days: days({ mon: { closed: false, ranges: [{ open: "09:00", close: "17:00" }] } }),
    };
    expect(hoursStatusAt(b, at("2026-01-05T10:00:00Z")).open).toBe(true);
  });
});
