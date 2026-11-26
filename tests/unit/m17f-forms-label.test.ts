import { describe, expect, it } from "vitest";
import { linkLabelsFromPublished } from "@/lib/analytics/dashboard/labels";

/** M17-06 step 7: "Clicks by link" names a form's stored submissions "Form: {heading}", cut to 60. */
describe("M17-06 the form's label in Clicks by link", () => {
  const doc = (block: Record<string, unknown>) => ({
    version: 1,
    blocks: [{ id: "formSign01", type: "form", visible: true, ...block }],
  });

  it("the heading, or the kind when it has none", () => {
    expect(
      linkLabelsFromPublished(doc({ kind: "signup", heading: "Studio notes" })).get("formSign01"),
    ).toBe("Form: Studio notes");
    expect(linkLabelsFromPublished(doc({ kind: "signup" })).get("formSign01")).toBe(
      "Form: Sign-up form",
    );
    expect(linkLabelsFromPublished(doc({ kind: "contact", heading: "  " })).get("formSign01")).toBe(
      "Form: Contact form",
    );
  });

  it("is cut to 60 characters", () => {
    const label = linkLabelsFromPublished(doc({ kind: "signup", heading: "x".repeat(80) })).get(
      "formSign01",
    )!;
    expect(Array.from(label)).toHaveLength(60);
    expect(label.endsWith("…")).toBe(true);
  });
});
