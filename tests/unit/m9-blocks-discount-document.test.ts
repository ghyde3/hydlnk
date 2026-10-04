// @vitest-environment jsdom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { PageRenderer } from "@/components/page/page-renderer";
import { blockRowSummary } from "@/components/blocks/summary";
import { linkLabelsFromPublished } from "@/lib/analytics/dashboard/labels";
import { findLinkUrl } from "@/lib/analytics/ingest/target";
import { blockedFieldErrors, blockedPublishErrorHolds, urlFieldsOf } from "@/lib/blocklist/fields";
import { blockedLinksInPublished } from "@/lib/blocklist/published";
import {
  blockDefaults,
  collectPublishErrors,
  draftDocSchema,
  publishDocSchema,
  publishedDocSchema,
  toPublishForm,
  type Block,
  type DraftDoc,
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
 * M9-19: the `discount` block. A code with no spaces (1 to 32 code points), a one-line description
 * and an optional shop link that goes through /r under the block's own id, is blocklist-checked and
 * is never in the markup.
 */

type Discount = Extract<Block, { type: "discount" }>;
const discount = (extra: Record<string, unknown> = {}) => ({
  id: "discount-blk-001",
  type: "discount",
  visible: true,
  code: "SAVE10",
  description: "10% off your first print",
  url: "https://maraokafor.com/prints",
  ...extra,
});

const publishOk = (block: unknown) => publishDocSchema.safeParse(draftWith(block)).success;
const draftOk = (block: unknown) => draftDocSchema.safeParse(draftWith(block)).success;
const messageOf = (block: unknown, field: string) =>
  collectPublishErrors(draftWith(block)).find((error) => error.field === field)?.message ?? null;

describe("M9-19 the discount schema", () => {
  it.each([
    ["SAVE10", true],
    ["summer-2026", true],
    ["🎉SALE", true],
    ["a".repeat(32), true],
    ["a".repeat(33), false],
    ["😀".repeat(32), true],
    ["😀".repeat(33), false],
    ["SAVE 10", false],
    ["SAVE\t10", false],
    ["SAVE 10", false],
    ["SAVE‮10", false],
    ["SAVE 10", false],
    ["SAVE\u000710", false],
    ["", false],
    ['"><svg/onload=alert(1)>', true],
    ['"><img src=x onerror=alert(1)>', false],
  ])("code %j publishes: %s", (code, ok) => {
    expect(publishOk(discount({ code }))).toBe(ok);
  });

  it("the sentences: 'Add a code.' for none, 'Enter a code with no spaces.' for a space, a length message past 32", () => {
    expect(messageOf(discount({ code: "" }), "code")).toBe("Add a code.");
    expect(messageOf(discount({ code: "SAVE 10" }), "code")).toBe("Enter a code with no spaces.");
    expect(messageOf(discount({ code: "x".repeat(33) }), "code")).toBe(
      "Use 32 characters or fewer.",
    );
  });

  it("the draft keeps whatever was typed (it autosaves), up to the length cap", () => {
    expect(draftOk(discount({ code: "SAVE 10" }))).toBe(true);
    expect(draftOk(discount({ code: "" }))).toBe(true);
    expect(draftOk(discount({ code: "x".repeat(33) }))).toBe(false);
  });

  it("the description is optional, one line, 100 code points", () => {
    expect(publishOk(discount({ description: "" }))).toBe(true);
    expect(publishOk(discount({ description: "d".repeat(100) }))).toBe(true);
    expect(publishOk(discount({ description: "d".repeat(101) }))).toBe(false);
    expect(publishOk(discount({ description: "two\nlines" }))).toBe(false);
  });

  it("the shop link is optional: empty, a missing key and a valid address pass; javascript: and data: are refused", () => {
    expect(publishOk(discount({ url: "" }))).toBe(true);
    const { url: _url, ...without } = discount();
    void _url;
    expect(publishOk(without)).toBe(true);
    expect(publishOk(discount({ url: "https://shop.example/x?a=1" }))).toBe(true);
    for (const url of [
      "javascript:alert(1)",
      "data:text/html,<b>",
      "mailto:a@b.example",
      "ftp://x.example",
      "shop.example",
    ]) {
      expect(publishOk(discount({ url })), url).toBe(false);
      expect(messageOf(discount({ url }), "url"), url).toBe(
        "Enter a full web address, like https://example.com.",
      );
    }
  });

  it("a hidden block with a bad code and a bad url does not stop Publish, and is dropped", () => {
    const hidden = discount({ visible: false, code: "a b", url: "javascript:alert(1)" });
    const draft = draftWith(hidden, {
      id: "header-xxxxxx-1",
      type: "header",
      visible: true,
      text: "Hi",
    });
    expect(publishDocSchema.safeParse(draft).success).toBe(true);
    expect(
      toPublishForm(draftDocSchema.parse(draft), noirTokens).blocks.map((b) => b.type),
    ).toEqual(["header"]);
  });

  it("the Publish form trims, leaves out an empty url and drops unknown keys", () => {
    const draft = draftDocSchema.parse(
      draftWith(
        discount({
          code: "  SAVE10  ",
          description: " 10% off ",
          url: "   ",
          copy: "x",
          html: "<b>",
        }),
      ),
    ) as DraftDoc;
    const form = toPublishForm(draft, noirTokens);
    expect(form.blocks[0]).toEqual({
      id: "discount-blk-001",
      type: "discount",
      visible: true,
      code: "SAVE10",
      description: "10% off",
    });
    expect(publishedDocSchema.safeParse(form).success).toBe(true);
    const withUrl = toPublishForm(
      draftDocSchema.parse(draftWith(discount({ url: " https://shop.example/ " }))),
      noirTokens,
    );
    expect((withUrl.blocks[0] as Discount).url).toBe("https://shop.example/");
  });

  it("a new block is empty, passes the draft schema and not Publish; the row shows the code and the description", () => {
    const block = blockDefaults.discount();
    expect(block).toMatchObject({ type: "discount", code: "", description: "", url: "" });
    expect(draftOk(block)).toBe(true);
    expect(publishOk(block)).toBe(false);
    const row = (extra: Record<string, unknown>) =>
      blockRowSummary(discount(extra) as unknown as Block);
    expect(row({})).toEqual({
      typeLabel: "Discount code",
      title: "SAVE10",
      sub: "10% off your first print",
    });
    expect(row({ description: "" }).sub).toBe("Discount code");
    expect(row({ code: "" }).title).toBe("Untitled discount code");
  });
});

const docOf = (...blocks: Block[]): PublishDoc => ({ ...fullPublished, blocks });
const full = discount() as unknown as Discount;

describe("M9-19 link plumbing", () => {
  it("the block's id resolves to its shop link, and to nothing when there is none", () => {
    expect(findLinkUrl(docOf(full), "discount-blk-001")).toBe("https://maraokafor.com/prints");
    const { url: _url, ...bare } = full;
    void _url;
    expect(findLinkUrl(docOf(bare as Discount), "discount-blk-001")).toBeNull();
    expect(findLinkUrl(docOf({ ...full, url: "" }), "discount-blk-001")).toBeNull();
    expect(
      findLinkUrl(docOf({ ...full, url: "javascript:alert(1)" }), "discount-blk-001"),
    ).toBeNull();
    expect(findLinkUrl(docOf(full), "something-else-01")).toBeNull();
  });

  it("'Clicks by link' reads 'Discount {code}', cut to 60 characters", () => {
    expect(linkLabelsFromPublished(docOf(full)).get("discount-blk-001")).toBe("Discount SAVE10");
    const long = linkLabelsFromPublished(docOf({ ...full, code: "c".repeat(32) })).get(
      "discount-blk-001",
    )!;
    expect(Array.from(long).length).toBeLessThanOrEqual(60);
    expect(linkLabelsFromPublished(docOf({ ...full, url: "" })).has("discount-blk-001")).toBe(
      false,
    );
  });

  it("the blocklist reads the shop link: in the draft's fields and in the published form", () => {
    const block = full as unknown as Block;
    expect(urlFieldsOf(block)).toEqual([
      { blockId: "discount-blk-001", value: "https://maraokafor.com/prints" },
    ]);
    expect(urlFieldsOf({ ...full, url: "" } as unknown as Block)).toEqual([]);

    const errors = blockedLinksInPublished(docOf(full), ["maraokafor.com"]);
    expect(errors).toEqual([
      expect.objectContaining({
        blockId: "discount-blk-001",
        field: "url",
        host: "maraokafor.com",
      }),
    ]);
    expect(blockedLinksInPublished(docOf(full), ["other.example"])).toEqual([]);
    expect(blockedLinksInPublished(docOf({ ...full, url: "" }), ["maraokafor.com"])).toEqual([]);

    const draft = draftDocSchema.parse(draftWith(discount())) as DraftDoc;
    const fieldErrors = blockedFieldErrors(draft, {
      hosts: ["maraokafor.com"],
      blockIds: ["discount-blk-001"],
    } as never);
    expect(fieldErrors).toEqual([
      expect.objectContaining({
        blockId: "discount-blk-001",
        field: "url",
        message: "That site is blocked. Use a different link.",
      }),
    ]);
    expect(
      blockedPublishErrorHolds(draft, {
        blockId: "discount-blk-001",
        field: "url",
        message: "x",
        host: "maraokafor.com",
      }),
    ).toBe(true);
  });
});

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
const rootOf = (doc: PublishDoc, mode: "live" | "preview" = "live", thumbnail = false) =>
  parse(draw(doc, mode, thumbnail)).querySelector<HTMLElement>(".pg-discount")!;

describe("M9-19 the markup", () => {
  it("description, code, Copy button, status region and Shop now, in that order", () => {
    const root = rootOf(docOf(full));
    expect(root.getAttribute("data-block-id")).toBe("discount-blk-001");
    expect(root.getAttribute("data-block-type")).toBe("discount");
    expect([...root.children].map((el) => `${el.tagName}.${el.className}`)).toEqual([
      "P.pg-discount-desc",
      "CODE.pg-discount-code",
      "BUTTON.pg-discount-copy",
      "SPAN.pg-discount-status",
      "A.pg-discount-shop",
    ]);
    const button = root.querySelector("button")!;
    expect(button.getAttribute("type")).toBe("button");
    expect(button.getAttribute("data-copy")).toBe("SAVE10");
    expect(button.getAttribute("data-copied")).toBe("Copied");
    expect(button.textContent).toBe("Copy");
    expect(root.querySelector(".pg-discount-status")!.getAttribute("role")).toBe("status");
    expect(root.querySelector(".pg-discount-status")!.textContent).toBe("");
    expect(root.querySelector(".pg-discount-code")!.textContent).toBe("SAVE10");
    expect(root.querySelector(".pg-discount-desc")!.textContent).toBe("10% off your first print");
  });

  it("Shop now goes through /r under the block's id; the destination is not in the markup", () => {
    const root = rootOf(docOf(full));
    const shop = root.querySelector<HTMLAnchorElement>(".pg-discount-shop")!;
    expect(shop.getAttribute("href")).toBe(`/r/${PAGE_ID}/discount-blk-001`);
    expect(shop.textContent).toBe("Shop now");
    expect(draw(docOf(full), "live")).not.toContain("maraokafor.com/prints");
  });

  it("without a shop link there is no Shop now; without a description there is no description", () => {
    const root = rootOf(docOf({ ...full, url: "", description: "" } as Discount));
    expect(root.querySelector(".pg-discount-shop")).toBeNull();
    expect(root.querySelector(".pg-discount-desc")).toBeNull();
    expect(root.querySelector(".pg-discount-code")!.textContent).toBe("SAVE10");
  });

  it("the Copy button starts un-marked: the block has no data-js until the script sets it", () => {
    const root = rootOf(docOf(full));
    expect(root.hasAttribute("data-js")).toBe(false);
  });

  it("the preview and the live page draw the same block", () => {
    expect(rootOf(docOf(full), "preview").outerHTML).toBe(rootOf(docOf(full), "live").outerHTML);
  });

  it("a code that is markup-shaped but has no space is accepted and written escaped, as text and as the data-copy value", () => {
    const code = '"><svg/onload=alert(1)>';
    const doc = docOf({ ...full, code } as Discount);
    const root = rootOf(doc);
    expect(root.querySelector(".pg-discount-code")!.textContent).toBe(code);
    expect(root.querySelector("button")!.getAttribute("data-copy")).toBe(code);
    expect(root.querySelectorAll("svg, img, script").length).toBe(0);
    for (const el of root.querySelectorAll("*")) {
      expect([...el.attributes].some((attr) => /^on/i.test(attr.name))).toBe(false);
    }
    // The raw markup never holds the unescaped quote-and-bracket sequence.
    expect(draw(doc, "live")).not.toContain('"><svg');
  });

  it("a description that is markup renders as text", () => {
    const root = rootOf(
      docOf({ ...full, description: "<b onmouseover=alert(1)>x</b>" } as Discount),
    );
    expect(root.querySelector(".pg-discount-desc")!.textContent).toBe(
      "<b onmouseover=alert(1)>x</b>",
    );
    expect(root.querySelector("b")).toBeNull();
  });

  it("a block override sits on the block's own root only", () => {
    const styled = { ...full, overrides: { accent: "#C46A4F", radius: 12 } } as Discount;
    const roots = [
      ...parse(
        draw(docOf(styled, { ...full, id: "discount-blk-002" } as Discount), "live"),
      ).querySelectorAll<HTMLElement>(".pg-discount"),
    ];
    expect(roots[0]!.getAttribute("style")).toContain("--t-accent:#C46A4F");
    expect(roots[1]!.getAttribute("style")).toBeNull();
  });

  it("in a thumbnail there is no button and nothing is a link", () => {
    const root = rootOf(docOf(full), "preview", true);
    expect(root.querySelectorAll("button, [data-copy]").length).toBe(0);
    expect(root.querySelectorAll("a, [href]").length).toBe(0);
    expect(root.querySelector(".pg-discount-code")!.textContent).toBe("SAVE10");
  });
});
