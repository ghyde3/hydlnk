// @vitest-environment jsdom
import { Editor } from "@tiptap/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LIMITS, MARK_MESSAGES, type Mark } from "@/lib/document";
import { buildExtensions } from "@/components/blocks/forms/text-editor/extensions";
import {
  marksToTiptapDoc,
  tiptapDocToTextAndMarks,
} from "@/components/blocks/forms/text-editor/convert";

/**
 * M9-12: the editor's schema and guards, run in a headless editor (jsdom, no layout): what it can
 * hold, what it refuses, what a paste keeps. Focus, keys, the toolbar and the phone keyboard are
 * checked in a real browser (tests/e2e/m9/text-*.spec.ts).
 */

// jsdom has no ClipboardEvent; ProseMirror's own paste helpers (`pasteHTML`, `pasteText`) build one.
(globalThis as { ClipboardEvent?: unknown }).ClipboardEvent ??= class ClipboardEvent extends Event {
  clipboardData = null;
};

const editors: Editor[] = [];
afterEach(() => {
  while (editors.length > 0) editors.pop()!.destroy();
  vi.restoreAllMocks();
});

function open(text = "", marks: unknown = [], hooks = { refuse: vi.fn() }) {
  const editor = new Editor({
    element: document.createElement("div"),
    extensions: buildExtensions(hooks),
    content: marksToTiptapDoc(text, marks),
  });
  editors.push(editor);
  document.body.appendChild(editor.view.dom);
  return { editor, hooks };
}

const model = (editor: Editor) =>
  tiptapDocToTextAndMarks(editor.getJSON(), { newId: () => "fresh-id-for-test" });

const bold = (start: number, end: number) => ({ type: "bold", start, end }) as Mark;

describe("M9-12 the schema", () => {
  it("allows only doc, paragraph and text, with five marks", () => {
    const { editor } = open("Hello");
    const { nodes, marks } = editor.schema;
    expect(Object.keys(nodes).sort()).toEqual(["doc", "paragraph", "text"]);
    expect(Object.keys(marks).sort()).toEqual(["bold", "italic", "link", "strike", "underline"]);
  });

  it("registers every extension once: no duplicate-name warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    open("Hello");
    expect(warn.mock.calls.flat().join(" ")).not.toMatch(/Duplicate extension names/i);
  });

  it("opens with the block's text and marks and writes nothing", () => {
    const onUpdate = vi.fn();
    const hooks = { refuse: vi.fn() };
    const editor = new Editor({
      element: document.createElement("div"),
      extensions: buildExtensions(hooks),
      content: marksToTiptapDoc("Hello world", [bold(6, 11)]),
      onUpdate,
    });
    editors.push(editor);
    expect(onUpdate).not.toHaveBeenCalled();
    expect(model(editor)).toEqual({ text: "Hello world", marks: [bold(6, 11)] });
  });

  it("an alignment is explicit: none until chosen, toggled off by choosing it again", () => {
    const { editor } = open("one\ntwo");
    expect(model(editor).marks).toEqual([]);
    editor.commands.setTextSelection(6);
    editor.commands.setTextAlign("center");
    expect(model(editor).marks).toEqual([{ type: "align", start: 4, end: 7, align: "center" }]);
    editor.commands.toggleTextAlign("center");
    expect(model(editor).marks).toEqual([]);
    editor.commands.toggleTextAlign("left");
    expect(model(editor).marks).toEqual([{ type: "align", start: 4, end: 7, align: "left" }]);
    expect(editor.commands.setTextAlign("justify")).toBe(false);
  });

  it("a paragraph's alignment shows as data-align, never as an inline style", () => {
    const { editor } = open("one", [{ type: "align", start: 0, end: 3, align: "right" }]);
    const p = editor.view.dom.querySelector("p")!;
    expect(p.getAttribute("data-align")).toBe("right");
    expect(p.getAttribute("style")).toBeNull();
  });
});

describe("M9-12 links", () => {
  it("keep their id and show no href that is not http or https", () => {
    const { editor } = open("go here", [
      { type: "link", start: 3, end: 7, id: "link-core-0001", url: "https://example.com/a" },
    ]);
    expect(model(editor).marks).toEqual([
      { type: "link", start: 3, end: 7, id: "link-core-0001", url: "https://example.com/a" },
    ]);
    const a = editor.view.dom.querySelector("a")!;
    expect(a.getAttribute("href")).toBe("https://example.com/a");
    expect(a.getAttribute("target")).toBeNull();
    const hostile = open("go here", [
      { type: "link", start: 3, end: 7, id: "link-core-0002", url: "javascript:alert(1)" },
    ]);
    expect(hostile.editor.view.dom.querySelector("a")?.getAttribute("href")).toBe("");
  });

  it("a link made with the command is a link mark with the id we give it", () => {
    const { editor } = open("go here");
    editor.commands.setTextSelection({ from: 4, to: 8 });
    editor.commands.setMark("link", { href: "https://example.com/x", id: "link-core-0003" });
    expect(model(editor).marks).toEqual([
      { type: "link", start: 3, end: 7, id: "link-core-0003", url: "https://example.com/x" },
    ]);
  });

  it("typing a web address does not link it", () => {
    const { editor } = open("");
    editor.commands.insertContent("https://example.com/auto ");
    expect(model(editor).marks).toEqual([]);
    editor.view.pasteText("https://example.com/pasted");
    expect(model(editor).marks).toEqual([]);
  });

  it("a link split in two gets a fresh id on the second part, and a pasted link gets one", () => {
    const { editor } = open("ab--cd", [
      { type: "link", start: 0, end: 6, id: "link-core-0004", url: "https://example.com/a" },
    ]);
    editor.commands.setTextSelection({ from: 3, to: 5 });
    editor.commands.unsetMark("link");
    const ids = model(editor).marks.map((m) => (m.type === "link" ? m.id : null));
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe("link-core-0004");
    expect(ids[1]).not.toBe("link-core-0004");
    expect(ids[1]).toMatch(/^[A-Za-z0-9_-]{8,24}$/);
  });
});

describe("M9-12 paste and drop keep only what the document can hold", () => {
  it("the spec's hostile paste keeps 'Hi x there' with one bold mark and nothing else", () => {
    const { editor } = open("");
    editor.view.pasteHTML(
      "<img src=x onerror=alert(1)><p style='color:red'>Hi <a href='javascript:alert(1)'>x</a> <b>there</b></p>",
    );
    expect(model(editor)).toEqual({ text: "Hi x there", marks: [bold(5, 10)] });
    expect(editor.view.dom.querySelector("img, script, a, [style], [onerror]")).toBeNull();
  });

  it("headings, lists, tables, code, fonts and colors become plain paragraphs", () => {
    const { editor } = open("");
    editor.view.pasteHTML(
      "<h1>Title</h1><ul><li>one</li><li>two</li></ul><table><tr><td>cell</td></tr></table><pre><code>x = 1</code></pre><p style='font-family:serif;font-size:30px;text-align:center'><font color=red>plain</font></p>",
    );
    const result = model(editor);
    expect(result.text.split("\n")).toEqual(expect.arrayContaining(["Title", "one", "two", "x = 1", "plain"]));
    expect(result.marks).toEqual([]);
    expect(editor.view.dom.querySelector("h1, ul, li, table, pre, code, font, [style]")).toBeNull();
  });

  it("keeps bold, italic, strikethrough and underline, the tags and the styles alike", () => {
    const { editor } = open("");
    editor.view.pasteHTML(
      "<p><b>a</b><i>b</i><del>c</del><u>d</u> <span style='font-weight:700'>e</span><span style='text-decoration:line-through'>f</span><span style='text-decoration:underline'>g</span></p>",
    );
    const { text, marks } = model(editor);
    expect(text).toBe("abcd efg");
    expect(marks.map((m) => `${m.type}:${m.start}-${m.end}`).sort()).toEqual(
      ["bold:0-1", "bold:5-6", "italic:1-2", "strike:2-3", "strike:6-7", "underline:3-4", "underline:7-8"].sort(),
    );
  });

  it("keeps an http link with a fresh id, drops javascript, data and mailto links", () => {
    const { editor } = open("");
    editor.view.pasteHTML(
      "<p><a href='https://example.com/a?x=1'>web</a> <a href='javascript:alert(1)'>js</a> <a href='data:text/html,x'>data</a> <a href='mailto:a@b.c'>mail</a></p>",
    );
    const { text, marks } = model(editor);
    expect(text).toBe("web js data mail");
    expect(marks).toHaveLength(1);
    expect(marks[0]).toMatchObject({ type: "link", start: 0, end: 3, url: "https://example.com/a?x=1" });
    const link = (marks[0] as { id: string }).id;
    expect(link).toMatch(/^[A-Za-z0-9_-]{8,24}$/);
    expect(link).not.toBe("fresh-id-for-test");
  });

  it("two pasted links get two different ids", () => {
    const { editor } = open("");
    editor.view.pasteHTML("<p><a href='https://a.example/'>one</a> and <a href='https://b.example/'>two</a></p>");
    const ids = editor
      .getJSON()
      .content!.flatMap((p) => p.content ?? [])
      .flatMap((n) => n.marks ?? [])
      .filter((m) => m.type === "link")
      .map((m) => m.attrs?.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });

  it("an id written in the pasted HTML is ignored", () => {
    const { editor } = open("");
    editor.view.pasteHTML("<p><a href='https://a.example/' data-id='x' id='link-forged-01'>one</a></p>");
    const mark = model(editor).marks[0] as { id?: string };
    expect(mark.id).not.toBe("link-forged-01");
  });

  it("plain text keeps its lines, empty ones too, and loses control characters", () => {
    const { editor } = open("");
    editor.view.pasteText("one\r\n\r\ntwo\u0007\nthree");
    expect(model(editor).text).toBe("one\n\ntwo\nthree");
  });

  it("the text is cut to 600 code points; 100,000 characters finish quickly", () => {
    const { editor } = open("");
    const started = performance.now();
    editor.view.pasteText("x".repeat(100_000));
    expect(performance.now() - started).toBeLessThan(2000);
    expect(Array.from(model(editor).text)).toHaveLength(LIMITS.text);
    editor.view.pasteHTML(`<p>${"y".repeat(5000)}</p>`);
    expect(Array.from(model(editor).text)).toHaveLength(LIMITS.text);
  });

  it("an emoji is never cut in half at the limit", () => {
    const { editor } = open("a".repeat(599));
    editor.commands.focus("end");
    editor.view.pasteText("\u{1F44D}\u{1F44D}");
    const { text } = model(editor);
    expect(Array.from(text)).toHaveLength(600);
    expect(text.endsWith("\u{1F44D}")).toBe(true);
  });

  it("the typed text of link text is just text", () => {
    const { editor } = open("");
    editor.commands.insertContent("<img src=x onerror=alert(1)>");
    expect(model(editor).text).toBe("<img src=x onerror=alert(1)>");
    expect(editor.view.dom.querySelector("img")).toBeNull();
  });
});

describe("M9-12 formatting is explicit", () => {
  /** Types `text` one character at a time through the view's text input, as the browser does. */
  function type(editor: Editor, text: string) {
    for (const char of Array.from(text)) {
      const { from, to } = editor.state.selection;
      const handled = editor.view.someProp("handleTextInput", (f) =>
        f(editor.view, from, to, char, () => editor.state.tr.insertText(char, from, to)),
      );
      if (!handled) editor.view.dispatch(editor.state.tr.insertText(char, from, to));
    }
  }

  it("typed Markdown stays literal: no bold, italic, strike or link", () => {
    const { editor } = open("");
    editor.commands.focus("end");
    type(editor, "**b** and _i_ and ~~s~~ and `c` and [t](https://example.com)");
    expect(model(editor)).toEqual({
      text: "**b** and _i_ and ~~s~~ and `c` and [t](https://example.com)",
      marks: [],
    });
  });

  it("pasted Markdown stays literal too", () => {
    const { editor } = open("");
    editor.view.pasteText("**b** _i_ ~~s~~ [t](https://example.com)");
    expect(model(editor).marks).toEqual([]);
    expect(model(editor).text).toBe("**b** _i_ ~~s~~ [t](https://example.com)");
  });
});

describe("M9-12 limits", () => {
  it("typing past 600 inserts nothing", () => {
    const { editor } = open("a".repeat(600));
    editor.commands.focus("end");
    editor.commands.insertContent("b");
    expect(Array.from(model(editor).text)).toHaveLength(600);
    expect(model(editor).text.endsWith("b")).toBe(false);
  });

  it("a block already over the limit can still be edited down", () => {
    const { editor } = open("a".repeat(700));
    editor.commands.focus("end");
    editor.commands.deleteRange({ from: 600, to: 640 });
    expect(Array.from(model(editor).text)).toHaveLength(660);
  });

  it("a change that would leave more than 30 inline marks is refused, with the message", () => {
    const { editor, hooks } = open("x".repeat(80));
    for (let i = 0; i < 30; i++) {
      editor.commands.setTextSelection({ from: 1 + i * 2, to: 2 + i * 2 });
      editor.commands.setMark("bold");
    }
    expect(model(editor).marks.filter((m) => m.type !== "align").length).toBeGreaterThan(0);
    // Non-adjacent marks of different types, to pass 30 runs.
    const { editor: e2, hooks: h2 } = open("x".repeat(200));
    for (let i = 0; i < 40; i++) {
      e2.commands.setTextSelection({ from: 1 + i * 3, to: 2 + i * 3 });
      e2.commands.setMark(i % 2 === 0 ? "bold" : "underline");
    }
    const marks = model(e2).marks;
    expect(marks.filter((m) => m.type !== "align").length).toBeLessThanOrEqual(LIMITS.textMarks);
    expect(h2.refuse).toHaveBeenCalledWith(MARK_MESSAGES.editorTooMany);
    void hooks;
  });

  it("an 11th link is refused", () => {
    const { editor, hooks } = open("x".repeat(100));
    for (let i = 0; i < 11; i++) {
      editor.commands.setTextSelection({ from: 1 + i * 4, to: 3 + i * 4 });
      editor.commands.setMark("link", { href: "https://example.com/" + i, id: `link-core-${String(i).padStart(4, "0")}` });
    }
    expect(model(editor).marks.filter((m) => m.type === "link")).toHaveLength(LIMITS.textLinks);
    expect(hooks.refuse).toHaveBeenCalledWith(MARK_MESSAGES.editorTooManyLinks);
  });

  it("a change that would leave more than 20 alignments is refused", () => {
    const lines = Array.from({ length: 22 }, (_, i) => `l${i}`).join("\n");
    const { editor, hooks } = open(lines);
    let position = 1;
    for (let i = 0; i < 22; i++) {
      editor.commands.setTextSelection(position + 1);
      editor.commands.setTextAlign("center");
      position += `l${i}`.length + 2;
    }
    expect(model(editor).marks.filter((m) => m.type === "align")).toHaveLength(LIMITS.textAligns);
    expect(hooks.refuse).toHaveBeenCalledWith(MARK_MESSAGES.editorTooMany);
  });
});
