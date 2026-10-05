import { beforeAll, describe, expect, it } from "vitest";
import { liveEmailContent, type LiveEmailContent } from "@/lib/domains/live-email";

/**
 * M9-09: the "your domain is live" email, rebuilt with react-email. The words are M5-23's (subject
 * "{hostname} is live", one sentence, one link, an HTML part and a plain-text part, no exclamation
 * marks); what changed is that both parts are rendered from src/emails/domain-live.tsx.
 */

const HOST = "links.example.test";
const ORIGIN = `https://${HOST}`;
const SENTENCE = `Your site is now served at ${ORIGIN}.`;
const LABEL = `Open ${HOST}`;

const count = (haystack: string, needle: string): number => haystack.split(needle).length - 1;
/** The HTML renderer's XHTML doctype carries a w3.org URL: not part of the message body. */
const withoutDoctype = (html: string): string => html.replace(/^<!doctype[^>]*>/i, "");
/** Markup without comments and doctype: the words and the elements. */
const markup = (html: string): string => withoutDoctype(html).replace(/<!--[\s\S]*?-->/g, "");

describe("M9-09 the content", () => {
  let content: LiveEmailContent;
  beforeAll(async () => {
    content = await liveEmailContent(HOST);
  });

  it("liveEmailContent is asynchronous and returns the subject, an HTML part and a text part", async () => {
    const pending = liveEmailContent(HOST);
    expect(pending).toBeInstanceOf(Promise);
    const result = await pending;
    expect(Object.keys(result).sort()).toEqual(["html", "subject", "text"]);
    expect(result.subject).toBe(`${HOST} is live`);
    expect(result.html.length).toBeGreaterThan(100);
    expect(result.text.length).toBeGreaterThan(20);
  });

  it("the HTML holds exactly one <a>: href https://{hostname}/ and text 'Open {hostname}'", () => {
    const html = markup(content.html);
    const anchors = [...html.matchAll(/<a\s([^>]*)>([\s\S]*?)<\/a>/g)];
    expect(anchors).toHaveLength(1);
    expect(count(html, "<a ")).toBe(1);
    expect(/href="([^"]*)"/.exec(anchors[0]![1]!)?.[1]).toBe(`${ORIGIN}/`);
    expect(anchors[0]![2]).toBe(LABEL);
  });

  it("the sentence is there once, and the root is lang='en'", () => {
    expect(count(content.html, SENTENCE)).toBe(1);
    expect(markup(content.html)).toMatch(/^<html[^>]*\blang="en"/);
  });

  it("the body is inline-styled in the old colors: #1c1b19 text and the same font stack", () => {
    // react-email puts the Body's style on the wrapper cell of its table, so it is there as inline CSS.
    expect(content.html).toMatch(/style="[^"]*color:#1c1b19/);
    expect(content.html).toContain("font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif");
    expect(content.html).toMatch(/line-height:1\.5/);
  });

  it("no <img>, no <script>, no <link rel=stylesheet>, no <style>, no remote resource, no tracking pixel", () => {
    const html = markup(content.html);
    for (const tag of ["img", "script", "link", "style", "iframe", "video", "audio", "object", "embed", "source", "picture", "svg", "form", "input"]) {
      expect(html, `<${tag}>`).not.toMatch(new RegExp(`<${tag}[\\s>/]`, "i"));
    }
    expect(html).not.toMatch(/\bsrc\s*=/i);
    expect(html).not.toMatch(/url\(/i);
    expect(html).not.toMatch(/@import/i);
    // Every address in the message is this domain's: nothing is fetched from anywhere else.
    const urls = new Set([...html.matchAll(/https?:\/\/[^\s"'<>)]+/g)].map((m) => m[0]));
    expect([...urls].sort()).toEqual([ORIGIN + ".", ORIGIN + "/"].sort());
    // Exactly one attribute holds an address (the link), and it is an href.
    expect([...html.matchAll(/\s(\w[\w-]*)="https?:\/\/[^"]*"/g)].map((m) => m[1])).toEqual(["href"]);
  });

  it("the text part holds the sentence, the label and the link address once each, no tag, no 'undefined', no exclamation mark", () => {
    expect(count(content.text, SENTENCE)).toBe(1);
    expect(count(content.text, LABEL)).toBe(1);
    expect(count(content.text, `${ORIGIN}/`)).toBe(1);
    expect(content.text).not.toMatch(/<\/?[a-z!]/i);
    expect(content.text).not.toContain("undefined");
    expect(content.text).not.toContain("!");
    expect(content.text).not.toContain("&amp;");
  });

  it("no exclamation mark in the words of the HTML part or the subject, and no line break in the subject", () => {
    const words = markup(content.html).replace(/<[^>]*>/g, "");
    expect(words).not.toContain("!");
    expect(content.subject).not.toContain("!");
    expect(content.subject).not.toMatch(/[\r\n]/);
    expect(content.subject).toBe("links.example.test is live");
  });

  it("nothing else: the words of the message are the sentence and the label", () => {
    const words = markup(content.html)
      .replace(/<[^>]*>/g, "\n")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    expect(words).toEqual([SENTENCE, LABEL]);
  });

  it("rendering twice gives the same message", async () => {
    expect(await liveEmailContent(HOST)).toEqual(content);
  });
});

describe("M9-09 the old content function's guarantees still hold for other hostnames", () => {
  it("an internationalised name arrives as stored (punycode) and a long one is carried whole", async () => {
    const long = `${"a".repeat(60)}.${"b".repeat(60)}.example.test`;
    for (const host of ["xn--bcher-kva.example.test", long]) {
      const content = await liveEmailContent(host);
      expect(content.subject).toBe(`${host} is live`);
      expect(content.html).toContain(`https://${host}/`);
      expect(content.text).toContain(`Open ${host}`);
    }
  });
});
