import { describe, expect, it } from "vitest";
import {
  LIMITS,
  blockSchema,
  blocksAt,
  collectPublishErrors,
  effectiveNow,
  featuredOverLimit,
  isEligibleRedirectLink,
  isLiveAt,
  previewBlocks,
  publishBlockSchema,
  publishWindow,
  redirectTargetIssue,
  scheduleInstant,
  toPublishForm,
  windowState,
  type Block,
  type DraftDoc,
} from "@/lib/document";
import { toSubPagePublishForm } from "@/lib/document/sub-page";
import { REDIRECT_SCHEDULED_MESSAGE, SCHEDULE_MESSAGES } from "@/lib/document";
import { draftOf } from "./publish-support";

/**
 * M20-02: a block's time window in the draft and publish schemas, the publish form, the redirect
 * rule and the featured count; plus the pure decisions every reader shares (`isLiveAt`, `blocksAt`,
 * `previewBlocks`, `effectiveNow`, `windowState`), including hostile stored values.
 */

const link = (over: Partial<Block> & Record<string, unknown> = {}): Block =>
  ({
    id: "lnk-window01",
    type: "link",
    visible: true,
    label: "Tickets",
    url: "https://tickets.example/",
    ...over,
  }) as Block;

const FROM = "2026-12-03T09:00:00Z";
const UNTIL = "2026-12-24T18:00:00Z";

describe("M20-02 the schedule field in the draft and publish schemas", () => {
  it("M20-02 every block type accepts an optional schedule in both forms", () => {
    const types = (blockSchema.options as Array<{ shape: { type: { value: string } } }>).map(
      (option) => option.shape.type.value,
    );
    expect(types.length).toBeGreaterThanOrEqual(19);
    for (const option of blockSchema.options as Array<{ shape: Record<string, unknown> }>) {
      expect(option.shape, "draft").toHaveProperty("schedule");
    }
    for (const option of publishBlockSchema.options as Array<{ shape: Record<string, unknown> }>) {
      expect(option.shape, "publish").toHaveProperty("schedule");
    }
  });

  it("M20-02 a draft keeps any short string in either time; 41 characters and a non-string are refused", () => {
    expect(blockSchema.safeParse(link({ schedule: { from: "half typed" } })).success).toBe(true);
    expect(blockSchema.safeParse(link({ schedule: { until: "x".repeat(40) } })).success).toBe(true);
    expect(blockSchema.safeParse(link({ schedule: { until: "x".repeat(41) } })).success).toBe(
      false,
    );
    expect(blockSchema.safeParse(link({ schedule: { from: 5 } as never })).success).toBe(false);
    expect(blockSchema.safeParse(link({ schedule: "soon" as never })).success).toBe(false);
  });

  it("M20-02 Publish accepts canonical UTC minutes with from before until", () => {
    expect(
      publishBlockSchema.safeParse(link({ schedule: { from: FROM, until: UNTIL } })).success,
    ).toBe(true);
    expect(publishBlockSchema.safeParse(link({ schedule: { from: FROM } })).success).toBe(true);
    expect(publishBlockSchema.safeParse(link({ schedule: { until: UNTIL } })).success).toBe(true);
    expect(publishBlockSchema.safeParse(link({ schedule: {} })).success).toBe(true);
  });

  it.each([
    ["seconds not 00", { from: "2026-12-03T09:00:30Z" }, SCHEDULE_MESSAGES.time],
    ["an offset other than Z", { from: "2026-12-03T09:00:00+01:00" }, SCHEDULE_MESSAGES.time],
    ["milliseconds", { until: "2026-12-03T09:00:00.000Z" }, SCHEDULE_MESSAGES.time],
    ["an impossible day", { from: "2026-02-30T09:00:00Z" }, SCHEDULE_MESSAGES.time],
    ["an impossible month", { from: "2026-13-45T99:00:00Z" }, SCHEDULE_MESSAGES.time],
    // Date.parse and a Postgres cast both read 24:00 as the next midnight; the canonical form does not
    // (entry_next_boundary refuses it too: pgTAP 224).
    [
      "T24:00 (the next day's midnight written as hour 24)",
      { until: "2026-12-03T24:00:00Z" },
      SCHEDULE_MESSAGES.time,
    ],
    ["from equal to until", { from: FROM, until: FROM }, SCHEDULE_MESSAGES.order],
    ["from after until", { from: UNTIL, until: FROM }, SCHEDULE_MESSAGES.order],
  ])("M20-02 Publish refuses %s and names the block", (_label, schedule, message) => {
    const draft: DraftDoc = draftOf("Mara", [link({ schedule })]);
    const errors = collectPublishErrors(draft);
    expect(errors).toEqual([expect.objectContaining({ blockId: "lnk-window01", message })]);
  });
});

describe("M20-02 the publish form", () => {
  it("M20-02 writes schedule only when a time is set, canonical keys in order, and reads no clock", () => {
    const tokens = null;
    const form = toPublishForm(
      draftOf("Mara", [
        link({ schedule: { until: UNTIL, from: FROM } }),
        link({ id: "lnk-nowin-01", schedule: {} }),
        link({ id: "lnk-plain-01" }),
        link({ id: "lnk-ended-01", schedule: { until: "2001-01-01T00:00:00Z" } }),
      ]),
      tokens,
    );
    expect(form.blocks.map((block) => block.schedule)).toEqual([
      { from: FROM, until: UNTIL },
      undefined,
      undefined,
      { until: "2001-01-01T00:00:00Z" },
    ]);
    expect(Object.keys(form.blocks[0]!.schedule!)).toEqual(["from", "until"]);
    expect("schedule" in form.blocks[1]!).toBe(false);
  });

  it("M20-02 a hidden block is dropped whatever its window, on Home and on a sub-page", () => {
    const hidden = link({ visible: false, schedule: { from: FROM } });
    expect(toPublishForm(draftOf("Mara", [hidden]), null).blocks).toEqual([]);
    expect(
      toSubPagePublishForm({ path: "x", title: "X", description: "", blocks: [hidden] }).blocks,
    ).toEqual([]);
    const sub = toSubPagePublishForm({
      path: "x",
      title: "X",
      description: "",
      blocks: [link({ schedule: { from: FROM } })],
    });
    expect(sub.blocks[0]!.schedule).toEqual({ from: FROM });
  });

  it("M20-02 two drafts that differ only in key order publish to equal forms", () => {
    const a = toPublishForm(
      draftOf("Mara", [link({ schedule: { from: FROM, until: UNTIL } })]),
      null,
    );
    const b = toPublishForm(
      draftOf("Mara", [link({ schedule: { until: UNTIL, from: FROM } })]),
      null,
    );
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(publishWindow({ until: UNTIL, from: FROM })).toEqual({
      schedule: { from: FROM, until: UNTIL },
    });
  });

  it("M20-02 a scheduled link is never the redirect target; a scheduled featured link still counts", () => {
    const scheduled = link({ schedule: { until: UNTIL } });
    expect(isEligibleRedirectLink(link())).toBe(true);
    expect(isEligibleRedirectLink(scheduled)).toBe(false);
    expect(redirectTargetIssue([scheduled], "lnk-window01")).toBe(REDIRECT_SCHEDULED_MESSAGE);
    const featured = Array.from({ length: LIMITS.featuredLinks + 1 }, (_, i) =>
      link({ id: `lnk-feat-${i}00`, featured: "bold", schedule: { from: FROM } }),
    );
    expect(featuredOverLimit(featured)).toEqual([LIMITS.featuredLinks]);
  });
});

describe("M20-02 the pure decisions every reader shares", () => {
  const at = (iso: string) => Date.parse(iso);

  it("M20-02 isLiveAt: from <= t < until, open bounds open", () => {
    const block = { schedule: { from: FROM, until: UNTIL } };
    expect(isLiveAt(block, at(FROM) - 1)).toBe(false);
    expect(isLiveAt(block, at(FROM))).toBe(true);
    expect(isLiveAt(block, at(UNTIL) - 1)).toBe(true);
    expect(isLiveAt(block, at(UNTIL))).toBe(false);
    expect(isLiveAt({}, 0)).toBe(true);
    expect(isLiveAt({ schedule: { until: UNTIL } }, 0)).toBe(true);
  });

  it("M20-02 a hostile stored value never throws: an unreadable from hides, an unreadable until is open", () => {
    const now = at(FROM);
    for (const schedule of [
      { from: "2026-13-45T99:00:00Z" },
      { from: 5 },
      { from: ["x"] },
      { from: null },
    ]) {
      expect(isLiveAt({ schedule }, now)).toBe(false);
    }
    for (const schedule of [{ until: "tomorrow" }, { until: 5 }, [1, 2], "x", 7, null]) {
      expect(isLiveAt({ schedule } as { schedule: unknown }, now)).toBe(true);
    }
    expect(scheduleInstant("2026-02-30T09:00:00Z")).toBeNull();
    expect(scheduleInstant({ toString: () => FROM })).toBeNull();
  });

  it("M20-02 blocksAt keeps live blocks, previewBlocks hides only ended ones", () => {
    const blocks = [
      { id: "a", schedule: { from: UNTIL } },
      { id: "b", schedule: { until: FROM } },
      { id: "c" },
    ];
    expect(blocksAt(blocks, at(FROM)).map((b) => b.id)).toEqual(["c"]);
    expect(previewBlocks(blocks, at(FROM)).map((b) => b.id)).toEqual(["a", "c"]);
  });

  it("M20-04 effectiveNow is the later of the server clock and the site's clock", () => {
    expect(effectiveNow(1000, null)).toBe(1000);
    expect(effectiveNow(1000, "garbage")).toBe(1000);
    expect(effectiveNow(at(FROM) - 1000, FROM)).toBe(at(FROM));
    expect(effectiveNow(at(UNTIL), FROM)).toBe(at(UNTIL));
  });

  it("M20-04 the site's clock counts for at most a minute ahead (a clock that ran ahead cannot hold a site in the future)", () => {
    expect(effectiveNow(at(FROM) - 30_000, FROM)).toBe(at(FROM));
    expect(effectiveNow(at(FROM) - 3_600_000, FROM)).toBe(at(FROM) - 3_600_000 + 60_000);
  });

  it("M20-06 windowState for each state", () => {
    expect(windowState(undefined, 0)).toBe("none");
    expect(windowState({ from: FROM }, at(FROM) - 1)).toBe("upcoming");
    expect(windowState({ from: FROM, until: UNTIL }, at(FROM))).toBe("showing");
    expect(windowState({ until: UNTIL }, at(UNTIL))).toBe("ended");
  });
});
