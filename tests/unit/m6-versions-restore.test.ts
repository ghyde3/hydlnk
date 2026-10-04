import { describe, expect, it } from "vitest";
import { draftDocSchema, toPublishForm, type PublishDoc } from "@/lib/document";
import { TOKEN_KEYS, resolveTokens, type TokenSet } from "@/lib/theme";
import { SYSTEM_DEFAULT_TOKENS } from "@/lib/theme";
import {
  nextRev,
  nullMissingImages,
  ownedImagePaths,
  restoredTheme,
  versionToDraft,
} from "@/lib/versions/restore";
import {
  OWNER_UID,
  bannerRef,
  fullDraft,
  fullPublished,
  noirTokens,
  photoRef,
} from "./fixtures/page-document";

/**
 * M6-49: the pure half of preview and restore. Theme fidelity with three fixtures (unchanged,
 * edited since, deleted or another user's), the image rules (photo, card, image block, background),
 * and the shape of the restored draft. No database: `isPresent` stands in for Storage.
 */

const ORIGIN = "http://127.0.0.1:54321";
const OTHER_UID = "11111111-2222-4333-8444-555555555555";
const bgUrl = (uid: string, name = "bg-aaaaaaaa.webp") =>
  `${ORIGIN}/storage/v1/object/public/page-media/${uid}/${name}`;

// Token overrides that name a background image are validated against the project's own media origin.
process.env.NEXT_PUBLIC_SUPABASE_URL = ORIGIN;

const everythingStored = () => true;

describe("M6-49 theme fidelity: the restored draft resolves to the version's frozen tokens", () => {
  it("M6-49 the theme is unchanged: the reference and the overrides are kept", () => {
    const version = toPublishForm(fullDraft, noirTokens);
    const theme = restoredTheme(version, version.tokens, noirTokens, false);
    expect(theme.ref).toBe(fullDraft.theme.ref);
    expect(theme.overrides).toEqual(fullDraft.theme.overrides);
    expect(resolveTokens(noirTokens, theme.overrides)).toEqual(version.tokens);
  });

  it("M6-49 the theme was edited after that Publish: the reference is kept and the overrides gain what differs", () => {
    const version = toPublishForm(fullDraft, noirTokens);
    const edited: TokenSet = {
      ...noirTokens,
      bg: "#101010",
      fontBody: "Inter",
      radius: 4,
      accent: "#00FF00", // the page override (#C46A4F) still wins over this one
    };
    const theme = restoredTheme(version, version.tokens, edited, false);
    expect(theme.ref).toBe(fullDraft.theme.ref);
    expect(theme.overrides).toMatchObject({ ...fullDraft.theme.overrides });
    // every token whose value would otherwise differ is written down
    expect(theme.overrides.bg).toBe(noirTokens.bg);
    expect(theme.overrides.fontBody).toBe(noirTokens.fontBody);
    expect(theme.overrides.radius).toBe(16); // the page override already said 16
    expect(resolveTokens(edited, theme.overrides)).toEqual(version.tokens);
  });

  it("M6-49 the theme was deleted, or belongs to another user: the reference becomes null and the overrides carry what it supplied", () => {
    const version = toPublishForm(fullDraft, noirTokens);
    const theme = restoredTheme(version, version.tokens, null, false);
    expect(theme.ref).toBeNull();
    expect(resolveTokens(null, theme.overrides)).toEqual(version.tokens);
    // the tokens Noir supplied that the system default does not are all there
    for (const key of TOKEN_KEYS) {
      if (version.tokens[key] !== SYSTEM_DEFAULT_TOKENS[key]) {
        expect(theme.overrides[key], key).toBe(version.tokens[key]);
      }
    }
  });

  it("M6-49 a version that used no theme at all restores with no theme and its own overrides", () => {
    const draft = { ...fullDraft, theme: { ref: null, overrides: { accent: "#123456" } } };
    const version = toPublishForm(draft, null);
    const theme = restoredTheme(version, version.tokens, null, false);
    expect(theme).toEqual({ ref: null, overrides: { accent: "#123456" } });
    expect(resolveTokens(null, theme.overrides)).toEqual(version.tokens);
  });

  it("M6-49 holds for every token key, whatever the theme changed to (a swept property)", () => {
    const version = toPublishForm(fullDraft, noirTokens);
    const themes: (Partial<TokenSet> | null)[] = [
      null,
      {},
      noirTokens,
      { ...noirTokens, bgType: "gradient", scale: 1.2, weightHeading: 700, align: "left" },
      { bg: "#FFFFFF" },
    ];
    for (const themeTokens of themes) {
      const theme = restoredTheme(version, version.tokens, themeTokens, false);
      expect(resolveTokens(themeTokens, theme.overrides)).toEqual(version.tokens);
    }
  });

  it("M6-49 a background image that is gone is nulled in the page-level overrides, and an image background turns solid", () => {
    const frozen: TokenSet = {
      ...noirTokens,
      bgType: "image",
      bgImage: bgUrl(OWNER_UID),
      overlayOpacity: 0.4,
    };
    const version = toPublishForm(
      {
        ...fullDraft,
        theme: { ref: null, overrides: { bgType: "image", bgImage: frozen.bgImage } },
      },
      noirTokens,
    );
    const theme = restoredTheme(version, version.tokens, noirTokens, true);
    expect(theme.overrides.bgImage).toBeNull();
    expect(theme.overrides.bgType).toBe("solid");
    const resolved = resolveTokens(noirTokens, theme.overrides);
    expect(resolved.bgImage).toBeNull();
    expect(resolved.bgType).toBe("solid");
  });
});

describe("M6-49 images: nothing outside the owner's folder, nothing that is gone", () => {
  const withBackground = (url: string | null, bgType: TokenSet["bgType"]): PublishDoc => ({
    ...fullPublished,
    tokens: { ...fullPublished.tokens, bgImage: url, bgType },
  });

  it("M6-49 an untouched document with every object present comes back unchanged and counts zero", () => {
    const result = nullMissingImages(fullPublished, OWNER_UID, ORIGIN, everythingStored);
    expect(result.missingImages).toBe(0);
    expect(result.backgroundMissing).toBe(false);
    expect(result.doc).toEqual(fullPublished);
  });

  it("M6-49 a missing photo, card image and image-block image each become null and are counted", () => {
    const result = nullMissingImages(fullPublished, OWNER_UID, ORIGIN, () => false);
    expect(result.doc.profile.photo).toBeNull();
    const card = result.doc.blocks.find((b) => b.type === "card");
    const image = result.doc.blocks.find((b) => b.type === "image");
    expect(card?.type === "card" && card.image).toBeNull();
    expect(image?.type === "image" && image.image).toBeNull();
    // a book's cover (M9-20) is one more place: it becomes null and the book stays
    const book = result.doc.blocks.find((b) => b.type === "book");
    expect(book?.type === "book" && book.cover).toBeNull();
    expect(book?.type === "book" && book.links).toHaveLength(3);
    expect(result.missingImages).toBe(4);
    // everything else is the same document
    expect(result.doc.blocks.map((b) => b.id)).toEqual(fullPublished.blocks.map((b) => b.id));
    expect(result.doc.profile.name).toBe(fullPublished.profile.name);
  });

  it("M6-49 one missing object counts once for each place that names it", () => {
    const only = (gone: string) => (path: string) => path !== gone;
    const result = nullMissingImages(fullPublished, OWNER_UID, ORIGIN, only(bannerRef.path));
    // the card and the image block share the banner
    expect(result.missingImages).toBe(2);
    expect(result.doc.profile.photo).toEqual(photoRef);
  });

  it("M6-49 a photo path in another user's folder is dropped without asking Storage", () => {
    const doc: PublishDoc = {
      ...fullPublished,
      profile: {
        ...fullPublished.profile,
        photo: { path: `${OTHER_UID}/avatar-aaaaaaaa.webp`, width: 400, height: 400 },
      },
    };
    const asked: string[] = [];
    const result = nullMissingImages(doc, OWNER_UID, ORIGIN, (path) => {
      asked.push(path);
      return true;
    });
    expect(result.doc.profile.photo).toBeNull();
    expect(result.missingImages).toBe(1);
    expect(asked.every((path) => path.startsWith(`${OWNER_UID}/`))).toBe(true);
    expect(ownedImagePaths(doc, OWNER_UID, ORIGIN).some((p) => p.startsWith(OTHER_UID))).toBe(
      false,
    );
  });

  it("M6-49 a background image that is stored, in the owner's folder, is kept", () => {
    const doc = withBackground(bgUrl(OWNER_UID), "image");
    const result = nullMissingImages(doc, OWNER_UID, ORIGIN, everythingStored);
    expect(result.doc.tokens.bgImage).toBe(bgUrl(OWNER_UID));
    expect(result.doc.tokens.bgType).toBe("image");
    expect(result.backgroundMissing).toBe(false);
  });

  it("M6-49 a background image whose object is gone shows no background: bgImage null, bgType solid, counted", () => {
    const doc = withBackground(bgUrl(OWNER_UID), "image");
    const result = nullMissingImages(
      doc,
      OWNER_UID,
      ORIGIN,
      (path) => !path.includes("bg-aaaaaaaa"),
    );
    expect(result.doc.tokens.bgImage).toBeNull();
    expect(result.doc.tokens.bgType).toBe("solid");
    expect(result.backgroundMissing).toBe(true);
    expect(result.missingImages).toBe(1);
  });

  it("M6-49 a background image in another user's folder is dropped without asking Storage", () => {
    const doc = withBackground(bgUrl(OTHER_UID), "image");
    const asked: string[] = [];
    const result = nullMissingImages(doc, OWNER_UID, ORIGIN, (path) => {
      asked.push(path);
      return true;
    });
    expect(result.doc.tokens.bgImage).toBeNull();
    expect(result.doc.tokens.bgType).toBe("solid");
    expect(result.missingImages).toBe(1);
    expect(asked).not.toContain(`${OTHER_UID}/bg-aaaaaaaa.webp`);
  });

  it("M6-49 a background URL that is not this project's media at all is dropped", () => {
    for (const url of [
      "https://evil.example/storage/v1/object/public/page-media/x/bg-aaaaaaaa.webp",
      `${ORIGIN}/storage/v1/object/public/other-bucket/${OWNER_UID}/bg-aaaaaaaa.webp`,
      `${bgUrl(OWNER_UID)}?x=1`,
      `${ORIGIN}/storage/v1/object/public/page-media/${OWNER_UID}/..%2f${OTHER_UID}%2fbg-aaaaaaaa.webp`,
    ]) {
      const result = nullMissingImages(
        withBackground(url, "image"),
        OWNER_UID,
        ORIGIN,
        everythingStored,
      );
      expect(result.doc.tokens.bgImage, url).toBeNull();
      expect(result.doc.tokens.bgType, url).toBe("solid");
      expect(result.missingImages, url).toBe(1);
    }
  });

  it("M6-49 a gradient background keeps its type when only its hidden image is gone", () => {
    const result = nullMissingImages(
      withBackground(bgUrl(OWNER_UID), "gradient"),
      OWNER_UID,
      ORIGIN,
      () => false,
    );
    expect(result.doc.tokens.bgImage).toBeNull();
    expect(result.doc.tokens.bgType).toBe("gradient");
  });

  it("M6-49 does not mutate the document it was given", () => {
    const doc = withBackground(bgUrl(OWNER_UID), "image");
    const before = JSON.stringify(doc);
    nullMissingImages(doc, OWNER_UID, ORIGIN, () => false);
    expect(JSON.stringify(doc)).toBe(before);
  });
});

describe("M6-49 images: link thumbnails (M6-20) and the share image (M6-32) follow the same rules", () => {
  const thumb = { path: `${OWNER_UID}/thumb-aaaaaaaa.webp`, width: 96, height: 96 };
  const sharePic = { path: `${OWNER_UID}/share-bbbbbbbb.webp`, width: 1200, height: 630 };
  const linkBlock = (icon: unknown, id = "link-thumb-1") =>
    ({
      id,
      type: "link",
      visible: true,
      label: "Portrait sessions",
      url: "https://maraokafor.com/book/portraits",
      icon,
    }) as PublishDoc["blocks"][number];
  const docWith = (over: Partial<PublishDoc>): PublishDoc => ({ ...fullPublished, ...over });
  const withThumb = (icon: unknown = { type: "image", image: thumb }) =>
    docWith({ blocks: [...fullPublished.blocks, linkBlock(icon)] });
  const withShare = (image: unknown = sharePic) =>
    docWith({ share: { title: "Mara", image } as PublishDoc["share"] });
  const linkOf = (doc: PublishDoc, id = "link-thumb-1") =>
    doc.blocks.find((b) => b.id === id) as Extract<PublishDoc["blocks"][number], { type: "link" }>;

  it("M6-49 ownedImagePaths names a link thumbnail and the share image, once each, in the owner's folder only", () => {
    const doc = docWith({
      blocks: [
        ...fullPublished.blocks,
        linkBlock({ type: "image", image: thumb }),
        linkBlock({ type: "image", image: thumb }, "link-thumb-2"),
        linkBlock(
          {
            type: "image",
            image: { path: `${OTHER_UID}/thumb-cccccccc.webp`, width: 96, height: 96 },
          },
          "link-thumb-3",
        ),
        linkBlock({ type: "builtin", name: "star" }, "link-builtin-1"),
      ],
      share: { image: sharePic },
    });
    const paths = ownedImagePaths(doc, OWNER_UID, ORIGIN);
    expect(paths.filter((p) => p === thumb.path)).toHaveLength(1);
    expect(paths).toContain(sharePic.path);
    expect(paths.some((p) => p.startsWith(OTHER_UID))).toBe(false);
  });

  it("M6-49 a link thumbnail that is stored is kept; a built-in icon is never looked up or touched", () => {
    const doc = docWith({
      blocks: [
        ...fullPublished.blocks,
        linkBlock({ type: "image", image: thumb }),
        linkBlock({ type: "builtin", name: "star" }, "link-builtin-1"),
      ],
    });
    const asked: string[] = [];
    const result = nullMissingImages(doc, OWNER_UID, ORIGIN, (path) => {
      asked.push(path);
      return true;
    });
    expect(result.missingImages).toBe(0);
    expect(result.doc).toEqual(doc);
    expect(linkOf(result.doc).icon).toEqual({ type: "image", image: thumb });
    expect(linkOf(result.doc, "link-builtin-1").icon).toEqual({ type: "builtin", name: "star" });
    expect(asked).not.toContain("star");
  });

  it("M6-49 a link thumbnail whose object is gone is removed from the link (the key goes, the link stays) and counted", () => {
    const result = nullMissingImages(withThumb(), OWNER_UID, ORIGIN, (p) => p !== thumb.path);
    const link = linkOf(result.doc);
    expect("icon" in link).toBe(false);
    expect(link.label).toBe("Portrait sessions");
    expect(link.url).toBe("https://maraokafor.com/book/portraits");
    expect(result.missingImages).toBe(1);
    // the draft schema accepts the link without its icon
    const theme = restoredTheme(fullPublished, fullPublished.tokens, noirTokens, false);
    expect(draftDocSchema.safeParse(versionToDraft(result.doc, theme, 2)).success).toBe(true);
  });

  it("M6-49 a link thumbnail in another user's folder is dropped without asking Storage", () => {
    const doc = withThumb({
      type: "image",
      image: { path: `${OTHER_UID}/thumb-cccccccc.webp`, width: 96, height: 96 },
    });
    const asked: string[] = [];
    const result = nullMissingImages(doc, OWNER_UID, ORIGIN, (path) => {
      asked.push(path);
      return true;
    });
    expect("icon" in linkOf(result.doc)).toBe(false);
    expect(result.missingImages).toBe(1);
    expect(asked.some((p) => p.startsWith(OTHER_UID))).toBe(false);
  });

  it("M6-49 a share image that is stored is kept; one that is gone becomes null, keeps the share text, and is counted", () => {
    const kept = nullMissingImages(withShare(), OWNER_UID, ORIGIN, everythingStored);
    expect(kept.doc.share).toEqual({ title: "Mara", image: sharePic });
    expect(kept.missingImages).toBe(0);

    const gone = nullMissingImages(withShare(), OWNER_UID, ORIGIN, (p) => p !== sharePic.path);
    expect(gone.doc.share).toEqual({ title: "Mara", image: null });
    expect(gone.missingImages).toBe(1);
  });

  it("M6-49 a share image in another user's folder is dropped without asking Storage", () => {
    const other = { path: `${OTHER_UID}/share-bbbbbbbb.webp`, width: 1200, height: 630 };
    const asked: string[] = [];
    const result = nullMissingImages(withShare(other), OWNER_UID, ORIGIN, (path) => {
      asked.push(path);
      return true;
    });
    expect(result.doc.share?.image).toBeNull();
    expect(result.missingImages).toBe(1);
    expect(asked.some((p) => p.startsWith(OTHER_UID))).toBe(false);
  });

  it("M6-49 one count per place: photo, card, image block, thumbnail, share image and background all gone", () => {
    const doc: PublishDoc = {
      ...withThumb(),
      share: { image: sharePic },
      tokens: { ...fullPublished.tokens, bgImage: bgUrl(OWNER_UID), bgType: "image" },
    };
    const result = nullMissingImages(doc, OWNER_UID, ORIGIN, () => false);
    expect(result.missingImages).toBe(3 + 1 + 1 + 1 + 1);
    expect(result.backgroundMissing).toBe(true);
  });

  it("M6-49 a document with neither a thumbnail nor a share card comes back as before (no stray keys)", () => {
    const result = nullMissingImages(fullPublished, OWNER_UID, ORIGIN, () => false);
    expect("share" in result.doc).toBe(false);
    expect(result.doc.blocks.every((b) => !("icon" in b))).toBe(true);
  });

  it("M6-49 does not mutate the document it was given (thumbnail and share image)", () => {
    const doc: PublishDoc = { ...withThumb(), share: { title: "T", image: sharePic } };
    const before = JSON.stringify(doc);
    nullMissingImages(doc, OWNER_UID, ORIGIN, () => false);
    expect(JSON.stringify(doc)).toBe(before);
  });

  it("M6-49 the restored draft carries the version's share card, and publishing it gives the share card back", () => {
    const doc: PublishDoc = {
      ...withThumb(),
      share: { title: "Mara Okafor", description: "Book a shoot", image: sharePic },
    };
    const theme = restoredTheme(doc, doc.tokens, noirTokens, false);
    const draft = versionToDraft(doc, theme, 3);
    expect(draft.share).toEqual(doc.share);
    const parsed = draftDocSchema.parse(draft);
    expect(parsed.share).toEqual(doc.share);
    expect(toPublishForm(parsed, noirTokens).share).toEqual(doc.share);
  });

  it("M6-49 a version with no share card restores to a draft with no share key at all", () => {
    const theme = restoredTheme(fullPublished, fullPublished.tokens, noirTokens, false);
    expect("share" in versionToDraft(fullPublished, theme, 3)).toBe(false);
  });

  it("M6-49 a restored draft whose thumbnail and share image are gone still validates and publishes without them", () => {
    const doc: PublishDoc = {
      ...withThumb(),
      share: { title: "Mara", image: sharePic },
    };
    const checked = nullMissingImages(doc, OWNER_UID, ORIGIN, () => false);
    const theme = restoredTheme(doc, doc.tokens, noirTokens, false);
    const parsed = draftDocSchema.parse(versionToDraft(checked.doc, theme, 4));
    expect(parsed.share).toEqual({ title: "Mara", image: null });
    const again = toPublishForm(parsed, noirTokens);
    expect(again.share).toEqual({ title: "Mara" });
    expect("icon" in linkOf(again)).toBe(false);
  });
});

describe("M6-49 the restored draft", () => {
  it("M6-49 keeps the profile, the blocks in order with their ids, all visible, and sets rev", () => {
    const theme = restoredTheme(fullPublished, fullPublished.tokens, noirTokens, false);
    const draft = versionToDraft(fullPublished, theme, 8);
    expect(draft.version).toBe(1);
    expect(draft.rev).toBe(8);
    expect(draft.profile.name).toBe(fullPublished.profile.name);
    expect(draft.blocks.map((b) => b.id)).toEqual(fullPublished.blocks.map((b) => b.id));
    expect(draft.blocks.every((b) => b.visible === true)).toBe(true);
    // the hidden block of the draft the version came from was never published, so it is not back
    expect(draft.blocks.some((b) => b.id === "header-hidden-1")).toBe(false);
    expect(draft.theme).toEqual(theme);
    expect(draftDocSchema.safeParse(draft).success).toBe(true);
  });

  it("M6-49 round-trips: publishing the restored draft gives the version's document again", () => {
    const theme = restoredTheme(fullPublished, fullPublished.tokens, noirTokens, false);
    const parsed = draftDocSchema.parse(versionToDraft(fullPublished, theme, 8));
    const again = toPublishForm({ ...parsed, profile: { ...parsed.profile } }, noirTokens);
    expect(again).toEqual(fullPublished);
  });

  it("M6-49 round-trips with the theme gone: the draft publishes to the same tokens", () => {
    const theme = restoredTheme(fullPublished, fullPublished.tokens, null, false);
    const parsed = draftDocSchema.parse(versionToDraft(fullPublished, theme, 1));
    const again = toPublishForm({ ...parsed, profile: { ...parsed.profile } }, null);
    expect(again.tokens).toEqual(fullPublished.tokens);
    expect(again.blocks).toEqual(fullPublished.blocks);
  });

  it("M6-49 rev is the stored rev plus one; a draft with no usable rev counts as 0", () => {
    expect(nextRev({ rev: 7 })).toBe(8);
    expect(nextRev({ rev: 0 })).toBe(1);
    for (const bad of [
      {},
      { rev: "7" },
      { rev: -1 },
      { rev: 1.5 },
      { rev: Number.MAX_SAFE_INTEGER + 1 },
      null,
      [],
      "x",
      5,
    ]) {
      expect(nextRev(bad), JSON.stringify(bad)).toBe(1);
    }
  });

  it("M6-49 a null image in a restored draft is allowed (the draft schema is lenient), so Publish asks for it again", () => {
    const stripped = nullMissingImages(fullPublished, OWNER_UID, ORIGIN, () => false);
    const theme = restoredTheme(fullPublished, fullPublished.tokens, noirTokens, false);
    expect(draftDocSchema.safeParse(versionToDraft(stripped.doc, theme, 2)).success).toBe(true);
  });
});
