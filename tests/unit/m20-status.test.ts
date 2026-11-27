import { describe, expect, it } from "vitest";
import { POST_FILTERS, POST_STATE_LABEL, postState, withSchedule } from "@/lib/posts/status";
import { LIST_STATUSES } from "@/lib/content/schemas/enums";
import { publishRows, rowChipState, scheduledToCancel } from "@/components/workspace/publish-bar/rows";
import { NO_SCHEDULE, scheduleFailureText } from "@/lib/schedule/types";

/**
 * M20-10: the post state and the publish bar's row state with a pending, a failed and a canceled
 * schedule; the Scheduled filter; the "Didn't publish" reasons.
 */

const pending = { ...NO_SCHEDULE, publishAt: "2026-12-03T09:00:00Z", scheduledRev: 3, snapshotAt: "2026-11-26T10:00:00Z" };
const failed = { ...NO_SCHEDULE, failed: "plan" };
const canceled = NO_SCHEDULE; // a canceled row leaves nothing pending and no failure

describe("M20-10 post states", () => {
  it("M20-10 Scheduled wins over Draft and Unpublished changes; Didn't publish shows until something replaces it", () => {
    expect(postState({ status: "draft", hasUnpublishedChanges: false, schedule: pending })).toBe("scheduled");
    expect(postState({ status: "published", hasUnpublishedChanges: true, schedule: pending })).toBe("scheduled");
    expect(postState({ status: "draft", hasUnpublishedChanges: false, schedule: failed })).toBe("failed");
    expect(postState({ status: "published", hasUnpublishedChanges: false, schedule: failed })).toBe("live");
    expect(postState({ status: "draft", hasUnpublishedChanges: false, schedule: canceled })).toBe("draft");
    expect(postState({ status: "trashed", hasUnpublishedChanges: false, schedule: pending })).toBe("trashed");
    expect(postState({ status: "published", hasUnpublishedChanges: false })).toBe("live");
    expect(withSchedule("changes", null)).toBe("changes");
    expect(POST_STATE_LABEL.scheduled).toBe("Scheduled");
    expect(POST_STATE_LABEL.failed).toBe("Didn’t publish");
  });

  it("M20-10 the Posts status filter offers Scheduled, and the list accepts it", () => {
    expect(POST_FILTERS.map((f) => f.value)).toContain("scheduled");
    expect(LIST_STATUSES).toContain("scheduled");
  });

  it("M20-10 a failed schedule says why", () => {
    expect(scheduleFailureText("missed")).toMatch(/more than a day late/);
    expect(scheduleFailureText("plan")).toMatch(/plan/);
    expect(scheduleFailureText("whatever")).toMatch(/went wrong/);
  });
});

describe("M20-10 the publish bar's rows", () => {
  const items = [
    { id: "home", title: "Home", path: "/", home: true },
    { id: "sub-1", title: "Events", path: "events", home: false },
    { id: "sub-2", title: "Shop", path: "shop", home: false },
  ] as never;

  it("M20-10 a row carries its entry's schedule (Home's under its entry id) and its chip follows it", () => {
    const rows = publishRows({
      items,
      design: "live",
      home: "changed",
      pages: { "sub-1": "draft", "sub-2": "live" },
      schedules: { "home-entry": pending, "sub-1": failed, "sub-2": canceled },
      homeEntryId: "home-entry",
    });
    const byKey = Object.fromEntries(rows.map((row) => [row.key, row]));
    expect(rowChipState(byKey.home!)).toBe("scheduled");
    expect(rowChipState(byKey["sub-1"]!)).toBe("failed");
    expect(rowChipState(byKey["sub-2"]!)).toBe("live");
    expect(rowChipState(byKey.design!)).toBe("live");
    expect(scheduledToCancel(rows)).toBe(1);
  });
});
