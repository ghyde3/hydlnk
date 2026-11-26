// @vitest-environment node
import { Marked } from "marked";
import { describe, expect, it } from "vitest";
import {
  BODY_SHAPE_MESSAGES,
  LEX_BUDGET,
  MARKDOWN_MAX_NESTING,
  bodyShapeMessage,
  lexBounded,
  lexMarkdown,
  walkBody,
} from "@/lib/blog/markdown";
import { canEditRich } from "@/components/posts/body-editor/markdown";

/**
 * The bound on post bodies (the attack pass, M16-04 / M16-13): one metered lexer for every reader.
 *
 * The benchmark this replays (run on the dev box, 2026-11-26): raw `marked` 17.0.6 on a 16 KiB body
 * took 3.5 s for "*a ", 3.9 s for "*a **b ", 2.8 s for "_a ", 1.9 s for "~a ", 1.6 s for "***...a";
 * quadratic too at 64 KiB: "[a](" 1.4 s, "http://a)))..." 1.4 s, a list item with 16k lines 1.4 s,
 * "a_a_a..." 2.7 s; deep nesting ("> " x 4000, "- > " x 2000, "1. " x 4000) threw a RangeError.
 * Under the meter (LEX_BUDGET = 60 M estimated ns) the largest body of each family that is still
 * accepted lexed in at most ~65 ms, and every family's full 512 KiB body was refused in at most
 * ~100 ms. The ceilings below are four times that, for slower machines and CI.
 */

const CAP = 512 * 1024;
const ACCEPTED_CEILING_MS = 250;
const REFUSED_CEILING_MS = 400;

const FAMILIES: Record<string, (n: number) => string> = {
  star: (n) => "*a ".repeat(n),
  starStrong: (n) => "*a **b ".repeat(n),
  underscore: (n) => "_a ".repeat(n),
  tilde: (n) => "~a ".repeat(n),
  backticks: (n) => "`a ".repeat(n),
  brackets: (n) => "[a ".repeat(n),
  linkOpen: (n) => "[a](".repeat(n),
  angle: (n) => "<a ".repeat(n),
  escapes: (n) => "\\* ".repeat(n),
  starLines: (n) => "*a\n".repeat(n),
  intraword: (n) => "a_".repeat(n),
  oneAt: (n) => "a@".repeat(n),
  urlTrim: (n) => `http://a${")".repeat(n)}`,
  emails: (n) => "a@b.c ".repeat(n),
  listContinued: (n) => `- a\n${"  b\n".repeat(n)}`,
  listLazy: (n) => `- a\n${"b\n".repeat(n)}`,
  quoteLazyRuns: (n) => "> a\nb\n".repeat(n),
  quoteListLazy: (n) => "> - a\nb\n".repeat(n),
  listLines: (n) => "- a\n".repeat(n),
  tableRows: (n) => `|a|b|\n|-|-|\n${"|a|b|\n".repeat(n)}`,
  headings: (n) => "# a\n".repeat(n),
  breaks: (n) => "a  \n".repeat(n),
  mixed: (n) => "*a _b ~c `d [e <f ".repeat(n),
};

const bodyOf = (make: (n: number) => string, n: number) => make(n).slice(0, CAP);

/** The largest n whose body is accepted (bodies grow with n; refusals are cheap). */
function largestAccepted(make: (n: number) => string): number {
  let hi = 1;
  while (lexBounded(bodyOf(make, hi)).ok && bodyOf(make, hi).length < CAP) hi *= 2;
  if (lexBounded(bodyOf(make, hi)).ok) return hi;
  let lo = Math.floor(hi / 2);
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (lexBounded(bodyOf(make, mid)).ok) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** The best of three timings, each with a budget of its own so the one-entry cache never answers. */
function timed(markdown: string): { ms: number; ok: boolean } {
  let ms = Infinity;
  let ok = false;
  for (let i = 1; i <= 3; i += 1) {
    const start = performance.now();
    ok = lexBounded(markdown, LEX_BUDGET + i).ok;
    ms = Math.min(ms, performance.now() - start);
  }
  return { ms, ok };
}

describe("the bounded lexer against the attack families", () => {
  for (const [name, make] of Object.entries(FAMILIES)) {
    it(`${name}: the worst accepted body lexes fast, and 512 KiB of it is refused fast`, () => {
      const n = largestAccepted(make);
      const worst = timed(bodyOf(make, n));
      expect(worst.ok).toBe(true);
      expect(worst.ms).toBeLessThan(ACCEPTED_CEILING_MS);
      const full = bodyOf(make, 1 << 20);
      const start = performance.now();
      const out = lexBounded(full);
      const ms = performance.now() - start;
      expect(ms).toBeLessThan(REFUSED_CEILING_MS);
      if (full.length >= CAP && !out.ok) expect(out.reason).toBe("work");
    }, 60_000);
  }

  it("the reported cases are refused: 24 KiB and 94 KiB of `*a `, 8000 of `*a **b `", () => {
    for (const body of ["*a ".repeat(8192), "*a ".repeat(32_000), "*a **b ".repeat(8000)]) {
      const start = performance.now();
      const out = lexBounded(body);
      expect(performance.now() - start).toBeLessThan(REFUSED_CEILING_MS);
      expect(out).toMatchObject({ ok: false, reason: "work" });
      expect(bodyShapeMessage(body)).toBe(BODY_SHAPE_MESSAGES.work);
    }
  });

  it("deep nesting answers `depth`, never a RangeError (finding 4)", () => {
    for (const body of [
      `${"> ".repeat(4000)}a`,
      `${"- > ".repeat(2000)}a`,
      `${"1. ".repeat(4000)}a`,
    ]) {
      // Raw marked overflows the stack on these.
      expect(() => new Marked({ gfm: true }).lexer(body)).toThrow(RangeError);
      expect(lexBounded(body)).toMatchObject({ ok: false, reason: "depth" });
      expect(bodyShapeMessage(body)).toBe(BODY_SHAPE_MESSAGES.depth);
    }
    expect(lexBounded(`${"> ".repeat(MARKDOWN_MAX_NESTING - 2)}a`).ok).toBe(true);
  });
});

// Ordinary posts ------------------------------------------------------------------------------

const WORDS =
  "the quick brown fox jumps over a lazy dog in the garden one morning with coffee and notes".split(
    " ",
  );

function seeded() {
  let seed = 7;
  return () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
}

/** A paragraph of `n` words with emphasis, strong, links, code, intraword underscores. */
function paragraph(rnd: () => number, n: number): string {
  const out: string[] = [];
  for (let i = 0; i < n; i += 1) {
    let word = WORDS[Math.floor(rnd() * WORDS.length)]!;
    const r = rnd();
    if (r < 0.03) word = `*${word}*`;
    else if (r < 0.05) word = `**${word}**`;
    else if (r < 0.06) word = `[${word}](https://example.com/${word}_page)`;
    else if (r < 0.065) word = `\`${word}\``;
    else if (r < 0.075) word = `${word}_${word}`;
    else if (r < 0.085) word = `${word},`;
    out.push(word);
  }
  return `${out.join(" ")}.`;
}

/** A post of about `words` words: paragraphs, headings, lists, quotes, code, an embed URL. */
function ordinaryPost(words: number): string {
  const rnd = seeded();
  const blocks: string[] = [];
  for (let n = 0; n < words;) {
    const r = rnd();
    if (r < 0.1) blocks.push(`## ${paragraph(rnd, 5)}`);
    else if (r < 0.2) {
      blocks.push(Array.from({ length: 5 }, () => `- ${paragraph(rnd, 12)}`).join("\n"));
      n += 60;
    } else if (r < 0.25) blocks.push(`> ${paragraph(rnd, 40)}`);
    else if (r < 0.28) blocks.push("```\nconst a = 1;\nconsole.log(a);\n```");
    else if (r < 0.3) blocks.push("https://www.youtube.com/watch?v=a_bcdEFG_12");
    else {
      blocks.push(paragraph(rnd, 120));
      n += 120;
    }
    n += 5;
  }
  return blocks.join("\n\n");
}

describe("ordinary posts are accepted", () => {
  it("a 10,000-word post with normal emphasis costs a small part of the budget", () => {
    const post = ordinaryPost(10_000);
    const out = lexBounded(post);
    expect(out.ok).toBe(true);
    expect(out.cost / LEX_BUDGET).toBeLessThan(0.15);
  });

  it("a post near the 512 KiB cap of the same writing is accepted", () => {
    const post = ordinaryPost(90_000);
    expect(new TextEncoder().encode(post).length).toBeGreaterThan(450 * 1024);
    expect(lexBounded(post).ok).toBe(true);
  });

  it("10,000 words in ONE paragraph is accepted too", () => {
    expect(lexBounded(paragraph(seeded(), 10_000)).ok).toBe(true);
  });

  it("a long tight list, a long quote and a long table of a real post are accepted", () => {
    const rnd = seeded();
    const list = Array.from({ length: 500 }, () => `- ${paragraph(rnd, 15)}`).join("\n");
    const quote = Array.from({ length: 300 }, () => `> ${paragraph(rnd, 15)}`).join("\n");
    const table = `| a | b |\n|---|---|\n${Array.from({ length: 500 }, () => `| ${paragraph(rnd, 5)} | ${paragraph(rnd, 5)} |`).join("\n")}`;
    for (const body of [list, quote, table, [list, quote, table].join("\n\n")]) {
      expect(lexBounded(body).ok).toBe(true);
    }
  });
});

describe("the readers degrade, never hang", () => {
  const attack = "*a ".repeat(32_000);

  it("a refused body renders as one paragraph of its own text", () => {
    const tokens = lexMarkdown(attack);
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({ type: "paragraph", text: attack });
    expect((tokens[0] as { tokens: unknown[] }).tokens).toEqual([
      { type: "text", raw: attack, text: attack, escaped: false },
    ]);
    expect(lexMarkdown(`${"> ".repeat(4000)}a`)).toHaveLength(1);
  });

  it("walkBody visits nothing of a refused body and every token of an accepted one", () => {
    const seen: string[] = [];
    expect(walkBody(attack, (t) => seen.push(t.type))).toBe(false);
    expect(seen).toEqual([]);
    expect(
      walkBody("| a |\n|---|\n| [x](https://e.com) |\n\n- ![i](https://e.com/i.png)", (t) =>
        seen.push(t.type),
      ),
    ).toBe(true);
    expect(seen).toEqual(expect.arrayContaining(["table", "link", "list", "list_item", "image"]));
  });

  it("the editor's loss guard sends a refused body to the Markdown box at once", () => {
    const start = performance.now();
    expect(canEditRich(attack)).toBe(false);
    expect(canEditRich(`${"> ".repeat(4000)}a`)).toBe(false);
    expect(performance.now() - start).toBeLessThan(REFUSED_CEILING_MS);
    expect(canEditRich("Hello *world*")).toBe(true);
  });
});
