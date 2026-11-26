/**
 * Body generators for the Markdown lexer's bound tests (M16-13): the 47 realistic families of the
 * benchmark (prose, lists, tables, quotes, code, CMS exports, CJK, transcripts, logs...), each
 * deterministic from a fixed seed, and the attack families (the attacker's and the advisor's
 * probes). `atCap` grows a family to the largest body within 512 KiB.
 */

export const BODY_CAP = 512 * 1024;
const bytes = (s: string) => Buffer.byteLength(s);
const W =
  "the quick brown fox jumps over a lazy dog in the garden one morning with coffee and notes about what came next".split(" ");
let seed = 7;
export const reseed = () => {
  seed = 7;
};
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const words = (n: number) => Array.from({ length: n }, () => W[Math.floor(rnd() * W.length)]).join(" ");
const sentence = (n: number) => {
  const w = words(n);
  return w[0]!.toUpperCase() + w.slice(1) + ".";
};
const para = (sentences: number, rich = true) =>
  Array.from({ length: sentences }, (_, i) => {
    let s = sentence(12 + Math.floor(rnd() * 10));
    if (rich && i % 3 === 0) s = s.replace(/ (\w+) /, " **$1** ");
    if (rich && i % 4 === 1) s = s.replace(/ (\w+)\.$/, " [$1](https://example.com/articles/$1).");
    if (rich && i % 5 === 2) s = s.replace(/ (\w+) /, " *$1* ");
    if (rich && i % 7 === 3) s = s.replace(/ (\w+) /, " `$1` ");
    return s;
  }).join(" ");
const cjk = "的一是在不了有和人这中大为上个国我以要他时来用们生到作地于出就分对成会可主发年动同工也能下过子说产种面而方后多定行学法所民得经";
const cjkRun = (n: number) => Array.from({ length: n }, () => cjk[Math.floor(rnd() * cjk.length)]).join("");
const code = [
  "const items = list.map((x) => x * 2).filter(Boolean);",
  'if (a < b && c[i] !== `t${d}`) { return <div className="x">{y}</div>; }',
  "for (let i = 0; i < n; i++) { out[i] = a[i] * b[i]; }",
  "  // TODO: handle the *edge* case where _id is null",
  "export function f<T>(x: T[]): T | undefined { return x[0]; }",
  "$ curl -s https://api.example.com/v1/items?limit=10 | jq '.[] | .name'",
];

export const REALISTIC: Record<string, { unit: string; gen: (n: number) => string }> = {
  "prose, 5-sentence paragraphs (emphasis, links, code spans)": { unit: "paragraphs", gen: (n) => Array.from({ length: n }, () => para(5)).join("\n\n") },
  "prose, 1-sentence paragraphs (~90 chars)": { unit: "paragraphs", gen: (n) => Array.from({ length: n }, () => para(1)).join("\n\n") },
  "prose, plain 64-char paragraphs (the known case)": { unit: "paragraphs", gen: (n) => Array.from({ length: n }, () => words(13).slice(0, 64)).join("\n\n") },
  "prose with headings every 4 paragraphs": { unit: "paragraphs", gen: (n) => Array.from({ length: n }, (_, i) => (i % 4 === 0 ? `## ${words(4)}\n\n` : "") + para(4)).join("\n\n") },
  "ONE paragraph, hard-wrapped at 80 cols (no blank lines), rich": { unit: "lines", gen: (n) => Array.from({ length: n }, () => para(1).slice(0, 78)).join("\n") },
  "ONE paragraph, hard-wrapped, plain words": { unit: "lines", gen: (n) => Array.from({ length: n }, () => words(14).slice(0, 78)).join("\n") },
  "code-heavy: paragraph + 30-line fenced block": { unit: "sections", gen: (n) => Array.from({ length: n }, () => para(3) + "\n\n```ts\n" + Array.from({ length: 30 }, (_, i) => code[i % code.length]).join("\n") + "\n```").join("\n\n") },
  "code pasted WITHOUT a fence (JS/JSX lines, no blank lines)": { unit: "lines", gen: (n) => Array.from({ length: n }, (_, i) => code[i % code.length]).join("\n") },
  "code pasted without a fence, blank line every 8 lines": { unit: "lines", gen: (n) => Array.from({ length: n }, (_, i) => code[i % code.length] + (i % 8 === 7 ? "\n" : "")).join("\n") },
  "HTML pasted without a fence (no blank lines)": { unit: "lines", gen: (n) => Array.from({ length: n }, (_, i) => `text <span class="c${i}">${words(4)}</span> and <a href="https://example.com/${i}">${words(2)}</a><br>`).join("\n") },
  "inline code spans in prose (API docs), 6 per paragraph": { unit: "paragraphs", gen: (n) => Array.from({ length: n }, () => Array.from({ length: 6 }, () => `Call \`${words(1)}.${words(1)}()\` to ${words(6)}.`).join(" ")).join("\n\n") },
  "table, 6 columns of text": { unit: "rows", gen: (n) => "| A | B | C | D | E | F |\n|---|---|---|---|---|---|\n" + Array.from({ length: n }, (_, i) => `| ${i} | ${words(2)} | ${words(3)} | ${words(1)} | ${words(2)} | ${words(1)} |`).join("\n") },
  "table, 3 short columns": { unit: "rows", gen: (n) => "| A | B | C |\n|---|---|---|\n" + Array.from({ length: n }, (_, i) => `| ${i} | ${words(1)} | ${words(1)} |`).join("\n") },
  "table, 12 columns with links and code": { unit: "rows", gen: (n) => "|" + " H |".repeat(12) + "\n|" + "---|".repeat(12) + "\n" + Array.from({ length: n }, (_, i) => "|" + Array.from({ length: 12 }, (_, k) => (k % 4 === 0 ? ` [${words(1)}](https://example.com/${i}/${k}) |` : k % 4 === 1 ? " `" + words(1) + "` |" : ` ${words(1)} |`)).join("")).join("\n") },
  "many small tables (5 rows each) between paragraphs": { unit: "tables", gen: (n) => Array.from({ length: n }, () => para(2) + "\n\n| A | B |\n|---|---|\n" + Array.from({ length: 5 }, () => `| ${words(2)} | ${words(2)} |`).join("\n")).join("\n\n") },
  "link list: bullet per link": { unit: "links", gen: (n) => Array.from({ length: n }, (_, i) => `- [${words(4)}](https://example.com/posts/${i}/${words(1)})`).join("\n") },
  "link directory: one paragraph, link per line with two-space breaks": { unit: "links", gen: (n) => Array.from({ length: n }, (_, i) => `[${words(4)}](https://example.com/posts/${i})  `).join("\n") },
  "bare URLs, one per line, one paragraph": { unit: "urls", gen: (n) => Array.from({ length: n }, (_, i) => `https://example.com/posts/${i}/${words(1)}`).join("\n") },
  "bare URLs, one per paragraph": { unit: "urls", gen: (n) => Array.from({ length: n }, (_, i) => `https://example.com/posts/${i}/${words(1)}`).join("\n\n") },
  "prose with 3 inline links per paragraph": { unit: "paragraphs", gen: (n) => Array.from({ length: n }, (_, i) => Array.from({ length: 3 }, (_, k) => `${sentence(10)} See [${words(2)}](https://example.com/${i}/${k}).`).join(" ")).join("\n\n") },
  "reference-style links: prose + one block of definitions at the end": { unit: "links", gen: (n) => Array.from({ length: Math.ceil(n / 3) }, (_, i) => `${sentence(8)} [${words(1)}][r${i * 3}] ${sentence(6)} [${words(1)}][r${i * 3 + 1}] and [${words(1)}][r${i * 3 + 2}].`).join("\n\n") + "\n\n" + Array.from({ length: n }, (_, i) => `[r${i}]: https://example.com/ref/${i} "Title ${i}"`).join("\n") },
  "footnotes: prose with [^n] and a block of notes": { unit: "notes", gen: (n) => Array.from({ length: n }, (_, i) => `${sentence(14)}[^${i}]`).join("\n\n") + "\n\n" + Array.from({ length: n }, (_, i) => `[^${i}]: ${sentence(8)}`).join("\n") },
  "CJK article: 400-char paragraphs, bold and a link": { unit: "paragraphs", gen: (n) => Array.from({ length: n }, (_, i) => `${cjkRun(120)}，**${cjkRun(6)}**${cjkRun(140)}。${cjkRun(60)}[${cjkRun(4)}](https://example.com/${i})${cjkRun(70)}。`).join("\n\n") },
  "CJK, plain 2,000-char paragraphs": { unit: "paragraphs", gen: (n) => Array.from({ length: n }, () => cjkRun(2000)).join("\n\n") },
  "CJK, one paragraph hard-wrapped at 40 chars with *emphasis*": { unit: "lines", gen: (n) => Array.from({ length: n }, (_, i) => (i % 5 === 0 ? `${cjkRun(15)}*${cjkRun(5)}*${cjkRun(18)}` : cjkRun(40))).join("\n") },
  "CMS export (Turndown style): escapes, inline HTML, images, lists": { unit: "sections", gen: (n) => Array.from({ length: n }, (_, i) => `## ${words(4)}\n\n${sentence(10)} snake\\_case\\_name and 1\\. not a list, \\[sic\\] \\*literal\\* ${sentence(8)}<br>${sentence(6)} <span style="color:red">${words(2)}</span>\n\n![${words(3)}](https://example.com/wp-content/uploads/2024/0${i % 9 + 1}/img-${i}.jpg)\n\n* ${sentence(6)}\n* ${sentence(6)}\n    * ${sentence(5)}\n    * ${sentence(5)}\n* ${sentence(6)}\n\n> ${sentence(12)}\n> ${sentence(9)}`).join("\n\n") },
  "CMS export: figure/figcaption HTML blocks between paragraphs": { unit: "sections", gen: (n) => Array.from({ length: n }, (_, i) => `${para(3)}\n\n<figure class="wp-block-image"><img src="https://example.com/i/${i}.jpg" alt="${words(3)}"/><figcaption>${words(6)}</figcaption></figure>`).join("\n\n") },
  "transcript: [hh:mm:ss] Speaker: line, single newlines": { unit: "lines", gen: (n) => Array.from({ length: n }, (_, i) => `[00:${String(Math.floor(i / 60) % 60).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}] ${i % 2 ? "Anna" : "Ben"}: ${words(9)}`).join("\n") },
  "transcript with a blank line between lines": { unit: "lines", gen: (n) => Array.from({ length: n }, (_, i) => `[00:${String(Math.floor(i / 60) % 60).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}] ${i % 2 ? "Anna" : "Ben"}: ${words(9)}`).join("\n\n") },
  "lyrics/poem: short lines with two-space breaks, stanzas of 4": { unit: "lines", gen: (n) => Array.from({ length: n }, (_, i) => words(6) + (i % 4 === 3 ? "\n" : "  ")).join("\n") },
  "lyrics, no stanza breaks (one paragraph)": { unit: "lines", gen: (n) => Array.from({ length: n }, () => words(6) + "  ").join("\n") },
  "nested outline: item with 3 sub-items": { unit: "top items", gen: (n) => Array.from({ length: n }, () => `- ${words(5)}\n  - ${words(4)}\n  - ${words(4)}\n  - ${words(4)}`).join("\n") },
  "nested outline, 3 levels (1 > 3 > 2)": { unit: "top items", gen: (n) => Array.from({ length: n }, () => `- ${words(5)}\n` + Array.from({ length: 3 }, () => `  - ${words(4)}\n    - ${words(3)}\n    - ${words(3)}`).join("\n")).join("\n") },
  "flat bullet list, 8-word items": { unit: "items", gen: (n) => Array.from({ length: n }, () => `- ${words(8)}`).join("\n") },
  "numbered list, 2-line items (lazy continuation)": { unit: "items", gen: (n) => Array.from({ length: n }, (_, i) => `${i + 1}. ${words(12)}\n${words(10)}`).join("\n") },
  "loose list (blank line between items), 2-sentence items": { unit: "items", gen: (n) => Array.from({ length: n }, () => `- ${para(2)}`).join("\n\n") },
  "task list": { unit: "items", gen: (n) => Array.from({ length: n }, (_, i) => `- [${i % 3 ? " " : "x"}] ${words(6)}`).join("\n") },
  "changelog: version headings with bullets, code and links": { unit: "versions", gen: (n) => Array.from({ length: n }, (_, i) => `## v1.${i}.0\n\n` + Array.from({ length: 8 }, (_, k) => `- ${k % 2 ? "Fixed" : "Added"} \`${words(1)}.${words(1)}\` ${words(5)} ([#${i * 8 + k}](https://github.com/example/repo/pull/${i * 8 + k}))`).join("\n")).join("\n\n") },
  "long quote: 20 quoted lines per block": { unit: "blocks", gen: (n) => Array.from({ length: n }, () => Array.from({ length: 20 }, () => `> ${words(12)}`).join("\n")).join("\n\n") },
  "email reply: nested quotes 3 deep, lazy lines": { unit: "blocks", gen: (n) => Array.from({ length: n }, () => `> > > ${words(10)}\n${words(10)}\n> > ${words(10)}\n> ${words(10)}\n${words(8)}`).join("\n\n") },
  "LaTeX-ish math lines with backslashes and underscores": { unit: "lines", gen: (n) => Array.from({ length: n }, (_, i) => `$$\\frac{a_{${i}}}{b_{${i}}} + \\sum_{k=1}^{n} x_k \\cdot \\alpha_{k}$$`).join("\n\n") },
  "math inline in prose (one paragraph per 4 formulas)": { unit: "paragraphs", gen: (n) => Array.from({ length: n }, (_, i) => Array.from({ length: 4 }, () => `${sentence(8)} $x_{i} = \\alpha_{j} \\* y^{2}$`).join(" ")).join("\n\n") },
  "CSV pasted as text (no blank lines)": { unit: "lines", gen: (n) => Array.from({ length: n }, (_, i) => `${i},${words(1)},${words(1)}@example.com,2024-0${i % 9 + 1}-1${i % 9},${(rnd() * 1000).toFixed(2)}`).join("\n") },
  "log lines pasted as text: [LEVEL] ts msg <id>": { unit: "lines", gen: (n) => Array.from({ length: n }, (_, i) => `[INFO] 2024-05-0${i % 9 + 1}T12:00:${String(i % 60).padStart(2, "0")}Z request <${i}> took ${i % 97}ms path=/api/v1/items?id=${i}`).join("\n") },
  "email addresses list, one per line": { unit: "lines", gen: (n) => Array.from({ length: n }, (_, i) => `${words(1)}.${words(1)}${i}@example.com`).join("\n") },
  "base64 block pasted without a fence (76-col lines)": { unit: "lines", gen: (n) => Array.from({ length: n }, () => Array.from({ length: 76 }, () => "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"[Math.floor(rnd() * 64)]).join("")).join("\n") },
  "snake_case identifiers in prose": { unit: "paragraphs", gen: (n) => Array.from({ length: n }, () => Array.from({ length: 5 }, () => `Set ${words(1)}_${words(1)}_${words(1)} and __${words(1)}__ before ${words(5)}.`).join(" ")).join("\n\n") },
};


/**
 * A body of `gen` close under the cap (by UTF-8 bytes), from the fixed seed: sized from a small
 * sample, then shrunk until it fits.
 */
export function atCap(gen: (n: number) => string, cap = BODY_CAP): string {
  const make = (n: number) => {
    seed = 7;
    return gen(n);
  };
  const sample = 64;
  let n = Math.max(1, Math.floor((cap / Math.max(1, bytes(make(sample)))) * sample * 0.98));
  let body = make(n);
  while (bytes(body) > cap && n > 1) {
    n = Math.max(1, Math.floor((n * cap) / bytes(body) * 0.995));
    body = make(n);
  }
  return body;
}

/** A body cut to at most `cap` UTF-8 bytes. */
export function fit(body: string, cap = BODY_CAP): string {
  const length = bytes(body);
  return length > cap ? body.slice(0, Math.floor((body.length * cap) / length)) : body;
}

const NBSP = "\u00a0";
const IDEO = "\u3000";

/**
 * The attack families: each makes a body of about `n` characters (cut to the cap by `fit`). From the
 * attacker's probes (one.mts, two.mts), the metered lexer's benchmark and the advisor's lists.
 */
export const ATTACKS: Record<string, (n: number) => string> = {
  // Link addresses that marked backtracks over (`\s*` and the address both take NBSP).
  "[a]( + NBSP": (n) => `[a](${NBSP.repeat(n)}`,
  "[a]( + U+3000": (n) => `[a](${IDEO.repeat(n / 3)}`,
  "[a]( + spaces": (n) => `[a](${" ".repeat(n)}`,
  "[a]( + tabs": (n) => `[a](${"\t".repeat(n)}`,
  "([a]( + 50 NBSP) repeated": (n) => `[a](${NBSP.repeat(50)}`.repeat(n / 54),
  "([a]( + spaces) repeated": (n) => "[a](    ".repeat(n / 8),
  "[a]( repeated": (n) => "[a](".repeat(n / 4),
  "[a]( + long address, repeated": (n) => `[a](${"b".repeat(996)}`.repeat(n / 1000),
  '[a](b " repeated': (n) => '[a](b "'.repeat(n / 7),
  "[a](b ( repeated": (n) => "[a](b (".repeat(n / 7),
  // Tables.
  "wide table 6,000 x 3,000": () => `${"|a".repeat(6000)}|\n${"|-".repeat(6000)}|\n${"a\n".repeat(3000)}`,
  "table rows": (n) => `|a|b|\n|-|-|\n${"a\n".repeat(n / 2)}`,
  "wide header": (n) => `${"|a".repeat(n / 4)}|\n${"|-".repeat(n / 4)}|\n`,
  "pipes": (n) => "|".repeat(n),
  // Emphasis and strikethrough.
  "*a ": (n) => "*a ".repeat(n / 3),
  "*a **b ": (n) => "*a **b ".repeat(n / 7),
  "_a ": (n) => "_a ".repeat(n / 3),
  "~a ": (n) => "~a ".repeat(n / 3),
  "~~a ": (n) => "~~a ".repeat(n / 4),
  "nested emphasis": (n) => "*a ".repeat(n / 6) + "b* ".repeat(n / 6),
  "nested _": (n) => "_a ".repeat(n / 6) + "b_ ".repeat(n / 6),
  "nested strong": (n) => "**a ".repeat(n / 8) + "b** ".repeat(n / 8),
  "nested ~": (n) => "~a ".repeat(n / 6) + "b~ ".repeat(n / 6),
  "nested 15 deep, repeated": (n) => `${"*a ".repeat(15)}${"b* ".repeat(15)}\n\n`.repeat(n / 92),
  "*a* repeated": (n) => "*a* ".repeat(n / 4),
  "a* repeated": (n) => "a*".repeat(n / 2),
  "*_ repeated": (n) => "*_".repeat(n / 2),
  "a***b**c*": (n) => "a***b**c*".repeat(n / 9),
  "*a_b**c__d": (n) => "*a_b**c__d ".repeat(n / 11),
  "stars": (n) => "*".repeat(n),
  "*a lines": (n) => "*a\n".repeat(n / 3),
  "a_ intraword": (n) => "a_".repeat(n / 2),
  // Code spans.
  "`a ": (n) => "`a ".repeat(n / 3),
  "``a `": (n) => "``a `".repeat(n / 5),
  "backtick runs 1..k": (n) => {
    let out = "";
    for (let k = 1; out.length < n; k += 1) out += `${"`".repeat(k)}a`;
    return out;
  },
  // Brackets.
  "[a ": (n) => "[a ".repeat(n / 3),
  "[ runs": (n) => "[".repeat(n / 2) + "]".repeat(n / 2),
  "[ runs with a definition": (n) => `[a]: b\n\n${("[".repeat(500) + "]".repeat(500)).repeat(n / 1000)}`,
  "[a] with a definition": (n) => `[a]: b\n\n${"[a]".repeat(n / 3)}`,
  "![ runs": (n) => "![".repeat(n / 4) + "](a)".repeat(n / 8),
  "[` runs": (n) => "[`".repeat(n / 2),
  // Angle brackets and HTML.
  "< runs": (n) => "<".repeat(n),
  "<a ": (n) => "<a ".repeat(n / 3),
  '<a x=" repeated': (n) => '<a x="'.repeat(n / 6),
  '<a x="<b y=" ': (n) => '<a x="<b y=" '.repeat(n / 12),
  "<!-- repeated": (n) => "<!--".repeat(n / 4),
  "<!a ": (n) => "<!a ".repeat(n / 4),
  "<? repeated": (n) => "<?".repeat(n / 2),
  "<div> lines": (n) => "<div>\n".repeat(n / 6),
  // Bare URLs and emails.
  "http://a ": (n) => "http://a ".repeat(n / 9),
  "http://a))))": (n) => `http://a${")".repeat(n)}`,
  "http://a&a;&a;": (n) => `http://a${"&a;".repeat(n / 3)}`,
  "http://a((((": (n) => `http://a${"(".repeat(n)}`,
  "http://a( repeated": (n) => "http://a(".repeat(n / 9),
  "www.a repeated": (n) => "www.a".repeat(n / 5),
  "a.www. repeated": (n) => "a.www.".repeat(n / 6),
  "a.a.a...@": (n) => `${"a.".repeat(n / 2)}@`,
  "a@ repeated": (n) => "a@".repeat(n / 2),
  "a@b.c repeated": (n) => "a@b.c ".repeat(n / 6),
  "a@b.b.b...": (n) => `a@${"b.".repeat(n / 2)}`,
  "a_a_..@b.co": (n) => `${"a_".repeat(n / 2)}@b.co`,
  // Blocks: nesting, lazy lines, setext lookahead, lists.
  "> deep (262,144)": () => "> ".repeat(262144),
  "> x 31 deep, repeated": (n) => `${"> ".repeat(31)}a\n`.repeat(n / 64),
  "- > nested": () => `${"- > ".repeat(131072)}a`,
  "1. nested": () => `${"1. ".repeat(174762)}a`,
  "- > x 15, repeated": (n) => `${"- > ".repeat(15)}a\n`.repeat(n / 62),
  "list 30 deep, repeated": (n) => {
    let block = "";
    for (let d = 0; d < 30; d += 1) block += `${"  ".repeat(d)}- a\n`;
    return block.repeat(Math.max(1, n / block.length));
  },
  "> a, lazy lines": (n) => `> a\n${"b\n".repeat(n / 2)}`,
  "> a / b alternating": (n) => "> a\nb\n".repeat(n / 6),
  "> - a / b": (n) => "> - a\nb\n".repeat(n / 8),
  "> > a / b": (n) => "> > a\nb\n".repeat(n / 8),
  "> 1. a / 2. b": (n) => "> 1. a\n2. b\n".repeat(n / 12),
  "- a, lazy lines": (n) => `- a\n${"b\n".repeat(n / 2)}`,
  "- a, indented lines": (n) => `- a\n${"  b\n".repeat(n / 4)}`,
  "- a, tab lines": (n) => `- a\n${"\tb\n".repeat(n / 3)}`,
  "setext lookahead": (n) => `${"a\n".repeat(n / 2)}===`,
  "setext past rules": (n) => "a\n***\n".repeat(n / 6),
  "- a lines": (n) => "- a\n".repeat(n / 4),
  "loose list": (n) => "- a\n\n".repeat(n / 5),
  "task list": (n) => "- [ ] a\n".repeat(n / 8),
  "1. lines": (n) => "1. a\n".repeat(n / 5),
  "# lines": (n) => "# a\n".repeat(n / 4),
  "``` lines": (n) => "```\n".repeat(n / 4),
  "definitions": (n) => "[a]: b\n".repeat(n / 7),
  "distinct definitions": (n) => {
    let out = "";
    for (let k = 0; out.length < n; k += 1) out += `[r${k}]: b\n`;
    return out;
  },
  "reference uses": (n) => `[a]: b\n\n${"[x][a] ".repeat(n / 7)}`,
  // Lines and characters.
  "one 512 KiB word": (n) => "a".repeat(n),
  "spaces then a": (n) => `${" ".repeat(n)}a`,
  "lines of spaces": (n) => `${" ".repeat(999)}\n`.repeat(n / 1000) + "a",
  "newlines": (n) => "\n".repeat(n),
  "backslashes": (n) => "\\".repeat(n),
  "\\* repeated": (n) => "\\* ".repeat(n / 3),
  "hard breaks": (n) => "a  \n".repeat(n / 4),
  "# runs": (n) => "#".repeat(n),
  "NBSP": (n) => NBSP.repeat(n / 2),
  "CRLF": (n) => "a\r\n".repeat(n / 3),
  "CR": (n) => "*a\r".repeat(n / 3),
};
