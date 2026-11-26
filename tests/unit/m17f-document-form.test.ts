import { describe, expect, it, vi } from "vitest";
import {
  BLOCK_TYPES,
  DEFAULT_CONSENT,
  FORM_DEFAULTS,
  blockDefaults,
  draftDocSchema,
  publishDocSchema,
  publishedDocSchema,
  switchFormKind,
  toPublishForm,
  type FormBlock,
} from "@/lib/document";
import { STYLE_SPECS } from "@/lib/themes/overrides";
import { BLOCK_FORMS } from "@/components/blocks/forms";
import { BLOCK_FIELD_KEYS, UNSETTABLE } from "@/lib/mcp/block-fields";
vi.mock("@/lib/env/client", () => ({
  clientEnv: {
    NEXT_PUBLIC_ROOT_DOMAIN: "localhost:3000",
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
  },
}));

import { contactFormBlock, draftWith, fullDraft, noirTokens } from "./fixtures/page-document";

/**
 * M17-03: the form block in the page document. Both kinds parse; an unknown kind, an over-long text,
 * a bad id and hidden characters are refused (the last at Publish); Publish names each required text
 * on its own field; `toPublishForm` drops empty optional texts and keeps each switch only for the kind
 * that reads it; a new block is a sign-up with the default words; the type tables list it.
 */

const form = (over: Partial<FormBlock> & Record<string, unknown> = {}) => ({
  ...(blockDefaults.form() as FormBlock),
  id: "form-test-0001",
  ...over,
});
const draftOk = (block: unknown) => draftDocSchema.safeParse(draftWith(block)).success;
const publishIssues = (block: unknown) => {
  const parsed = publishDocSchema.safeParse(draftWith(block));
  return parsed.success
    ? []
    : parsed.error.issues.map((issue) => ({
        path: issue.path.slice(2).join("."),
        message: issue.message,
      }));
};

describe("M17-03 the form block schema", () => {
  it("is a block type, last in the chip order, and an older document still parses with version 1", () => {
    expect(BLOCK_TYPES.at(-1)).toBe("form");
    const older = { ...fullDraft, blocks: fullDraft.blocks.filter((b) => b.type !== "form") };
    const parsed = draftDocSchema.parse(older);
    expect(parsed.version).toBe(1);
    expect(parsed.blocks.some((b) => b.type === "form")).toBe(false);
  });

  it("accepts both kinds, in the draft and at Publish", () => {
    for (const block of [form(), contactFormBlock]) {
      expect(draftOk(block)).toBe(true);
      expect(publishIssues(block)).toEqual([]);
    }
  });

  it("refuses an unknown kind in both forms", () => {
    expect(draftOk(form({ kind: "newsletter" as never }))).toBe(false);
    expect(publishIssues(form({ kind: "newsletter" as never }))).toEqual([
      { path: "kind", message: "Choose Sign-up or Contact." },
    ]);
  });

  it("refuses a bad id", () => {
    expect(draftOk(form({ id: "bad id!" }))).toBe(false);
    expect(draftOk(form({ id: "short" }))).toBe(false);
  });

  it("counts code points and refuses over-length texts", () => {
    const at = (n: number) => "👍".repeat(n);
    expect(draftOk(form({ heading: at(80), buttonLabel: at(30), consent: at(200) }))).toBe(true);
    for (const [field, max] of [
      ["heading", 80],
      ["description", 200],
      ["buttonLabel", 30],
      ["successMessage", 160],
      ["consent", 200],
    ] as const) {
      expect(draftOk(form({ [field]: at(max + 1) })), field).toBe(false);
      const issues = publishIssues(form({ [field]: at(max + 1) }));
      expect(new Set(issues.map((issue) => JSON.stringify(issue))), field).toEqual(
        new Set([JSON.stringify({ path: field, message: `Use ${max} characters or fewer.` })]),
      );
    }
  });

  it("a draft keeps empty required texts; Publish names each on its own field", () => {
    const empty = form({ buttonLabel: "", successMessage: "  ", consent: "" });
    expect(draftOk(empty)).toBe(true);
    expect(publishIssues(empty)).toEqual([
      { path: "buttonLabel", message: "Add a button label." },
      { path: "successMessage", message: "Add a message to show after sending." },
      { path: "consent", message: "Add a consent line." },
    ]);
  });

  it("refuses control and bidi characters at Publish, as every text field does", () => {
    expect(draftOk(form({ heading: "a‮b" }))).toBe(true);
    expect(publishIssues(form({ heading: "a‮b" }))[0]?.path).toBe("heading");
    expect(publishIssues(form({ consent: "a\nb" }))[0]?.path).toBe("consent");
    expect(publishIssues(form({ buttonLabel: "a\u0007b" }))[0]?.path).toBe("buttonLabel");
  });
});

describe("M17-03 toPublishForm", () => {
  const published = (block: unknown) =>
    toPublishForm({ ...fullDraft, blocks: [block as FormBlock] }, noirTokens).blocks[0];

  it("drops an empty heading and description and trims the texts", () => {
    expect(published(form({ heading: "", description: " ", buttonLabel: " Join " }))).toEqual({
      id: "form-test-0001",
      type: "form",
      visible: true,
      kind: "signup",
      askName: false,
      notify: false,
      buttonLabel: "Join",
      successMessage: FORM_DEFAULTS.signup.successMessage,
      consent: DEFAULT_CONSENT,
    });
  });

  it("keeps askName only for a sign-up and notify only for a contact form", () => {
    expect(published(form({ kind: "signup", askName: true, notify: true }))).toMatchObject({
      askName: true,
      notify: false,
    });
    expect(published(form({ kind: "contact", askName: true, notify: true }))).toMatchObject({
      askName: false,
      notify: true,
    });
  });

  it("the published form parses with the strict schema", () => {
    const doc = toPublishForm(
      { ...fullDraft, blocks: [form({ heading: "News" }), contactFormBlock] },
      noirTokens,
    );
    expect(publishedDocSchema.safeParse(doc).success).toBe(true);
  });
});

describe("M17-03 defaults and the kind switch", () => {
  it("a new block is a sign-up with Subscribe, the success line and the default consent", () => {
    const block = blockDefaults.form() as FormBlock;
    expect(block).toMatchObject({
      type: "form",
      visible: true,
      kind: "signup",
      askName: false,
      notify: false,
      buttonLabel: "Subscribe",
      successMessage: "Thanks. You’re on the list.",
      consent: "Your details go to the owner of this page, who may contact you.",
    });
    expect(block.id).toMatch(/^[A-Za-z0-9_-]{8,24}$/);
  });

  it("switching kind swaps the button and message only while they hold the other kind's words", () => {
    const signup = form();
    expect(switchFormKind(signup, "contact")).toMatchObject({
      kind: "contact",
      buttonLabel: "Send",
      successMessage: "Thanks. Your message was sent.",
    });
    const custom = form({ buttonLabel: "Join the list" });
    expect(switchFormKind(custom, "contact")).toMatchObject({
      kind: "contact",
      buttonLabel: "Join the list",
      successMessage: "Thanks. Your message was sent.",
    });
    expect(switchFormKind(signup, "signup")).toBe(signup);
  });
});

describe("M17-03 the type tables", () => {
  it("the fixture holds one form of each kind", () => {
    const kinds = fullDraft.blocks.flatMap((b) => (b.type === "form" ? [b.kind] : []));
    expect(kinds.sort()).toEqual(["contact", "signup"]);
  });

  it("the style spec, the editor forms and the MCP registry list the type; notify is app-only", () => {
    expect(STYLE_SPECS.form.controls).toEqual(["buttonStyle", "color", "radius"]);
    expect(BLOCK_FORMS.form).toBeTypeOf("function");
    expect(BLOCK_FIELD_KEYS.form).toEqual([
      "kind",
      "heading",
      "description",
      "askName",
      "buttonLabel",
      "successMessage",
      "consent",
      "overrides",
    ]);
    expect(BLOCK_FIELD_KEYS.form).not.toContain("notify");
    expect(UNSETTABLE.notify).toBe("Email notifications can only be set in the app.");
  });
});
