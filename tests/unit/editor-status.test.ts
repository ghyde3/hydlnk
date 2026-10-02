import { describe, expect, it } from "vitest";
import { toPublishForm, type DraftDoc } from "@/lib/document";
import { computePublishStatus } from "@/lib/editor/status";
import { blocks, fullDraft, noirTokens } from "./fixtures/page-document";

/**
 * M2-27: the status chip is computed from data: the draft's publish form (visible blocks, resolved
 * tokens, rev ignored) deep-compared with `pages.published`.
 */

const published = toPublishForm(fullDraft, noirTokens);
const status = (
  draft: DraftDoc,
  opts: { has?: boolean; published?: typeof published | null; theme?: typeof noirTokens } = {},
) =>
  computePublishStatus({
    hasPublished: opts.has ?? true,
    published: opts.published === undefined ? published : opts.published,
    form: toPublishForm(draft, opts.theme ?? noirTokens),
  });

describe("computePublishStatus", () => {
  it("a page never published is 'not-published'", () => {
    expect(status(fullDraft, { has: false, published: null })).toBe("not-published");
  });

  it("a draft equal to published is 'published', whatever the rev", () => {
    expect(status(fullDraft)).toBe("published");
    expect(status({ ...fullDraft, rev: 99 })).toBe("published");
  });

  it("editing the bio flips it, and typing the original bio back flips it back", () => {
    const edited = { ...fullDraft, profile: { ...fullDraft.profile, bio: "new bio" } };
    expect(status(edited)).toBe("unpublished-changes");
    expect(status({ ...edited, profile: { ...edited.profile, bio: fullDraft.profile.bio } })).toBe(
      "published",
    );
  });

  it("whitespace the schemas trim is not a change", () => {
    const padded = {
      ...fullDraft,
      profile: { ...fullDraft.profile, bio: `  ${fullDraft.profile.bio} ` },
    };
    expect(status(padded)).toBe("published");
  });

  it("reordering and toggling visibility change it", () => {
    const [first, second, ...rest] = fullDraft.blocks;
    expect(status({ ...fullDraft, blocks: [second!, first!, ...rest] })).toBe(
      "unpublished-changes",
    );
    const toggled = fullDraft.blocks.map((b) =>
      b.id === blocks.header.id ? { ...b, visible: false } : b,
    );
    expect(status({ ...fullDraft, blocks: toggled as DraftDoc["blocks"] })).toBe(
      "unpublished-changes",
    );
  });

  it("editing a block hidden in both draft and published does not change it", () => {
    const hiddenId = "header-hidden-1";
    const edited = fullDraft.blocks.map((b) =>
      b.id === hiddenId && b.type === "header" ? { ...b, text: "Edited while hidden" } : b,
    );
    expect(status({ ...fullDraft, blocks: edited })).toBe("published");
  });

  it("a change to the theme row flips it with no draft edit", () => {
    expect(status(fullDraft, { theme: { ...noirTokens, bg: "#000000" } })).toBe(
      "unpublished-changes",
    );
  });

  it("a published copy that cannot be read cannot match", () => {
    expect(status(fullDraft, { published: null })).toBe("unpublished-changes");
  });
});
