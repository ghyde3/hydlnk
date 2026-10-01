import { describe, expect, it } from "vitest";
import {
  BLOCK_TYPES,
  EMBED_HOSTS,
  MAX_BLOCKS,
  blockSchema,
  pageDocumentSchema,
  publishedDocumentSchema,
} from "@/lib/schemas";
import { fullDocument, fullPublishedDocument } from "./fixtures/page-document";

type Json = Record<string, unknown>;

/** A deep copy of the valid fixture that tests can break in one place. */
function mutableDocument(): Json & { profile: Json; blocks: Json[] } {
  return structuredClone(fullDocument) as unknown as Json & { profile: Json; blocks: Json[] };
}

function documentWithBlock(block: Json) {
  return pageDocumentSchema.safeParse({ ...mutableDocument(), blocks: [block] });
}

function blockOfType(type: string): Json {
  const block = fullDocument.blocks.find((b) => b.type === type);
  if (!block) throw new Error(`fixture has no ${type} block`);
  return structuredClone(block) as unknown as Json;
}

describe("pageDocumentSchema: valid documents", () => {
  it("accepts the full fixture", () => {
    const result = pageDocumentSchema.safeParse(fullDocument);
    expect(result.error?.issues).toBeUndefined();
    expect(result.success).toBe(true);
  });

  it("fixture covers every block type", () => {
    const used = new Set(fullDocument.blocks.map((block) => block.type));
    expect([...used].sort()).toEqual([...BLOCK_TYPES].sort());
    expect(BLOCK_TYPES).toHaveLength(9);
  });

  it("fixture covers hidden blocks, both embed providers and block overrides", () => {
    expect(fullDocument.blocks.some((b) => !b.visible)).toBe(true);
    const providers = fullDocument.blocks.flatMap((b) => (b.type === "embed" ? [b.provider] : []));
    expect(providers.sort()).toEqual(["spotify", "youtube"]);
    expect(fullDocument.blocks.some((b) => b.overrides !== undefined)).toBe(true);
  });

  it("accepts an empty page with no theme, no overrides and no avatar", () => {
    const result = pageDocumentSchema.safeParse({
      version: 1,
      profile: { displayName: "A", bio: "", avatarUrl: null },
      themeId: null,
      tokens: {},
      blocks: [],
    });
    expect(result.success).toBe(true);
  });

  it("accepts system-theme ids that are not RFC 4122 versions", () => {
    const doc = { ...mutableDocument(), themeId: "00000000-0000-0000-0000-00000000a001" };
    expect(pageDocumentSchema.safeParse(doc).success).toBe(true);
  });

  it("accepts a bio of exactly 160 characters", () => {
    const doc = mutableDocument();
    doc.profile.bio = "a".repeat(160);
    expect(pageDocumentSchema.safeParse(doc).success).toBe(true);
  });
});

describe("pageDocumentSchema: invalid documents", () => {
  it("rejects a bio of 161 characters", () => {
    const doc = mutableDocument();
    doc.profile.bio = "a".repeat(161);
    const result = pageDocumentSchema.safeParse(doc);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["profile", "bio"]);
  });

  it.each([
    ["empty display name", ""],
    ["whitespace-only display name", "   "],
    ["display name over 60", "n".repeat(61)],
  ])("rejects %s", (_name, displayName) => {
    const doc = mutableDocument();
    doc.profile.displayName = displayName;
    expect(pageDocumentSchema.safeParse(doc).success).toBe(false);
  });

  it("rejects an unsafe avatar URL", () => {
    const doc = mutableDocument();
    doc.profile.avatarUrl = "javascript:alert(1)";
    expect(pageDocumentSchema.safeParse(doc).success).toBe(false);
  });

  it("rejects a wrong version and unknown top-level keys", () => {
    expect(pageDocumentSchema.safeParse({ ...mutableDocument(), version: 2 }).success).toBe(false);
    expect(pageDocumentSchema.safeParse({ ...mutableDocument(), css: "body{}" }).success).toBe(
      false,
    );
  });

  it("rejects a theme id that is not a uuid", () => {
    expect(pageDocumentSchema.safeParse({ ...mutableDocument(), themeId: "noir" }).success).toBe(
      false,
    );
  });

  it("rejects invalid page-level token overrides", () => {
    const bad = { ...mutableDocument(), tokens: { fontHeading: "Papyrus" } };
    expect(pageDocumentSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects duplicate block ids", () => {
    const doc = mutableDocument();
    doc.blocks = [blockOfType("header"), blockOfType("header")];
    const result = pageDocumentSchema.safeParse(doc);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["blocks", 1, "id"]);
  });

  it("rejects more than the maximum number of blocks", () => {
    const doc = mutableDocument();
    doc.blocks = Array.from({ length: MAX_BLOCKS + 1 }, (_, i) => ({
      ...blockOfType("divider"),
      id: `divider-${String(i).padStart(4, "0")}`,
    }));
    expect(pageDocumentSchema.safeParse(doc).success).toBe(false);
    doc.blocks.pop();
    expect(pageDocumentSchema.safeParse(doc).success).toBe(true);
  });
});

describe("blockSchema: common fields", () => {
  it("rejects an unknown block type", () => {
    const result = documentWithBlock({ ...blockOfType("header"), type: "carousel" });
    expect(result.success).toBe(false);
  });

  it("rejects a block without a type", () => {
    const untyped = blockOfType("header");
    delete untyped.type;
    expect(documentWithBlock(untyped).success).toBe(false);
  });

  it.each([
    ["too short", "abc"],
    ["7 characters", "a".repeat(7)],
    ["25 characters", "a".repeat(25)],
    ["space", "has space1"],
    ["punctuation", "bad!chars12"],
    ["unicode", "blöck-id-01"],
    ["empty", ""],
  ])("rejects a block id that is %s", (_name, id) => {
    expect(documentWithBlock({ ...blockOfType("header"), id }).success).toBe(false);
  });

  it.each(["a".repeat(8), "a".repeat(24), "A-b_C-d_1234"])("accepts block id %s", (id) => {
    expect(documentWithBlock({ ...blockOfType("header"), id }).success).toBe(true);
  });

  it("requires the visible flag and rejects unknown block keys", () => {
    const noVisible = blockOfType("header");
    delete noVisible.visible;
    expect(documentWithBlock(noVisible).success).toBe(false);
    expect(documentWithBlock({ ...blockOfType("header"), onClick: "alert(1)" }).success).toBe(
      false,
    );
  });

  it("allows only the eight override keys on a block", () => {
    const withOverrides = (overrides: Json) => ({ ...blockOfType("link_button"), overrides });
    expect(documentWithBlock(withOverrides({ accent: "#112233", radius: 0 })).success).toBe(true);
    expect(documentWithBlock(withOverrides({ fontHeading: "Fraunces" })).success).toBe(false);
    expect(documentWithBlock(withOverrides({ bg: "#000000" })).success).toBe(false);
    expect(documentWithBlock(withOverrides({ accent: "javascript:1" })).success).toBe(false);
  });
});

describe("blockSchema: URLs", () => {
  it.each([
    ["javascript:", "javascript:alert(document.cookie)"],
    ["data:", "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=="],
    ["vbscript:", "vbscript:msgbox(1)"],
    ["file:", "file:///etc/passwd"],
    ["protocol-relative", "//evil.example/x"],
    ["credentials", "https://user:pw@evil.example"],
  ])("rejects a %s link_button url", (_name, url) => {
    expect(documentWithBlock({ ...blockOfType("link_button"), url }).success).toBe(false);
  });

  it.each([
    ["link_card url", "link_card", "url"],
    ["link_card imageUrl", "link_card", "imageUrl"],
    ["image url", "image", "url"],
    ["image linkUrl", "image", "linkUrl"],
  ])("rejects javascript: in %s", (_name, type, field) => {
    expect(
      documentWithBlock({ ...blockOfType(type), [field]: "javascript:alert(1)" }).success,
    ).toBe(false);
  });

  it("rejects data: and javascript: URLs inside grid items", () => {
    const grid = blockOfType("grid2") as Json & { items: Json[] };
    grid.items = [
      { title: "ok", url: "https://example.com" },
      { title: "bad", url: "data:text/html,x" },
    ];
    expect(documentWithBlock(grid).success).toBe(false);
    grid.items = [
      { title: "ok", url: "https://example.com" },
      { title: "bad", url: "https://example.com", imageUrl: "javascript:1" },
    ];
    expect(documentWithBlock(grid).success).toBe(false);
  });
});

describe("blockSchema: embed", () => {
  const embed = (provider: string, url: string) => ({ ...blockOfType("embed"), provider, url });

  it.each([
    ["youtube", "https://youtube.com/watch?v=jNQXAC9IVRw"],
    ["youtube", "https://www.youtube.com/watch?v=jNQXAC9IVRw"],
    ["youtube", "https://m.youtube.com/watch?v=jNQXAC9IVRw"],
    ["youtube", "https://youtu.be/jNQXAC9IVRw"],
    ["youtube", "https://WWW.YouTube.com/embed/jNQXAC9IVRw"],
    ["spotify", "https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC"],
  ])("accepts %s %s", (provider, url) => {
    expect(documentWithBlock(embed(provider, url)).success).toBe(true);
  });

  it.each([
    ["host outside the allowlist", "youtube", "https://vimeo.com/123456"],
    ["lookalike suffix", "youtube", "https://youtube.com.evil.example/watch?v=x"],
    ["lookalike prefix", "youtube", "https://evilyoutube.com/watch?v=x"],
    ["allowed host as userinfo", "youtube", "https://www.youtube.com@evil.example/"],
    ["other youtube subdomain", "youtube", "https://studio.youtube.com/"],
    ["spotify host on a youtube embed", "youtube", "https://open.spotify.com/track/abc"],
    ["youtube host on a spotify embed", "spotify", "https://www.youtube.com/watch?v=jNQXAC9IVRw"],
    ["bare spotify.com", "spotify", "https://spotify.com/track/abc"],
    ["javascript: url", "youtube", "javascript:alert(1)"],
    ["data: url", "spotify", "data:text/html,x"],
    ["unknown provider", "vimeo", "https://vimeo.com/123456"],
  ])("rejects %s", (_name, provider, url) => {
    expect(documentWithBlock(embed(provider, url)).success).toBe(false);
  });

  it("allowlist is exactly the contract's hosts", () => {
    expect([...EMBED_HOSTS.youtube].sort()).toEqual(
      ["m.youtube.com", "www.youtube.com", "youtu.be", "youtube.com"].sort(),
    );
    expect(EMBED_HOSTS.spotify).toEqual(["open.spotify.com"]);
  });
});

describe("blockSchema: social_row", () => {
  const social = (links: Json[]) => ({ ...blockOfType("social_row"), links });

  it("requires mailto: for email and http(s) for every other platform", () => {
    expect(
      documentWithBlock(social([{ platform: "email", url: "mailto:hi@example.com" }])).success,
    ).toBe(true);
    expect(
      documentWithBlock(social([{ platform: "email", url: "https://example.com" }])).success,
    ).toBe(false);
    expect(documentWithBlock(social([{ platform: "email", url: "hi@example.com" }])).success).toBe(
      false,
    );
    expect(
      documentWithBlock(social([{ platform: "github", url: "mailto:hi@example.com" }])).success,
    ).toBe(false);
    expect(documentWithBlock(social([{ platform: "x", url: "javascript:alert(1)" }])).success).toBe(
      false,
    );
  });

  it("accepts every contract platform", () => {
    const platforms = [
      "instagram",
      "tiktok",
      "youtube",
      "x",
      "facebook",
      "linkedin",
      "github",
      "spotify",
      "website",
    ];
    const links = platforms.map((platform) => ({
      platform,
      url: `https://example.com/${platform}`,
    }));
    expect(documentWithBlock(social(links)).success).toBe(true);
  });

  it("rejects an unknown platform, an empty row and more than 12 links", () => {
    expect(
      documentWithBlock(social([{ platform: "myspace", url: "https://example.com" }])).success,
    ).toBe(false);
    expect(documentWithBlock(social([])).success).toBe(false);
    const thirteen = Array.from({ length: 13 }, () => ({
      platform: "website",
      url: "https://example.com",
    }));
    expect(documentWithBlock(social(thirteen)).success).toBe(false);
    expect(documentWithBlock(social(thirteen.slice(0, 12))).success).toBe(true);
  });
});

describe("blockSchema: text limits", () => {
  const withField = (type: string, field: string, value: unknown) => ({
    ...blockOfType(type),
    [field]: value,
  });

  it.each([
    ["link_button label", "link_button", "label", 80],
    ["link_card title", "link_card", "title", 80],
    ["header text", "header", "text", 80],
    ["text text", "text", "text", 1000],
  ])("%s accepts the maximum and rejects one more", (_name, type, field, max) => {
    expect(documentWithBlock(withField(type, field, "a".repeat(max))).success).toBe(true);
    expect(documentWithBlock(withField(type, field, "a".repeat(max + 1))).success).toBe(false);
    expect(documentWithBlock(withField(type, field, "")).success).toBe(false);
  });

  it("limits link_card description to 160 and image alt to 200", () => {
    expect(documentWithBlock(withField("link_card", "description", "d".repeat(160))).success).toBe(
      true,
    );
    expect(documentWithBlock(withField("link_card", "description", "d".repeat(161))).success).toBe(
      false,
    );
    expect(documentWithBlock(withField("image", "alt", "")).success).toBe(true);
    expect(documentWithBlock(withField("image", "alt", "a".repeat(200))).success).toBe(true);
    expect(documentWithBlock(withField("image", "alt", "a".repeat(201))).success).toBe(false);
  });

  it("requires 2 to 12 grid items with titles up to 60", () => {
    const item = (n: number) => ({ title: `Item ${n}`, url: `https://example.com/${n}` });
    const items = (count: number) => Array.from({ length: count }, (_, i) => item(i));
    expect(documentWithBlock(withField("grid2", "items", items(1))).success).toBe(false);
    expect(documentWithBlock(withField("grid2", "items", items(2))).success).toBe(true);
    expect(documentWithBlock(withField("grid2", "items", items(12))).success).toBe(true);
    expect(documentWithBlock(withField("grid2", "items", items(13))).success).toBe(false);
    expect(
      documentWithBlock(
        withField("grid2", "items", [item(1), { ...item(2), title: "t".repeat(61) }]),
      ).success,
    ).toBe(false);
  });

  it("divider takes no extra fields", () => {
    expect(
      blockSchema.safeParse({ id: "divider-0001", type: "divider", visible: true }).success,
    ).toBe(true);
    expect(
      blockSchema.safeParse({ id: "divider-0001", type: "divider", visible: true, label: "x" })
        .success,
    ).toBe(false);
  });
});

describe("publishedDocumentSchema", () => {
  it("accepts the published fixture", () => {
    const result = publishedDocumentSchema.safeParse(fullPublishedDocument);
    expect(result.error?.issues).toBeUndefined();
    expect(result.success).toBe(true);
  });

  it("requires a complete resolvedTokens", () => {
    expect(publishedDocumentSchema.safeParse(fullDocument).success).toBe(false);

    const partial = { ...fullPublishedDocument, resolvedTokens: { accent: "#C9A86A" } };
    expect(publishedDocumentSchema.safeParse(partial).success).toBe(false);
  });

  it("applies the same content rules as a draft", () => {
    const doc = structuredClone(fullPublishedDocument) as unknown as Json & { profile: Json };
    doc.profile.bio = "a".repeat(161);
    expect(publishedDocumentSchema.safeParse(doc).success).toBe(false);
  });

  it("a draft does not accept resolvedTokens (strict)", () => {
    expect(pageDocumentSchema.safeParse(fullPublishedDocument).success).toBe(false);
  });
});
