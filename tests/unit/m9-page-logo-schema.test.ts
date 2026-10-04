import { describe, expect, it } from "vitest";
import {
  LOGO_PLACEMENTS,
  NAME_SIZES,
  collectImageRefs,
  collectPublishErrors,
  draftDocSchema,
  emptyDraft,
  pickProfileStyle,
  publishNameStyle,
  publishedDocSchema,
  resolveNameStyle,
  toPublishForm,
  type DraftDoc,
} from "@/lib/document";
import { FONT_ALLOWLIST } from "@/lib/theme";
import { loadDraft } from "@/lib/editor/load";
import {
  setLogoPlacement,
  setNameFont,
  setNameSize,
  setProfileLogo,
} from "@/lib/editor/page-extras";
import { versionToDraft, nullMissingImages, ownedImagePaths } from "@/lib/versions/restore";
import {
  OWNER_UID,
  blocks,
  draftWith,
  fullDraft,
  noirTokens,
  photoRef,
} from "./fixtures/page-document";

/**
 * M9-24: the profile's logo, its placement, the name's own font and size in the document. Optional
 * with no defaults written: a page that uses none publishes byte-identically to before.
 */

const logoRef = { path: `${OWNER_UID}/logo-aaaaaaaa1111.webp`, width: 600, height: 200 };
const withProfile = (extra: Record<string, unknown>, ...docBlocks: unknown[]) => ({
  ...(draftWith(...docBlocks) as { profile: object }),
  profile: { name: "Mara Okafor", bio: "", photo: null, ...extra },
});
const errors = (extra: Record<string, unknown>) =>
  collectPublishErrors(withProfile(extra)).map((e) => `${e.field}: ${e.message}`);
const parseDraft = (extra: Record<string, unknown>): DraftDoc =>
  draftDocSchema.parse(withProfile(extra, blocks.header)) as DraftDoc;

describe("M9-24 every value of every list is accepted", () => {
  it.each(LOGO_PLACEMENTS)("logoPlacement %s", (logoPlacement) => {
    expect(errors({ logo: logoRef, logoPlacement })).toEqual([]);
  });
  it.each(NAME_SIZES)("nameSize %s", (nameSize) => {
    expect(errors({ nameSize })).toEqual([]);
  });
  it.each([...FONT_ALLOWLIST])("nameFont %s", (nameFont) => {
    expect(errors({ nameFont })).toEqual([]);
  });
  it("a logo of null and a profile with none of the keys are fine", () => {
    expect(errors({ logo: null })).toEqual([]);
    expect(errors({})).toEqual([]);
  });
});

describe("M9-24 a value outside its list fails with the gate's wording, naming the field", () => {
  it.each([
    ["nameFont", "Comic Sans", "profile.nameFont: Pick a font from the list."],
    [
      "nameFont",
      "x;}</style><script>alert(1)</script>",
      "profile.nameFont: Pick a font from the list.",
    ],
    ["nameFont", "inter", "profile.nameFont: Pick a font from the list."],
    ["nameFont", "Inter, sans-serif", "profile.nameFont: Pick a font from the list."],
    ["nameFont", 5, "profile.nameFont: Pick a font from the list."],
    ["nameSize", "huge", "profile.nameSize: Pick a size from the list."],
    ["nameSize", "MEDIUM", "profile.nameSize: Pick a size from the list."],
    ["nameSize", 1.5, "profile.nameSize: Pick a size from the list."],
    ["logoPlacement", "left", "profile.logoPlacement: Pick where the logo goes."],
    ["logoPlacement", "", "profile.logoPlacement: Pick where the logo goes."],
  ])("%s %j", (key, value, expected) => {
    expect(errors({ [key]: value })).toEqual([expected]);
  });

  it.each([
    ["a path with ..", `${OWNER_UID}/../x.webp`],
    ["a URL", "https://evil.example/a.png"],
    ["a script", "javascript:alert(1)"],
    ["a different extension", `${OWNER_UID}/logo-aaaaaaaa.gif`],
    ["no folder", "logo-aaaaaaaa1111.webp"],
  ])("a logo that is %s is not a valid image reference", (_name, path) => {
    const found = errors({ logo: { path, width: 600, height: 200 } });
    expect(found).toEqual(["profile.logo.path: Not a valid image reference."]);
  });

  it("a logo with no size or a size out of range is refused", () => {
    expect(errors({ logo: { path: logoRef.path, width: 0, height: 200 } }).length).toBe(1);
    expect(errors({ logo: { path: logoRef.path, width: 600, height: 99999 } }).length).toBe(1);
    expect(errors({ logo: "x" }).length).toBe(1);
  });
});

describe("M9-24 toPublishForm omits every default", () => {
  it("a page that uses none of the keys is the document it always was, byte for byte", () => {
    const plain = toPublishForm(fullDraft, noirTokens);
    const explicit = toPublishForm(
      {
        ...fullDraft,
        profile: { ...fullDraft.profile, logoPlacement: "beside", nameSize: "medium", logo: null },
      },
      noirTokens,
    );
    expect(JSON.stringify(explicit)).toBe(JSON.stringify(plain));
    for (const key of ["logo", "logoPlacement", "nameFont", "nameSize"]) {
      expect(JSON.stringify(plain)).not.toContain(`"${key}"`);
    }
  });

  it("writes only what differs: a size, a font, a logo, and a placement only with a logo", () => {
    const form = toPublishForm(
      {
        ...fullDraft,
        profile: {
          ...fullDraft.profile,
          logo: { ...logoRef, focus: { x: 0.2, y: 0.8 } },
          logoPlacement: "instead",
          nameFont: "Fraunces",
          nameSize: "xlarge",
        },
      },
      noirTokens,
    );
    expect(form.profile).toMatchObject({
      logo: logoRef,
      logoPlacement: "instead",
      nameFont: "Fraunces",
      nameSize: "xlarge",
    });
    // The logo's focus is dropped (a logo is shown whole).
    expect(form.profile.logo).toEqual(logoRef);
    const noLogo = toPublishForm(
      { ...fullDraft, profile: { ...fullDraft.profile, logoPlacement: "instead" } },
      noirTokens,
    );
    expect("logoPlacement" in noLogo.profile).toBe(false);
  });

  it("the form passes the strict published schema and round-trips", () => {
    const form = toPublishForm(
      {
        ...fullDraft,
        profile: { ...fullDraft.profile, logo: logoRef, nameFont: "Lora", nameSize: "small" },
      },
      noirTokens,
    );
    expect(publishedDocSchema.parse(form).profile).toEqual(form.profile);
  });

  it("a stored published document with a bad style value does not parse", () => {
    const form = toPublishForm(fullDraft, noirTokens);
    for (const bad of [
      { nameFont: "Comic Sans" },
      { nameSize: "huge" },
      { logoPlacement: "left" },
    ]) {
      expect(
        publishedDocSchema.safeParse({ ...form, profile: { ...form.profile, ...bad } }).success,
      ).toBe(false);
    }
  });

  it("the old six options are still written explicitly", () => {
    const form = toPublishForm(fullDraft, noirTokens);
    expect(Object.keys(form.profile)).toEqual([
      "name",
      "bio",
      "photo",
      "photoShape",
      "photoSize",
      "photoBorder",
      "showPhoto",
      "showName",
      "showBio",
    ]);
  });
});

describe("M9-24 the pure helpers", () => {
  it("resolveNameStyle is total and falls back to the defaults", () => {
    expect(resolveNameStyle(undefined)).toEqual({
      nameFont: null,
      nameSize: "medium",
      logoPlacement: "beside",
    });
    expect(
      resolveNameStyle({ nameFont: "Comic Sans", nameSize: "huge", logoPlacement: "left" }),
    ).toEqual({
      nameFont: null,
      nameSize: "medium",
      logoPlacement: "beside",
    });
    expect(
      resolveNameStyle({ nameFont: "Fraunces", nameSize: "large", logoPlacement: "instead" }),
    ).toEqual({
      nameFont: "Fraunces",
      nameSize: "large",
      logoPlacement: "instead",
    });
    expect(resolveNameStyle("x")).toEqual(resolveNameStyle(undefined));
    expect(resolveNameStyle(null)).toEqual(resolveNameStyle(undefined));
  });

  it("publishNameStyle leaves out the defaults", () => {
    expect(publishNameStyle({}, false)).toEqual({});
    expect(publishNameStyle({ nameSize: "medium", logoPlacement: "beside" }, true)).toEqual({});
    expect(publishNameStyle({ logoPlacement: "instead" }, false)).toEqual({});
    expect(publishNameStyle({ logoPlacement: "instead" }, true)).toEqual({
      logoPlacement: "instead",
    });
  });

  it("pickProfileStyle copies only the keys the profile carries", () => {
    expect(pickProfileStyle({ name: "x" })).toEqual({});
    expect(pickProfileStyle({ nameSize: "large", name: "x" })).toEqual({ nameSize: "large" });
    expect(pickProfileStyle(undefined)).toEqual({});
  });
});

describe("M9-24 images: the logo is an image the owner's folder, checked and cleaned up like the photo", () => {
  it("collectImageRefs lists the logo after the photo", () => {
    const draft = parseDraft({ photo: photoRef, logo: logoRef });
    expect(collectImageRefs(draft).map((ref) => ref.path)).toEqual([photoRef.path, logoRef.path]);
    expect(collectImageRefs(parseDraft({})).length).toBe(0);
  });

  it("a restored version keeps a logo that is still stored and drops one that is gone", () => {
    const form = toPublishForm(
      parseDraft({ photo: null, logo: logoRef, nameSize: "large" }),
      noirTokens,
    );
    expect(ownedImagePaths(form, OWNER_UID, "http://x")).toEqual([logoRef.path]);
    expect(ownedImagePaths(form, "someone-else", "http://x")).toEqual([]);
    const kept = nullMissingImages(form, OWNER_UID, "http://x", () => true);
    expect(kept.doc.profile.logo).toEqual(logoRef);
    expect(kept.missingImages).toBe(0);
    const gone = nullMissingImages(form, OWNER_UID, "http://x", () => false);
    expect("logo" in gone.doc.profile).toBe(false);
    expect(gone.doc.profile.nameSize).toBe("large");
    expect(gone.missingImages).toBe(1);
    const foreign = nullMissingImages(form, "someone-else", "http://x", () => true);
    expect("logo" in foreign.doc.profile).toBe(false);
    const restored = versionToDraft(kept.doc, { ref: null, overrides: {} }, 2);
    expect(restored.profile.logo).toEqual(logoRef);
    expect(restored.profile.nameSize).toBe("large");
  });
});

describe("M9-24 the editor: loading and editing", () => {
  it("loadDraft keeps the four keys of a stored profile, and invents none", () => {
    const stored = {
      ...parseDraft({
        logo: logoRef,
        logoPlacement: "instead",
        nameFont: "Lora",
        nameSize: "large",
      }),
      rev: 2,
    };
    const loaded = loadDraft(stored, "mara").draft.profile;
    expect(loaded).toMatchObject({
      logo: logoRef,
      logoPlacement: "instead",
      nameFont: "Lora",
      nameSize: "large",
    });
    const plain = loadDraft({ ...parseDraft({}), rev: 2 }, "mara").draft.profile;
    for (const key of ["logo", "logoPlacement", "nameFont", "nameSize"])
      expect(key in plain).toBe(false);
  });

  it("the repair path keeps each value that reads and leaves out the ones that do not", () => {
    const damaged = {
      ...parseDraft({}),
      blocks: 5,
      profile: {
        name: "Mara",
        bio: "",
        photo: null,
        logo: logoRef,
        logoPlacement: "left",
        nameFont: "Comic Sans",
        nameSize: "xlarge",
      },
    };
    const repaired = loadDraft(damaged, "mara");
    expect(repaired.repaired).toBe(true);
    expect(repaired.draft.profile).toMatchObject({ logo: logoRef, nameSize: "xlarge" });
    expect("logoPlacement" in repaired.draft.profile).toBe(false);
    expect("nameFont" in repaired.draft.profile).toBe(false);
    expect(
      loadDraft({ profile: { logo: { path: "../x.webp" } } }, "mara").draft.profile.logo,
    ).toBeUndefined();
  });

  it("the edit helpers return the same object for a no-op, and refuse a value outside a list", () => {
    const draft = emptyDraft("mara");
    expect(setNameSize(draft, "huge" as never)).toBe(draft);
    expect(setNameFont(draft, "Comic Sans" as never)).toBe(draft);
    expect(setNameFont(draft, null)).toBe(draft);
    expect(setLogoPlacement(draft, "left" as never)).toBe(draft);
    expect(setProfileLogo(draft, null)).toBe(draft);

    const sized = setNameSize(draft, "large");
    expect(sized.profile.nameSize).toBe("large");
    expect(setNameSize(sized, "large")).toBe(sized);

    const fonted = setNameFont(sized, "Fraunces");
    expect(fonted.profile.nameFont).toBe("Fraunces");
    const cleared = setNameFont(fonted, null);
    expect("nameFont" in cleared.profile).toBe(false);

    const logo = setProfileLogo(draft, logoRef);
    expect(logo.profile.logo).toEqual(logoRef);
    expect(setProfileLogo(logo, logoRef)).toBe(logo);
    const placed = setLogoPlacement(logo, "instead");
    expect(placed.profile.logoPlacement).toBe("instead");
    const removed = setProfileLogo(placed, null);
    expect("logo" in removed.profile).toBe(false);
    // The placement is kept (it is only meaningful with a logo), so a new upload keeps the person's choice.
    expect(removed.profile.logoPlacement).toBe("instead");
    expect(draftDocSchema.safeParse(placed).success).toBe(true);
  });
});
