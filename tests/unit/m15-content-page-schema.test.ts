import { describe, expect, it } from "vitest";
import {
  BLOCK_TYPES,
  blockDefaults,
  draftDocSchema,
  emptyDraft,
  publishDocSchema,
  toPublishForm,
  type Block,
  type DraftDoc,
} from "@/lib/document";
import {
  draftSubPageSchema,
  emptySubPageDraft,
  publishSubPageSchema,
} from "@/lib/document/sub-page";
import {
  designDraftSchema,
  designPublishSchema,
  homeEntryDraftSchema,
  homeEntryPublishSchema,
  pageDraftSchema,
  pagePublishSchema,
  toHomeEntryPublishForm,
} from "@/lib/content/schemas/page";
import { schemaForType } from "@/lib/content/schemas";
import { noirTokens } from "./fixtures/page-document";

/** A small seeded generator so the 50 drafts are the same on every run. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function homeDraft(seed: number): DraftDoc {
  const next = rng(seed);
  const blocks: Block[] = [];
  const count = Math.floor(next() * 12);
  for (let i = 0; i < count; i += 1) {
    const type = BLOCK_TYPES[Math.floor(next() * BLOCK_TYPES.length)]!;
    const block = blockDefaults[type]();
    blocks.push({ ...block, visible: next() > 0.3 } as Block);
  }
  return { ...emptyDraft("mara"), blocks };
}

const home = (blocks: Block[] = []) => ({ path: "/", title: "", description: "", blocks });

describe("sub-page schemas, re-exported for page entries", () => {
  it("a seed sub-page draft parses", () => {
    const draft = emptySubPageDraft("about");
    expect(draftSubPageSchema.safeParse(draft).success).toBe(true);
    expect(pageDraftSchema.safeParse(draft).success).toBe(true);
    expect(schemaForType("page", "draft")!.safeParse(draft).success).toBe(true);
  });

  it("'/' publishes only through the Home schemas", () => {
    expect(publishSubPageSchema.safeParse(home()).success).toBe(false);
    expect(pagePublishSchema.safeParse(home()).success).toBe(true);
    expect(homeEntryPublishSchema.safeParse(home()).success).toBe(true);
    expect(schemaForType("page", "publish")!.safeParse(home()).success).toBe(true);
    // A sub-page still needs a title and a real path.
    expect(pagePublishSchema.safeParse(emptySubPageDraft("about", "")).success).toBe(false);
    expect(pagePublishSchema.safeParse(emptySubPageDraft("about")).success).toBe(true);
    expect(pagePublishSchema.safeParse(emptySubPageDraft("/x")).success).toBe(false);
  });

  it("the Home schemas take only the path '/'", () => {
    for (const path of ["about", "", "/x", " / "]) {
      expect(homeEntryDraftSchema.safeParse({ ...home(), path }).success, path).toBe(false);
      expect(homeEntryPublishSchema.safeParse({ ...home(), path }).success, path).toBe(false);
    }
    expect(homeEntryDraftSchema.safeParse(home()).success).toBe(true);
  });

  it("Home keeps the block limit, unique ids and the featured-link rule", () => {
    const link = (n: number, featured: boolean): Block =>
      ({
        id: `block-${String(n).padStart(4, "0")}`,
        type: "link",
        visible: true,
        label: "x",
        url: "https://example.com",
        ...(featured ? { featured: "bold" } : {}),
      }) as Block;
    const four = [1, 2, 3, 4].map((n) => link(n, true));
    const result = homeEntryPublishSchema.safeParse(home(four));
    expect(result.success).toBe(false);
    expect(result.error!.issues.map((i) => i.path.join("."))).toContain("blocks.3.featured");
    expect(homeEntryDraftSchema.safeParse(home(four)).success).toBe(true);

    const dup = [link(1, false), link(1, false)];
    expect(homeEntryDraftSchema.safeParse(home(dup)).success).toBe(false);

    const many = Array.from({ length: 200 }, (_, n) => link(n, false));
    expect(homeEntryDraftSchema.safeParse(home(many)).success).toBe(false);

    // A visible, empty link is incomplete at publish; hidden ones are dropped.
    const incomplete = { ...link(1, false), url: "" } as Block;
    expect(homeEntryPublishSchema.safeParse(home([incomplete])).success).toBe(false);
    expect(
      homeEntryPublishSchema.safeParse(home([{ ...incomplete, visible: false } as Block])).success,
    ).toBe(true);
    // An unsafe URL scheme is refused at publish.
    const bad = { ...link(1, false), url: "javascript:alert(1)" } as Block;
    expect(homeEntryPublishSchema.safeParse(home([bad])).success).toBe(false);
  });
});

describe("toHomeEntryPublishForm", () => {
  it("deep-equals toPublishForm(...).blocks for 50 generated Home drafts", () => {
    for (let seed = 1; seed <= 50; seed += 1) {
      const draft = homeDraft(seed);
      expect(toHomeEntryPublishForm(draft.blocks), `seed ${seed}`).toEqual(
        toPublishForm(draft, noirTokens).blocks,
      );
    }
  });
});

describe("design schemas", () => {
  it("designDraftSchema drops a blocks key and keeps every design key", () => {
    const draft = {
      ...emptyDraft("mara"),
      share: { title: "T", description: "D", image: null },
      utm: { source: "a" },
      nav: { show: true, items: [] },
      blocks: [blockDefaults.link()],
    };
    const full = draftDocSchema.parse(draft);
    const parsed = designDraftSchema.parse(draft);
    expect("blocks" in parsed).toBe(false);
    const { blocks, ...rest } = full;
    void blocks;
    expect(parsed).toEqual(rest);
    expect(designDraftSchema.safeParse({ ...draft, version: 2 }).success).toBe(false);
  });

  it("designPublishSchema checks the design with the same issues as the whole document", () => {
    const draft = { ...emptyDraft("mara"), blocks: [] };
    expect(designPublishSchema.safeParse(draft).success).toBe(
      publishDocSchema.safeParse(draft).success,
    );
    const noName = { ...draft, profile: { ...draft.profile, name: "" } };
    const a = designPublishSchema.safeParse(noName);
    const b = publishDocSchema.safeParse(noName);
    expect(a.success).toBe(false);
    expect(a.error!.issues.map((i) => i.path.join("."))).toEqual(
      b.error!.issues.map((i) => i.path.join(".")),
    );
    // Blocks are not its business: an incomplete block does not fail it, and the key is dropped.
    const withBlock = { ...draft, blocks: [blockDefaults.link()] };
    const parsed = designPublishSchema.safeParse(withBlock);
    expect(parsed.success).toBe(true);
    expect("blocks" in parsed.data!).toBe(false);
  });
});
