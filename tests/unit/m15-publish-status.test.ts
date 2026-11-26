import { describe, expect, it } from "vitest";
import { toPublishForm, type DraftDoc } from "@/lib/document";
import { ITEM_STATE_LABEL, splitPublishState } from "@/lib/publish/status";
import { blocks, fullDraft, noirTokens } from "./fixtures/page-document";

/**
 * M15-10: the design (the publish form without `blocks`) and Home (its `blocks`) each have their
 * own state, computed from data like the site's one status chip (M2-27).
 */

const published = toPublishForm(fullDraft, noirTokens);
const split = (
  draft: DraftDoc,
  opts: { has?: boolean; published?: typeof published | null; theme?: typeof noirTokens } = {},
) =>
  splitPublishState({
    hasPublished: opts.has ?? true,
    published: opts.published === undefined ? published : opts.published,
    form: toPublishForm(draft, opts.theme ?? noirTokens),
  });

describe("splitPublishState", () => {
  it("the labels are the one vocabulary", () => {
    expect(ITEM_STATE_LABEL).toEqual({
      live: "Live",
      changed: "Unpublished changes",
      draft: "Draft",
    });
  });

  it("a site never published is draft on both halves, whatever is stored", () => {
    expect(split(fullDraft, { has: false, published: null })).toEqual({
      design: "draft",
      home: "draft",
    });
    expect(split(fullDraft, { has: false })).toEqual({ design: "draft", home: "draft" });
  });

  it("a published copy that cannot be read is changed on both halves", () => {
    expect(split(fullDraft, { published: null })).toEqual({ design: "changed", home: "changed" });
  });

  it("a draft equal to the live copy is live on both halves, whatever the rev", () => {
    expect(split(fullDraft)).toEqual({ design: "live", home: "live" });
    expect(split({ ...fullDraft, rev: 99 })).toEqual({ design: "live", home: "live" });
  });

  it("a profile edit changes the design only, and typing it back makes it live again", () => {
    const edited = { ...fullDraft, profile: { ...fullDraft.profile, bio: "new bio" } };
    expect(split(edited)).toEqual({ design: "changed", home: "live" });
    expect(
      split({ ...edited, profile: { ...edited.profile, bio: fullDraft.profile.bio } }),
    ).toEqual({ design: "live", home: "live" });
  });

  it("a theme token change changes the design only", () => {
    const form = toPublishForm(fullDraft, noirTokens);
    const recolored = { ...form, tokens: { ...form.tokens, bg: "#123456" } };
    expect(
      splitPublishState({ hasPublished: true, published, form: recolored as typeof form }),
    ).toEqual({ design: "changed", home: "live" });
  });

  it("a block edit, a reorder and a visibility toggle change Home only", () => {
    const [first, second, ...rest] = fullDraft.blocks;
    expect(split({ ...fullDraft, blocks: [second!, first!, ...rest] })).toEqual({
      design: "live",
      home: "changed",
    });
    const toggled = fullDraft.blocks.map((b) =>
      b.id === blocks.header.id ? { ...b, visible: false } : b,
    );
    expect(split({ ...fullDraft, blocks: toggled as DraftDoc["blocks"] })).toEqual({
      design: "live",
      home: "changed",
    });
  });

  it("both halves can be changed at once", () => {
    const [first, ...rest] = fullDraft.blocks;
    expect(
      split({
        ...fullDraft,
        profile: { ...fullDraft.profile, bio: "new bio" },
        blocks: [...rest, first!],
      }),
    ).toEqual({ design: "changed", home: "changed" });
  });

  it("key order in the stored copy is not a change (jsonb does not keep it)", () => {
    const reordered = Object.fromEntries(Object.entries(published).reverse()) as typeof published;
    expect(split(fullDraft, { published: reordered })).toEqual({ design: "live", home: "live" });
  });
});
