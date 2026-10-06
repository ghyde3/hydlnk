// @vitest-environment jsdom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { gzipSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import { PageRenderer } from "@/components/page/page-renderer";
import { LIMITS, type Block, type PublishDoc } from "@/lib/document";
import { PAGE_ID } from "./fixtures/m8-render-docs";
import { fullPublished } from "./fixtures/page-document";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/media/url", () => ({
  mediaUrl: (path: string) => `https://media.test/page-media/${path}`,
}));
vi.mock("@/lib/env/client", () => ({
  clientEnv: {
    NEXT_PUBLIC_ROOT_DOMAIN: "localhost:3000",
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
  },
}));

const { renderLivePage } = await import("@/lib/tenant-render/live-page");
const { FAQ_JSON_LD_MAX, escapeJsonForScript, faqJsonLd, faqPageData } =
  await import("@/lib/tenant-render/faq-json-ld");
const { renderHead } = await import("@/lib/tenant-render/head");
const { pageRulesCss } = await import("@/lib/tenant-assets/css");

/**
 * M9-16 (page side): one `<details>` per question, every answer in the HTML while closed, no
 * script, the FAQPage data block in the live document only, the CSS only on a page that has a FAQ.
 */

const URLS = { page: "http://mara.localhost:3000/", image: "http://mara.localhost:3000/og?v=1" };
const parse = (html: string) => new DOMParser().parseFromString(html, "text/html");

type Faq = Extract<Block, { type: "faq" }>;
const faqBlock = (id: string, questions: [string, string][], extra: Partial<Faq> = {}): Faq => ({
  id,
  type: "faq",
  visible: true,
  items: questions.map(([question, answer], i) => ({
    id: `${id}-item-${String(i).padStart(2, "0")}`,
    question,
    answer,
  })),
  ...extra,
});

const link: Block = {
  id: "link-block-0001",
  type: "link",
  visible: true,
  label: "Book",
  url: "https://example.com/book",
};
const docOf = (...blocks: Block[]): PublishDoc => ({ ...fullPublished, blocks });
const live = (doc: PublishDoc) =>
  renderLivePage({ pageId: PAGE_ID, document: doc, plan: "free", urls: URLS });
const draw = (doc: PublishDoc, mode: "live" | "preview", thumbnail = false) =>
  renderToStaticMarkup(
    createElement(PageRenderer, {
      doc,
      pageId: PAGE_ID,
      mode,
      ...(thumbnail ? { thumbnail } : {}),
    }),
  );

const SAMPLE = faqBlock("faq-sample-0001", [
  ["Do you ship worldwide?", "Yes.\nWithin three days."],
  ["Can I commission a piece?", "Send a message."],
]);

describe("M9-16 the markup", () => {
  const html = draw(docOf(SAMPLE), "live");
  const root = parse(html).querySelector<HTMLElement>(".pg-faq")!;

  it("is one .pg-faq with a <details class=pg-faq-item> per question, a <summary class=pg-faq-q> and a <p class=pg-faq-a>", () => {
    expect(root.getAttribute("data-block-id")).toBe("faq-sample-0001");
    expect(root.getAttribute("data-block-type")).toBe("faq");
    const details = [...root.children];
    expect(details.map((el) => el.tagName)).toEqual(["DETAILS", "DETAILS"]);
    for (const el of details) {
      expect(el.className).toBe("pg-faq-item");
      expect([...el.children].map((child) => `${child.tagName}.${child.className}`)).toEqual([
        "SUMMARY.pg-faq-q",
        "P.pg-faq-a",
      ]);
    }
    expect(details[0]!.querySelector("summary")!.textContent).toBe("Do you ship worldwide?");
  });

  it("every item starts closed and every answer is in the HTML while closed", () => {
    expect(root.querySelectorAll("details[open]").length).toBe(0);
    expect(html).toContain("Within three days.");
    expect(html).toContain("Send a message.");
  });

  it("has no script, no handler, no image and no icon font: the disclosure is the browser's own", () => {
    expect(root.outerHTML).not.toMatch(/<script|<img|<svg|<i /i);
    expect(root.outerHTML).not.toMatch(/\son[a-z]+=/);
  });

  it("answers carry no marks and no links: a web address stays text", () => {
    const doc = docOf(
      faqBlock("faq-links-00001", [["Where?", "See https://example.com/a and **bold**"]]),
    );
    const answer = parse(draw(doc, "live")).querySelector(".pg-faq-a")!;
    expect(answer.querySelector("a")).toBeNull();
    expect(answer.querySelector("strong")).toBeNull();
    expect(answer.textContent).toBe("See https://example.com/a and **bold**");
  });

  it("the preview, the live page and the share page draw the same block (renderToStaticMarkup, both modes)", () => {
    const blockHtml = (mode: "live" | "preview") =>
      parse(draw(docOf(SAMPLE, link), mode)).querySelector(".pg-faq")!.outerHTML;
    expect(blockHtml("preview")).toBe(blockHtml("live"));
  });

  it("a block override goes on the block's own root as inline --t-* variables, and nowhere else", () => {
    const doc = docOf(
      faqBlock("faq-style-00001", [["Q?", "A."]], {
        overrides: { accent: "#C46A4F", text: "#112233" },
      }),
      SAMPLE,
    );
    const roots = [...parse(draw(doc, "live")).querySelectorAll<HTMLElement>(".pg-faq")];
    expect(roots[0]!.getAttribute("style")).toContain("--t-accent:#C46A4F");
    expect(roots[0]!.getAttribute("style")).toContain("--t-text:#112233");
    expect(roots[1]!.getAttribute("style")).toBeNull();
  });

  it("in a thumbnail (the editor's dock) nothing can be opened: questions only, no <details>, no answers", () => {
    const thumb = draw(docOf(SAMPLE), "preview", true);
    expect(thumb).not.toContain("<details");
    expect(thumb).not.toContain("<summary");
    expect(thumb).not.toContain("Within three days.");
    expect(thumb).toContain("Do you ship worldwide?");
  });
});

describe("M9-16 hostile text is text", () => {
  const question = "</script><script>alert(1)</script>";
  const answer = "<img src=x onerror=alert(1)>";
  const doc = docOf(faqBlock("faq-hostile-0001", [[question, answer]]));

  it("renders as visible text and creates no element", () => {
    const body = parse(draw(doc, "live"));
    expect(body.querySelector(".pg-faq-q")!.textContent).toBe(question);
    expect(body.querySelector(".pg-faq-a")!.textContent).toBe(answer);
    expect(body.querySelectorAll(".pg-faq script, .pg-faq img").length).toBe(0);
    expect(body.querySelectorAll("script").length).toBe(0);
  });

  it("the live document has exactly two <script> elements: the tenant script and the data block", () => {
    const document = parse(live(doc));
    const scripts = [...document.querySelectorAll("script")];
    expect(scripts.length).toBe(2);
    // The data block is in the head, the tenant script ends the body.
    expect(scripts.map((s) => s.getAttribute("type"))).toEqual(["application/ld+json", null]);
    expect(scripts.filter((s) => s.hasAttribute("src")).length).toBe(1);
    expect(scripts[1]!.hasAttribute("src")).toBe(true);
    // The data block holds data only: parsing it gives back the strings, and nothing ran.
    const data = JSON.parse(scripts[0]!.textContent!);
    expect(data.mainEntity[0].name).toBe(question);
    expect(data.mainEntity[0].acceptedAnswer.text).toBe(answer);
  });
});

describe("M9-16 the FAQPage data", () => {
  it("one block in the head, in page order, for the visible FAQ blocks only", () => {
    const a = faqBlock("faq-aaaaaaaa-01", [
      ["First?", "One."],
      ["Second?", "Two."],
    ]);
    const b = faqBlock("faq-bbbbbbbb-01", [["Third?", "Three."]]);
    const hidden = faqBlock("faq-hidden-0001", [["Never?", "No."]], { visible: false });
    const document = parse(live(docOf(a, link, hidden, b)));
    const blocks = document.head.querySelectorAll('script[type="application/ld+json"]');
    expect(blocks.length).toBe(1);
    expect(document.body.querySelectorAll("script[type]").length).toBe(0);
    const data = JSON.parse(blocks[0]!.textContent!);
    expect(data).toEqual({
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: [
        {
          "@type": "Question",
          name: "First?",
          acceptedAnswer: { "@type": "Answer", text: "One." },
        },
        {
          "@type": "Question",
          name: "Second?",
          acceptedAnswer: { "@type": "Answer", text: "Two." },
        },
        {
          "@type": "Question",
          name: "Third?",
          acceptedAnswer: { "@type": "Answer", text: "Three." },
        },
      ],
    });
    expect(document.documentElement.outerHTML).not.toContain("Never?");
  });

  it("is built by one pure function; it writes < > & U+2028 U+2029 as \\u escapes, and JSON.parse returns the strings", () => {
    const nasty = "a < b > c & d \u2028 e \u2029 f </script><script>alert(1)</script> <!-- ";
    const text = faqJsonLd(docOf(faqBlock("faq-nasty-00001", [[nasty, nasty]])))!;
    expect(text).not.toMatch(/[<>&\u2028\u2029]/);
    expect(text).toContain("\\u003c");
    expect(text).toContain("\\u003e");
    expect(text).toContain("\\u0026");
    expect(text).toContain("\\u2028");
    expect(text).toContain("\\u2029");
    const data = JSON.parse(text);
    expect(data.mainEntity[0].name).toBe(nasty);
    expect(data.mainEntity[0].acceptedAnswer.text).toBe(nasty);
    expect(escapeJsonForScript(JSON.stringify({ x: "<>&" }))).toBe('{"x":"\\u003c\\u003e\\u0026"}');
  });

  it("holds at most 50 questions, and is null for a page without a visible question", () => {
    const many = Array.from({ length: 6 }, (_, i) =>
      faqBlock(
        `faq-many-0000${i}`,
        Array.from({ length: 10 }, (_, j) => [`Q${i}.${j}?`, "A."] as [string, string]),
      ),
    );
    const data = faqPageData(docOf(...many))!;
    expect((data.mainEntity as unknown[]).length).toBe(FAQ_JSON_LD_MAX);
    expect(FAQ_JSON_LD_MAX).toBe(50);
    expect(faqPageData(docOf(link))).toBeNull();
    expect(faqJsonLd(docOf(link))).toBeNull();
    expect(faqPageData(docOf(faqBlock("faq-empty-00001", [])))).toBeNull();
  });

  it("is written only in the live document: not in the preview or the thumbnail markup", () => {
    expect(draw(docOf(SAMPLE), "preview")).not.toContain("ld+json");
    expect(draw(docOf(SAMPLE), "preview", true)).not.toContain("ld+json");
    expect(draw(docOf(SAMPLE), "live")).not.toContain("ld+json");
    expect(live(docOf(SAMPLE))).toContain('<script type="application/ld+json">');
  });

  it("a page without a FAQ block has no ld+json element, one script, and a head the data block never touches", () => {
    const html = live(docOf(link));
    expect(html).not.toContain("ld+json");
    expect(parse(html).querySelectorAll("script").length).toBe(1);
    // renderHead without the new input is the head it always was.
    const base = { metadata: { title: "x" }, css: "a{b:c}" };
    expect(renderHead({ ...base, jsonLd: null })).toBe(renderHead(base));
    expect(renderHead(base)).not.toContain("<script");
  });

  it("the head refuses data that was not escaped", () => {
    expect(() =>
      renderHead({ metadata: { title: "x" }, css: "", jsonLd: '{"a":"</script>"}' }),
    ).toThrow(/unescaped/);
  });
});

describe("M9-16 the CSS and the budget", () => {
  it("the block's rules are in the page's <style> only when the page has a FAQ block", () => {
    const withFaq = pageRulesCss(["link", "faq"]);
    const without = pageRulesCss(["link"]);
    for (const selector of [".pg-faq", ".pg-faq-item", ".pg-faq-q", ".pg-faq-a"]) {
      expect(withFaq, selector).toContain(selector);
      expect(without, selector).not.toContain(selector);
    }
  });

  it("two FAQ pages with different text have a byte-identical <style>", () => {
    const style = (html: string) => /<style>([\s\S]*?)<\/style>/.exec(html)![1];
    const one = live(docOf(faqBlock("faq-one-0000001", [["One?", "1"]])));
    const two = live(
      docOf(faqBlock("faq-two-0000001", [["Another question entirely?", "2, with more words"]])),
    );
    expect(style(one)).toBe(style(two));
  });

  it("ten questions at their limits: the document is under 32 KB raw and 12 KB gzip, and no other host is named", () => {
    const longest = faqBlock(
      "faq-limits-00001",
      Array.from(
        { length: 10 },
        (_, i) =>
          [
            `${i}`.repeat(LIMITS.faqQuestion).slice(0, LIMITS.faqQuestion),
            `${i}`.repeat(LIMITS.faqAnswer).slice(0, LIMITS.faqAnswer),
          ] as [string, string],
      ),
    );
    const html = live({ ...docOf(longest), profile: { ...fullPublished.profile, photo: null } });
    expect(Buffer.byteLength(html)).toBeLessThan(32 * 1024);
    expect(gzipSync(html).length).toBeLessThan(12 * 1024);
    const hosts = new Set(
      [...html.matchAll(/(?:src|href)="(https?:\/\/[^"/]+)/g)].map((m) => m[1]),
    );
    expect([...hosts].every((host) => host!.includes("localhost"))).toBe(true);
  });
});
