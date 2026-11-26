import { describe, expect, it, vi } from "vitest";
import { blockDefaults, type FormBlock } from "@/lib/document";
import { parseBlockFields } from "@/lib/mcp/block-fields";
import { blockView, buildBlock, patchBlock, validateBlock } from "@/lib/mcp/doc-view";

vi.mock("server-only", () => ({}));

/** M17-03 step 5: the MCP tools add and edit a form block's texts; `notify` is set in the app only. */

const NO_IMAGES = new Map();

describe("M17-03 the form block through the MCP write tools", () => {
  it("add_block takes the kind and the texts and builds a valid block", () => {
    const parsed = parseBlockFields(
      "form",
      {
        kind: "contact",
        heading: " Write to me ",
        buttonLabel: "Send it",
        consent: "I may reply.",
      },
      "add",
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const block = buildBlock("form", parsed.fields, NO_IMAGES, true) as FormBlock;
    expect(block).toMatchObject({
      type: "form",
      kind: "contact",
      heading: "Write to me",
      buttonLabel: "Send it",
      successMessage: "Thanks. Your message was sent.",
      consent: "I may reply.",
      notify: false,
    });
    expect(() => validateBlock(block, { visible: true })).not.toThrow();
  });

  it("update_block edits the texts, clears the heading with null and swaps default words on a kind change", () => {
    const start = { ...(blockDefaults.form() as FormBlock), heading: "News" } as FormBlock;
    const edited = patchBlock(start, { successMessage: "See you soon.", heading: null }, NO_IMAGES)
      .block as FormBlock;
    expect(edited.successMessage).toBe("See you soon.");
    expect(edited.heading).toBeUndefined();
    const switched = patchBlock(start, { kind: "contact" }, NO_IMAGES).block as FormBlock;
    expect(switched).toMatchObject({ kind: "contact", buttonLabel: "Send" });
  });

  it("notify is refused with a reason, and an unknown kind is refused", () => {
    const notify = parseBlockFields("form", { notify: true }, "update");
    expect(notify).toEqual({
      ok: false,
      issues: [
        { path: "fields.notify", message: "Email notifications can only be set in the app." },
      ],
    });
    expect(parseBlockFields("form", { kind: "survey" }, "update").ok).toBe(false);
  });

  it("get_page shows the block's fields, notify included (read only)", () => {
    const view = blockView({
      ...(blockDefaults.form() as FormBlock),
      id: "form-view-0001",
      notify: true,
    });
    expect(view).toMatchObject({
      id: "form-view-0001",
      type: "form",
      kind: "signup",
      askName: false,
      buttonLabel: "Subscribe",
      notify: true,
    });
    expect(view).not.toHaveProperty("heading");
  });
});
