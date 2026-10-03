import { describe, expect, it } from "vitest";
import {
  FOCUS_MESSAGE,
  IMAGE_SHAPE_MESSAGE,
  collectPublishErrors,
  draftDocSchema,
  focusOf,
  imageRefSchema,
  objectPositionOf,
  pickShape,
  publishDocSchema,
  publishFormsEqual,
  publishedDocSchema,
  toPublishForm,
  type Block,
  type DraftDoc,
} from "@/lib/document";
import { blocks, fullDraft, photoRef } from "./fixtures/page-document";

/**
 * M6-23: the focus on an image reference, the image block's shape, and what the Publish gate and
 * `toPublishForm` do with them. The security-relevant half (a draft written straight to the
 * database with bad values) is tested in full: the bad values are refused at Publish and never
 * reach the published form.
 */

const REF = { ...blocks.image.image };

function draftOf(...docBlocks: unknown[]): DraftDoc {
  return {
    version: 1,
    rev: 1,
    profile: { name: "Mara Okafor", bio: "", photo: null },
    theme: { ref: null, overrides: {} },
    blocks: docBlocks,
  } as unknown as DraftDoc;
}

const imageBlock = (extra: Record<string, unknown> = {}, ref: Record<string, unknown> = {}) => ({
  ...blocks.image,
  image: { ...REF, ...ref },
  ...extra,
});
const cardBlock = (ref: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => ({
  ...blocks.card,
  image: { ...blocks.card.image, ...ref },
  ...extra,
});

describe("M6-23 the focus on an image reference", () => {
  it("is optional, so every older reference is still valid", () => {
    expect(imageRefSchema.safeParse(REF).success).toBe(true);
    expect(imageRefSchema.parse(REF)).toEqual(REF);
  });

  it.each([
    [0, 0],
    [1, 1],
    [0.5, 0.5],
    [0, 1],
    [0.333, 0.667],
  ])("accepts x=%s y=%s", (x, y) => {
    expect(imageRefSchema.parse({ ...REF, focus: { x, y } }).focus).toEqual({ x, y });
  });

  it.each([
    ["x below 0", { x: -0.001, y: 0.5 }],
    ["x above 1", { x: 1.001, y: 0.5 }],
    ["y below 0", { x: 0.5, y: -1 }],
    ["y above 1", { x: 0.5, y: 5 }],
    ["a string x", { x: "0.5", y: 0.5 }],
    ["a string y", { x: 0.5, y: "a" }],
    ["a null x", { x: null, y: 0.5 }],
    ["a null y", { x: 0.5, y: null }],
    ["NaN", { x: Number.NaN, y: 0.5 }],
    ["Infinity", { x: Number.POSITIVE_INFINITY, y: 0.5 }],
    ["a missing y", { x: 0.5 }],
    ["an empty object", {}],
  ])("rejects %s with the Publish gate's sentence", (_name, focus) => {
    const result = imageRefSchema.safeParse({ ...REF, focus });
    expect(result.success).toBe(false);
    if (!result.success) {
      for (const issue of result.error.issues) expect(issue.message).toBe(FOCUS_MESSAGE);
    }
  });

  it.each([
    ["null", null],
    ["a string", "0.5,0.5"],
    ["a number", 0.5],
    ["an array", [0.5, 0.5]],
    ["true", true],
  ])("rejects a focus that is %s", (_name, focus) => {
    expect(imageRefSchema.safeParse({ ...REF, focus }).success).toBe(false);
  });

  it("strips extra keys inside the focus", () => {
    const parsed = imageRefSchema.parse({ ...REF, focus: { x: 0.2, y: 0.8, z: 1, label: "<b>" } });
    expect(parsed.focus).toEqual({ x: 0.2, y: 0.8 });
  });

  it("strips extra keys next to it", () => {
    expect(imageRefSchema.parse({ ...REF, evil: 1 })).toEqual(REF);
  });
});

describe("M6-23 focus and shape helpers", () => {
  it("focusOf accepts only two numbers from 0 to 1", () => {
    expect(focusOf({ x: 0, y: 1 })).toEqual({ x: 0, y: 1 });
    for (const bad of [
      null,
      undefined,
      "x",
      7,
      [],
      {},
      { x: 2, y: 0 },
      { x: "0", y: 0 },
      { x: Number.NaN, y: 0 },
    ]) {
      expect(focusOf(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it("pickShape returns one of the three words and nothing else", () => {
    for (const shape of ["square", "landscape", "wide"]) expect(pickShape(shape)).toBe(shape);
    for (const bad of ['x"><b>', "Square", "", "original", null, undefined, 4, {}, ["wide"]]) {
      expect(pickShape(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it("objectPositionOf builds the value from the two numbers only, with one decimal", () => {
    expect(objectPositionOf({ x: 0, y: 0.5 })).toEqual({ objectPosition: "0% 50%" });
    expect(objectPositionOf({ x: 1, y: 0.5 })).toEqual({ objectPosition: "100% 50%" });
    expect(objectPositionOf({ x: 0.333, y: 0.667 })).toEqual({ objectPosition: "33.3% 66.7%" });
    expect(objectPositionOf({ x: 0.1234, y: 0.5 })).toEqual({ objectPosition: "12.3% 50%" });
  });

  it("objectPositionOf gives nothing for no focus, the center or an invalid one", () => {
    for (const none of [
      undefined,
      null,
      { x: 0.5, y: 0.5 },
      { x: 0.5004, y: 0.4996 },
      { x: 5, y: 0.5 },
      { x: "50%; background:url(//evil.example/x)", y: 0.5 },
      { x: Number.NaN, y: 0.5 },
    ]) {
      expect(objectPositionOf(none), JSON.stringify(none)).toBeUndefined();
    }
  });

  it("never lets a string from the focus into the value", () => {
    const hostile = { x: "0%; background: url(//evil.example)", y: "y" };
    expect(objectPositionOf(hostile)).toBeUndefined();
    // Even with extra keys on a valid focus, only the two numbers are read.
    expect(objectPositionOf({ x: 0.25, y: 0.75, css: "} body{display:none}" })).toEqual({
      objectPosition: "25% 75%",
    });
  });
});

describe("M6-23 the draft and the Publish gate", () => {
  it("a draft with a focus and a shape parses and keeps them", () => {
    const draft = draftOf(
      imageBlock({ shape: "wide" }, { focus: { x: 0.1, y: 0.9 } }),
      cardBlock({ focus: { x: 0.3, y: 0.7 } }),
    );
    const parsed = draftDocSchema.parse(draft);
    const [image, card] = parsed.blocks;
    expect(image).toMatchObject({ shape: "wide", image: { focus: { x: 0.1, y: 0.9 } } });
    expect(card).toMatchObject({ image: { focus: { x: 0.3, y: 0.7 } } });
    expect(collectPublishErrors(draft)).toEqual([]);
  });

  it("a block without a shape or a focus is valid and gets neither", () => {
    const draft = draftOf(blocks.image, blocks.card);
    expect(collectPublishErrors(draft)).toEqual([]);
    const published = toPublishForm(draftDocSchema.parse(draft), null);
    expect(JSON.stringify(published.blocks)).not.toMatch(/shape|focus/);
  });

  it.each([
    ["unknown word", "triangle"],
    ["markup", 'x"><b>'],
    ["wrong case", "Wide"],
    ["empty", ""],
    ["a number", 42],
    ["null", null],
  ])("a visible image block with a %s shape fails with the shape sentence", (_name, shape) => {
    const draft = draftOf(imageBlock({ shape }));
    expect(publishDocSchema.safeParse(draft).success).toBe(false);
    expect(collectPublishErrors(draft)).toEqual([
      { blockId: blocks.image.id, field: "shape", message: IMAGE_SHAPE_MESSAGE },
    ]);
    expect(IMAGE_SHAPE_MESSAGE).toBe("Pick a shape from the list.");
  });

  it.each([
    ["x and y out of range", { x: 5, y: 5 }],
    ["a string y", { x: 5, y: "a" }],
    ["a null axis, what NaN becomes in JSON", { x: null, y: 0.5 }],
    ["a missing axis", { x: 0.5 }],
    ["a string", "center"],
    ["null", null],
    ["an array", [0.5, 0.5]],
  ])(
    "a visible image block with a focus of %s fails with the focus sentence, once",
    (_n, focus) => {
      const draft = draftOf(imageBlock({ shape: "wide" }, { focus }));
      expect(publishDocSchema.safeParse(draft).success).toBe(false);
      expect(collectPublishErrors(draft)).toEqual([
        { blockId: blocks.image.id, field: "focus", message: FOCUS_MESSAGE },
      ]);
      expect(FOCUS_MESSAGE).toBe("Choose a focus point inside the image.");
    },
  );

  it("a visible card with a bad focus fails with the focus sentence, naming the card", () => {
    const draft = draftOf(cardBlock({ focus: { x: -1, y: 0.5 } }));
    expect(collectPublishErrors(draft)).toEqual([
      { blockId: blocks.card.id, field: "focus", message: FOCUS_MESSAGE },
    ]);
  });

  it("both bad at once: one error for each field, in the same block", () => {
    const draft = draftOf(imageBlock({ shape: "zig" }, { focus: { x: 9, y: 9 } }));
    const errors = collectPublishErrors(draft);
    expect(errors).toHaveLength(2);
    expect(errors.map((e) => e.field).sort()).toEqual(["focus", "shape"]);
    expect(errors.every((e) => e.blockId === blocks.image.id)).toBe(true);
  });

  it("a hidden block with bad values does not block Publish", () => {
    const hiddenImage = imageBlock(
      { visible: false, shape: 'x"><b>' },
      { focus: { x: 5, y: "a" } },
    );
    const hiddenCard = {
      ...cardBlock({ focus: { x: null, y: 0.5 } }),
      visible: false,
      id: "card-hidden-1",
    };
    const draft = draftOf(blocks.link, hiddenImage, hiddenCard);
    expect(collectPublishErrors(draft)).toEqual([]);
    const published = toPublishForm(draftDocSchema.parse(draft), null);
    // Hidden blocks are dropped, bad values and all.
    expect(published.blocks.map((b) => b.id)).toEqual([blocks.link.id]);
  });

  it("the live page never receives a bad value: publishedDocSchema refuses it too", () => {
    const form = toPublishForm(
      draftDocSchema.parse(draftOf(imageBlock({ shape: "wide" }, { focus: { x: 0.2, y: 0.8 } }))),
      null,
    );
    expect(publishedDocSchema.safeParse(form).success).toBe(true);
    const tampered = JSON.parse(JSON.stringify(form));
    tampered.blocks[0].shape = 'x"><b>';
    expect(publishedDocSchema.safeParse(tampered).success).toBe(false);
    const tamperedFocus = JSON.parse(JSON.stringify(form));
    tamperedFocus.blocks[0].image.focus = { x: 5, y: 0.5 };
    expect(publishedDocSchema.safeParse(tamperedFocus).success).toBe(false);
  });

  it("a bad focus on the profile photo fails the draft (it is the strict reference)", () => {
    const draft = {
      ...draftOf(),
      profile: { name: "Mara", bio: "", photo: { ...photoRef, focus: { x: 3, y: 3 } } },
    };
    expect(draftDocSchema.safeParse(draft).success).toBe(false);
  });
});

describe("M6-23 toPublishForm", () => {
  const form = (...docBlocks: unknown[]) =>
    toPublishForm(draftDocSchema.parse(draftOf(...docBlocks)), null);

  it("rounds a focus to 3 decimals", () => {
    const published = form(
      imageBlock({ shape: "square" }, { focus: { x: 0.123456, y: 0.987654 } }),
      cardBlock({ focus: { x: 0.33333333, y: 0.66666666 } }),
    );
    expect(published.blocks[0]).toMatchObject({ image: { focus: { x: 0.123, y: 0.988 } } });
    expect(published.blocks[1]).toMatchObject({ image: { focus: { x: 0.333, y: 0.667 } } });
  });

  it("omits a focus of exactly 0.5 and 0.5, so equal drafts stay deep-equal", () => {
    const centered = form(imageBlock({ shape: "wide" }, { focus: { x: 0.5, y: 0.5 } }));
    const plain = form(imageBlock({ shape: "wide" }));
    expect(JSON.stringify(centered)).not.toContain("focus");
    expect(publishFormsEqual(centered, plain)).toBe(true);
    expect(centered).toEqual(plain);
    // A focus that rounds to the center is the center.
    const nearly = form(imageBlock({ shape: "wide" }, { focus: { x: 0.5004, y: 0.4996 } }));
    expect(centered).toEqual(nearly);
  });

  it("keeps a focus that is not the center when only one axis moved", () => {
    const published = form(cardBlock({ focus: { x: 0.5, y: 0.2 } }));
    expect(published.blocks[0]).toMatchObject({ image: { focus: { x: 0.5, y: 0.2 } } });
  });

  it("changing only the focus changes the published form (so the chip says Unpublished changes)", () => {
    const a = form(imageBlock({ shape: "wide" }, { focus: { x: 0.2, y: 0.5 } }));
    const b = form(imageBlock({ shape: "wide" }, { focus: { x: 0.8, y: 0.5 } }));
    const none = form(imageBlock({ shape: "wide" }));
    expect(publishFormsEqual(a, b)).toBe(false);
    expect(publishFormsEqual(a, none)).toBe(false);
  });

  it("changing only the shape changes the published form; Original leaves no key", () => {
    const wide = form(imageBlock({ shape: "wide" }));
    const square = form(imageBlock({ shape: "square" }));
    const original = form(imageBlock());
    expect(publishFormsEqual(wide, square)).toBe(false);
    expect(publishFormsEqual(wide, original)).toBe(false);
    expect(wide.blocks[0]).toMatchObject({ shape: "wide" });
    expect("shape" in original.blocks[0]!).toBe(false);
  });

  it("drops the focus from the profile photo", () => {
    const draft = {
      ...fullDraft,
      profile: { ...fullDraft.profile, photo: { ...photoRef, focus: { x: 0.1, y: 0.9 } } },
    };
    const published = toPublishForm(draft, null);
    expect(published.profile.photo).toEqual(photoRef);
    expect(JSON.stringify(published.profile)).not.toContain("focus");
  });

  it("drops the focus from a link's thumbnail too (a square crop already)", () => {
    const published = form({
      ...blocks.link,
      icon: { type: "image", image: { ...REF, focus: { x: 0.1, y: 0.9 } } },
    });
    const link = published.blocks[0] as {
      icon?: { type: string; image: Record<string, unknown> };
    };
    expect(link.icon?.type).toBe("image");
    expect(link.icon?.image).toEqual(REF);
    expect(JSON.stringify(published.blocks[0])).not.toContain("focus");
  });

  it("copies only path, width, height and focus: no other key of the reference", () => {
    const published = form(
      cardBlock({ focus: { x: 0.1, y: 0.2 }, evil: "<script>" } as Record<string, unknown>),
    );
    const card = published.blocks[0] as Extract<Block, { type: "card" }>;
    expect(Object.keys(card.image!).sort()).toEqual(["focus", "height", "path", "width"]);
    expect(Object.keys(card.image!.focus!).sort()).toEqual(["x", "y"]);
  });

  it("never publishes a value the gate would refuse (a bad shape and focus are dropped)", () => {
    // `toPublishForm` is total and never validates: the gate runs first. Given a bad value anyway,
    // nothing reaches the form.
    const bad = {
      ...draftDocSchema.parse(
        draftOf(imageBlock({ shape: 'x"><b>' }, { focus: { x: 5, y: "a" } })),
      ),
    };
    const published = toPublishForm(bad, null);
    expect(published.blocks[0]).not.toHaveProperty("shape");
    expect((published.blocks[0] as { image: { focus?: unknown } }).image.focus).toBeUndefined();
  });

  it("the published form of a shaped, focused image passes the stored-document schema", () => {
    const published = form(
      imageBlock({ shape: "landscape" }, { focus: { x: 0.25, y: 0.75 } }),
      cardBlock({ focus: { x: 1, y: 0 } }),
    );
    expect(publishedDocSchema.safeParse(published).success).toBe(true);
  });
});
