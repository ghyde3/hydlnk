import { describe, expect, it } from "vitest";
import {
  BLOCK_ID_PATTERN,
  LIMITS,
  blockDefaults,
  collectPublishErrors,
  draftDocSchema,
  newFaqItem,
  publishDocSchema,
  publishedDocSchema,
  toPublishForm,
  type Block,
  type DraftDoc,
} from "@/lib/document";
import { duplicateBlock, collectIds } from "@/lib/editor/duplicate";
import { blockRowSummary } from "@/components/blocks/summary";
import { draftWith, noirTokens } from "./fixtures/page-document";

/**
 * M9-16 (schema side): the `faq` block. 1 to 10 items of a one-line question and a multi-line
 * answer, lenient draft, strict Publish, a Publish form that trims and normalizes line breaks and
 * drops unknown keys, ids that are unique across the page.
 */

const item = (n: number, question = `Question ${n}?`, answer = `Answer ${n}.`) => ({
  id: `faq-item-${String(n).padStart(4, "0")}`,
  question,
  answer,
});
const faq = (items: unknown[], extra: Record<string, unknown> = {}) => ({
  id: "faq-block-0001",
  type: "faq",
  visible: true,
  items,
  ...extra,
});
const items = (n: number) => Array.from({ length: n }, (_, i) => item(i + 1));

const draftOk = (block: unknown) => draftDocSchema.safeParse(draftWith(block)).success;
const publishOk = (block: unknown) => publishDocSchema.safeParse(draftWith(block)).success;
const errorsOf = (block: unknown) => collectPublishErrors(draftWith(block));

describe("M9-16 the faq schema", () => {
  it.each([
    ["0 items", [], false, "Add at least one question."],
    ["1 item", items(1), true, null],
    ["10 items", items(10), true, null],
    ["11 items", items(11), false, "Use up to 10 questions."],
  ])("%s", (_name, list, publishable, message) => {
    expect(publishOk(faq(list))).toBe(publishable);
    if (message) expect(errorsOf(faq(list)).map((e) => e.message)).toContain(message);
    // A draft keeps any list (a hidden block must not stop Publish, and Publish names the block).
    expect(draftOk(faq(list))).toBe(true);
  });

  it("a hidden block with 0 items does not stop Publish, and is dropped from the form", () => {
    const draft = draftWith(faq([], { visible: false }), {
      id: "header-xxxxxx-1",
      type: "header",
      visible: true,
      text: "Hi",
    });
    expect(publishDocSchema.safeParse(draft).success).toBe(true);
    const form = toPublishForm(draftDocSchema.parse(draft), noirTokens);
    expect(form.blocks.map((b) => b.type)).toEqual(["header"]);
  });

  it("limits: a 120-character question and a 600-character answer pass, one more fails with the field named", () => {
    const edge = [item(1, "q".repeat(LIMITS.faqQuestion), "a".repeat(LIMITS.faqAnswer))];
    expect(publishOk(faq(edge))).toBe(true);
    const long = [item(1, "q".repeat(LIMITS.faqQuestion + 1), "a".repeat(LIMITS.faqAnswer + 1))];
    expect(publishOk(faq(long))).toBe(false);
    const errors = errorsOf(faq(long));
    expect(errors.map((e) => `${e.itemId}:${e.field}`).sort()).toEqual([
      "faq-item-0001:answer",
      "faq-item-0001:question",
    ]);
    expect(
      errors.every((e) => e.message === undefined || /characters or fewer/.test(e.message)),
    ).toBe(true);
  });

  it("counts code points, not UTF-16 units: 120 emoji are a legal question", () => {
    expect(publishOk(faq([item(1, "😀".repeat(120))]))).toBe(true);
    expect(publishOk(faq([item(1, "😀".repeat(121))]))).toBe(false);
  });

  it("an empty question and an empty answer fail at Publish with the two sentences, the draft keeps them", () => {
    const block = faq([item(1, "", ""), item(2)]);
    expect(draftOk(block)).toBe(true);
    expect(errorsOf(block)).toEqual([
      {
        blockId: "faq-block-0001",
        itemId: "faq-item-0001",
        field: "question",
        message: "Add a question.",
      },
      {
        blockId: "faq-block-0001",
        itemId: "faq-item-0001",
        field: "answer",
        message: "Add an answer.",
      },
    ]);
  });

  it("a control character in a question is refused (one line); in an answer only a line break is allowed", () => {
    expect(publishOk(faq([item(1, "Line\nbreak")]))).toBe(false);
    expect(publishOk(faq([item(1, "Tab\there")]))).toBe(false);
    expect(publishOk(faq([item(1, "Bidi ‮")]))).toBe(false);
    expect(publishOk(faq([item(1, "ok", "one\ntwo\nthree")]))).toBe(true);
    expect(publishOk(faq([item(1, "ok", "bell\u0007")]))).toBe(false);
    expect(publishOk(faq([item(1, "ok", "bidi ⁦")]))).toBe(false);
  });

  it("a missing item id and a bad item id are refused, in the draft too", () => {
    const { id: _id, ...noId } = item(1);
    void _id;
    expect(draftOk(faq([noId]))).toBe(false);
    expect(draftOk(faq([{ ...item(1), id: "short" }]))).toBe(false);
    expect(draftOk(faq([{ ...item(1), id: "has space in it" }]))).toBe(false);
  });

  it("an extra key (`open`, `html`) is stripped, in the block and in an item", () => {
    const parsed = draftDocSchema.parse(
      draftWith(
        faq([{ ...item(1), open: true, html: "<b>x</b>" }], { open: true, html: "<i>y</i>" }),
      ),
    );
    const block = parsed.blocks[0] as unknown as Record<string, unknown>;
    expect(Object.keys(block).sort()).toEqual(["id", "items", "type", "visible"]);
    expect(Object.keys((block.items as object[])[0]!).sort()).toEqual(["answer", "id", "question"]);
  });

  it("a duplicate item id within the page names the second holder; so does a clash with a block id", () => {
    const clash = draftWith(faq([item(1), { ...item(2), id: item(1).id }]));
    const result = publishDocSchema.safeParse(clash);
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((i) => `${i.path.join(".")}:${i.message}`)).toContain(
      "blocks.0.items.1.id:Ids must be unique within a page.",
    );
    const withBlock = draftWith(faq([{ ...item(1), id: "header-clash-01" }]), {
      id: "header-clash-01",
      type: "header",
      visible: true,
      text: "Hi",
    });
    expect(draftDocSchema.safeParse(withBlock).success).toBe(false);
  });

  it("the style overrides are the same ten keys as every block", () => {
    expect(publishOk(faq(items(1), { overrides: { accent: "#C46A4F", text: "#112233" } }))).toBe(
      true,
    );
    expect(publishOk(faq(items(1), { overrides: { accent: "red" } }))).toBe(false);
  });
});

describe("M9-16 the Publish form of a faq block", () => {
  const draft = (list: unknown[], extra: Record<string, unknown> = {}): DraftDoc =>
    draftDocSchema.parse(draftWith(faq(list, extra)));

  it("trims, turns CRLF into LF, and keeps the item order and ids", () => {
    const form = toPublishForm(
      draft([
        item(1, "  Spaced out?  ", "  line one\r\nline two\rline three  "),
        item(2, "Second?", "Plain."),
      ]),
      noirTokens,
    );
    const block = form.blocks[0] as Extract<Block, { type: "faq" }>;
    expect(block.items).toEqual([
      { id: "faq-item-0001", question: "Spaced out?", answer: "line one\nline two\nline three" },
      { id: "faq-item-0002", question: "Second?", answer: "Plain." },
    ]);
    expect(publishedDocSchema.safeParse(form).success).toBe(true);
  });

  it("is canonical: equal drafts give equal forms, and no `overrides` key appears when there are none", () => {
    const a = toPublishForm(draft(items(2), { overrides: {} }), noirTokens);
    const b = toPublishForm(draft(items(2)), noirTokens);
    expect(a).toEqual(b);
    expect(Object.keys(a.blocks[0]!)).not.toContain("overrides");
  });

  it("a stored published form with an extra key never keeps it (publishedDocSchema strips unknown keys)", () => {
    const form = toPublishForm(draft(items(1)), noirTokens);
    const dirty = JSON.parse(JSON.stringify(form));
    dirty.blocks[0].open = true;
    dirty.blocks[0].items[0].html = "<script>";
    const parsed = publishedDocSchema.parse(dirty);
    expect(JSON.stringify(parsed)).not.toContain("<script>");
    expect(JSON.stringify(parsed)).not.toContain('"open"');
  });
});

describe("M9-16 defaults, summary and ids", () => {
  it("a new block starts with one empty item and passes the draft schema but not Publish", () => {
    const block = blockDefaults.faq();
    expect(block).toMatchObject({
      type: "faq",
      visible: true,
      items: [{ question: "", answer: "" }],
    });
    expect((block as Extract<Block, { type: "faq" }>).items).toHaveLength(1);
    expect(draftOk(block)).toBe(true);
    expect(publishOk(block)).toBe(false);
    expect(newFaqItem().id).toMatch(BLOCK_ID_PATTERN);
    expect(newFaqItem().id).not.toBe(newFaqItem().id);
  });

  it("the row's title is the first question (60 characters) or 'FAQ', and its sub line counts the questions", () => {
    const summary = (list: unknown[]) => blockRowSummary(faq(list) as unknown as Block);
    expect(summary(items(1))).toEqual({
      typeLabel: "FAQ",
      title: "Question 1?",
      sub: "1 question",
    });
    expect(summary(items(5)).sub).toBe("5 questions");
    expect(summary([item(1, "x".repeat(100))]).title).toBe("x".repeat(60));
    expect(summary([item(1, "", "")]).title).toBe("FAQ");
    expect(summary([]).sub).toBe("0 questions");
  });

  it("a duplicated block gets a new id for every question, and collectIds sees them all", () => {
    const original = faq(items(3)) as unknown as Block;
    const taken = collectIds({ blocks: [original] });
    const copy = duplicateBlock(original, taken) as Extract<Block, { type: "faq" }>;
    const originalIds = (original as Extract<Block, { type: "faq" }>).items.map((i) => i.id);
    const copyIds = copy.items.map((i) => i.id);
    expect(copy.id).not.toBe(original.id);
    expect(copyIds).toHaveLength(3);
    for (const id of copyIds) expect(originalIds).not.toContain(id);
    expect(new Set(copyIds).size).toBe(3);
    expect(copy.items.map((i) => i.question)).toEqual(items(3).map((i) => i.question));
    for (const id of originalIds) expect(taken.has(id)).toBe(true);
  });
});
