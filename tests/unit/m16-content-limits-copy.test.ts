import { describe, expect, it } from "vitest";
import { TERMS_PER_TYPE } from "@/lib/blog/types";
import {
  TERM_LIMIT_MESSAGE,
  formatPostsLimit,
  postLimitMessage,
  postsUsageText,
} from "@/lib/limits/messages";
import { buildPostsMeter } from "@/lib/limits/meters";
import { PLAN_LIMITS } from "@/lib/limits/table";

/** M16-12, M16-14: the words and the meter of the posts limit (HL010) and the term cap (HL015), from the one table. */
describe("posts limit and term cap copy", () => {
  it("the limit per plan is read from the table; Studio reads Unlimited", () => {
    expect(PLAN_LIMITS.free.entriesPerType).toBe(25);
    expect(formatPostsLimit("free")).toBe("25");
    expect(formatPostsLimit("pro")).toBe("1,000");
    expect(formatPostsLimit("studio")).toBe("Unlimited");
  });

  it("the header line", () => {
    expect(postsUsageText("free", 3)).toBe("3 of 25 posts");
    expect(postsUsageText("pro", 1000)).toBe("1,000 of 1,000 posts");
    expect(postsUsageText("studio", 1)).toBe("1 post · Unlimited");
    expect(postsUsageText("studio", 1234)).toBe("1,234 posts · Unlimited");
  });

  it("why a new post is refused, by plan", () => {
    expect(postLimitMessage("free")).toBe(
      "Free includes 25 posts, the trash included. Pro includes 1,000.",
    );
    expect(postLimitMessage("pro")).toBe(
      "You’ve used 1,000 of 1,000 posts, the trash included. Studio includes unlimited posts.",
    );
    expect(postLimitMessage("studio")).toBe(
      "You’ve used 100,000 of 100,000 posts, the trash included.",
    );
    // After a downgrade the count can be past the limit.
    expect(postLimitMessage("pro", 1200)).toContain("1,200 of 1,000");
  });

  it("the term cap message names the cap", () => {
    expect(TERM_LIMIT_MESSAGE).toBe(
      `A blog holds up to ${TERMS_PER_TYPE} categories and tags. Delete one to add another.`,
    );
  });

  it("the posts meter: at the limit, over it after a downgrade, and dashed on Studio", () => {
    expect(buildPostsMeter("free", 5)).toEqual({
      used: 5,
      limit: 25,
      text: "5 of 25 posts",
      percent: 20,
      dashed: false,
      atLimit: false,
      over: false,
    });
    expect(buildPostsMeter("free", 25)).toMatchObject({ percent: 100, atLimit: true, over: false });
    expect(buildPostsMeter("free", 40)).toMatchObject({ percent: 100, atLimit: true, over: true });
    expect(buildPostsMeter("studio", 40)).toMatchObject({
      limit: 100000,
      text: "40 posts · Unlimited",
      percent: 0,
      dashed: true,
      atLimit: false,
    });
    expect(buildPostsMeter("studio", 100000)).toMatchObject({ atLimit: true });
    expect(buildPostsMeter("free", -1)).toMatchObject({ used: 0, percent: 0 });
  });
});
