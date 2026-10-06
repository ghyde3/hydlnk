import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

/**
 * M9-19 (script side): the one tenant script's copy branch, run in jsdom. A click inside an element
 * with `data-copy` writes that value (cut to 64 characters) to the visitor's own clipboard, shows the
 * element's `data-copied` word for two seconds, and falls back to selecting the code's text. It reads
 * those two attributes and no other, sends nothing, and never reads the clipboard.
 */

const PAGE_ID = "6f1c2a52-3a1e-4c0b-9d57-0b8f2f7a1e01";
const ROOT = process.cwd();
const FILE = readdirSync(join(ROOT, "public/_t")).find((name) =>
  /^p\.[0-9a-f]{12}\.js$/.test(name),
)!;
const CODE = readFileSync(join(ROOT, "public/_t", FILE), "utf8");
const SOURCE = readFileSync(join(ROOT, "src/lib/tenant-assets/script/tenant.js"), "utf8");

const BLOCK = (code: string, id = "d1") =>
  `<div class="pg-discount" data-block-id="${id}" data-block-type="discount">` +
  `<p class="pg-discount-desc">10% off</p>` +
  `<code class="pg-discount-code">${code}</code>` +
  `<button type="button" class="pg-discount-copy" data-copy="${code}" data-copied="Copied">Copy</button> ` +
  `<span class="pg-discount-status" role="status"></span></div>`;

type ClipboardMode = "ok" | "missing" | "reject" | "throws";

function load(body: string, clipboard: ClipboardMode = "ok") {
  const dom = new JSDOM(`<!DOCTYPE html><html lang="en"><body>${body}</body></html>`, {
    url: "http://mara.localhost:3000/",
    runScripts: "dangerously",
    pretendToBeVisual: true,
  });
  const { window } = dom;
  const written: string[] = [];
  const beacons: string[] = [];
  const timers: { fn: () => void; ms: number; id: number; live: boolean }[] = [];
  const read: string[] = [];
  const nav = window.navigator as unknown as Record<string, unknown>;
  nav.sendBeacon = (to: string) => {
    beacons.push(to);
    return true;
  };
  if (clipboard !== "missing") {
    Object.defineProperty(nav, "clipboard", {
      configurable: true,
      value: {
        writeText: (value: string) => {
          written.push(value);
          if (clipboard === "throws") throw new TypeError("not allowed");
          return clipboard === "reject" ? Promise.reject(new Error("denied")) : Promise.resolve();
        },
        readText: () => {
          read.push("readText");
          return Promise.resolve("");
        },
      },
    });
  }
  // Timers the script sets are collected, so a test can run them without waiting two seconds.
  const w = window as unknown as Record<string, unknown>;
  w.setTimeout = (fn: () => void, ms: number) => {
    timers.push({ fn, ms, id: timers.length + 1, live: true });
    return timers.length;
  };
  w.clearTimeout = (id: number) => {
    const timer = timers.find((candidate) => candidate.id === id);
    if (timer) timer.live = false;
  };
  const attributes: string[] = [];
  const proto = window.Element.prototype;
  const original = proto.getAttribute;
  proto.getAttribute = function (name: string) {
    attributes.push(name);
    return original.call(this, name);
  };
  const script = window.document.createElement("script");
  script.setAttribute("data-page-id", PAGE_ID);
  script.textContent = CODE;
  window.document.body.appendChild(script);
  attributes.length = 0;
  const doc = window.document;
  return {
    dom,
    doc,
    written,
    beacons,
    read,
    attributes,
    runTimers: () => {
      for (const timer of timers.splice(0)) if (timer.live) timer.fn();
    },
    timers,
    click: (el: Element) => el.dispatchEvent(new window.MouseEvent("click", { bubbles: true })),
    flush: () => new Promise((resolve) => setTimeout(resolve, 0)),
    button: () => doc.querySelector<HTMLButtonElement>("button.pg-discount-copy")!,
    status: () => doc.querySelector(".pg-discount-status")!,
  };
}

describe("M9-19 load", () => {
  it("marks every .pg-discount with data-js, which is what shows the Copy button", () => {
    const { doc } = load(BLOCK("SAVE10", "d1") + BLOCK("SUMMER", "d2"));
    const blocks = [...doc.querySelectorAll(".pg-discount")];
    expect(blocks).toHaveLength(2);
    for (const block of blocks) expect(block.getAttribute("data-js")).toBe("");
  });

  it("a page with no discount block gets nothing marked, and the script still loads cleanly", () => {
    const { doc } = load('<div class="pg-text">x</div>');
    expect(doc.querySelectorAll("[data-js]").length).toBe(0);
  });

  it("loading requests nothing but the one view beacon, and sets no timer", () => {
    const { beacons, timers } = load(BLOCK("SAVE10"));
    expect(timers).toHaveLength(0);
    expect(beacons.length).toBeLessThanOrEqual(1);
  });
});

describe("M9-19 copying", () => {
  it("puts the code on the clipboard, shows Copied on the button and in the status, and restores both after 2 seconds", async () => {
    const t = load(BLOCK("SAVE10"));
    t.click(t.button());
    expect(t.written).toEqual(["SAVE10"]);
    await t.flush();
    expect(t.button().textContent).toBe("Copied");
    expect(t.status().textContent).toBe("Copied");
    expect(t.timers).toHaveLength(1);
    expect(t.timers[0]!.ms).toBe(2000);
    t.runTimers();
    expect(t.button().textContent).toBe("Copy");
    expect(t.status().textContent).toBe("");
  });

  it("a double tap copies and shows Copied once; the label that comes back is Copy, never Copied", async () => {
    const t = load(BLOCK("SAVE10"));
    t.click(t.button());
    await t.flush();
    t.click(t.button());
    await t.flush();
    expect(t.written).toEqual(["SAVE10", "SAVE10"]);
    expect(t.button().textContent).toBe("Copied");
    // The first timer was cleared by the second tap: only one restore is live.
    expect(t.timers.filter((timer) => timer.live)).toHaveLength(1);
    t.runTimers();
    expect(t.button().textContent).toBe("Copy");
    expect(t.status().textContent).toBe("");
  });

  it("a click on the text inside the button (a child element) copies too", async () => {
    const t = load(BLOCK("SAVE10").replace(">Copy</button>", "><span>Copy</span></button>"));
    t.click(t.doc.querySelector("button span")!);
    expect(t.written).toEqual(["SAVE10"]);
  });

  it("each block copies its own code", async () => {
    const t = load(BLOCK("ONE", "d1") + BLOCK("TWO", "d2"));
    const [first, second] = [
      ...t.doc.querySelectorAll<HTMLButtonElement>("button.pg-discount-copy"),
    ];
    t.click(second!);
    await t.flush();
    expect(t.written).toEqual(["TWO"]);
    expect(first!.textContent).toBe("Copy");
    expect(second!.textContent).toBe("Copied");
  });

  it("sends no request and no beacon, and reads nothing from the clipboard", async () => {
    const t = load(BLOCK("SAVE10"));
    // The view beacon goes out once, after `load`; the copy adds nothing to it.
    await t.flush();
    const before = t.beacons.length;
    t.click(t.button());
    await t.flush();
    expect(t.beacons.length).toBe(before);
    expect(t.read).toEqual([]);
  });

  it("clicking anywhere else in the block (the code, the description) does nothing", async () => {
    const t = load(BLOCK("SAVE10"));
    t.click(t.doc.querySelector(".pg-discount-code")!);
    t.click(t.doc.querySelector(".pg-discount-desc")!);
    await t.flush();
    expect(t.written).toEqual([]);
    expect(t.button().textContent).toBe("Copy");
  });
});

describe("M9-19 when the Clipboard API is missing or refuses", () => {
  it.each(["missing", "reject", "throws"] as const)(
    "%s: the code's text is selected and the status says so",
    async (mode) => {
      const t = load(BLOCK("SAVE10"), mode);
      t.click(t.button());
      await t.flush();
      expect(t.dom.window.getSelection()!.toString()).toBe("SAVE10");
      expect(t.status().textContent).toBe("Select and copy the code.");
      expect(t.button().textContent).toBe("Copy");
    },
  );
});

describe("M9-19 a tampered page", () => {
  it("a changed data-copy only changes what lands on the visitor's own clipboard (documented)", async () => {
    const t = load(BLOCK("SAVE10"));
    t.button().setAttribute("data-copy", "something else");
    t.click(t.button());
    expect(t.written).toEqual(["something else"]);
  });

  it("a data-copy of 10,000 characters is cut to 64", async () => {
    const t = load(BLOCK("SAVE10"));
    t.button().setAttribute("data-copy", "x".repeat(10_000));
    t.click(t.button());
    expect(t.written).toHaveLength(1);
    expect(t.written[0]).toHaveLength(64);
  });

  it("an element without data-copy does nothing", async () => {
    const t = load(BLOCK("SAVE10"));
    t.button().removeAttribute("data-copy");
    t.click(t.button());
    await t.flush();
    expect(t.written).toEqual([]);
    expect(t.button().textContent).toBe("Copy");
    expect(t.status().textContent).toBe("");
  });

  it("any element with data-copy works the same way, and nothing else is read", async () => {
    const t = load(
      `<div class="pg-discount"><code class="pg-discount-code">X</code><b id="x" data-copy="abc" data-copied="Done">Go</b><span class="pg-discount-status" role="status"></span></div>`,
    );
    t.attributes.length = 0;
    t.click(t.doc.querySelector("#x")!);
    await t.flush();
    expect(t.written).toEqual(["abc"]);
    expect(t.doc.querySelector("#x")!.textContent).toBe("Done");
    // `class` is the selector engine matching `.pg-discount` and `.pg-discount-status` (closest, querySelector).
    expect([...new Set(t.attributes)].filter((name) => name !== "class").sort()).toEqual([
      "data-copied",
      "data-copy",
    ]);
  });

  it("nothing is read from any other attribute, however hostile (class, id, title, onclick, data-*)", async () => {
    const t = load(
      BLOCK("SAVE10").replace(
        'class="pg-discount-copy"',
        'class="pg-discount-copy" id="i" title="t" onclick="void 0" data-evil="e" data-copy-extra="z"',
      ),
    );
    t.attributes.length = 0;
    t.click(t.button());
    await t.flush();
    // Selector matching reads `class`; the script itself reads the two data attributes, and no hostile one.
    expect([...new Set(t.attributes)].filter((name) => name !== "class").sort()).toEqual([
      "data-copied",
      "data-copy",
    ]);
    for (const name of ["id", "title", "onclick", "data-evil", "data-copy-extra", "type"]) {
      expect(t.attributes).not.toContain(name);
    }
  });
});

describe("M9-19 the script's size and rules", () => {
  it("is at most 3 KB gzipped and 8 KB unminified, ASCII only", () => {
    expect(Buffer.byteLength(SOURCE)).toBeLessThanOrEqual(8 * 1024);
    expect(gzipSync(CODE).length).toBeLessThanOrEqual(3 * 1024);
    expect(CODE).toMatch(/^[\x00-\x7f]*$/);
  });

  it("never uses execCommand, never reads the clipboard, and has no other listener than the two it had", () => {
    for (const pattern of [/execCommand/, /readText/, /clipboard\.read\b/, /\.paste\b/]) {
      expect(CODE).not.toMatch(pattern);
    }
    expect(CODE.match(/addEventListener\(/g)).toHaveLength(2);
    expect(CODE).toMatch(/clipboard\.writeText\(value\)/);
  });
});
