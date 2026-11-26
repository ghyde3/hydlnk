// @vitest-environment node
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";
import type { Token } from "marked";
import { describe, expect, it } from "vitest";
import {
  BODY_SHAPE_MESSAGES,
  MARKDOWN_MAX_DEPTH,
  MARKDOWN_MAX_NESTING,
  MARKDOWN_MAX_NODES,
  bodyShapeMessage,
  lexBounded,
  lexMarkdown,
  walkBody,
} from "@/lib/blog/markdown";
import { lexTokens } from "@/lib/blog/markdown/lex";
import { LexRefused } from "@/lib/blog/markdown/limits";
import { canEditRich } from "@/components/posts/body-editor/markdown";
import { ATTACKS, BODY_CAP, REALISTIC, atCap, fit } from "./support/markdown-families";

/**
 * The bound on post bodies (M16-04, M16-13): the lexer is linear in the body, its two limits are
 * counted, not timed, and its verdict is a pure function of the body. Tests that cannot rot:
 *   (a) a scan of the lexer's source: no clock, no timer, no `new RegExp`, marked as a type only,
 *       and an inventory of its regular expression literals (a new one fails here until reviewed);
 *   (b) determinism: the same body gives the same tokens and node count, pinned for a few bodies;
 *   (c) fuzzers (fixed seeds) up to 512 KiB, and every attack family: never an error, never past the
 *       node limit, doubling the body (64 to 128 KiB) less than triples the time (min of 5 runs), and
 *       a loose ceiling of 1 s at 512 KiB (the worst family takes about 0.2 s on the dev box). The
 *       ratio is measured for each family whose 512 KiB body takes 20 ms or more;
 *   (d) the 47 realistic families at 512 KiB are accepted;
 *   (e) memory: the wide table and bodies at the node limit stay within a sane heap delta.
 *
 * The fuzzers run `MARKDOWN_FUZZ_SAMPLES` bodies each (default 24, a few seconds); set it higher
 * for a longer run (the advisor's run used 400).
 */

const LEXER_DIR = join(process.cwd(), "src/lib/blog/markdown");
const FUZZ_SAMPLES = Number(process.env.MARKDOWN_FUZZ_SAMPLES ?? 24);
const CEILING_MS = 1_000;

/** The result of one lex, uncached (the module keeps the last body). */
function lexOnce(body: string): { ok: boolean; reason?: string; nodes: number; tokens?: Token[] } {
  try {
    const { tokens, nodes } = lexTokens(body);
    return { ok: true, nodes, tokens };
  } catch (err) {
    if (err instanceof LexRefused) return { ok: false, reason: err.reason, nodes: MARKDOWN_MAX_NODES };
    throw err;
  }
}

/**
 * A full garbage collection before each timed run, so a timing measures the lexer and not the
 * previous run's garbage (an accepted body's tree holds up to 150,000 tokens). Node exposes `gc`
 * to a new context once the flag is set; where it does not, timing just runs without it.
 */
const collectGarbage: () => void = (() => {
  try {
    setFlagsFromString("--expose-gc");
    return runInNewContext("gc") as () => void;
  } catch {
    return () => {};
  }
})();

function timed(body: string): number {
  const start = performance.now();
  lexOnce(body);
  return performance.now() - start;
}

/** The fastest of `runs` timings of each body, interleaved so both see the same heap. */
function fastest(bodies: string[], runs = 5): number[] {
  const best = bodies.map(() => Infinity);
  for (let run = 0; run < runs; run += 1) {
    collectGarbage();
    bodies.forEach((body, k) => {
      best[k] = Math.min(best[k]!, timed(body));
    });
  }
  return best;
}

/**
 * t(2n) / t(n) below 3 for n = 64 KiB (a quadratic shape reads about 4 there; marked took seconds),
 * measured again (up to five times) when noise makes one reading high.
 */
function expectLinear(name: string, make: (n: number) => string): void {
  // Uncut: cutting a body mid-pattern would compare two different shapes.
  const small = make(BODY_CAP / 8);
  const large = make(BODY_CAP / 4);
  let ratio = Infinity;
  let times: number[] = [];
  // A garbage collection inside every one of five runs can still lift one reading; a quadratic
  // shape reads 4 or more on every attempt, so five attempts tell the two apart.
  fastest([small, large], 1);
  for (let attempt = 0; attempt < 5 && ratio >= 3; attempt += 1) {
    times = fastest([small, large]);
    // Below a few milliseconds a ratio is noise: the body is cheap whatever its shape.
    ratio = times[1]! < 4 ? 0 : times[1]! / Math.max(times[0]!, 0.5);
  }
  expect(ratio, `${name}: ${times.map((t) => t.toFixed(1)).join(" ms -> ")} ms`).toBeLessThan(3);
}

// (a) ------------------------------------------------------------------------------------------------

/** The source of each lexer file without comments, strings or template text, and its regex literals. */
function scan(source: string): { code: string; regexes: string[] } {
  let code = "";
  const regexes: string[] = [];
  let lastSignificant = "";
  for (let i = 0; i < source.length; ) {
    const char = source[i]!;
    const next = source[i + 1];
    if (char === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") i += 1;
      continue;
    }
    if (char === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      i = end === -1 ? source.length : end + 2;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      let k = i + 1;
      while (k < source.length && source[k] !== char) k += source[k] === "\\" ? 2 : 1;
      code += char + char;
      lastSignificant = char;
      i = k + 1;
      continue;
    }
    if (char === "/" && (lastSignificant === "" || "(,=:[!&|?{};".includes(lastSignificant) || /\breturn$/.test(code))) {
      let k = i + 1;
      let inClass = false;
      while (k < source.length && (inClass || source[k] !== "/")) {
        if (source[k] === "\\") k += 1;
        else if (source[k] === "[") inClass = true;
        else if (source[k] === "]") inClass = false;
        k += 1;
      }
      k += 1;
      while (k < source.length && /[a-z]/.test(source[k]!)) k += 1;
      regexes.push(source.slice(i, k));
      code += "/re/";
      lastSignificant = "/";
      i = k;
      continue;
    }
    code += char;
    if (!/\s/.test(char)) lastSignificant = char;
    i += 1;
  }
  return { code, regexes };
}

/**
 * Every regular expression literal of the lexer, by file, with why it cannot backtrack over a body.
 * Adding one fails the test until it is listed here (and reviewed).
 */
const REGEX_INVENTORY: Record<string, Record<string, string>> = {
  "chars.ts": {
    "/^[\\p{P}\\p{S}]$/u": "anchored at both ends, tested on one code point only",
    "/^[\\p{L}\\p{N}]$/u": "anchored at both ends, tested on one code point only",
  },
  "readers.ts": {
    "/&(?:#(\\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([a-zA-Z]{2,6}));/g":
      "an entity of at most 10 characters from each `&`: bounded quantifiers only, no nesting",
    "/\\s+/g": "one class repeated with nothing after it: each match ends at the first non-space",
  },
};

describe("(a) the lexer's source: no clock, no marked, every pattern listed", () => {
  const files = readdirSync(LEXER_DIR).filter((name) => name.endsWith(".ts"));
  const sources = Object.fromEntries(files.map((name) => [name, readFileSync(join(LEXER_DIR, name), "utf8")]));

  it("is one folder of small modules behind one entry", () => {
    expect(files).toContain("index.ts");
    expect(files.length).toBeGreaterThanOrEqual(8);
  });

  it("reads no clock and sets no timer: the verdict depends on the body alone", () => {
    for (const [name, source] of Object.entries(sources)) {
      const { code } = scan(source);
      expect(code, name).not.toMatch(/\bperformance\b|\bDate\b|\bset(?:Timeout|Interval|Immediate)\b|\bprocess\b|\bMath\.random\b/);
    }
  });

  it("builds no pattern at run time", () => {
    for (const [name, source] of Object.entries(sources)) {
      expect(scan(source).code, name).not.toMatch(/\bnew\s+RegExp\b|\bRegExp\s*\(/);
    }
  });

  it("imports marked for its token types only", () => {
    for (const [name, source] of Object.entries(sources)) {
      for (const match of source.matchAll(/^\s*import\s+(type\s+)?[^;]*?from\s+["']marked["']/gm)) {
        expect(match[1], `${name}: ${match[0]}`).toBeDefined();
      }
      expect(source, name).not.toMatch(/\brequire\(\s*["']marked["']\s*\)|import\(\s*["']marked["']\s*\)/);
    }
  });

  it("has exactly the regular expression literals of the inventory", () => {
    const found: Record<string, string[]> = {};
    for (const [name, source] of Object.entries(sources)) {
      const { regexes } = scan(source);
      if (regexes.length > 0) found[name] = regexes.sort();
    }
    const listed = Object.fromEntries(
      Object.entries(REGEX_INVENTORY).map(([name, patterns]) => [name, Object.keys(patterns).sort()]),
    );
    expect(found).toEqual(listed);
  });
});

// (b) ------------------------------------------------------------------------------------------------

describe("(b) determinism", () => {
  const BODIES: Record<string, { body: string; nodes: number }> = {
    "a post": {
      body: "## Heading\n\nA paragraph with **bold**, *italic*, ~~strike~~ and a [link](https://example.com).\n\n- one\n- two\n\n> quoted\n\n```\ncode\n```",
      nodes: 30,
    },
    "a table": { body: "| a | b |\n|---|:-:|\n| 1 | *2* |\n| 3 |", nodes: 12 },
    "a task list in a quote": { body: "> - [ ] a\n> - [x] b\n>\n> c", nodes: 13 },
    "links and references": { body: "[a][r], [b](u \"t\"), <http://x.co>, www.y.co and z@w.co\n\n[r]: v", nodes: 14 },
  };

  for (const [name, { body, nodes }] of Object.entries(BODIES)) {
    it(`${name}: the same tokens and count every time (${nodes})`, () => {
      const first = lexOnce(body);
      const second = lexOnce(body);
      expect(second).toEqual(first);
      expect(first.nodes).toBe(nodes);
      expect(lexBounded(body)).toMatchObject({ ok: true, nodes });
    });
  }

  it("a refusal is the same every time, and the same through every reader", () => {
    const deep = `${"> ".repeat(MARKDOWN_MAX_NESTING + 1)}a`;
    for (let k = 0; k < 3; k += 1) expect(lexOnce(deep)).toMatchObject({ ok: false, reason: "depth" });
    expect(bodyShapeMessage(deep)).toBe(BODY_SHAPE_MESSAGES.depth);
    expect(walkBody(deep, () => {})).toBe(false);
    expect(canEditRich(deep)).toBe(false);
    expect(lexMarkdown(deep)).toEqual([
      { type: "paragraph", raw: deep, text: deep, tokens: [{ type: "text", raw: deep, text: deep, escaped: false }] },
    ]);
  });
});

// The limits -------------------------------------------------------------------------------------------

/** The deepest children list of a tree, counted as the renderer counts. */
function treeDepth(tokens: readonly Token[], depth = 0): number {
  let deepest = depth;
  for (const token of tokens as Array<Token & { tokens?: Token[]; items?: Array<{ tokens: Token[] }> }>) {
    if (token.type === "list") {
      for (const item of token.items ?? []) deepest = Math.max(deepest, treeDepth(item.tokens, depth + 1));
    } else if (token.type === "table") {
      const table = token as unknown as { header: Array<{ tokens: Token[] }>; rows: Array<Array<{ tokens: Token[] }>> };
      for (const cell of [...table.header, ...table.rows.flat()]) deepest = Math.max(deepest, treeDepth(cell.tokens, depth + 1));
    } else if (token.tokens && token.tokens.length > 0) {
      deepest = Math.max(deepest, treeDepth(token.tokens, depth + 1));
    }
  }
  return deepest;
}

describe("the limits and their messages", () => {
  it("say what was passed, with the numbers of the one constant each", () => {
    expect(BODY_SHAPE_MESSAGES.depth).toBe(`Quotes, lists and emphasis can nest at most ${MARKDOWN_MAX_NESTING} levels.`);
    expect(BODY_SHAPE_MESSAGES.size).toBe(
      "A post can hold at most 150,000 formatted pieces (table cells, list items, links, styled runs). Split it into several posts.",
    );
    expect(MARKDOWN_MAX_NODES).toBe(150_000);
  });

  it("nesting: the deepest body accepted is drawn whole by the renderer; one level more is refused", () => {
    for (const [name, make] of Object.entries({
      quotes: (k: number) => `${"> ".repeat(k)}a`,
      lists: (k: number) => Array.from({ length: k }, (_, d) => `${"  ".repeat(d)}- a`).join("\n"),
      emphasis: (k: number) => `${"*a ".repeat(k)}b${" c*".repeat(k)}`,
      "lists in quotes": (k: number) => `${"> - ".repeat(Math.ceil(k / 2)).slice(0, k * 2)}a`,
    })) {
      let k = 1;
      while (lexOnce(make(k + 1)).ok && k < 200) k += 1;
      const deepest = lexOnce(make(k));
      expect(deepest.ok, name).toBe(true);
      expect(treeDepth(deepest.tokens!), name).toBeLessThanOrEqual(MARKDOWN_MAX_DEPTH);
      expect(lexOnce(make(k + 1)), name).toMatchObject({ ok: false, reason: "depth" });
    }
    // The counts the message gives hold for quotes and lists.
    expect(lexOnce(`${"> ".repeat(MARKDOWN_MAX_NESTING)}a`).ok).toBe(true);
    expect(lexOnce(`${"> ".repeat(MARKDOWN_MAX_NESTING + 1)}a`).ok).toBe(false);
  });

  it("size: a body past the node limit is refused with the size message, below it accepted", () => {
    const at = (n: number) => "*a* ".repeat(n);
    expect(lexOnce(at(40_000))).toMatchObject({ ok: true, nodes: 120_001 });
    expect(lexOnce(at(60_000))).toMatchObject({ ok: false, reason: "size" });
    expect(bodyShapeMessage(at(60_000))).toBe(BODY_SHAPE_MESSAGES.size);
  });

  it("the reported refusals of the old meter are accepted now (they lex in linear time)", () => {
    for (const body of ["*a ".repeat(32_000), "*a **b ".repeat(8000), `[a](${" ".repeat(4800)}`]) {
      expect(lexOnce(body).ok).toBe(true);
    }
  });
});

// (c) ------------------------------------------------------------------------------------------------

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}
const pick = <T,>(random: () => number, list: readonly T[]): T => list[Math.floor(random() * list.length)]!;

function expectBounded(body: string, label: string): number {
  let result: ReturnType<typeof lexOnce> | undefined;
  let ms = Infinity;
  for (let run = 0; run < 2 && ms >= CEILING_MS; run += 1) {
    const start = performance.now();
    result = lexOnce(body);
    ms = Math.min(ms, performance.now() - start);
  }
  expect(result!.reason, label).not.toBe("error");
  expect(result!.nodes, label).toBeLessThanOrEqual(MARKDOWN_MAX_NODES);
  expect(ms, `${label}: ${ms.toFixed(0)} ms`).toBeLessThan(CEILING_MS);
  return ms;
}

/** A family whose whole 512 KiB body lexes this fast cannot hide a cost worth a ratio. */
const RATIO_FLOOR_MS = 20;

describe("(c) fuzzers up to 512 KiB, and every attack family", () => {
  const SPECIAL = ["*", "_", "~", "[", "]", "(", ")", "<", ">", "!", "`", "|", "#", "-", "+", "\\", "&", " ", "\t", "\n", "\r\n", " ", "　", "a"];

  it(`repetition fuzzer: prefix + piece x k + suffix at 512 KiB (${FUZZ_SAMPLES} bodies)`, () => {
    const ALPHA = [...SPECIAL, "**", "__", "~~", "``", "\n\n", "[a](", "](", "<!--", "<a ", "&amp;", "---", "===", "|-", "- ", "> ", "```", "~~~", "a@b.c", "[a]: b\n", "[a]", "![", "http://", "www.", "1.", "    ", "x_y", '"', ":", "/", "@", "."];
    const random = rng(1);
    for (let sample = 0; sample < FUZZ_SAMPLES; sample += 1) {
      const part = (max: number) => Array.from({ length: Math.floor(random() * (max + 1)) }, () => pick(random, ALPHA)).join("");
      const seed = Array.from({ length: 1 + Math.floor(random() * 5) }, () => pick(random, ALPHA)).join("");
      const second = random() < 0.3 ? part(3) : "";
      const unit = seed.length + second.length || 1;
      const k = Math.floor(500_000 / unit);
      const body = fit(part(4) + seed.repeat(k) + second.repeat(second ? k : 0) + part(4));
      expectBounded(body, JSON.stringify(seed + "|" + second).slice(0, 60));
    }
  }, 120_000);

  it(`random-mix fuzzer: random sub-alphabets of the special characters, 4 to 512 KiB (${FUZZ_SAMPLES} bodies)`, () => {
    const random = rng(7);
    for (let sample = 0; sample < FUZZ_SAMPLES; sample += 1) {
      const length = sample % 4 === 0 ? BODY_CAP : 4096 + Math.floor(random() * (BODY_CAP - 4096));
      const alphabet: string[] = [];
      for (let j = 0, k = 2 + Math.floor(random() * 8); j < k; j += 1) {
        const char = pick(random, SPECIAL);
        for (let w = 1 + Math.floor(random() * random() * 12); w > 0; w -= 1) alphabet.push(char);
      }
      const parts: string[] = [];
      let size = 0;
      if (random() < 0.5) {
        const chunks = Array.from({ length: 6 }, () => Array.from({ length: 1 + Math.floor(random() * 12) }, () => pick(random, alphabet)).join(""));
        while (size < length) {
          const chunk = pick(random, chunks);
          parts.push(chunk);
          size += chunk.length;
        }
      } else {
        while (size < length) {
          parts.push(pick(random, alphabet));
          size += 1;
        }
      }
      expectBounded(fit(parts.join("")), `mix ${sample}: ${JSON.stringify(alphabet.join("").slice(0, 30))}`);
    }
  }, 120_000);

  for (const [name, make] of Object.entries(ATTACKS)) {
    it(`${name}: linear (t(2n)/t(n) < 3), and within the ceiling at 512 KiB`, () => {
      if (expectBounded(fit(make(BODY_CAP)), name) >= RATIO_FLOOR_MS) expectLinear(name, make);
    }, 60_000);
  }
});

// (d) ------------------------------------------------------------------------------------------------

describe("(d) the 47 realistic families at 512 KiB are accepted", () => {
  it("has the 47 families", () => {
    expect(Object.keys(REALISTIC)).toHaveLength(47);
  });

  for (const [name, { gen }] of Object.entries(REALISTIC)) {
    it(name, () => {
      const body = atCap(gen);
      expect(Buffer.byteLength(body)).toBeGreaterThan(BODY_CAP * 0.9);
      const start = performance.now();
      const result = lexOnce(body);
      expect(performance.now() - start).toBeLessThan(CEILING_MS);
      expect(result, name).toMatchObject({ ok: true });
    }, 60_000);
  }
});

// (e) ------------------------------------------------------------------------------------------------

describe("(e) memory", () => {
  const MB = 1024 * 1024;
  const heapDelta = (body: string): { delta: number; result: ReturnType<typeof lexOnce> } => {
    const before = process.memoryUsage().heapUsed;
    const result = lexOnce(body);
    return { delta: process.memoryUsage().heapUsed - before, result };
  };

  it("the wide table (6,000 columns, 3,000 rows) is accepted without growing with rows x columns", () => {
    const { delta, result } = heapDelta(ATTACKS["wide table 6,000 x 3,000"]!(0));
    expect(result.ok).toBe(true);
    expect(delta).toBeLessThan(128 * MB);
  });

  it("bodies at the node limit, accepted and refused, stay within a sane heap delta", () => {
    for (const body of ["*a* ".repeat(40_000), "- a\n".repeat(130_000), `|a|b|\n|-|-|\n${"a|b\n".repeat(120_000)}`]) {
      const { delta, result } = heapDelta(fit(body));
      expect(result.nodes).toBeLessThanOrEqual(MARKDOWN_MAX_NODES);
      expect(delta, JSON.stringify(body.slice(0, 20))).toBeLessThan(256 * MB);
    }
  });
});
