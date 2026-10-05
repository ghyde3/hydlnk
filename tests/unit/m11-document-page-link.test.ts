import { describe, expect, it } from "vitest";
import {
  BLOCK_TYPES,
  LIMITS,
  blockDefaults,
  draftDocSchema,
  publishDocSchema,
  publishedDocSchema,
  toPublishForm,
  type DraftDoc,
} from "@/lib/document";
import { draftWith } from "./fixtures/page-document";

const SUB = "00000000-0000-4000-8000-000000000001";
const link = (over: Record<string, unknown> = {}) => ({
  id: "page-link-001",
  type: "page_link",
  visible: true,
  label: "Directions",
  target: SUB,
  ...over,
});

describe("M11-07 page_link block", () => {
  it("is a registered block type with a default that parses as a draft", () => {
    expect(BLOCK_TYPES).toContain("page_link");
    const block = blockDefaults.page_link();
    expect(block).toMatchObject({ type: "page_link", visible: true, target: "home" });
    expect(draftDocSchema.safeParse(draftWith(block)).success).toBe(true);
    // Home is a valid target, so the default is publishable as it is.
    expect(publishDocSchema.safeParse(draftWith(block)).success).toBe(true);
  });

  it("accepts Home and a sub-page id as target", () => {
    expect(publishDocSchema.safeParse(draftWith(link({ target: "home" }))).success).toBe(true);
    expect(publishDocSchema.safeParse(draftWith(link())).success).toBe(true);
  });

  it("refuses anything else at Publish, but a draft keeps it", () => {
    for (const target of ["", "Home", "items", "javascript:alert(1)", "https://x.com", "/items"]) {
      expect(draftDocSchema.safeParse(draftWith(link({ target }))).success, target).toBe(true);
      const result = publishDocSchema.safeParse(draftWith(link({ target })));
      expect(result.success, target).toBe(false);
      expect(
        result.error?.issues.map((i) => i.path.join(".")),
        target,
      ).toContain("blocks.0.target");
    }
  });

  it("holds the link block's label limits", () => {
    expect(publishDocSchema.safeParse(draftWith(link({ label: "" }))).success).toBe(false);
    expect(publishDocSchema.safeParse(draftWith(link({ label: "a\nb" }))).success).toBe(false);
    expect(
      publishDocSchema.safeParse(draftWith(link({ label: "x".repeat(LIMITS.linkLabel) }))).success,
    ).toBe(true);
    expect(
      draftDocSchema.safeParse(draftWith(link({ label: "x".repeat(LIMITS.linkLabel + 1) })))
        .success,
    ).toBe(false);
  });

  it("publishes trimmed, with only known keys and the overrides that have a value", () => {
    const draft = draftDocSchema.parse(
      draftWith(
        link({
          label: " Go ",
          target: ` ${SUB} `,
          url: "https://evil.example",
          overrides: { accent: "#112233" },
        }),
      ),
    ) as DraftDoc;
    const form = toPublishForm(draft, null);
    expect(form.blocks[0]).toEqual({
      id: "page-link-001",
      type: "page_link",
      visible: true,
      label: "Go",
      target: SUB,
      overrides: { accent: "#112233" },
    });
    expect(publishedDocSchema.safeParse(form).success).toBe(true);
  });

  it("a hidden page link is dropped", () => {
    const draft = draftDocSchema.parse(draftWith(link({ visible: false, target: "" }))) as DraftDoc;
    expect(publishDocSchema.safeParse(draft).success).toBe(true);
    expect(toPublishForm(draft, null).blocks).toEqual([]);
  });
});
