import { describe, expect, it } from "vitest";
import {
  LIMITS,
  collectPublishErrors,
  draftDocSchema,
  emptyDraft,
  publishDocSchema,
  publishedDocSchema,
  toPublishForm,
  type DraftDoc,
} from "@/lib/document";
import { bannerIssues, isBannerEmpty, publishBanner } from "@/lib/document/page-extras";
import { blocks, draftWith, fullDraft, noirTokens } from "./fixtures/page-document";

/**
 * M9-23: the support banner in the document. The page-level `banner` key `{id, visible, text, label,
 * url}`: lenient in the draft, strict at Publish, trimmed and omitted when empty or hidden by
 * `toPublishForm`, and held to the page's unique-id rule.
 */

const BANNER_ID = "banner-0001a";
const banner = (over: Record<string, unknown> = {}) => ({
  id: BANNER_ID,
  visible: true,
  text: "Free shipping this week",
  label: "Shop",
  url: "https://shop.example/sale",
  ...over,
});
const withBanner = (value: unknown, ...docBlocks: unknown[]) => ({
  ...(draftWith(...docBlocks) as object),
  ...(value === undefined ? {} : { banner: value }),
});
const errorsOf = (draft: unknown) => collectPublishErrors(draft);
const messages = (draft: unknown) => errorsOf(draft).map((e) => `${e.field}: ${e.message}`);

describe("M9-23 the limits", () => {
  it("are 100 code points for the message and 30 for the label, in LIMITS", () => {
    expect(LIMITS.bannerText).toBe(100);
    expect(LIMITS.bannerLabel).toBe(30);
  });
});

describe("M9-23 Publish: what a banner must hold", () => {
  it.each([
    ["a message only", banner({ label: "", url: "" }), []],
    ["a message and a link", banner(), []],
    [
      "a hidden banner with nothing valid in it",
      banner({ visible: false, text: "", label: "x", url: "" }),
      [],
    ],
    ["a banner with nothing in it", banner({ text: "", label: "", url: "" }), []],
  ])("%s publishes", (_name, value, expected) => {
    expect(errorsOf(withBanner(value))).toEqual(expected);
  });

  it("a link without a label says 'Add a label for the link.' on banner.label", () => {
    expect(messages(withBanner(banner({ label: "" })))).toEqual([
      "banner.label: Add a label for the link.",
    ]);
  });

  it("a label without a link says the address message on banner.url", () => {
    expect(messages(withBanner(banner({ url: "" })))).toEqual([
      "banner.url: Enter a full web address, like https://example.com.",
    ]);
  });

  it("a link and a label without a message says 'Add the message.' on banner.text", () => {
    expect(messages(withBanner(banner({ text: "" })))).toEqual(["banner.text: Add the message."]);
  });

  it("a message of 101 characters is over the limit (100 code points; an emoji counts as one)", () => {
    expect(messages(withBanner(banner({ text: "a".repeat(101) })))).toEqual([
      "banner.text: Use 100 characters or fewer.",
    ]);
    expect(errorsOf(withBanner(banner({ text: "a".repeat(100) })))).toEqual([]);
    expect(errorsOf(withBanner(banner({ text: "\u{1F44D}".repeat(100) })))).toEqual([]);
    expect(messages(withBanner(banner({ label: "b".repeat(31) })))).toEqual([
      "banner.label: Use 30 characters or fewer.",
    ]);
    expect(errorsOf(withBanner(banner({ label: "b".repeat(30) })))).toEqual([]);
  });

  it.each([
    "javascript:alert(1)",
    "data:text/html,x",
    "//evil.example",
    "https://good.example@blocked.example/",
    "ftp://x.example/",
    "https://",
    "x".repeat(2100),
  ])("the address %s is refused with the address message", (url) => {
    expect(messages(withBanner(banner({ url })))).toContain(
      "banner.url: Enter a full web address, like https://example.com.",
    );
  });

  it("a control character or a line break in the message is refused (one line)", () => {
    expect(messages(withBanner(banner({ text: "one\ntwo" })))).toEqual([
      "banner.text: Remove line breaks and hidden control characters.",
    ]);
    expect(messages(withBanner(banner({ text: "a\u0007b" })))).toEqual([
      "banner.text: Remove line breaks and hidden control characters.",
    ]);
    expect(messages(withBanner(banner({ text: "a‮b" })))).toEqual([
      "banner.text: Remove line breaks and hidden control characters.",
    ]);
  });

  it("visible:false drops the banner at Publish: a hidden banner with a bad address does not stop it", () => {
    const draft = withBanner(banner({ visible: false, url: "javascript:alert(1)" }));
    expect(errorsOf(draft)).toEqual([]);
    const parsed = publishDocSchema.parse(draft) as DraftDoc;
    expect(toPublishForm(parsed, null).banner).toBeUndefined();
  });

  it("a banner whose id is a block's id is refused: 'Ids must be unique within a page.'", () => {
    // The banner's id is read first, so the second holder, the block, is the one named.
    const clash = withBanner(banner({ id: blocks.link.id }), blocks.link);
    expect(messages(clash)).toEqual(["id: Ids must be unique within a page."]);
    expect(errorsOf(clash)[0]!.blockId).toBe(blocks.link.id);
    // The same id on a block that comes later.
    expect(errorsOf(withBanner(banner(), { ...blocks.link, id: BANNER_ID })).length).toBe(1);
  });

  it("a banner id that is not a valid id is refused", () => {
    expect(draftDocSchema.safeParse(withBanner(banner({ id: "short" }))).success).toBe(false);
    expect(draftDocSchema.safeParse(withBanner(banner({ id: "x y z a b c d e" }))).success).toBe(
      false,
    );
  });

  it("abuse written as raw JSON: 5,000 characters, a data: address and an id equal to a block id are refused", () => {
    expect(draftDocSchema.safeParse(withBanner(banner({ text: "x".repeat(5000) }))).success).toBe(
      false,
    );
    expect(messages(withBanner(banner({ text: "x".repeat(5000) })))[0]).toContain(
      "Use 100 characters or fewer.",
    );
    expect(messages(withBanner(banner({ url: "data:text/html,x" })))).toContain(
      "banner.url: Enter a full web address, like https://example.com.",
    );
    expect(errorsOf(withBanner(banner({ id: blocks.header.id }), blocks.header)).length).toBe(1);
  });

  it("unknown keys are stripped on parse and never reach the published form", () => {
    const parsed = draftDocSchema.parse(
      withBanner(banner({ onclick: "x()", html: "<b>", style: "color:red" })),
    );
    expect(Object.keys(parsed.banner!).sort()).toEqual(["id", "label", "text", "url", "visible"]);
  });
});

describe("M9-23 toPublishForm", () => {
  const draft = (value: unknown): DraftDoc =>
    draftDocSchema.parse(withBanner(value, blocks.header)) as DraftDoc;

  it("trims every text and writes visible:true", () => {
    const form = toPublishForm(
      draft(banner({ text: "  Hello  ", label: " Shop ", url: " https://shop.example/sale " })),
      noirTokens,
    );
    expect(form.banner).toEqual({
      id: BANNER_ID,
      visible: true,
      text: "Hello",
      label: "Shop",
      url: "https://shop.example/sale",
    });
  });

  it("omits an empty banner and a hidden one: no key at all", () => {
    expect("banner" in toPublishForm(draft(banner({ text: "", label: "", url: "" })), null)).toBe(
      false,
    );
    expect(
      "banner" in toPublishForm(draft(banner({ text: "  ", label: " ", url: " " })), null),
    ).toBe(false);
    expect("banner" in toPublishForm(draft(banner({ visible: false })), null)).toBe(false);
  });

  it("a page that never used a banner publishes byte-identically to before", () => {
    const plain = toPublishForm(fullDraft, noirTokens);
    expect(JSON.stringify(plain)).not.toContain('"banner":');
    // The same draft with a hidden banner is the same document, byte for byte.
    const hidden = toPublishForm(
      { ...fullDraft, banner: { id: BANNER_ID, visible: false, text: "x", label: "", url: "" } },
      noirTokens,
    );
    expect(JSON.stringify(hidden)).toBe(JSON.stringify(plain));
  });

  it("the form of a draft with a banner passes the strict published schema, and round-trips", () => {
    const form = toPublishForm(draft(banner()), noirTokens);
    const parsed = publishedDocSchema.parse(form);
    expect(parsed.banner).toEqual(form.banner);
  });

  it("a stored published document holding a banner with no message does not parse (the gate refuses it)", () => {
    const form = toPublishForm(draft(banner()), noirTokens);
    const bad = { ...form, banner: { ...form.banner!, text: "" } };
    expect(publishedDocSchema.safeParse(bad).success).toBe(false);
  });
});

describe("M9-23 the pure helpers", () => {
  it("bannerIssues: empty is fine; text is required once anything is filled in; label and link go together", () => {
    expect(bannerIssues({ text: "", label: "", url: "" })).toEqual([]);
    expect(bannerIssues({ text: "a", label: "", url: "" })).toEqual([]);
    expect(bannerIssues({ text: "a", label: "l", url: "u" })).toEqual([]);
    expect(bannerIssues({ text: "", label: "l", url: "u" }).map((i) => i.field)).toEqual(["text"]);
    expect(bannerIssues({ text: "a", label: "", url: "u" }).map((i) => i.field)).toEqual(["label"]);
    expect(bannerIssues({ text: "a", label: "l", url: "" }).map((i) => i.field)).toEqual(["url"]);
    expect(bannerIssues({ text: "", label: "", url: "u" }).map((i) => i.field)).toEqual([
      "text",
      "label",
    ]);
  });

  it("isBannerEmpty trims; publishBanner is total on any input shape", () => {
    expect(isBannerEmpty(undefined)).toBe(true);
    expect(isBannerEmpty({ text: " ", label: "\t", url: "" })).toBe(true);
    expect(isBannerEmpty({ text: "a", label: "", url: "" })).toBe(false);
    expect(publishBanner(undefined)).toBeUndefined();
    expect(publishBanner({ id: BANNER_ID, text: "a", label: "", url: "" })).toEqual({
      id: BANNER_ID,
      visible: true,
      text: "a",
      label: "",
      url: "",
    });
  });

  it("the empty draft has no banner key", () => {
    expect("banner" in emptyDraft("mara")).toBe(false);
  });
});
