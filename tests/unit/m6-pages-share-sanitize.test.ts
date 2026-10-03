import { describe, expect, it } from "vitest";
import {
  publishedDocSchema,
  stripHiddenCharacters,
  toPublishForm,
  type Block,
  type DraftDoc,
} from "@/lib/document";
import { sanitizeSharedDoc } from "@/lib/previews/sanitize";

/**
 * M6-10 (Wave F review): a share link shows a draft that never went through Publish, and a lenient
 * draft may hold the control and bidi characters the Publish gate refuses. A shared draft is stripped
 * of them, with the very rules of the gate (`CONTROL`, `CONTROL_EXCEPT_NEWLINE`, `BIDI`), so a label
 * cannot read backwards or look like HYDLNK's own words to whoever holds the link.
 */

const RLO = "\u202E"; // right-to-left override
const LRI = "\u2066"; // left-to-right isolate
const PDI = "\u2069"; // pop directional isolate
const BEL = "\u0007";
const NUL = "\u0000";
const NEL = "\u0085"; // a C1 control

describe("M6-10 stripHiddenCharacters", () => {
  it("removes C0 and C1 controls and the bidi overrides and isolates, and trims", () => {
    expect(stripHiddenCharacters(`  Pay${RLO}pal${BEL}now${NUL}${NEL}  `)).toBe("Paypalnow");
    expect(stripHiddenCharacters(`a${LRI}b${PDI}c\u202A\u202B\u202C\u202D\u2067\u2068`)).toBe(
      "abc",
    );
    expect(stripHiddenCharacters("a\tb\nc\rd\u007Fe\u009Ff")).toBe("abcdef");
  });

  it("keeps a newline only when it is multiline, and never the other controls", () => {
    expect(stripHiddenCharacters(`one\ntwo${BEL}${RLO}`, { multiline: true })).toBe("one\ntwo");
    expect(stripHiddenCharacters("one\ntwo")).toBe("onetwo");
    // A tab is a control character in a text block too: the gate refuses it there as well.
    expect(stripHiddenCharacters("a\tb", { multiline: true })).toBe("ab");
  });

  it("leaves everything else alone: letters of every script, emoji and joiners, spaces inside", () => {
    const text =
      "\u00DCn\u00EFc\u00F6d\u00E9 \u65E5\u672C\u8A9E \u0627\u0644\u0639\u0631\u0628\u064A\u0629 \u05E9\u05DC\u05D5\u05DD " +
      "\u{1F468}\u200D\u{1F469}\u200D\u{1F467} a b  c \u200D\u200C\u200E\u200B";
    expect(stripHiddenCharacters(text)).toBe(text.trim());
  });
});

const draftWith = (blocks: Block[], profile?: Partial<DraftDoc["profile"]>): DraftDoc => ({
  version: 1,
  rev: 3,
  profile: { name: `Ada${RLO}lovelace`, bio: `Bi${BEL}o${LRI}`, photo: null, ...profile },
  theme: { ref: null, overrides: {} },
  blocks,
});

const doc = (blocks: Block[], profile?: Partial<DraftDoc["profile"]>) =>
  toPublishForm(draftWith(blocks, profile), null);

describe("M6-10 sanitizeSharedDoc", () => {
  it("cleans the profile name and bio", () => {
    const clean = sanitizeSharedDoc(doc([]));
    expect(clean.profile.name).toBe("Adalovelace");
    expect(clean.profile.bio).toBe("Bio");
  });

  it("cleans every text of every block type", () => {
    const blocks = [
      {
        id: "lnk-00000001",
        type: "link",
        visible: true,
        label: `Pay${RLO}pal`,
        url: "https://example.com/a",
      },
      {
        id: "crd-00000001",
        type: "card",
        visible: true,
        title: `Ti${BEL}tle`,
        caption: `Ca${RLO}ption`,
        url: "https://example.com/c",
        image: null,
      },
      { id: "hdr-00000001", type: "header", visible: true, text: `He${LRI}ad${PDI}` },
      { id: "img-00000001", type: "image", visible: true, image: null, alt: `Al${NEL}t`, url: "" },
      { id: "emb-00000001", type: "embed", visible: true, url: "", caption: `Ca${RLO}p` },
      {
        id: "grd-00000001",
        type: "grid",
        visible: true,
        cells: [
          {
            id: "cll-00000001",
            title: `Ce${RLO}ll`,
            subtitle: `Su${BEL}b`,
            url: "https://example.com/g",
          },
        ],
      },
      {
        id: "soc-00000001",
        type: "social",
        visible: true,
        icons: [
          { id: "ico-00000001", platform: "instagram", url: `https://instagram.com/x${RLO}` },
        ],
      },
    ] as Block[];
    const clean = sanitizeSharedDoc(doc(blocks));
    const text = JSON.stringify(clean.blocks);
    expect(text).not.toMatch(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u202A-\u202E\u2066-\u2069]/);
    const byId = (id: string) =>
      clean.blocks.find((block) => block.id === id) as never as Record<string, unknown>;
    expect(byId("lnk-00000001").label).toBe("Paypal");
    expect(byId("crd-00000001").title).toBe("Title");
    expect(byId("crd-00000001").caption).toBe("Caption");
    expect(byId("hdr-00000001").text).toBe("Head");
    expect(byId("img-00000001").alt).toBe("Alt");
    expect(byId("emb-00000001").caption).toBe("Cap");
    expect((byId("grd-00000001").cells as { title: string; subtitle: string }[])[0]).toMatchObject({
      title: "Cell",
      subtitle: "Sub",
    });
  });

  it("keeps the line breaks of a text block, and only there", () => {
    const blocks = [
      { id: "txt-00000001", type: "text", visible: true, text: `One\nTwo${RLO}\n\nThree${BEL}` },
      { id: "hdr-00000001", type: "header", visible: true, text: "A" },
    ] as Block[];
    const clean = sanitizeSharedDoc(doc(blocks));
    expect((clean.blocks[0] as { text: string }).text).toBe("One\nTwo\n\nThree");
  });

  it("changes nothing else: ids, types, order, the tokens, the theme and a clean document are the same", () => {
    const blocks = [
      {
        id: "lnk-00000001",
        type: "link",
        visible: true,
        label: "Plain",
        url: "https://example.com/a",
      },
      { id: "txt-00000001", type: "text", visible: true, text: "Line one\nLine two" },
    ] as Block[];
    const before = doc(blocks, { name: "Plain name", bio: "A plain bio." });
    const after = sanitizeSharedDoc(before);
    expect(after).toEqual(before);
    // It does not mutate what it was given.
    const dirty = doc(blocks);
    const copy = JSON.parse(JSON.stringify(dirty));
    sanitizeSharedDoc(dirty);
    expect(dirty).toEqual(copy);
    expect(after.tokens).toBe(before.tokens);
  });

  it("what it returns passes the Publish gate's text rules (it is what the gate would have required)", () => {
    const blocks = [
      {
        id: "lnk-00000001",
        type: "link",
        visible: true,
        label: `Pay${RLO}pal`,
        url: "https://example.com/a",
      },
      { id: "txt-00000001", type: "text", visible: true, text: `A\nB${BEL}` },
    ] as Block[];
    const dirty = doc(blocks);
    expect(publishedDocSchema.safeParse(dirty).success).toBe(false);
    const clean = sanitizeSharedDoc(dirty);
    const parsed = publishedDocSchema.safeParse(clean);
    expect(parsed.success, JSON.stringify(parsed.success ? null : parsed.error.issues)).toBe(true);
  });
});
