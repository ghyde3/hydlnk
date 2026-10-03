import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  PHOTO_BORDERS,
  PHOTO_SHAPES,
  PHOTO_SIZES,
  PROFILE_OPTION_DEFAULTS,
  PROFILE_OPTION_KEYS,
  PROFILE_OPTION_MESSAGES,
  applyProfileOption,
  collectPublishErrors,
  draftDocSchema,
  emptyDraft,
  publishDocSchema,
  publishFormsEqual,
  publishedDocSchema,
  resolveProfileOptions,
  toPublishForm,
  type DraftDoc,
  type PublishDoc,
} from "@/lib/document";
import { loadDraft } from "@/lib/editor/load";
import { editorReducer, initialEditorState } from "@/lib/editor/state";
import { PUBLIC_READ_CACHE_VERSION } from "@/lib/publish/tags";
import { blocks, fullDraft, noirTokens, photoRef } from "./fixtures/page-document";

/**
 * M6-15 and M6-17: the profile's display options (photo shape, size, border, show photo, show
 * name, show bio). Every option has a default, a document stored before they existed parses and
 * loads with them filled in, the Publish gate names a bad value in plain words, and hiding never
 * deletes what is stored.
 */

const SIX = ["photoShape", "photoSize", "photoBorder", "showPhoto", "showName", "showBio"] as const;

/** A stored draft from before M6: the profile has name, bio and photo only. */
function legacyDraft(): Record<string, unknown> {
  return {
    version: 1,
    rev: 3,
    profile: { name: "Mara Okafor", bio: "Photographer", photo: null },
    theme: { ref: null, overrides: {} },
    blocks: [blocks.link, blocks.header],
  };
}

/** The same with `profile` fields changed. */
function withProfile(patch: Record<string, unknown>): Record<string, unknown> {
  const base = legacyDraft();
  return { ...base, profile: { ...(base.profile as object), ...patch } };
}

describe("M6-15 the defaults and the lists", () => {
  it("are circle, medium, page, and all three shown", () => {
    expect(PROFILE_OPTION_DEFAULTS).toEqual({
      photoShape: "circle",
      photoSize: "medium",
      photoBorder: "page",
      showPhoto: true,
      showName: true,
      showBio: true,
    });
    expect(PROFILE_OPTION_KEYS.slice().sort()).toEqual([...SIX].sort());
    expect([...PHOTO_SHAPES]).toEqual(["circle", "rounded", "square"]);
    expect([...PHOTO_SIZES]).toEqual(["small", "medium", "large"]);
    expect([...PHOTO_BORDERS]).toEqual(["page", "none", "thin", "thick"]);
  });

  it("have the sentences of the Publish gate", () => {
    expect(PROFILE_OPTION_MESSAGES).toEqual({
      photoShape: "Choose a photo shape from the list.",
      photoSize: "Choose a photo size from the list.",
      photoBorder: "Choose a photo border from the list.",
      showPhoto: "Choose on or off.",
      showName: "Choose on or off.",
      showBio: "Choose on or off.",
    });
  });
});

describe("M6-15 / M6-17 schemas fill the defaults of an older document", () => {
  it("parses a draft without the fields, in both the draft and the publish schema", () => {
    const draft = draftDocSchema.parse(legacyDraft());
    expect(draft.profile).toEqual({
      name: "Mara Okafor",
      bio: "Photographer",
      photo: null,
      ...PROFILE_OPTION_DEFAULTS,
    });
    expect(publishDocSchema.safeParse(legacyDraft()).success).toBe(true);
    expect(collectPublishErrors(legacyDraft())).toEqual([]);
  });

  it("parses a stored legacy published document with publishedDocSchema (the profile options need no cache bump)", () => {
    const form = toPublishForm(draftDocSchema.parse(legacyDraft()), noirTokens);
    const { profile, ...rest } = form;
    const stored = {
      ...rest,
      profile: { name: profile.name, bio: profile.bio, photo: profile.photo },
    };
    const parsed = publishedDocSchema.parse(stored);
    expect(parsed.profile).toMatchObject(PROFILE_OPTION_DEFAULTS);
    // "3" since the gradient tokens (M6-41); the profile options alone did not need a bump.
    expect(PUBLIC_READ_CACHE_VERSION).toBe("3");
  });

  it("keeps the seeded mara draft valid: no fields stored, all defaulted on parse", () => {
    const seed = readFileSync(resolve(process.cwd(), "supabase/seed.sql"), "utf8");
    const json: unknown = JSON.parse(/\$json\$([\s\S]*?)\$json\$/.exec(seed)![1]!);
    expect((json as { profile: object }).profile).not.toHaveProperty("photoShape");
    expect(draftDocSchema.parse(json).profile).toMatchObject(PROFILE_OPTION_DEFAULTS);
    expect(collectPublishErrors(json)).toEqual([]);
  });

  it("carries valid stored values through", () => {
    const stored = {
      photoShape: "square",
      photoSize: "large",
      photoBorder: "thick",
      showPhoto: false,
      showName: false,
      showBio: false,
    };
    expect(draftDocSchema.parse(withProfile(stored)).profile).toMatchObject(stored);
    expect(publishDocSchema.safeParse(withProfile(stored)).success).toBe(true);
  });
});

describe("M6-15 / M6-17 toPublishForm writes every option explicitly", () => {
  it("fills the defaults for a draft that has none (a hand-built or older object)", () => {
    const draft = legacyDraft() as unknown as DraftDoc;
    const form = toPublishForm(draft, noirTokens);
    for (const key of SIX) expect(form.profile).toHaveProperty(key);
    expect(form.profile).toMatchObject(PROFILE_OPTION_DEFAULTS);
  });

  it("deep-equals a parsed stored copy, so a page that was never edited still says Published", () => {
    const draft = draftDocSchema.parse(legacyDraft());
    const form = toPublishForm(draft, noirTokens);
    // What the strict schema returns for the stored form with the six fields missing (the seeded
    // mara page and every page published before M6).
    const { profile, ...rest } = form;
    const storedLegacy = publishedDocSchema.parse({
      ...rest,
      profile: { name: profile.name, bio: profile.bio, photo: profile.photo },
    });
    expect(publishFormsEqual(form, storedLegacy)).toBe(true);
    // The editor holds the loaded draft, not the parsed one: the same answer.
    const loaded = loadDraft(legacyDraft(), "mara").draft;
    expect(publishFormsEqual(toPublishForm(loaded, noirTokens), storedLegacy)).toBe(true);
  });

  it("returns to equal after an option is changed and changed back", () => {
    const loaded = loadDraft(legacyDraft(), "mara").draft;
    const stored = publishedDocSchema.parse(toPublishForm(loaded, noirTokens)) as PublishDoc;
    for (const [key, other] of [
      ["photoShape", "square"],
      ["photoSize", "large"],
      ["photoBorder", "thick"],
      ["showPhoto", false],
      ["showName", false],
      ["showBio", false],
    ] as const) {
      const changed: DraftDoc = { ...loaded, profile: { ...loaded.profile, [key]: other } };
      expect(publishFormsEqual(toPublishForm(changed, noirTokens), stored), key).toBe(false);
      const back: DraftDoc = {
        ...changed,
        profile: { ...changed.profile, [key]: PROFILE_OPTION_DEFAULTS[key] },
      };
      expect(publishFormsEqual(toPublishForm(back, noirTokens), stored), key).toBe(true);
    }
  });

  it("keeps the text of a hidden name and bio, and the photo of a hidden photo", () => {
    const draft = draftDocSchema.parse(
      withProfile({ photo: photoRef, showName: false, showBio: false, showPhoto: false }),
    );
    const form = toPublishForm(draft, noirTokens);
    expect(form.profile).toMatchObject({
      name: "Mara Okafor",
      bio: "Photographer",
      photo: photoRef,
      showName: false,
      showBio: false,
      showPhoto: false,
    });
    const shownAgain = toPublishForm(
      { ...draft, profile: { ...draft.profile, showName: true, showBio: true, showPhoto: true } },
      noirTokens,
    );
    expect(shownAgain.profile).toMatchObject({ name: "Mara Okafor", bio: "Photographer" });
    expect(publishedDocSchema.safeParse(form).success).toBe(true);
  });

  it("strips unknown profile keys (photoGlow) from the stored form", () => {
    const dirty = withProfile({ photoGlow: true, photoShape: "rounded" });
    const parsed = publishDocSchema.parse(dirty);
    expect(parsed.profile).not.toHaveProperty("photoGlow");
    const form = toPublishForm(parsed, noirTokens);
    expect(form.profile).not.toHaveProperty("photoGlow");
    expect(publishedDocSchema.parse(form).profile).not.toHaveProperty("photoGlow");
  });
});

describe("M6-15 the Publish gate names a bad photo option", () => {
  const bad = withProfile({
    photoShape: "blob",
    photoSize: "999",
    photoBorder: "url(x)",
    showPhoto: "yes",
  });

  it("refuses each field in the editor's words and with the field path", () => {
    expect(draftDocSchema.safeParse(bad).success).toBe(false);
    expect(publishDocSchema.safeParse(bad).success).toBe(false);
    const errors = collectPublishErrors(bad);
    expect(errors.map((error) => [error.field, error.message])).toEqual([
      ["profile.photoShape", "Choose a photo shape from the list."],
      ["profile.photoSize", "Choose a photo size from the list."],
      ["profile.photoBorder", "Choose a photo border from the list."],
      ["profile.showPhoto", "Choose on or off."],
    ]);
    for (const error of errors) expect(error.blockId).toBeNull();
  });

  it.each([
    ["photoShape", 5],
    ["photoShape", null],
    ["photoShape", ""],
    ["photoSize", "Large"],
    ["photoBorder", ["thin"]],
    ["showPhoto", 1],
    ["showPhoto", null],
  ])("refuses %s = %j", (key, value) => {
    const errors = collectPublishErrors(withProfile({ [key]: value }));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({
      field: `profile.${key}`,
      message: PROFILE_OPTION_MESSAGES[key as never],
    });
  });
});

describe("M6-17 hiding the name and bio", () => {
  it("refuses a string or a number where a switch belongs, naming each field", () => {
    const errors = collectPublishErrors(withProfile({ showName: "false", showBio: 0 }));
    expect(errors.map((error) => [error.field, error.message])).toEqual([
      ["profile.showName", "Choose on or off."],
      ["profile.showBio", "Choose on or off."],
    ]);
  });

  it("keeps the display name required even when it is hidden", () => {
    const errors = collectPublishErrors(withProfile({ showName: false, name: "" }));
    expect(errors).toEqual([
      { blockId: null, field: "profile.name", message: "Add a display name." },
    ]);
    expect(collectPublishErrors(withProfile({ showName: false, name: "Mara" }))).toEqual([]);
  });

  it("keeps the 160-character bio limit even when the bio is hidden", () => {
    const errors = collectPublishErrors(withProfile({ showBio: false, bio: "x".repeat(161) }));
    expect(errors.map((error) => error.field)).toEqual(["profile.bio"]);
    expect(collectPublishErrors(withProfile({ showBio: false, bio: "x".repeat(160) }))).toEqual([]);
  });

  it("stores hidden text as it is (a tag stays a string, never markup)", () => {
    const html = "<script>alert(1)</script>";
    const doc = withProfile({ name: html, bio: html, showName: false, showBio: false });
    expect(collectPublishErrors(doc)).toEqual([]);
    const form = toPublishForm(draftDocSchema.parse(doc), noirTokens);
    expect(form.profile).toMatchObject({ name: html, bio: html, showName: false, showBio: false });
  });
});

describe("M6-15 / M6-17 loadDraft fills and repairs the options", () => {
  it("fills the defaults of a valid stored draft that has none, without flagging it", () => {
    const loaded = loadDraft(legacyDraft(), "mara");
    expect(loaded.repaired).toBe(false);
    expect(loaded.draft.profile).toEqual({
      name: "Mara Okafor",
      bio: "Photographer",
      photo: null,
      ...PROFILE_OPTION_DEFAULTS,
    });
    // The editor state holds a value for each, always.
    const state = initialEditorState(loaded.draft);
    for (const key of SIX) expect(state.draft.profile[key]).not.toBeUndefined();
  });

  it("carries valid stored values through", () => {
    const stored = {
      photoShape: "rounded",
      photoSize: "small",
      photoBorder: "thin",
      showPhoto: false,
      showName: false,
      showBio: true,
    };
    const loaded = loadDraft(withProfile({ ...stored, photo: photoRef }), "mara");
    expect(loaded.repaired).toBe(false);
    expect(loaded.draft.profile).toMatchObject({ ...stored, photo: photoRef });
  });

  it("resets one invalid value to its default and keeps everything else, with the notice", () => {
    const loaded = loadDraft(
      withProfile({ photoShape: "blob", photoSize: "large", showBio: false, bio: " kept " }),
      "mara",
    );
    expect(loaded.repaired).toBe(true);
    expect(loaded.draft.profile).toMatchObject({
      photoShape: "circle",
      photoSize: "large",
      showBio: false,
      name: "Mara Okafor",
    });
    expect(loaded.draft.profile.bio).toBe(" kept ");
    expect(loaded.draft.blocks.map((block) => block.id)).toEqual([
      blocks.link.id,
      blocks.header.id,
    ]);
    expect(draftDocSchema.safeParse(loaded.draft).success).toBe(true);
  });

  it("resets a string 'false' and a number 0 to on", () => {
    const loaded = loadDraft(withProfile({ showName: "false", showBio: 0 }), "mara");
    expect(loaded.repaired).toBe(true);
    expect(loaded.draft.profile).toMatchObject({ showName: true, showBio: true });
  });

  it("resets every one when all four are bad", () => {
    const loaded = loadDraft(
      withProfile({
        photoShape: "blob",
        photoSize: "999",
        photoBorder: "url(x)",
        showPhoto: "yes",
      }),
      "mara",
    );
    expect(loaded.repaired).toBe(true);
    expect(loaded.draft.profile).toMatchObject(PROFILE_OPTION_DEFAULTS);
  });

  it("a brand new page loads with the defaults written explicitly", () => {
    expect(loadDraft(emptyDraft("mara"), "mara").draft.profile).toMatchObject(
      PROFILE_OPTION_DEFAULTS,
    );
  });
});

describe("M6-16 / M6-18 the reducer takes only valid options", () => {
  const start = initialEditorState(loadDraft(legacyDraft(), "mara").draft);

  it.each([
    ["photoShape", "square"],
    ["photoShape", "rounded"],
    ["photoSize", "small"],
    ["photoSize", "large"],
    ["photoBorder", "none"],
    ["photoBorder", "thin"],
    ["photoBorder", "thick"],
    ["showPhoto", false],
    ["showName", false],
    ["showBio", false],
  ] as const)("%s = %j changes that one field and nothing else", (key, value) => {
    const next = editorReducer(start, { type: "profile/option", key, value } as never);
    expect(next).not.toBe(start);
    expect(next.draft.profile).toEqual({ ...start.draft.profile, [key]: value });
    expect(next.draft.blocks).toBe(start.draft.blocks);
    expect(next.draft.theme).toBe(start.draft.theme);
  });

  it.each([
    ["photoShape", "blob"],
    ["photoShape", "Square"],
    ["photoShape", 1],
    ["photoSize", "999"],
    ["photoSize", undefined],
    ["photoBorder", "url(x)"],
    ["showPhoto", "yes"],
    ["showName", "false"],
    ["showName", 0],
    ["showBio", null],
    ["showBio", undefined],
  ])("%s = %j is refused: the same state object comes back", (key, value) => {
    const next = editorReducer(start, { type: "profile/option", key, value } as never);
    expect(next).toBe(start);
  });

  it("refuses an unknown key and a value that is already set", () => {
    expect(
      editorReducer(start, { type: "profile/option", key: "photoGlow", value: true } as never),
    ).toBe(start);
    expect(
      editorReducer(start, { type: "profile/option", key: "photoShape", value: "circle" }),
    ).toBe(start);
    expect(editorReducer(start, { type: "profile/option", key: "showName", value: true })).toBe(
      start,
    );
  });

  it("clears a Publish error that no longer holds, and keeps the draft's blocks", () => {
    const withErrors = {
      ...start,
      publishErrors: [{ blockId: null, field: "profile.name", message: "Add a display name." }],
    };
    const next = editorReducer(withErrors, {
      type: "profile/option",
      key: "showName",
      value: false,
    });
    expect(next.draft.profile.showName).toBe(false);
    // The name is still empty-checked: nothing about a switch clears an error about the text.
    expect(next.draft.profile.name).toBe("Mara Okafor");
  });

  it("applyProfileOption leaves the object alone for anything invalid", () => {
    const profile = { name: "a", bio: "", photo: null, ...PROFILE_OPTION_DEFAULTS };
    expect(applyProfileOption(profile, { key: "showName", value: "false" })).toBe(profile);
    expect(applyProfileOption(profile, { key: "photoSize", value: "huge" })).toBe(profile);
    expect(applyProfileOption(profile, { key: "photoSize", value: "large" })).toEqual({
      ...profile,
      photoSize: "large",
    });
  });

  it("resolveProfileOptions is total", () => {
    expect(resolveProfileOptions(undefined)).toEqual(PROFILE_OPTION_DEFAULTS);
    expect(resolveProfileOptions(null)).toEqual(PROFILE_OPTION_DEFAULTS);
    expect(resolveProfileOptions("circle")).toEqual(PROFILE_OPTION_DEFAULTS);
    expect(resolveProfileOptions({ photoShape: "square", photoSize: 9, showBio: false })).toEqual({
      ...PROFILE_OPTION_DEFAULTS,
      photoShape: "square",
      showBio: false,
    });
  });
});

describe("M6-16 / M6-18 each option is one undo step", () => {
  const start = initialEditorState(loadDraft(legacyDraft(), "mara").draft);

  it("Circle, Rounded, Square pressed in turn undo one at a time, and redo in order", () => {
    let state = start;
    for (const value of ["rounded", "square"] as const) {
      state = editorReducer(state, { type: "profile/option", key: "photoShape", value });
    }
    expect(state.draft.profile.photoShape).toBe("square");
    state = editorReducer(state, { type: "history/undo" });
    expect(state.draft.profile.photoShape).toBe("rounded");
    state = editorReducer(state, { type: "history/undo" });
    expect(state.draft.profile.photoShape).toBe("circle");
    state = editorReducer(state, { type: "history/redo" });
    expect(state.draft.profile.photoShape).toBe("rounded");
  });

  it("a switch and a choice are separate steps, and a refused value adds none", () => {
    let state = editorReducer(start, { type: "profile/option", key: "showName", value: false });
    state = editorReducer(state, { type: "profile/option", key: "photoSize", value: "large" });
    const refused = editorReducer(state, {
      type: "profile/option",
      key: "photoSize",
      value: "huge",
    } as never);
    expect(refused).toBe(state);
    state = editorReducer(state, { type: "history/undo" });
    expect(state.draft.profile).toMatchObject({ showName: false, photoSize: "medium" });
    state = editorReducer(state, { type: "history/undo" });
    expect(state.draft.profile).toMatchObject({ showName: true, photoSize: "medium" });
  });
});

describe("fixtures", () => {
  it("fullDraft (the M2-31 fixture) carries the defaults explicitly and publishes cleanly", () => {
    expect(fullDraft.profile).toMatchObject(PROFILE_OPTION_DEFAULTS);
    expect(collectPublishErrors(fullDraft)).toEqual([]);
  });
});
