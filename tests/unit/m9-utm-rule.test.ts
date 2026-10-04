import { describe, expect, it } from "vitest";
import {
  UTM_KEYS,
  UTM_PATTERN_MESSAGE,
  collectPublishErrors,
  draftDocSchema,
  publishDocSchema,
  publishedDocSchema,
  toPublishForm,
  utmExample,
  utmValueError,
  validUtmValue,
  withUtm,
  type DraftDoc,
} from "@/lib/document";
import { blocks, draftWith, fullDraft, fullPublished, noirTokens } from "./fixtures/page-document";

/**
 * M9-27 UTM tags: the value rule, the one pure function `withUtm`, the schema in both forms and the
 * publish form (a page that never sets one publishes the same bytes as before).
 */

const PAGE = { source: "hydlnk", medium: "link-in-bio", campaign: "spring" };

describe("M9-27 the value rule", () => {
  const valid = [
    "hydlnk",
    "link-in-bio",
    "spring launch",
    "a.b_c~d",
    "Q4 2026",
    "é",
    "1",
    "Frühling",
  ];
  const invalid = [
    "a&utm_medium=x",
    "a=b",
    "a\nb",
    "a\r\nb",
    "a\tb",
    "a#b",
    "a?b",
    "a%20b",
    "a+b",
    "a/b",
    "a;b",
    "<b>x</b>",
    "x".repeat(41),
    "",
    "   ",
    "a​b",
    "a‮b",
  ];

  it.each(valid)("accepts %j", (value) => {
    expect(utmValueError(value)).toBeNull();
    expect(validUtmValue(value)).toBe(value.trim());
  });

  it.each(invalid)("refuses %j", (value) => {
    expect(utmValueError(value)).not.toBeNull();
    expect(validUtmValue(value)).toBeUndefined();
  });

  it("is judged trimmed, with exactly 40 code points the longest", () => {
    expect(utmValueError("  spring  ")).toBeNull();
    expect(validUtmValue("  spring  ")).toBe("spring");
    expect(utmValueError("x".repeat(40))).toBeNull();
    expect(utmValueError("é".repeat(40))).toBeNull();
    expect(utmValueError("x".repeat(41))).toMatch(/40 characters or fewer/);
    expect(utmValueError("a&b")).toBe(UTM_PATTERN_MESSAGE);
  });

  it("refuses a value that is not a string", () => {
    for (const value of [undefined, null, 5, {}, ["a"]])
      expect(validUtmValue(value)).toBeUndefined();
  });
});

describe("M9-27 withUtm", () => {
  const cases: [
    string,
    string,
    Parameters<typeof withUtm>[1],
    Parameters<typeof withUtm>[2],
    string,
  ][] = [
    [
      "appends after the query and before the fragment",
      "https://shop.example/p?id=1#top",
      { source: "hydlnk" },
      undefined,
      "https://shop.example/p?id=1&utm_source=hydlnk#top",
    ],
    [
      "starts a query with ?",
      "https://shop.example/p",
      { source: "hydlnk" },
      undefined,
      "https://shop.example/p?utm_source=hydlnk",
    ],
    [
      "puts ? before a fragment",
      "https://shop.example/p#top",
      { source: "hydlnk" },
      undefined,
      "https://shop.example/p?utm_source=hydlnk#top",
    ],
    [
      "writes all three page defaults in the order source, medium, campaign",
      "https://shop.example/p",
      PAGE,
      undefined,
      "https://shop.example/p?utm_source=hydlnk&utm_medium=link-in-bio&utm_campaign=spring",
    ],
    [
      "a link's own value wins over the page's",
      "https://shop.example/p",
      PAGE,
      { source: "newsletter" },
      "https://shop.example/p?utm_source=newsletter&utm_medium=link-in-bio&utm_campaign=spring",
    ],
    [
      "an empty own value follows the page default",
      "https://shop.example/p",
      PAGE,
      { source: "", medium: "  " },
      "https://shop.example/p?utm_source=hydlnk&utm_medium=link-in-bio&utm_campaign=spring",
    ],
    [
      "off adds nothing at all",
      "https://shop.example/p",
      PAGE,
      { off: true, source: "x" },
      "https://shop.example/p",
    ],
    [
      "a parameter the destination already carries is left as it is",
      "https://shop.example/p?utm_source=partner",
      PAGE,
      undefined,
      "https://shop.example/p?utm_source=partner&utm_medium=link-in-bio&utm_campaign=spring",
    ],
    [
      "all three already there: unchanged",
      "https://shop.example/p?utm_campaign=a&utm_medium=b&utm_source=c#x",
      PAGE,
      { source: "z" },
      "https://shop.example/p?utm_campaign=a&utm_medium=b&utm_source=c#x",
    ],
    [
      "the existing query is kept byte for byte, in its order",
      "https://shop.example/p?z=1&a=%20x%2Fy&b=a+b&c",
      { source: "hydlnk" },
      undefined,
      "https://shop.example/p?z=1&a=%20x%2Fy&b=a+b&c&utm_source=hydlnk",
    ],
    [
      "an empty query (a bare ?) gets no extra &",
      "https://shop.example/p?",
      { source: "hydlnk" },
      undefined,
      "https://shop.example/p?utm_source=hydlnk",
    ],
    [
      "a query that ends in & gets no second &",
      "https://shop.example/p?a=1&",
      { source: "hydlnk" },
      undefined,
      "https://shop.example/p?a=1&utm_source=hydlnk",
    ],
    [
      "a space is percent-encoded by URLSearchParams",
      "https://shop.example/p",
      { campaign: "spring launch" },
      undefined,
      "https://shop.example/p?utm_campaign=spring+launch",
    ],
    [
      "a bare origin keeps no trailing slash it did not have",
      "https://shop.example",
      { source: "hydlnk" },
      undefined,
      "https://shop.example?utm_source=hydlnk",
    ],
    [
      "a port, a userless host and the path are never changed",
      "http://shop.example:8080/a/b/c.html?x=1",
      { medium: "m" },
      undefined,
      "http://shop.example:8080/a/b/c.html?x=1&utm_medium=m",
    ],
    [
      "nothing set: exactly the published URL",
      "https://shop.example/p?id=1",
      undefined,
      undefined,
      "https://shop.example/p?id=1",
    ],
    [
      "empty defaults: exactly the published URL",
      "https://shop.example/p",
      {},
      {},
      "https://shop.example/p",
    ],
    [
      "an invalid stored value is skipped",
      "https://shop.example/p",
      { source: "a&utm_medium=evil", medium: "ok", campaign: "x=y" },
      undefined,
      "https://shop.example/p?utm_medium=ok",
    ],
    [
      "a value with a line break cannot inject a header",
      "https://shop.example/p",
      { source: "a\r\nSet-Cookie: x=1" },
      undefined,
      "https://shop.example/p",
    ],
    [
      "the scheme's case is kept",
      "HTTPS://shop.example/p",
      { source: "hydlnk" },
      undefined,
      "HTTPS://shop.example/p?utm_source=hydlnk",
    ],
  ];

  it.each(cases)("%s", (_name, target, page, link, expected) => {
    expect(withUtm(target, page, link)).toBe(expected);
  });

  it("leaves anything that is not an http or https URL unchanged", () => {
    for (const target of [
      "mailto:hello@maraokafor.com",
      "tel:+15551234567",
      "javascript:alert(1)",
      "data:text/html,x",
      "ftp://example.com/file",
      "//example.com/p",
      "/relative/path",
      "not a url",
      "",
      "https://",
      "https://user:pw@example.com/p",
    ]) {
      expect(withUtm(target, PAGE, undefined)).toBe(target);
    }
  });

  it("is total: a value that is not a string comes back as it was", () => {
    expect(withUtm(undefined as unknown as string, PAGE)).toBeUndefined();
    expect(withUtm(null as unknown as string, PAGE)).toBeNull();
  });

  it("adds nothing when the result would be longer than 2048 characters", () => {
    const base = "https://shop.example/p?q=";
    const room = 2048 - base.length;
    const exact = base + "a".repeat(room - "&utm_source=hydlnk".length);
    expect(exact.length + "&utm_source=hydlnk".length).toBe(2048);
    expect(withUtm(exact, { source: "hydlnk" })).toBe(`${exact}&utm_source=hydlnk`);
    const over = exact + "a";
    expect(withUtm(over, { source: "hydlnk" })).toBe(over);
  });

  it("never changes the host, the path or the fragment, whatever the values", () => {
    const target = "https://Shop.Example/Path/%7Euser?x=1#Frag%20ment";
    const out = withUtm(target, PAGE, { campaign: "Q4 2026" });
    const before = new URL(target);
    const after = new URL(out);
    expect(after.host).toBe(before.host);
    expect(after.pathname).toBe(before.pathname);
    expect(after.hash).toBe(before.hash);
    expect(out.startsWith("https://Shop.Example/Path/%7Euser?x=1&")).toBe(true);
    expect(out.endsWith("#Frag%20ment")).toBe(true);
  });

  it("a hostile object cannot reach the Object prototype", () => {
    const hostile = JSON.parse('{"__proto__":{"source":"evil"},"source":"ok"}') as {
      source: string;
    };
    expect(withUtm("https://a.example/", {}, hostile)).toBe("https://a.example/?utm_source=ok");
    expect(withUtm("https://a.example/", JSON.parse('{"__proto__":{"source":"evil"}}'))).toBe(
      "https://a.example/",
    );
  });

  it("the example line is withUtm of https://example.com/page", () => {
    expect(utmExample(PAGE)).toBe(withUtm("https://example.com/page", PAGE));
    expect(utmExample(PAGE, { off: true })).toBe("https://example.com/page");
    expect(utmExample(PAGE, { source: "n" }, "https://x.example/y")).toBe(
      "https://x.example/y?utm_source=n&utm_medium=link-in-bio&utm_campaign=spring",
    );
  });
});

describe("M9-27 the schema, draft and Publish", () => {
  const link = (extra: Record<string, unknown>) => ({ ...blocks.link, ...extra });

  it("the draft is lenient (any string up to 100 characters), Publish is strict, and both name the field", () => {
    const half = draftWith(link({ utm: { source: "a&b", medium: "x".repeat(100) } }));
    expect(draftDocSchema.safeParse(half).success).toBe(true);
    const errors = collectPublishErrors(half);
    expect(errors.map((e) => `${e.blockId}|${e.field}`).sort()).toEqual(
      [`${blocks.link.id}|utm.medium`, `${blocks.link.id}|utm.source`].sort(),
    );
    expect(errors.find((e) => e.field === "utm.source")?.message).toBe(UTM_PATTERN_MESSAGE);
    expect(
      draftDocSchema.safeParse(draftWith(link({ utm: { source: "x".repeat(101) } }))).success,
    ).toBe(false);
  });

  it("accepts the valid shapes at Publish", () => {
    for (const utm of [
      {},
      { source: "newsletter" },
      { off: true },
      { source: "a b", medium: "c.d", campaign: "e_f-g~h" },
    ]) {
      expect(publishDocSchema.safeParse(draftWith(link({ utm }))).success).toBe(true);
    }
  });

  it("refuses at Publish: &, =, line break, tab, #, ?, %, 41 characters, an empty string and off:'yes'", () => {
    for (const bad of [
      "a&utm_medium=x",
      "a=b",
      "a\nb",
      "a\tb",
      "a#b",
      "a?b",
      "a%b",
      "x".repeat(41),
      "",
    ]) {
      const errors = collectPublishErrors(draftWith(link({ utm: { source: bad } })));
      expect(errors.map((e) => e.field)).toEqual(["utm.source"]);
    }
    const off = collectPublishErrors(draftWith(link({ utm: { off: "yes" } })));
    expect(off.map((e) => e.field)).toEqual(["utm.off"]);
  });

  it("the page's defaults follow the same rules, under the field named", () => {
    const doc = { ...(draftWith(blocks.link) as object), utm: { source: "a&b", campaign: "ok" } };
    expect(draftDocSchema.safeParse(doc).success).toBe(true);
    expect(collectPublishErrors(doc).map((e) => `${e.blockId}|${e.field}`)).toEqual([
      "null|utm.source",
    ]);
    const good = { ...(draftWith(blocks.link) as object), utm: PAGE };
    expect(collectPublishErrors(good)).toEqual([]);
  });

  it("a hidden block holding a bad value does not stop Publish", () => {
    const doc = draftWith(
      link({ visible: false, utm: { source: "a&b", off: "yes" } }),
      blocks.header,
    );
    expect(draftDocSchema.safeParse(doc).success).toBe(true);
    expect(collectPublishErrors(doc)).toEqual([]);
  });

  it("a utm on a card or a social icon is stripped, never an error and never published", () => {
    const card = { ...blocks.card, utm: { source: "x" } };
    const social = {
      ...blocks.social,
      utm: { source: "x" },
      icons: blocks.social.icons.map((icon) => ({ ...icon, utm: { source: "x" } })),
    };
    const doc = draftWith(card, social);
    expect(collectPublishErrors(doc)).toEqual([]);
    const parsed = draftDocSchema.parse(doc);
    expect(JSON.stringify(parsed)).not.toContain("utm");
    expect(JSON.stringify(toPublishForm(parsed as DraftDoc, noirTokens))).not.toContain("utm");
  });

  it("unknown keys inside utm are stripped", () => {
    const parsed = draftDocSchema.parse(
      draftWith(link({ utm: { source: "a", evil: "b", term: "c" } })),
    );
    expect((parsed.blocks[0] as { utm: object }).utm).toEqual({ source: "a" });
  });
});

describe("M9-27 the publish form", () => {
  const draftOf = (
    extra: Record<string, unknown>,
    blockExtra: Record<string, unknown> = {},
  ): DraftDoc =>
    ({
      ...(fullDraft as object),
      ...extra,
      blocks: [{ ...blocks.link, ...blockExtra }],
    }) as DraftDoc;

  it("a page that never sets one publishes exactly the keys it did before", () => {
    const doc = toPublishForm(draftOf({}), noirTokens);
    expect(Object.keys(doc)).not.toContain("utm");
    expect(Object.keys(doc)).not.toContain("redirect");
    expect(Object.keys(doc.blocks[0]!)).not.toContain("utm");
    expect(Object.keys(doc.blocks[0]!)).not.toContain("lock");
    for (const block of fullPublished.blocks) {
      expect(Object.keys(block)).not.toContain("utm");
      expect(Object.keys(block)).not.toContain("lock");
    }
    expect(Object.keys(fullPublished)).not.toContain("utm");
    expect(Object.keys(fullPublished)).not.toContain("redirect");
  });

  it("trims the values, leaves out the empty ones and writes nothing for an all-empty object", () => {
    expect(
      toPublishForm(
        draftOf({ utm: { source: "  hydlnk  ", medium: "", campaign: "   " } }),
        noirTokens,
      ).utm,
    ).toEqual({
      source: "hydlnk",
    });
    expect(
      Object.keys(toPublishForm(draftOf({ utm: { source: "", medium: " " } }), noirTokens)),
    ).not.toContain("utm");
    expect(Object.keys(toPublishForm(draftOf({ utm: {} }), noirTokens))).not.toContain("utm");
    const block = toPublishForm(draftOf({}, { utm: {} }), noirTokens).blocks[0]!;
    expect(Object.keys(block)).not.toContain("utm");
  });

  it("a link's own tags: the values, or {off: true} alone", () => {
    const own = toPublishForm(draftOf({}, { utm: { source: " n ", campaign: "c" } }), noirTokens)
      .blocks[0] as { utm?: unknown };
    expect(own.utm).toEqual({ source: "n", campaign: "c" });
    const off = toPublishForm(draftOf({}, { utm: { off: true, source: "n" } }), noirTokens)
      .blocks[0] as { utm?: unknown };
    expect(off.utm).toEqual({ off: true });
    const notOff = toPublishForm(draftOf({}, { utm: { off: false, source: "n" } }), noirTokens)
      .blocks[0] as { utm?: unknown };
    expect(notOff.utm).toEqual({ source: "n" });
  });

  it("the stored form parses with the published schema, and equal drafts give equal forms", () => {
    const draft = draftOf({ utm: PAGE }, { utm: { source: "n" } });
    const form = toPublishForm(draft, noirTokens);
    expect(publishedDocSchema.safeParse(form).success).toBe(true);
    expect(toPublishForm(structuredClone(draft), noirTokens)).toEqual(form);
    for (const key of UTM_KEYS) expect(form.utm?.[key]).toBe(PAGE[key]);
  });
});
