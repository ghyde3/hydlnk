import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { type Block, type DraftDoc } from "@/lib/document";
import {
  COALESCE_MS,
  HISTORY_LIMIT,
  REDO_IMAGE_GONE,
  UNDO_IMAGE_GONE,
  blockEditGroup,
  canRedo,
  canUndo,
  checkImagesExist,
  createHistory,
  draftImagePaths,
  imagesNeededBy,
  recordEdit,
  redo,
  undo,
  type History,
} from "@/lib/editor/history";
import { bannerRef, blocks, fullDraft, photoRef } from "./fixtures/page-document";

/** M6-06: the framework-free undo and redo engine. */

const named = (draft: DraftDoc, name: string): DraftDoc => ({
  ...draft,
  profile: { ...draft.profile, name },
});

/** `edits` edits of one distinct value each, never coalesced, 10 ms apart. */
function withEdits(draft: DraftDoc, edits: number): History {
  let history = createHistory(draft);
  for (let i = 1; i <= edits; i++) {
    history = recordEdit(history, named(draft, `Name ${i}`), { at: i * 10 });
  }
  return history;
}

describe("M6-06 history engine: steps", () => {
  it("keeps snapshots by reference and shares every block that did not change", () => {
    const first = createHistory(fullDraft);
    const edited: DraftDoc = { ...fullDraft, profile: { ...fullDraft.profile, bio: "New bio" } };
    const second = recordEdit(first, edited, { at: 0 });
    expect(second.past[0]).toBe(fullDraft);
    expect(second.present).toBe(edited);
    expect(second.present.blocks[0]).toBe(fullDraft.blocks[0]);
    const back = undo(second);
    // A restored draft is a new top-level object (so the autosave rule "a new object" fires), but
    // the blocks inside it are the very same ones.
    expect(back.present).not.toBe(fullDraft);
    expect(back.present.blocks).toBe(fullDraft.blocks);
    expect(back.present).toEqual(fullDraft);
  });

  it("a restored draft takes the rev of the draft on screen, not the stored one", () => {
    const old: DraftDoc = { ...fullDraft, rev: 3 };
    let history = createHistory(old);
    history = recordEdit(history, { ...named(old, "B"), rev: 9 }, { at: 0 });
    const back = undo(history);
    expect(back.present.rev).toBe(9);
    expect(back.present.profile.name).toBe(old.profile.name);
    expect(redo(back).present.rev).toBe(9);
  });

  it("pushing the same draft object twice adds one entry", () => {
    const a = named(fullDraft, "A");
    let history = recordEdit(createHistory(fullDraft), a, { at: 0 });
    const again = recordEdit(history, a, { at: 5 });
    expect(again).toBe(history);
    expect(again.past).toHaveLength(1);
    history = recordEdit(history, named(fullDraft, "B"), { at: 10 });
    expect(history.past).toHaveLength(2);
  });

  it("undo with an empty past and redo with an empty future return the same history object", () => {
    const history = createHistory(fullDraft);
    expect(canUndo(history)).toBe(false);
    expect(canRedo(history)).toBe(false);
    expect(undo(history)).toBe(history);
    expect(redo(history)).toBe(history);
  });

  it("undo moves the present into the future and redo replays the steps in order", () => {
    const history = withEdits(fullDraft, 3);
    expect(history.present.profile.name).toBe("Name 3");
    let h = history;
    const seen: string[] = [];
    while (canUndo(h)) {
      h = undo(h);
      seen.push(h.present.profile.name);
    }
    expect(seen).toEqual(["Name 2", "Name 1", fullDraft.profile.name]);
    const replayed: string[] = [];
    while (canRedo(h)) {
      h = redo(h);
      replayed.push(h.present.profile.name);
    }
    expect(replayed).toEqual(["Name 1", "Name 2", "Name 3"]);
    expect(canRedo(h)).toBe(false);
  });

  it("a new edit clears the redo stack", () => {
    let h = undo(undo(withEdits(fullDraft, 3)));
    expect(h.future).toHaveLength(2);
    h = recordEdit(h, named(fullDraft, "Fresh"), { at: 1000 });
    expect(canRedo(h)).toBe(false);
    expect(h.future).toHaveLength(0);
  });
});

describe("M6-06 history engine: coalescing", () => {
  const typeText = (text: string, group: string, gapMs: number, startAt = 0) => {
    let history = createHistory(fullDraft);
    let at = startAt;
    let value = "";
    for (const char of text) {
      value += char;
      history = recordEdit(history, named(fullDraft, value), { group, at });
      at += gapMs;
    }
    return history;
  };

  it("typing 'Hello world' as 11 keystrokes 100 ms apart is one step", () => {
    const history = typeText("Hello world", "profile/name", 100);
    expect(history.past).toHaveLength(1);
    expect(history.present.profile.name).toBe("Hello world");
    const back = undo(history);
    expect(back.present.profile.name).toBe(fullDraft.profile.name);
    expect(canUndo(back)).toBe(false);
  });

  it("a pause of 1500 ms starts a new step", () => {
    let history = typeText("Hello", "profile/name", 100);
    history = recordEdit(history, named(fullDraft, "Hello world"), {
      group: "profile/name",
      at: 400 + 1500,
    });
    expect(history.past).toHaveLength(2);
    expect(undo(history).present.profile.name).toBe("Hello");
  });

  it("the window is measured from the previous edit of the group, not the first one", () => {
    // 20 keystrokes, 900 ms apart: 18 s in all, still one step.
    const history = typeText("abcdefghijklmnopqrst", "profile/name", 900);
    expect(history.past).toHaveLength(1);
    // Exactly the window apart is a new step ("less than 1000 ms").
    const split = recordEdit(createHistory(fullDraft), named(fullDraft, "a"), {
      group: "g",
      at: 0,
    });
    const next = recordEdit(split, named(fullDraft, "ab"), { group: "g", at: COALESCE_MS });
    expect(next.past).toHaveLength(2);
  });

  it("a different field starts a new step", () => {
    let history = typeText("Hello", "profile/name", 100);
    history = recordEdit(
      history,
      { ...history.present, profile: { ...history.present.profile, bio: "x" } },
      {
        group: "profile/bio",
        at: 500,
      },
    );
    expect(history.past).toHaveLength(2);
  });

  it("an edit without a group never merges, and closes the open group", () => {
    let history = typeText("Hi", "profile/name", 50);
    history = recordEdit(history, named(fullDraft, "Hi!"), { at: 100 });
    history = recordEdit(history, named(fullDraft, "Hi!!"), { at: 120 });
    expect(history.past).toHaveLength(3);
    // The same group again right after an ungrouped edit is a new step too.
    history = recordEdit(history, named(fullDraft, "x"), { group: "profile/name", at: 130 });
    history = recordEdit(history, named(fullDraft, "xy"), { group: "profile/name", at: 140 });
    expect(history.past).toHaveLength(4);
  });

  it("undo and redo close the open group: the next keystroke is a new step", () => {
    let history = typeText("Hello", "profile/name", 100);
    history = undo(history);
    history = recordEdit(history, named(fullDraft, "Hey"), { group: "profile/name", at: 450 });
    expect(history.past).toHaveLength(1);
    expect(history.future).toHaveLength(0);
    history = recordEdit(history, named(fullDraft, "Hey!"), { group: "profile/name", at: 500 });
    // Merged into the step made after the undo, not into the one that was undone.
    expect(history.past).toHaveLength(1);
    expect(undo(history).present.profile.name).toBe(fullDraft.profile.name);
  });
});

describe("M6-06 history engine: one gesture, several writes", () => {
  const withOverrides = (draft: DraftDoc, overrides: Record<string, unknown>): DraftDoc => ({
    ...draft,
    theme: { ...draft.theme, overrides: overrides as DraftDoc["theme"]["overrides"] },
  });

  it("edits of one batch are one step whatever their groups, and a later batch is another", () => {
    let history = createHistory(fullDraft);
    // An accent swatch sets the accent and the two button colors in one tick.
    const first = [
      ["theme:accent", { accent: "#111111" }],
      ["theme:buttonBg", { accent: "#111111", buttonBg: "#111111" }],
      ["theme:buttonText", { accent: "#111111", buttonBg: "#111111", buttonText: "#FFFFFF" }],
    ] as const;
    for (const [group, overrides] of first) {
      history = recordEdit(history, withOverrides(fullDraft, overrides), {
        group,
        at: 5000,
        batch: 1,
      });
    }
    expect(history.past).toHaveLength(1);
    // Another swatch a moment later is a new gesture: its own step.
    history = recordEdit(history, withOverrides(fullDraft, { accent: "#222222" }), {
      group: "theme:accent",
      at: 5100,
      batch: 2,
    });
    expect(history.past).toHaveLength(2);
    expect(undo(history).present.theme.overrides).toEqual(first[2][1]);
    expect(undo(undo(history)).present.theme.overrides).toEqual(fullDraft.theme.overrides);
  });

  it("a batch never merges into a step that was undone", () => {
    let history = recordEdit(createHistory(fullDraft), withOverrides(fullDraft, { radius: 4 }), {
      group: "theme:radius",
      at: 0,
      batch: 1,
    });
    history = undo(history);
    history = recordEdit(history, withOverrides(fullDraft, { radius: 8 }), {
      group: "theme:radius",
      at: 10,
      batch: 1,
    });
    expect(history.past).toHaveLength(1);
    expect(history.future).toHaveLength(0);
    expect(undo(history).present.theme.overrides).toEqual(fullDraft.theme.overrides);
  });

  it("dragging one slider is one step: many edits of one group inside the window", () => {
    let history = createHistory(fullDraft);
    for (let i = 1; i <= 30; i++) {
      history = recordEdit(history, withOverrides(fullDraft, { overlayOpacity: i / 100 }), {
        group: "theme:overlayOpacity",
        at: i * 16,
        batch: i,
      });
    }
    expect(history.past).toHaveLength(1);
  });
});

describe("M6-06 history engine: the cap", () => {
  it(`keeps at most ${HISTORY_LIMIT} steps: the 101st edit drops the oldest`, () => {
    const history = withEdits(fullDraft, HISTORY_LIMIT + 1);
    expect(history.past).toHaveLength(HISTORY_LIMIT);
    let h = history;
    while (canUndo(h)) h = undo(h);
    // The original draft is gone; the oldest step left is the one after the first edit.
    expect(h.present.profile.name).toBe("Name 1");
  });

  it("exactly 100 edits can all be undone back to the original", () => {
    let h = withEdits(fullDraft, HISTORY_LIMIT);
    for (let i = 0; i < HISTORY_LIMIT; i++) h = undo(h);
    expect(h.present).toEqual(fullDraft);
    expect(canUndo(h)).toBe(false);
  });

  it("a 100-step history of a 200 KB draft shares the blocks it did not touch", () => {
    const big: DraftDoc = {
      ...fullDraft,
      blocks: Array.from({ length: 50 }, (_, i) => ({
        id: `block-text-${String(i).padStart(3, "0")}`,
        type: "text",
        visible: true,
        text: `${i} `.padEnd(4000, "x"),
      })) as Block[],
    };
    expect(JSON.stringify(big).length).toBeGreaterThan(200_000);
    let history = createHistory(big);
    for (let i = 0; i < HISTORY_LIMIT; i++) {
      const blocksNext = history.present.blocks.slice();
      blocksNext[0] = { ...(blocksNext[0] as Block), text: `edit ${i}` } as Block;
      history = recordEdit(history, { ...history.present, blocks: blocksNext }, { at: i * 10 });
    }
    expect(history.past).toHaveLength(HISTORY_LIMIT);
    for (const snapshot of history.past) {
      for (let b = 1; b < 50; b++) expect(snapshot.blocks[b]).toBe(big.blocks[b]);
    }
  });
});

describe("M6-06 history engine: the block edit group", () => {
  const link = blocks.link as Block;
  it("names the one field that changed", () => {
    expect(blockEditGroup(link, { ...link, label: "New" } as Block)).toBe(`block:${link.id}:label`);
    expect(blockEditGroup(link, { ...link, url: "https://x.test" } as Block)).toBe(
      `block:${link.id}:url`,
    );
  });

  it("names the icon, cell or override inside a field", () => {
    const social = blocks.social as Extract<Block, { type: "social" }>;
    const icons = social.icons.slice();
    icons[0] = { ...icons[0]!, url: "https://instagram.com/new" } as (typeof icons)[number];
    expect(blockEditGroup(social, { ...social, icons })).toBe(
      `block:${social.id}:icons.${social.icons[0]!.id}.url`,
    );
    const withOverride = { ...link, overrides: { accent: "#112233" } } as Block;
    const second = { ...link, overrides: { accent: "#223344" } } as Block;
    expect(blockEditGroup(withOverride, second)).toBe(`block:${link.id}:overrides.accent`);
  });

  it("never groups an edit that is not one field of one block", () => {
    const card = blocks.card as Block;
    // Two fields at once, an icon added, a platform change that swaps fields, another block.
    expect(blockEditGroup(card, { ...card, title: "x", caption: "y" } as Block)).toBeUndefined();
    const social = blocks.social as Extract<Block, { type: "social" }>;
    expect(
      blockEditGroup(social, { ...social, icons: [...social.icons, social.icons[0]!] }),
    ).toBeUndefined();
    expect(blockEditGroup(link, blocks.header as Block)).toBeUndefined();
  });
});

describe("M6-06 history engine: images", () => {
  const ORIGIN = "http://127.0.0.1:54321";
  const bg = `${ORIGIN}/storage/v1/object/public/page-media/${bannerRef.path}`;

  it("finds the photo, card and image blocks, and the background image", () => {
    const doc: DraftDoc = {
      ...fullDraft,
      theme: { ...fullDraft.theme, overrides: { ...fullDraft.theme.overrides, bgImage: bg } },
    };
    const paths = draftImagePaths(doc, ORIGIN);
    expect(paths).toContain(photoRef.path);
    expect(paths).toContain(bannerRef.path);
    // Without an origin the background URL cannot be told from any other string.
    expect(draftImagePaths(doc)).toContain(photoRef.path);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it("reports only the paths the restored snapshot holds and the draft on screen does not", () => {
    const withPhoto = fullDraft;
    const without = { ...fullDraft, profile: { ...fullDraft.profile, photo: null } };
    // Removing the photo was the step: undoing it brings the photo back.
    const history = recordEdit(createHistory(withPhoto), without, { at: 0 });
    expect(imagesNeededBy(history, "undo")).toEqual([photoRef.path]);
    expect(imagesNeededBy(history, "redo")).toEqual([]);
    // After the undo, redo would remove it: nothing to check.
    const back = undo(history);
    expect(imagesNeededBy(back, "redo")).toEqual([]);
    // An edit that keeps the photo needs no check.
    const text = recordEdit(createHistory(withPhoto), named(withPhoto, "Z"), { at: 0 });
    expect(imagesNeededBy(text, "undo")).toEqual([]);
  });

  const urlOf = (path: string) => `https://media.test/${path}`;

  it("applies the step when every file answers 200", async () => {
    const fetchStub = vi.fn(async () => new Response(null, { status: 200 }));
    await expect(
      checkImagesExist(["a/b.jpg", "c/d.png"], { fetch: fetchStub, urlOf }),
    ).resolves.toBe("ok");
    expect(fetchStub).toHaveBeenCalledTimes(2);
    expect(fetchStub).toHaveBeenCalledWith("https://media.test/a/b.jpg", {
      method: "HEAD",
      cache: "no-store",
    });
  });

  it("refuses the step when one file answers 404 (or 400, which Storage sends for a missing object)", async () => {
    const answers: Record<string, number> = { "a/b.jpg": 200, "c/d.png": 404 };
    const fetchStub = vi.fn(
      async (input: RequestInfo | URL) =>
        new Response(null, { status: answers[String(input).replace("https://media.test/", "")]! }),
    );
    await expect(
      checkImagesExist(["a/b.jpg", "c/d.png"], { fetch: fetchStub, urlOf }),
    ).resolves.toBe("gone");
    const missing = vi.fn(async () => new Response(null, { status: 400 }));
    await expect(checkImagesExist(["a/b.jpg"], { fetch: missing, urlOf })).resolves.toBe("gone");
  });

  it("fails open: a network error or a server error applies the step", async () => {
    const boom = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(checkImagesExist(["a/b.jpg"], { fetch: boom, urlOf })).resolves.toBe("ok");
    const serverError = vi.fn(async () => new Response(null, { status: 503 }));
    await expect(checkImagesExist(["a/b.jpg"], { fetch: serverError, urlOf })).resolves.toBe("ok");
  });

  it("has the wording the screens show", () => {
    expect(UNDO_IMAGE_GONE).toBe("Can’t undo that. The earlier image was already deleted.");
    expect(REDO_IMAGE_GONE).toBe("Can’t redo that. That image was already deleted.");
  });
});

describe("M6-06 history engine: memory only", () => {
  it("never touches storage, cookies or the network except the HEAD checks", () => {
    const files = [
      "src/lib/editor/history.ts",
      "src/components/editor/use-undo-redo.ts",
      "src/components/design/use-draft-history.ts",
    ];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      expect(source, file).not.toMatch(/localStorage|sessionStorage|indexedDB|document\.cookie/);
      expect(source, file).not.toMatch(/from\s+["']server-only["']|import\s+["']server-only["']/);
    }
    // The engine itself makes no request at all; the screen's hook only builds the HEAD checks.
    expect(readFileSync("src/lib/editor/history.ts", "utf8")).not.toMatch(/clientEnv|mediaUrl\(/);
    expect(readFileSync("src/components/editor/use-undo-redo.ts", "utf8")).not.toMatch(
      /method:\s*"(POST|PATCH|PUT|DELETE)"/,
    );
  });
});
