import { describe, expect, it } from "vitest";
import {
  formatLocal,
  formatLocalDay,
  localInputToUtc,
  utcToLocalInput,
  windowChipText,
  zoneLabel,
} from "@/lib/schedule/local-time";

/**
 * M20-06: local wall time to UTC and back, pinned to explicit zones (the editor passes the browser's),
 * across both DST changes of Europe/London and America/New_York, and the block row chip's text.
 */

describe("M20-06 local time to UTC and back", () => {
  it.each([
    // zone, local input, UTC
    ["Europe/London", "2026-01-15T09:30", "2026-01-15T09:30:00Z"], // GMT
    ["Europe/London", "2026-07-15T09:30", "2026-07-15T08:30:00Z"], // BST
    ["America/New_York", "2026-01-15T09:30", "2026-01-15T14:30:00Z"], // EST
    ["America/New_York", "2026-07-15T09:30", "2026-07-15T13:30:00Z"], // EDT
    ["Asia/Kolkata", "2026-07-15T09:30", "2026-07-15T04:00:00Z"], // a half-hour zone
  ])("M20-06 %s %s is %s and back", (zone, local, utc) => {
    expect(localInputToUtc(local, zone)).toBe(utc);
    expect(utcToLocalInput(utc, zone)).toBe(local);
  });

  it("M20-06 London spring forward (29 Mar 2026, 01:00 -> 02:00): either side, and a skipped time moves forward", () => {
    expect(localInputToUtc("2026-03-29T00:59", "Europe/London")).toBe("2026-03-29T00:59:00Z");
    expect(localInputToUtc("2026-03-29T02:00", "Europe/London")).toBe("2026-03-29T01:00:00Z");
    // 01:30 never happens: it lands an hour on, and the control then shows 02:30.
    const skipped = localInputToUtc("2026-03-29T01:30", "Europe/London")!;
    expect(skipped).toBe("2026-03-29T01:30:00Z");
    expect(utcToLocalInput(skipped, "Europe/London")).toBe("2026-03-29T02:30");
  });

  it("M20-06 London fall back (25 Oct 2026, 02:00 -> 01:00): the repeated hour is the first one", () => {
    expect(localInputToUtc("2026-10-25T01:30", "Europe/London")).toBe("2026-10-25T00:30:00Z");
    expect(localInputToUtc("2026-10-25T02:30", "Europe/London")).toBe("2026-10-25T02:30:00Z");
    expect(utcToLocalInput("2026-10-25T01:30:00Z", "Europe/London")).toBe("2026-10-25T01:30");
  });

  it("M20-06 New York spring forward (8 Mar 2026) and fall back (1 Nov 2026)", () => {
    expect(localInputToUtc("2026-03-08T01:59", "America/New_York")).toBe("2026-03-08T06:59:00Z");
    expect(localInputToUtc("2026-03-08T03:00", "America/New_York")).toBe("2026-03-08T07:00:00Z");
    expect(localInputToUtc("2026-03-08T02:30", "America/New_York")).toBe("2026-03-08T07:30:00Z");
    expect(localInputToUtc("2026-11-01T01:30", "America/New_York")).toBe("2026-11-01T05:30:00Z");
    expect(localInputToUtc("2026-11-01T02:30", "America/New_York")).toBe("2026-11-01T07:30:00Z");
  });

  it("M20-06 seconds are dropped and malformed values are null", () => {
    expect(localInputToUtc("2026-01-15T09:30:45", "UTC")).toBe("2026-01-15T09:30:00Z");
    expect(localInputToUtc("", "UTC")).toBeNull();
    expect(localInputToUtc("2026-02-30T09:00", "UTC")).toBeNull();
    expect(localInputToUtc("tomorrow", "UTC")).toBeNull();
    expect(utcToLocalInput("not a date", "UTC")).toBe("");
  });

  it("M20-06 the zone line names the zone and its offset", () => {
    expect(zoneLabel(new Date("2026-01-15T12:00:00Z"), "Europe/London")).toBe("Europe/London, GMT+0");
    expect(zoneLabel(new Date("2026-07-15T12:00:00Z"), "Europe/London")).toBe("Europe/London, GMT+1");
    expect(zoneLabel(new Date("2026-01-15T12:00:00Z"), "America/New_York")).toBe("America/New_York, GMT-5");
    expect(zoneLabel(new Date("2026-01-15T12:00:00Z"), "Asia/Kolkata")).toBe("Asia/Kolkata, GMT+5:30");
  });

  it("M20-06 dates read as day and month, with the year only when it is not this year's", () => {
    const now = new Date("2026-11-26T12:00:00Z");
    expect(formatLocal("2026-12-03T09:00:00Z", now, "Europe/London")).toBe("3 Dec, 09:00");
    expect(formatLocalDay("2027-01-03T09:00:00Z", now, "Europe/London")).toBe("3 Jan 2027");
  });
});

describe("M20-06 the block row chip", () => {
  const now = Date.parse("2026-11-26T12:00:00Z");
  const zone = "Europe/London";
  it("M20-06 Starts, Until, Ended, or none", () => {
    expect(windowChipText({ from: "2026-12-03T09:00:00Z" }, now, zone)).toEqual({
      tone: "upcoming",
      text: "Starts 3 Dec, 09:00",
    });
    expect(windowChipText({ until: "2026-12-24T18:00:00Z" }, now, zone)).toEqual({
      tone: "showing",
      text: "Until 24 Dec, 18:00",
    });
    expect(windowChipText({ from: "2026-11-01T00:00:00Z", until: "2026-11-25T10:00:00Z" }, now, zone)).toEqual({
      tone: "ended",
      text: "Ended 25 Nov",
    });
    expect(windowChipText({ from: "2026-11-01T00:00:00Z" }, now, zone)).toBeNull();
    expect(windowChipText(undefined, now, zone)).toBeNull();
  });
});
