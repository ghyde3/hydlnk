// @vitest-environment jsdom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { PageRenderer } from "@/components/page/page-renderer";
import { blockRowSummary } from "@/components/blocks/summary";
import { linkLabelsFromPublished } from "@/lib/analytics/dashboard/labels";
import { findLinkUrl } from "@/lib/analytics/ingest/target";
import {
  EMAIL_ERROR_MESSAGE,
  PHONE_ERROR_MESSAGE,
  blockDefaults,
  collectPublishErrors,
  draftDocSchema,
  isPhoneNumber,
  publishDocSchema,
  publishedDocSchema,
  telHref,
  toPublishForm,
  type Block,
  type PublishDoc,
} from "@/lib/document";
import { PAGE_ID } from "./fixtures/m8-render-docs";
import { draftWith, fullPublished, noirTokens } from "./fixtures/page-document";

vi.mock("@/lib/media/url", () => ({
  mediaUrl: (path: string) => `https://media.test/page-media/${path}`,
}));
vi.mock("@/lib/env/client", () => ({
  clientEnv: { NEXT_PUBLIC_ROOT_DOMAIN: "localhost:3000" },
}));

/**
 * M9-17: the `contact` block. A name and at least one of a phone number and an email address; the
 * phone and email are plain `tel:` and `mailto:` links built by pure functions from validated values;
 * "Save contact" is a relative `/c/<pageId>/<blockId>` link; nothing in it is a web address, so the
 * click redirect and the blocklist have nothing to add.
 */

const contact = (extra: Record<string, unknown> = {}) => ({
  id: "contact-blk-0001",
  type: "contact",
  visible: true,
  name: "Mara Okafor",
  phone: "+1 (555) 123-4567",
  email: "hello@maraokafor.com",
  hours: "Mon to Fri, 9am to 5pm",
  ...extra,
});

const publishOk = (block: unknown) => publishDocSchema.safeParse(draftWith(block)).success;
const errorsOf = (block: unknown) => collectPublishErrors(draftWith(block));
const messageOf = (block: unknown, field: string) =>
  errorsOf(block).find((error) => error.field === field)?.message ?? null;

describe("M9-17 phone numbers", () => {
  it.each([
    ["+1 (555) 123-4567", true],
    ["+15551234567", true],
    ["5551234", true],
    ["555.123.4567", true],
    ["(555) 123-4567", true],
    ["+44 20 7946 0958", true],
    ["+123456789012345", true],
    ["555 12", false],
    ["+1234567890123456", false],
    ["javascript:alert(1)", false],
    ["+1 555; rm -rf", false],
    ["tel:+1555@evil.example", false],
    ["555-CALL-NOW", false],
    ["+1 555 123 45a7", false],
    ["++15551234567", false],
    ["1+5551234567", false],
    ["", false],
  ])("isPhoneNumber(%j) is %s", (value, ok) => {
    expect(isPhoneNumber(value)).toBe(ok);
  });

  it("telHref builds from a leading + and the digits only, never from the raw string", () => {
    expect(telHref("+1 (555) 123-4567")).toBe("tel:+15551234567");
    expect(telHref("  555.123.4567  ")).toBe("tel:5551234567");
    expect(telHref("5551234")).toBe("tel:5551234");
    expect(telHref("+44 20 7946 0958")).toBe("tel:+442079460958");
  });

  it.each(["javascript:alert(1)", "tel:+1555@evil.example", "555 12", "+1 555; rm -rf", "", "   "])(
    "telHref(%j) is undefined",
    (value) => {
      expect(telHref(value)).toBeUndefined();
    },
  );

  it("telHref of a missing value is undefined", () => {
    expect(telHref(undefined)).toBeUndefined();
    expect(telHref(null)).toBeUndefined();
  });
});

describe("M9-17 the contact schema", () => {
  it("a complete block publishes", () => {
    expect(publishOk(contact())).toBe(true);
  });

  it("the name is required (one line, 60 code points); the draft keeps an empty one", () => {
    expect(draftDocSchema.safeParse(draftWith(contact({ name: "" }))).success).toBe(true);
    expect(messageOf(contact({ name: "" }), "name")).toBe("Add a name.");
    expect(publishOk(contact({ name: "n".repeat(60) }))).toBe(true);
    expect(publishOk(contact({ name: "n".repeat(61) }))).toBe(false);
    expect(publishOk(contact({ name: "Mara\nOkafor" }))).toBe(false);
    expect(publishOk(contact({ name: "Mara\u0007" }))).toBe(false);
    expect(publishOk(contact({ name: "Mara ‮" }))).toBe(false);
  });

  it("at least one of phone and email is required, and the sentence sits on the phone field", () => {
    expect(publishOk(contact({ phone: "", email: "" }))).toBe(false);
    expect(messageOf(contact({ phone: "", email: "" }), "phone")).toBe(
      "Add a phone number or an email address.",
    );
    expect(publishOk(contact({ phone: "", email: "a@b.example" }))).toBe(true);
    expect(publishOk(contact({ phone: "5551234", email: "" }))).toBe(true);
  });

  it.each([
    ["+1 (555) 123-4567", true],
    ["5551234", true],
    ["555 12", false],
    ["javascript:alert(1)", false],
    ["+1 555; rm -rf", false],
    ["tel:+1555@evil.example", false],
    ["+1 555 123 45a7", false],
    ["1".repeat(31), false],
    ["1".repeat(30).slice(0, 15), true],
  ])("phone %j publishes: %s", (phone, ok) => {
    expect(publishOk(contact({ phone }))).toBe(ok);
    if (!ok)
      expect(messageOf(contact({ phone }), "phone")).toMatch(/phone number|characters or fewer/);
  });

  it("a bad phone says how to write one", () => {
    expect(messageOf(contact({ phone: "abc" }), "phone")).toBe(PHONE_ERROR_MESSAGE);
    expect(PHONE_ERROR_MESSAGE).toBe("Enter a valid phone number, like +1 555 123 4567.");
  });

  it.each([
    ["a@b.example?subject=x&bcc=y@evil.example"],
    ["a@b.example,c@d.example"],
    ["a@b.example;c@d.example"],
    ["not an email"],
    ["a@b"],
  ])("email %j is refused at Publish with the existing sentence", (email) => {
    expect(publishOk(contact({ email }))).toBe(false);
    expect(messageOf(contact({ email }), "email")).toBe(EMAIL_ERROR_MESSAGE);
  });

  it("hours are optional, 160 code points, and keep their line breaks", () => {
    expect(publishOk(contact({ hours: "" }))).toBe(true);
    expect(publishOk(contact({ hours: "a\nb\nc\nd" }))).toBe(true);
    expect(publishOk(contact({ hours: "h".repeat(160) }))).toBe(true);
    expect(publishOk(contact({ hours: "h".repeat(161) }))).toBe(false);
    expect(publishOk(contact({ hours: "bell\u0007" }))).toBe(false);
  });

  it("a hidden block with bad new fields does not stop Publish, and is dropped", () => {
    const hidden = contact({ visible: false, phone: "javascript:alert(1)", email: "x", name: "" });
    const header = { id: "header-xxxxxx-1", type: "header", visible: true, text: "Hi" };
    const draft = draftWith(hidden, header);
    expect(publishDocSchema.safeParse(draft).success).toBe(true);
    const form = toPublishForm(draftDocSchema.parse(draft), noirTokens);
    expect(form.blocks.map((b) => b.type)).toEqual(["header"]);
    expect(JSON.stringify(form)).not.toContain("javascript:");
  });

  it("the Publish form trims, normalizes line breaks and drops unknown keys", () => {
    const draft = draftDocSchema.parse(
      draftWith(
        contact({
          name: "  Mara  ",
          phone: " 5551234 ",
          email: " a@b.example ",
          hours: " a\r\nb ",
          href: "x",
          style: "y",
        }),
      ),
    );
    const form = toPublishForm(draft, noirTokens);
    expect(form.blocks[0]).toEqual({
      id: "contact-blk-0001",
      type: "contact",
      visible: true,
      name: "Mara",
      phone: "5551234",
      email: "a@b.example",
      hours: "a\nb",
    });
    expect(publishedDocSchema.safeParse(form).success).toBe(true);
  });

  it("a new block has empty fields, passes the draft schema and not Publish; the row says which of phone and email it has", () => {
    const block = blockDefaults.contact();
    expect(draftDocSchema.safeParse(draftWith(block)).success).toBe(true);
    expect(publishOk(block)).toBe(false);
    const row = (extra: Record<string, unknown>) =>
      blockRowSummary(contact(extra) as unknown as Block);
    expect(row({})).toEqual({ typeLabel: "Contact", title: "Mara Okafor", sub: "Phone and email" });
    expect(row({ email: "" }).sub).toBe("Phone");
    expect(row({ phone: "" }).sub).toBe("Email");
    expect(row({ phone: "", email: "" }).sub).toBe("");
    expect(row({ name: "" }).title).toBe("Untitled contact");
  });
});

type Contact = Extract<Block, { type: "contact" }>;
const docOf = (...blocks: Block[]): PublishDoc => ({ ...fullPublished, blocks });
const draw = (doc: PublishDoc, mode: "live" | "preview", thumbnail = false) =>
  renderToStaticMarkup(
    createElement(PageRenderer, {
      doc,
      pageId: PAGE_ID,
      mode,
      ...(thumbnail ? { thumbnail } : {}),
    }),
  );
const parse = (html: string) => new DOMParser().parseFromString(html, "text/html");
const full = contact() as unknown as Contact;

describe("M9-17 the markup", () => {
  const root = parse(draw(docOf(full), "live")).querySelector<HTMLElement>(".pg-contact")!;

  it("name, phone, email, hours and Save contact, in that order, with the documented classes", () => {
    expect(root.getAttribute("data-block-id")).toBe("contact-blk-0001");
    expect(root.getAttribute("data-block-type")).toBe("contact");
    expect([...root.children].map((el) => `${el.tagName}.${el.className}`)).toEqual([
      "P.pg-contact-name",
      "A.pg-contact-phone",
      "A.pg-contact-email",
      "P.pg-contact-hours",
      "A.pg-contact-save",
    ]);
  });

  it("the phone link is tel:+digits and shows the number as typed; the email link is mailto: from mailtoHref", () => {
    const phone = root.querySelector<HTMLAnchorElement>(".pg-contact-phone")!;
    expect(phone.getAttribute("href")).toBe("tel:+15551234567");
    expect(phone.textContent).toBe("+1 (555) 123-4567");
    const email = root.querySelector<HTMLAnchorElement>(".pg-contact-email")!;
    expect(email.getAttribute("href")).toBe("mailto:hello@maraokafor.com");
    expect(email.textContent).toBe("hello@maraokafor.com");
  });

  it("Save contact is a relative /c/<pageId>/<blockId> download link", () => {
    const save = root.querySelector<HTMLAnchorElement>(".pg-contact-save")!;
    expect(save.getAttribute("href")).toBe(`/c/${PAGE_ID}/contact-blk-0001`);
    expect(save.hasAttribute("download")).toBe(true);
    expect(save.textContent).toBe("Save contact");
  });

  it("the phone and email links do not go through /r and carry no tracking", () => {
    expect(root.outerHTML).not.toContain("/r/");
  });

  it("leaves out a phone, an email and hours that are empty; the name and Save contact stay", () => {
    const only = docOf({ ...full, phone: "", hours: "" } as Contact);
    const el = parse(draw(only, "live")).querySelector(".pg-contact")!;
    expect([...el.children].map((child) => child.className)).toEqual([
      "pg-contact-name",
      "pg-contact-email",
      "pg-contact-save",
    ]);
  });

  it("an unusable value draws without an href (a draft), never a javascript: link", () => {
    const bad = docOf({
      ...full,
      phone: "javascript:alert(1)",
      email: "a@b.example,c@d.example",
    } as Contact);
    const el = parse(draw(bad, "preview")).querySelector(".pg-contact")!;
    for (const anchor of el.querySelectorAll<HTMLAnchorElement>(
      ".pg-contact-phone, .pg-contact-email",
    )) {
      expect(anchor.hasAttribute("href")).toBe(false);
    }
    expect(el.outerHTML).not.toContain('href="javascript');
  });

  it("the preview and the live page draw the same block", () => {
    const html = (mode: "live" | "preview") =>
      parse(draw(docOf(full), mode)).querySelector(".pg-contact")!.outerHTML;
    expect(html("preview")).toBe(html("live"));
  });

  it("a name that is markup renders as visible text", () => {
    const doc = docOf({ ...full, name: "<img src=x onerror=alert(1)>" } as Contact);
    const el = parse(draw(doc, "live")).querySelector(".pg-contact")!;
    expect(el.querySelector(".pg-contact-name")!.textContent).toBe("<img src=x onerror=alert(1)>");
    expect(el.querySelector("img")).toBeNull();
  });

  it("in a thumbnail nothing is a link", () => {
    const el = parse(draw(docOf(full), "preview", true)).querySelector(".pg-contact")!;
    expect(el.querySelectorAll("a").length).toBe(0);
    expect(el.querySelectorAll("[href], [download]").length).toBe(0);
  });
});

describe("M9-17 link plumbing", () => {
  const published = docOf(full);

  it("the block's own id has no click target: nothing for the redirect to send anyone to", () => {
    expect(findLinkUrl(published, "contact-blk-0001")).toBeNull();
  });

  it("'Clicks by link' names a Save contact click by the person, cut to 60 characters", () => {
    expect(linkLabelsFromPublished(published).get("contact-blk-0001")).toBe(
      "Save contact: Mara Okafor",
    );
    const long = docOf({ ...full, name: "n".repeat(60) } as Contact);
    const label = linkLabelsFromPublished(long).get("contact-blk-0001")!;
    expect(Array.from(label).length).toBeLessThanOrEqual(60);
    expect(label.startsWith("Save contact: nnn")).toBe(true);
    // After the block is gone from the published document the id reads as a removed link.
    expect(linkLabelsFromPublished(docOf()).get("contact-blk-0001")).toBeUndefined();
  });
});
