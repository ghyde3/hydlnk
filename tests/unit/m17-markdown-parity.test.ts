// @vitest-environment node
import { Lexer, type Token } from "marked";
import { describe, expect, it } from "vitest";
import { decodeEntities, lexBounded } from "@/lib/blog/markdown";
import { fromMarkdown, toMarkdown } from "@/components/posts/body-editor/markdown";
import { REALISTIC, reseed } from "./support/markdown-families";
import { seeded } from "./support/random";

/**
 * Parity of the bounded lexer with marked 17 (M16-04, M16-13). The renderer and every walker read
 * marked-shaped tokens; the lexer is this module's own, so it is compared here with `marked.lexer`
 * (a development-time comparison: nothing in src calls marked's lexer for a post body).
 *
 * What is compared is what the page shows: the render signature of a body (token types and
 * nesting, the visible text with entities decoded and runs of whitespace as one space, link and
 * image addresses and titles, heading levels, list kind, start, looseness and checkboxes, table
 * alignment and cells, code text, HTML as the text the renderer draws). `raw` and space tokens,
 * which nothing draws, are not compared.
 */

type Signature = unknown[];

function signature(tokens: readonly Token[]): Signature {
  const out: unknown[] = [];
  let text = "";
  const flush = () => {
    if (text !== "") out.push(text.replace(/\s+/g, " "));
    text = "";
  };
  for (const token of tokens as Array<Token & Record<string, never>>) {
    const t = token as unknown as Record<string, unknown> & { type: string; tokens?: Token[] };
    if (t.type === "space" || t.type === "def") continue;
    if ((t.type === "text" && !(t.tokens && t.tokens.length > 0)) || t.type === "escape") {
      text += t.type === "text" ? decodeEntities(String(t.text)) : String(t.text);
      continue;
    }
    if (t.type === "html" && !t.block) {
      text += String(t.raw);
      continue;
    }
    flush();
    const node: Record<string, unknown> = { t: t.type };
    if (t.type === "list") {
      const items = t.items as Array<{ tokens: Token[]; task: boolean; checked?: boolean }>;
      node.ordered = t.ordered;
      if (t.ordered) node.start = t.start;
      node.loose = t.loose;
      node.items = items.map((item) => ({ c: signature(item.tokens), task: item.task ? item.checked === true : undefined }));
    } else if (t.type === "table") {
      const cells = (row: Array<{ tokens: Token[] }>) => row.map((cell) => signature(cell.tokens));
      node.align = t.align;
      node.header = cells(t.header as Array<{ tokens: Token[] }>);
      node.rows = (t.rows as Array<Array<{ tokens: Token[] }>>).map(cells);
    } else if (t.type === "code") node.x = t.text;
    else if (t.type === "codespan") node.x = String(t.text).replace(/\s+/g, " ");
    else if (t.type === "html") node.x = String(t.raw).trim();
    else if (t.type === "checkbox") node.x = t.checked;
    else if (t.tokens) node.c = signature(t.tokens);
    if (t.type === "link" || t.type === "image") {
      node.href = t.href;
      if (t.title) node.title = t.title;
      if (t.type === "image") node.alt = t.text;
    }
    if (t.type === "heading") node.depth = t.depth;
    out.push(node);
  }
  flush();
  return out;
}

const ours = (body: string): Signature => {
  const lexed = lexBounded(body);
  if (!lexed.ok) throw new Error(`refused (${lexed.reason}): ${JSON.stringify(body.slice(0, 80))}`);
  return signature(lexed.tokens);
};
const marked = (body: string): Signature => signature(new Lexer({ gfm: true }).lex(body));

/** One case per construct, and its awkward corners: each must draw exactly as marked's tokens do. */
const CORPUS: Record<string, string> = {
  "link in a link's text (marked nests it)": "[[a](b)](c)",
  "unbalanced runs **a*": "**a*",
  // A run right after a finished emphasis follows a token (marked has no `prevChar` there), and
  // what is left of a closer is a run of its own: emphasis is matched as each run is pushed.
  "strike starting with punctuation after bold": "**a**~~-b~~",
  "em starting with punctuation after the rest of a closer": "**@2***-*",
  "strike of punctuation after em": "*@22*~~---~~",
  "strong after em in a heading, from one run": '#### *21***"(/**',
  // A bare URL is cut only by a run that closes an opener still open (counted exactly).
  "URL after a closed bold keeps its stars": "**Docs** at www.a.co**b**",
  "URL after a closed strike keeps its tilde": "~~old~~ https://x.co/a~b",
  "URL inside an open em still stops at its closer": "*a https://x.co/a*b c*",
  "mixed runs ***a** b ** c*": "***a** b ** c*",
  "NBSP before <address>": "[a](\u00a0<b>)",
  "escaped mark before a closer": "*a \\**",
  // ATX headings
  "atx 1-6": "# a\n## b\n### c\n#### d\n##### e\n###### f",
  "atx 7": "####### g",
  "atx no space": "#hashtag",
  "atx closing": "## a ##",
  "atx closing no space": "## a##",
  "atx only hashes": "### ###",
  "atx indented": "   # a",
  "atx 4 spaces": "    # a",
  "atx tab": "#\ta",
  "atx empty": "#",
  "atx trailing spaces": "# a   ",
  "atx escaped": "\\# a",
  "atx after para": "a\n# b",
  // setext
  "setext 1": "a\n===",
  "setext 2": "a\n---",
  "setext multi": "a\nb\n===",
  "setext spaces": "a\n   ===   ",
  "setext 4 spaces": "a\n    ===",
  "setext tab after": "a\n===\t",
  "setext not after blank": "a\n\n===",
  "setext lazy quote": "> a\n===",
  "setext lazy quote 2": "> a\nb\n===",
  "setext lazy quote dash": "> a\n--",
  "setext in list": "- a\n===",
  "setext with hashtag": "a\n#tag\n===",
  "setext with indented": "a\n    b\n===",
  "setext table-ish": "a\n|-|\n===",
  "setext under bullet": "a\n2. b\n===",
  // paragraphs, breaks
  "para leading spaces": "  a\n   b  ",
  "para trailing": "a\nb  ",
  "hard br": "a  \nb",
  "hard br 3": "a   \nb",
  "hard br backslash": "a\\\nb",
  "br at end": "a  ",
  "br at end nl": "a  \n",
  "backslash end": "a\\",
  "soft": "a\nb\nc",
  "tab line in para": "a\n\t\nb",
  "spaces line": "a\n   \nb",
  "nbsp line": "a\n \nb",
  // emphasis
  "em basic": "*a* _b_ **c** __d__",
  "em nested": "*a **b** c*",
  "strong nested": "**a *b* c**",
  "em triple": "***a***",
  "em triple 2": "***a** b*",
  "em triple 3": "***a* b**",
  "em intraword star": "a*b*c",
  "em intraword under": "a_b_c",
  "em snake": "snake_case_name",
  "em unclosed": "*a",
  "em unmatched": "**a*",
  "em unmatched 2": "*a**",
  "em space": "* a *",
  "em punct": "*\"a\"*",
  "em punct2": "a*\"b\"*c",
  "em under punct": "_\"a\"_",
  "em rule of 3": "*a**b*",
  "em rule of 3b": "**a*b**",
  "em long run": "****a****",
  "em five": "*****a*****",
  "em mixed": "*a _b* c_",
  "em mixed2": "_a *b_ c*",
  "em across link": "*a [b*](c)",
  "em across code": "*a `b* c`",
  "em escaped": "\\*a*",
  "em in word cjk": "中*文*字",
  "em with tilde": "*~a~*",
  "em after link": "[a](b)*c*",
  "em underscore after link": "[a](b)_c_",
  "em before punct": "*a*.",
  "em multi para": "*a\nb*",
  "em star space": "a * b * c",
  "del": "~~a~~ ~b~",
  "del mismatched": "~~a~",
  "del triple": "~~~a~~~",
  "del nested": "~~a *b* c~~",
  "del intraword": "a~~b~~c",
  "del spaced": "~~ a ~~",
  // code spans
  "code basic": "`a`",
  "code double": "``a`b``",
  "code spaces": "` a `",
  "code one space": "` `",
  "code newline": "`a\nb`",
  "code unclosed": "`a",
  "code unequal": "``a`",
  "code backslash": "`a\\`b`",
  "code in em": "*a `*` b*",
  "code tilde": "`~~a~~`",
  "code before tilde": "`a`~b~",
  "tick tilde run": "`~~a~~",
  // fences
  "fence basic": "```\na\n```",
  "fence lang": "```js\na\n```",
  "fence lang spaces": "```  js x  \na\n```",
  "fence tilde": "~~~\na\n~~~",
  "fence longer close": "```\na\n`````",
  "fence shorter close": "````\na\n```\nb\n````",
  "fence unclosed": "```\na\nb",
  "fence unclosed nl": "```\na\n\n",
  "fence indented": " ```\n  a\n b\nc\n ```",
  "fence indented tilde": "  ~~~\n   a\n ~~~",
  "fence backtick info": "``` a`b\nc\n```",
  "fence in para": "a\n```\nb\n```",
  "fence close trailing": "```\na\n```   ",
  "fence close with tilde": "```\na\n```~~",
  "fence escaped lang": "```c\\+\\+\na\n```",
  "fence 4 spaces": "    ```\n    a",
  // indented code
  "icode": "    a\n    b",
  "icode blank": "    a\n\n    b\n",
  "icode tab": "\ta\n\tb",
  "icode trailing blank": "    a\n      \n\nb",
  "icode after para": "a\n    b",
  "icode after list": "- a\n\n      b",
  // hr
  "hr dashes": "---",
  "hr stars": "* * *",
  "hr under": "___",
  "hr tabs": "-\t-\t-",
  "hr after para": "a\n***",
  "hr not": "--",
  "hr 4sp": "    ---",
  // quotes
  "quote basic": "> a",
  "quote multi": "> a\n> b",
  "quote no space": ">a",
  "quote tab": ">\ta",
  "quote blank inside": "> a\n>\n> b",
  "quote lazy": "> a\nb",
  "quote lazy 2": "> a\nb\nc",
  "quote lazy heading": "> # h\nlazy",
  "quote lazy after empty": ">\nb",
  "quote lazy hr": "> a\n---",
  "quote lazy list": "> a\n- b",
  "quote lazy ordered 2": "> a\n2. b",
  "quote lazy code": "> a\n    b",
  "quote nested": "> > a",
  "quote nested lazy": "> > a\nb",
  "quote nested lazy 2": "> > a\nb\n> c",
  "quote nested back": "> a\n> > b\nc",
  "quote email": "> > > a\nb\n> > c\n> d\ne",
  "quote fence": "> ```\na",
  "quote fence closed": "> ```\n> a\n> ```",
  "quote list": "> - a\n> - b",
  "quote list lazy": "> - a\nb",
  "quote list lazy item": "> 1. a\n2. b",
  "quote heading": "> # a",
  "quote table": "> | a | b |\n> |---|---|\n> | 1 | 2 |",
  "quote table lazy row": "> |a|b|\n> |-|-|\n|c|d|",
  "quote then para": "> a\n\nb",
  "quote html": "> <div>\n> x",
  "quote def lazy": "> a\n[x]: y",
  "quote deep": "> > > > > a",
  "quote indented": "   > a",
  "quote 4sp": "    > a",
  "quote empty lines": ">\n>\n> a",
  // lists
  "ul star": "* a\n* b",
  "ul plus": "+ a\n+ b",
  "ul mixed": "- a\n* b",
  "ol paren": "1) a\n2) b",
  "ol start": "3. a\n4. b",
  "ol start 0": "0. a",
  "ol big": "123456789. a",
  "ol too big": "1234567890. a",
  "list loose": "- a\n\n- b",
  "list loose inner": "- a\n\n  b",
  "list tight nested": "- a\n  - b\n- c",
  "list nested ol": "1. a\n   1. b",
  "list nested 3": "- a\n  - b\n    - c",
  "list staircase": "- a\n - b\n  - c\n   - d\n    - e",
  "list lazy": "- a\nb",
  "list lazy para": "- a\n  b\nc",
  "list blank first": "-\n  a",
  "list blank first 2": "-\n\n  a",
  "list empty item": "- a\n-\n- c",
  "list spaces item": "- ",
  "list dash alone": "-",
  "list para interrupt": "a\n- b",
  "list para no interrupt": "a\n2. b",
  "list para 1": "a\n1. b",
  "list hr": "- a\n- - -\n- b",
  "list hr star": "* a\n* * *",
  "list code in item": "- a\n\n      code",
  "list fence in item": "- ```\n  a\n  ```",
  "list fence lazy": "- ```\n  a\nb",
  "list heading in item": "- # a",
  "list heading after": "- a\n# b",
  "list quote in item": "- > a\n  > b",
  "list quote lazy": "- > a\nb",
  "list task": "- [ ] a\n- [x] b\n- [X] c",
  "list task loose": "- [ ] a\n\n- [x] b",
  "list task no space": "- [ ]a",
  "list task only": "- [ ] ",
  "list task ordered": "1. [x] a",
  "list wide indent": "-     a",
  "list tab": "-\ta\n\tb",
  "list ordered nested ul": "1. a\n   - b\n2. c",
  "list then para": "- a\n\nb",
  "list then indented para": "- a\n\n  b\n\nc",
  "list item multi para": "1. a\n\n   b\n\n2. c",
  "list nested loose": "- a\n  - b\n\n  - c",
  "list text after nested": "- a\n  - b\n\n  c",
  "list text after nested tight": "- a\n  - b\n  c",
  "list def in item": "- a\n  [x]: y",
  "list html in item": "- <div>\n  x",
  "list item heading lazy": "- a\n  ===",
  "list nbsp blank": "- a\n \n- b",
  "list 2 blank": "- a\n\n\n- b",
  "list end blank": "- a\n\n",
  "list numbers": "1. a\n1. b\n1. c",
  // tables
  "table align": "| a | b | c |\n|:--|:-:|--:|\n| 1 | 2 | 3 |",
  "table no outer pipes": "a | b\n--|--\n1 | 2",
  "table escaped pipe": "| a \\| b | c |\n|---|---|\n| 1 | 2 |",
  "table escaped backslash pipe": "| a \\\\| b |\n|---|---|",
  "table code pipe": "| `a|b` | c |\n|---|---|",
  "table long row": "| a | b |\n|---|---|\n| 1 | 2 | 3 |",
  "table count mismatch": "| a | b |\n|---|",
  "table no pipe delim": "a\n---",
  "table colon delim": "a\n:-",
  "table ends blank": "|a|\n|-|\n|b|\n\nc",
  "table ends heading": "|a|\n|-|\n|b|\n# c",
  "table row no pipe": "|a|\n|-|\nb",
  "table in para": "x\n|a|\n|-|\n|b|",
  "table inline": "| *a* | [b](c) |\n|---|---|\n| `d` | e |",
  "table empty cells": "| a | b |\n|---|---|\n|   | 2 |",
  "table single col": "|a|\n|-|",
  "table delim spaces": "| a |\n| --- |",
  // links
  "link basic": "[a](b)",
  "link title": '[a](b "t")',
  "link title single": "[a](b 't')",
  "link title paren": "[a](b (t))",
  "link angle": "[a](<b c>)",
  "link angle empty": "[a](<>)",
  "link empty": "[a]()",
  "link parens": "[a](b(c)d)",
  "link unbalanced": "[a](b(c)",
  "link unbalanced 2": "[a](b(c)(d)",
  "link unbalanced 3": "[a](b(c) x",
  "link paren end": "[a](b)c)",
  "link nested label": "[a [b] c](d)",
  "link nested 2": "[a [b [c]] d](e)",
  "link in link": "[[a](b)](c)",
  "link escaped bracket": "[a\\]b](c)",
  "link label code": "[a `]` b](c)",
  "link space dest": "[a]( b )",
  "link newline dest": "[a](\nb\n)",
  "link newline title": '[a](b\n"t")',
  "link no close": "[a](b",
  "link bad title": '[a](b "t)',
  "link title then junk": '[a](b "t" x)',
  "link escaped paren": "[a](b\\)c)",
  "link entity": "[a](b&amp;c)",
  "link javascript": "[a](javascript:alert(1))",
  "link nbsp": "[a]( b)",
  "link nbsp end": "[a](b )",
  "link url label": "[http://a.com](http://b.com)",
  "link www label": "[see www.a.com now](x)",
  "link email label": "[me@a.com](x)",
  "link bold": "**[a](b)**",
  "link angle lt": "[a](<b<c>)",
  "link angle escaped": "[a](<b\\>c>)",
  "link label newline": "[a\nb](c)",
  "image": "![a *b*](c)",
  "image title": '![a](b "t")',
  "image in link": "[![a](b)](c)",
  "image ref": "![a][r]\n\n[r]: b",
  "image bang text": "!not an image",
  "image undefined ref": "![a][nope]",
  "bang link": "a![b](c)",
  // references
  "ref full": "[a][b]\n\n[b]: c",
  "ref collapsed": "[a][]\n\n[a]: c",
  "ref shortcut": "[a]\n\n[a]: c",
  "ref case": "[A]\n\n[a]: c",
  "ref spaces": "[a  b]\n\n[a b]: c",
  "ref undefined": "[a][b]",
  "ref shortcut undefined": "[a]",
  "ref title": '[a]\n\n[a]: c "t"',
  "ref title next line": '[a]\n\n[a]: c\n"t"',
  "ref angle": "[a]\n\n[a]: <c d>",
  "ref dest next line": "[a]\n\n[a]:\nc",
  "ref dup": "[a]\n\n[a]: b\n[a]: c",
  "ref before use": "[a]: b\n\n[a]",
  "ref in para": "x\n[a]: b\n\n[a]",
  "ref bad title": '[a]: b "t" x\n\n[a]',
  "ref nested brackets": "[a [b]]\n\n[a [b]]: c",
  "ref undefined label defined": "[a][b]\n\n[a]: c",
  "ref empty label": "[]: x",
  "ref whitespace label": "[ ]: x",
  "ref escaped": "[a\\]]\n\n[a\\]]: b",
  // autolinks
  "auto angle": "<http://a.com>",
  "auto angle mail": "<a@b.co>",
  "auto angle scheme": "<irc://x>",
  "auto angle space": "<http://a b>",
  "url bare": "http://a.com/x",
  "url https": "see https://a.com/x.",
  "url www": "www.a.com",
  "url WWW": "WWW.a.com",
  "url mid word": "xhttp://a.com",
  "url www mid": "rewww.a.com",
  "url trailing punct": "http://a.com/x?!.,:;",
  "url paren": "http://a.com/x(y)",
  "url paren unbalanced": "http://a.com/x(y",
  "url close paren": "(http://a.com/x)",
  "url entity": "http://a.com/?a&amp;",
  "url entity mid": "http://a.com/?a&amp;b",
  "url entity dot": "http://a.com/x&amp;.",
  "url star": "http://a.com/*x*",
  "url underscore": "http://a.com/a_b_",
  "url lt": "http://a.com<b>",
  "url ftp": "ftp://a.com",
  "url HTTP": "HTTP://A.COM",
  "url no host": "http://",
  "url in em": "*see http://a.com*",
  "url in code": "`http://a.com`",
  "url in parens": "(see www.a.com)",
  "url after bracket": "[http://a.com]",
  "url nbsp end": "http://a.com x",
  "email": "a@b.co",
  "email dots": "a.b+c@d.e.co",
  "email underscore": "a_b@c.co",
  "email dash end": "a@b.c-",
  "email dash label": "a@b.cd-",
  "email two at": "a@b@c.co",
  "email no dot": "a@b",
  "email www": "x@www.a.co",
  "email local www": "a.www.x@y.co",
  "email in text": "write to me@example.com today",
  "email under open": "x _b@c.co",
  "email bang": "a!b@c.de",
  "email trailing dot": "a@b.co.",
  // html inline
  "html tag": "a <b>c</b> d",
  "html attr": 'a <a href="x">b</a>',
  "html attr single": "a <span class='x y'>b</span>",
  "html attr unquoted": "a <a href=x>b</a>",
  "html self": "a <br/> b",
  "html comment": "a <!-- c --> b",
  "html comment unclosed": "a <!-- c",
  "html pi": "a <?php x ?> b",
  "html decl": "a <!DOCTYPE html> b",
  "html cdata": "a <![CDATA[x]]> b",
  "html bad": "a <b c=> d",
  "html lt alone": "a < b",
  "html lt num": "a <1> b",
  "html close": "a </b> c",
  "html newline attr": "a <b\nc=\"d\"> e",
  "html link suppress url": '<a href="x">http://y.com</a> http://z.com',
  "html em inside attr": '<a title="*x*">*y*</a>',
  // html blocks
  "hblock div": "<div>\n*a*\n</div>",
  "hblock div blank": "<div>\n*a*\n\n*b*",
  "hblock script": "<script>\nx\n\ny\n</script>\nz",
  "hblock pre": "<pre>\na\n</pre>",
  "hblock comment": "<!--\na\n-->\nb",
  "hblock pi": "<?x\ny?>\nz",
  "hblock pi tail": "<?x?> tail",
  "hblock decl": "<!DOCTYPE html>\nx",
  "hblock cdata": "<![CDATA[\nx\n]]>",
  "hblock kind7": "<custom-tag>\nx\n\ny",
  "hblock kind7 close": "</custom>\nx",
  "hblock kind7 not alone": "<custom> x",
  "hblock kind7 no interrupt": "a\n<custom>\nb",
  "hblock interrupts": "a\n<div>\nb",
  "hblock upper": "<DIV>\nx",
  "hblock upper no interrupt": "a\n<DIV>\nb",
  "hblock indented": "   <div>\nx",
  "hblock table": "<table><tr><td>x</td></tr></table>",
  "hblock figure": '<figure class="x"><img src="a.jpg" alt="b"/><figcaption>c</figcaption></figure>',
  "hblock in list": "- <div>\n  x\n\n- b",
  // escapes, entities
  "escapes": "\\*a\\* \\_b\\_ \\# \\[c\\] \\` \\\\ \\<",
  "escape non punct": "\\a \\1",
  "entities": "&amp; &lt; &gt; &quot; &#39; &#x27; &nbsp; &copy; &bogus;",
  "entity in link": "[a&amp;b](c)",
  // misc
  "crlf": "a\r\nb\r\n\r\n- c\r\n- d",
  "cr": "a\rb",
  "tabs": "\ta\n\t\tb",
  "only spaces": "   ",
  "only newlines": "\n\n\n",
  "unicode": "Grüße *ñ* 😀 **日本**",
  "emoji em": "😀*a*😀",
  "nul": "a\u0000b",
  "footnote": "Term[^1]\n\n[^1]: note",
  "math": "$$x<y$$",
  "admonition": ":::warning\n<b>x</b>\n:::",
  "everything": "## Heading\n\nA paragraph with **bold**, *italic*, ~~strike~~ and a [link](https://example.com).\n\n- one\n- two\n\n1. first\n2. second\n\n> quoted\n\n```\ncode here\n```\n\n---\n\n![alt](https://x/a.webp)\n\nEnd.",
};

/**
 * Where the signatures differ on purpose. Each is pinned (the test fails if marked and this lexer
 * come to agree, or if ours changes), with the reason ours is the safer or an equally valid reading.
 */
const PINNED: Array<{ body: string; ours: Signature; reason: string }> = [
  {
    body: "| a | b |\n|---|---|\n| 1 |",
    ours: [{ t: "table", align: [null, null], header: [["a"], ["b"]], rows: [[["1"]]] }],
    reason:
      "a short row is not padded to the header's width (marked pads it, which made a wide table's memory rows x columns); the row draws one cell, not one and an empty one",
  },
  {
    body: "~`a`",
    ours: [{ t: "paragraph", c: ["~", { t: "codespan", x: "a" }] }],
    reason:
      "an unmatched ~ right before a code span: marked's text rule takes `[`~]+` as one run and loses the code span; CommonMark and GFM read the code span",
  },




  {
    body: "[a]\n\n[a\n]: b",
    ours: [{ t: "paragraph", c: ["[a]"] }, { t: "paragraph", c: ["[a ]: b"] }],
    reason: "a definition's label is on one line (marked lets it run over lines)",
  },
];

describe("parity with marked on every construct", () => {
  for (const [name, body] of Object.entries(CORPUS)) {
    it(name, () => {
      expect(ours(body), JSON.stringify(body)).toEqual(marked(body));
    });
  }
});

describe("parity with marked on the 47 realistic families", () => {
  for (const [name, { gen }] of Object.entries(REALISTIC)) {
    it(name, () => {
      for (const n of [1, 3, 12, 40]) {
        reseed();
        const body = gen(n);
        expect(ours(body), `${name} x ${n}`).toEqual(marked(body));
      }
    });
  }
});

describe("the pinned differences, each with its reason", () => {
  for (const pinned of PINNED) {
    it(pinned.reason, () => {
      expect(ours(pinned.body)).toEqual(pinned.ours);
      expect(marked(pinned.body)).not.toEqual(pinned.ours);
    });
  }
});

describe("what the rich editor writes goes live as the editor read it", () => {
  // The editor serialises with @tiptap/markdown, which reads with marked: the live page must read
  // every body the editor can write the same way (tests/unit/m16-body-editor-markdown.test.ts).
  const IMAGE = "https://x.example/storage/v1/object/public/page-media/u/f.webp";
  const SUPPORTED = [
    "Just a paragraph.",
    "One.\n\nTwo.",
    "## A heading\n\n### Third\n\n#### Fourth",
    "Some **bold**, *italic*, ~~struck~~ and ***both*** text.",
    "A [link](https://example.com/a?b=1&c=2) and a [**bold link**](https://example.com).",
    "- one\n- two\n- three\n\n1. first\n2. second\n\n- a\n  - nested\n- b",
    "> Quoted words.\n\n```js\nlet a = 1;\n```\n\nRun `pnpm verify` first.\n\nAbove.\n\n---\n\nBelow.",
    `line one  \nline two\n\n![A photo](${IMAGE})\n\nBefore ![alt](${IMAGE}) after.`,
  ];

  it("the editor's own corpus, through a round trip", () => {
    for (const body of SUPPORTED) {
      const written = toMarkdown(fromMarkdown(body));
      expect(ours(written), written).toEqual(marked(written));
    }
  });

  it("randomised typed text (*_~[]()<>&\\, URL prefixes, @), as the serializer writes it", () => {
    const PIECES = [..."*_~[]()<>&\\".split(""), "http://", "https://", "www.", "WWW.", "@", "a", "co", ".", "/", " ", "x.co", "amp;", "#38;", "# ", "- ", "1. ", "> ", "---"];
    const random = seeded(0x5eed);
    for (let i = 0; i < 1500; i += 1) {
      let text = "";
      const length = 1 + Math.floor(random() * 24);
      for (let j = 0; j < length; j += 1) text += PIECES[Math.floor(random() * PIECES.length)];
      const marks = random() < 0.3 ? [{ type: random() < 0.5 ? "bold" : "italic" }] : undefined;
      const doc = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: `t ${text.trim()}`.trim(), marks }] }] };
      const written = toMarkdown(doc);
      expect(ours(written), JSON.stringify(written)).toEqual(marked(written));
    }
  });
});

describe("a seeded differential fuzz over small documents", () => {
  // Distinct bodies only (the shared generator draws 3,755 distinct of 4,000). Measured: 46 of them
  // differ at the start of the third pass (1.23%; the old generator cycled and drew 1,282 distinct
  // bodies, 10 differing), 45 after it (1.20%): emphasis counting, runs of `~` and
  // backticks, and bare URLs and emails next to emphasis. The bound sits just above.
  it("draws as marked does on at least 98.7% of random distinct documents", () => {
    const PIECES = ["a", "b c", " ", "  ", "\n", "\n\n", "*", "**", "_", "__", "~", "~~", "`", "``", "[", "]", "(", ")", "![", "<", ">", "<b>", "</b>", '<a href="x">', "\\", "\\*", "&amp;", "&", "#", "## ", "> ", "- ", "1. ", "2) ", "    ", "\t", "|", "---", "===", "```", "~~~", "http://x.co/p", "www.x.co", "a@b.co", "[l](http://u.co)", "[l][r]", "[r]: http://d.co", "<http://x.co>", '"t"', ":", ".", ",", "!", "?", "'", "-", "+", "=", "\u00a0", "日本"];
    const random = seeded(1);
    const bodies = new Set<string>();
    for (let k = 0; k < 4000; k += 1) {
      let body = "";
      const length = 1 + Math.floor(random() * 14);
      for (let j = 0; j < length; j += 1) body += PIECES[Math.floor(random() * PIECES.length)];
      bodies.add(body);
    }
    const differing = [...bodies].filter((body) => JSON.stringify(ours(body)) !== JSON.stringify(marked(body)));
    expect(bodies.size).toBeGreaterThan(3_700);
    expect(differing.length / bodies.size, differing.slice(0, 10).map((b) => JSON.stringify(b)).join("\n")).toBeLessThan(0.013);
  });
});
