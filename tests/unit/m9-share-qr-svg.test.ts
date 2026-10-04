// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { makeQr, qrSvg } from "@/lib/qr/generate";
import { DEFAULT_APPEARANCE, type QrAppearance } from "@/lib/qr/style";
import {
  buildQrSvg,
  escapeXml,
  isPictureAddress,
  qrStyledDrawing,
  type QrPicture,
} from "@/lib/qr/styled-svg";

/**
 * M9-25: the downloadable SVG of a styled QR code (src/lib/qr/styled-svg.ts). The file is built
 * from numbers, two validated colors, a validated picture and one escaped line of text, so these
 * tests feed it hostile versions of each and scan every combination of options for anything that
 * could run, load or leave the file.
 */

const ADDRESS = "http://mara.localhost:3000/";
const code = makeQr(ADDRESS);
const codeH = makeQr(ADDRESS, "H");

// A 1x1 PNG, the shape of address `loadQrPicture` produces.
const PIXEL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const picture = (over: Partial<QrPicture> = {}): QrPicture => ({
  dataUrl: PIXEL,
  width: 256,
  height: 256,
  ...over,
});

const NAVY_ON_CREAM = { ...DEFAULT_APPEARANCE, code: "#0B2A5B", background: "#FBF6E9" };

function parse(svg: string): Document {
  return new DOMParser().parseFromString(svg, "image/svg+xml");
}

const ALLOWED_TAGS = new Set(["svg", "rect", "path", "text", "image"]);

/** Every combination of the options the card offers, with the hostile frame texts. */
function combos(): { name: string; appearance: QrAppearance; picture: QrPicture | null }[] {
  const out: { name: string; appearance: QrAppearance; picture: QrPicture | null }[] = [];
  for (const colors of [
    { code: "#000000", background: "#FFFFFF" },
    { code: "#0B2A5B", background: "#FBF6E9" },
    { code: "#1B1814", background: "#F7F3EC" },
  ]) {
    for (const logo of [false, true]) {
      for (const frame of [false, true]) {
        for (const frameText of [
          "Scan me",
          "</text><script>alert(1)</script>",
          'say "hi" & <b>bye</b>',
          "http://evil.example/x",
          "javascript:alert(1)",
          "onload=alert(1)",
          "']]><!-- -->",
        ]) {
          out.push({
            name: `${colors.code} on ${colors.background}, logo ${logo}, frame ${frame}, ${JSON.stringify(frameText)}`,
            appearance: { ...colors, logo, frame, frameText: frameText.slice(0, 20) },
            picture: logo ? picture() : null,
          });
        }
      }
    }
  }
  return out;
}

describe("M9-25 the default look is the M6-31 file, byte for byte", () => {
  it("M9-25 buildQrSvg with the default appearance equals qrSvg(code)", () => {
    expect(buildQrSvg(code, DEFAULT_APPEARANCE)).toBe(qrSvg(code));
    expect(buildQrSvg(code, { ...DEFAULT_APPEARANCE }, { picture: null })).toBe(qrSvg(code));
    expect(buildQrSvg(makeQr("https://links.example.com/"), DEFAULT_APPEARANCE)).toBe(
      qrSvg(makeQr("https://links.example.com/")),
    );
  });

  it("M9-25 the default file is one rect and one path and holds no text or image", () => {
    const doc = parse(buildQrSvg(code, DEFAULT_APPEARANCE));
    expect(Array.from(doc.documentElement.children).map((c) => c.tagName)).toEqual([
      "rect",
      "path",
    ]);
  });

  it("M9-25 turning a picture or text options on without a logo or frame does not change the default", () => {
    expect(
      buildQrSvg(code, { ...DEFAULT_APPEARANCE, frameText: "Hello" }, { picture: picture() }),
    ).toBe(qrSvg(code));
  });
});

describe("M9-25 a styled SVG: structure", () => {
  it("M9-25 custom colors only: one svg, a background rect first and one path, in the two colors", () => {
    const svg = buildQrSvg(code, NAVY_ON_CREAM);
    const doc = parse(svg);
    expect(doc.querySelector("parsererror")).toBeNull();
    const root = doc.documentElement;
    expect(root.tagName).toBe("svg");
    expect(root.getAttribute("xmlns")).toBe("http://www.w3.org/2000/svg");
    expect(root.getAttribute("viewBox")).toBe("0 0 1024 1024");
    expect(Array.from(root.children).map((c) => c.tagName)).toEqual(["rect", "path"]);
    expect(root.querySelector("rect")!.getAttribute("fill")).toBe("#FBF6E9");
    expect(root.querySelector("path")!.getAttribute("fill")).toBe("#0B2A5B");
    // Colors of the page's theme are not in the file: only these two.
    const colors = new Set(svg.match(/#[0-9A-Fa-f]{3,8}\b/g));
    expect([...colors].sort()).toEqual(["#0B2A5B", "#FBF6E9"]);
  });

  it("M9-25 with a frame: 1024 by 1216, a bordered rect in the code color and one text, centered and bold, sans-serif", () => {
    const svg = buildQrSvg(code, { ...NAVY_ON_CREAM, frame: true, frameText: "Scan me" });
    const doc = parse(svg);
    expect(doc.documentElement.getAttribute("viewBox")).toBe("0 0 1024 1216");
    expect(doc.documentElement.getAttribute("width")).toBe("1024");
    expect(doc.documentElement.getAttribute("height")).toBe("1216");
    const tags = Array.from(doc.documentElement.children).map((c) => c.tagName);
    expect(tags).toEqual(["rect", "rect", "path", "text"]);
    const border = doc.querySelectorAll("rect")[1]!;
    expect(border.getAttribute("fill")).toBe("none");
    expect(border.getAttribute("stroke")).toBe("#0B2A5B");
    expect(Number(border.getAttribute("rx"))).toBeGreaterThan(0);
    const text = doc.querySelector("text")!;
    expect(text.textContent).toBe("Scan me");
    expect(text.getAttribute("font-family")).toBe("sans-serif");
    expect(text.getAttribute("font-weight")).toBe("700");
    expect(text.getAttribute("text-anchor")).toBe("middle");
    expect(text.getAttribute("x")).toBe("512");
    expect(Number(text.getAttribute("font-size"))).toBeGreaterThanOrEqual(64);
    expect(text.getAttribute("fill")).toBe("#0B2A5B");
  });

  it("M9-25 with a logo: a plate of the background color and one image whose href is the data address", () => {
    const svg = buildQrSvg(codeH, { ...NAVY_ON_CREAM, logo: true }, { picture: picture() });
    const doc = parse(svg);
    expect(Array.from(doc.documentElement.children).map((c) => c.tagName)).toEqual([
      "rect",
      "path",
      "rect",
      "image",
    ]);
    const plate = doc.querySelectorAll("rect")[1]!;
    expect(plate.getAttribute("fill")).toBe("#FBF6E9");
    const image = doc.querySelector("image")!;
    expect(image.getAttribute("href")).toBe(PIXEL);
    expect(image.getAttribute("href")).toMatch(/^data:image\/png;base64,/);
    expect(image.hasAttribute("xlink:href")).toBe(false);
    // The picture is inside the plate.
    const [px, py, pw, ph] = ["x", "y", "width", "height"].map((a) =>
      Number(plate.getAttribute(a)),
    );
    const [ix, iy, iw, ih] = ["x", "y", "width", "height"].map((a) =>
      Number(image.getAttribute(a)),
    );
    expect(ix).toBeGreaterThanOrEqual(px!);
    expect(iy).toBeGreaterThanOrEqual(py!);
    expect(ix! + iw!).toBeLessThanOrEqual(px! + pw!);
    expect(iy! + ih!).toBeLessThanOrEqual(py! + ph!);
  });

  it("M9-25 a logo that has not loaded yet leaves the plate and the image out", () => {
    const svg = buildQrSvg(codeH, { ...NAVY_ON_CREAM, logo: true }, { picture: null });
    expect(parse(svg).querySelector("image")).toBeNull();
    expect(Array.from(parse(svg).documentElement.children).map((c) => c.tagName)).toEqual([
      "rect",
      "path",
    ]);
  });

  it("M9-25 text that does not fit is squeezed with textLength, only then", () => {
    const wide = { ...NAVY_ON_CREAM, frame: true, frameText: "W".repeat(20) };
    const narrow = buildQrSvg(code, wide, {
      picture: null,
      measureText: (t, s) => t.length * 0.5 * s,
    });
    expect(parse(narrow).querySelector("text")!.hasAttribute("textLength")).toBe(false);
    const squeezed = buildQrSvg(code, wide, {
      picture: null,
      measureText: (t, s) => t.length * 1.2 * s,
    });
    const text = parse(squeezed).querySelector("text")!;
    expect(Number(text.getAttribute("textLength"))).toBeGreaterThan(0);
    expect(Number(text.getAttribute("textLength"))).toBeLessThanOrEqual(1024);
    expect(text.getAttribute("lengthAdjust")).toBe("spacingAndGlyphs");
  });
});

describe("M9-25 a styled SVG: nothing that can run, load or leave the file (every combination)", () => {
  const all = combos();

  it("M9-25 the scan covers a real number of combinations", () => {
    expect(all.length).toBeGreaterThan(80);
  });

  it.each(all.map((c) => [c.name, c] as const))("M9-25 %s", (_name, c) => {
    const svg = buildQrSvg(c.appearance.logo ? codeH : code, c.appearance, { picture: c.picture });
    // 1. A well-formed XML document.
    const doc = parse(svg);
    expect(doc.querySelector("parsererror"), svg.slice(0, 200)).toBeNull();
    // 2. Only the five tags, no event attribute, no style, no link.
    for (const el of Array.from(doc.getElementsByTagName("*"))) {
      expect(ALLOWED_TAGS.has(el.tagName), el.tagName).toBe(true);
      for (const attr of Array.from(el.attributes)) {
        expect(attr.name).not.toMatch(/^on/i);
        expect(attr.name).not.toBe("style");
        expect(attr.name).not.toMatch(/^xlink/i);
        if (attr.name === "href") {
          expect(el.tagName).toBe("image");
          expect(isPictureAddress(attr.value)).toBe(true);
        }
      }
    }
    // 3. The scan the feature names, over the output text.
    expect(svg).not.toMatch(/<script|<foreignObject|<style|<link|<use|<a[\s>]|<!|<\?/i);
    expect(svg).not.toMatch(/xlink:href/i);
    expect(svg).not.toMatch(/\son\w+\s*=/i);
    // No address anywhere but the namespace: no `://` in the whole file, once it is taken out.
    expect(svg.replace('xmlns="http://www.w3.org/2000/svg"', "")).not.toContain("://");
    expect(svg.match(/:\/\//g)).toEqual(["://"]); // the xmlns, and only the xmlns
    // 4. The text is the (cut) frame text as text: it parses back to exactly what was typed.
    if (c.appearance.frame) {
      expect(doc.querySelector("text")!.textContent).toBe(c.appearance.frameText);
    } else {
      expect(doc.querySelector("text")).toBeNull();
    }
    // 5. At most one image, and only with a logo and a loaded picture.
    expect(doc.querySelectorAll("image")).toHaveLength(c.appearance.logo ? 1 : 0);
    expect(doc.querySelectorAll("text")).toHaveLength(c.appearance.frame ? 1 : 0);
  });
});

describe("M9-25 a frame text of </text><script>alert(1)</script> is escaped and drawn as text", () => {
  it("M9-25 the markup characters are entities, the file parses, and the text node holds the characters", () => {
    const hostile = "</text><script>alert(1)</script>";
    const cut = Array.from(hostile).slice(0, 20).join("");
    const svg = buildQrSvg(code, { ...NAVY_ON_CREAM, frame: true, frameText: cut });
    expect(svg).toContain("&lt;/text&gt;&lt;script&gt;alert");
    expect(svg).not.toContain("<script");
    const doc = parse(svg);
    expect(doc.querySelector("script")).toBeNull();
    expect(doc.querySelector("text")!.textContent).toBe(cut);
    expect(doc.querySelectorAll("text")).toHaveLength(1);
  });

  it("M9-25 the full 32-character string, even uncut, cannot break out", () => {
    const hostile = "</text><script>alert(1)</script>";
    const svg = buildQrSvg(code, { ...NAVY_ON_CREAM, frame: true, frameText: hostile });
    const doc = parse(svg);
    expect(doc.querySelector("parsererror")).toBeNull();
    expect(doc.querySelector("script")).toBeNull();
    expect(doc.querySelector("text")!.textContent).toBe(hostile);
  });
});

describe("M9-25 escapeXml", () => {
  it("M9-25 escapes & < > \" ' and writes a colon before // as a character reference", () => {
    expect(escapeXml(`a & b < c > d "e" 'f'`)).toBe(
      "a &amp; b &lt; c &gt; d &quot;e&quot; &#39;f&#39;",
    );
    expect(escapeXml("http://x.co")).toBe("http&#58;//x.co");
    expect(escapeXml("a:b")).toBe("a:b");
    expect(escapeXml("12:30")).toBe("12:30");
  });

  it("M9-25 text with a colon before // reads back as the same text", () => {
    const doc = parse(
      `<svg xmlns="http://www.w3.org/2000/svg"><text>${escapeXml("go to http://x.co")}</text></svg>`,
    );
    expect(doc.querySelector("text")!.textContent).toBe("go to http://x.co");
  });

  it("M9-25 drops what an XML document cannot hold: lone surrogates and the two non-characters", () => {
    const lone = String.fromCharCode(0xd800);
    expect(escapeXml(`a${lone}b`)).toBe("ab");
    expect(escapeXml(`a${String.fromCharCode(0xffff)}b${String.fromCharCode(0xfffe)}`)).toBe("ab");
    // A real surrogate pair (an emoji) is kept.
    expect(escapeXml("😀")).toBe("😀");
  });
});

describe("M9-25 hostile values never reach a file", () => {
  it("M9-25 a color that is not a hex color throws before anything is written", () => {
    for (const bad of ['#fff" onload="x', "red", "url(javascript:alert(1))", "", "#12", "</svg>"]) {
      expect(() => buildQrSvg(code, { ...NAVY_ON_CREAM, code: bad }), bad).toThrow();
      expect(() => buildQrSvg(code, { ...NAVY_ON_CREAM, background: bad }), bad).toThrow();
      expect(
        () => qrStyledDrawing(code, { ...NAVY_ON_CREAM, code: bad }, { picture: null }),
        bad,
      ).toThrow();
    }
  });

  it("M9-25 a three-digit color is written as six upper-case digits", () => {
    const svg = buildQrSvg(code, { ...DEFAULT_APPEARANCE, code: "#036", background: "#fff" });
    expect(svg).toContain('fill="#003366"');
    expect(svg).toContain('fill="#FFFFFF"');
  });

  it("M9-25 only a PNG data address from the loader is accepted as the picture", () => {
    expect(isPictureAddress(PIXEL)).toBe(true);
    for (const bad of [
      "javascript:alert(1)",
      "https://evil.example/logo.png",
      "http://localhost:3000/media/x.png",
      "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
      "data:text/html;base64,PHNjcmlwdD4=",
      'data:image/png;base64,AAAA" onload="x',
      "data:image/png;base64,",
      `${PIXEL}<script>`,
      "data:image/png;base64," + "A".repeat(400_001),
      "",
      null,
      undefined,
      42,
    ]) {
      expect(isPictureAddress(bad as unknown), String(bad).slice(0, 40)).toBe(false);
    }
  });

  it("M9-25 a picture whose address is not accepted is left out, never written", () => {
    for (const dataUrl of [
      "https://evil.example/x.png",
      "javascript:alert(1)",
      "data:image/svg+xml;base64,AAAA",
    ]) {
      const svg = buildQrSvg(
        codeH,
        { ...NAVY_ON_CREAM, logo: true },
        { picture: picture({ dataUrl }) },
      );
      expect(svg).not.toContain("<image");
      expect(svg).not.toContain(dataUrl);
    }
  });
});

describe("M9-25 the file is the same drawing the card previews", () => {
  it("M9-25 qrStyledDrawing's nodes are what the file is made of, in order", () => {
    const appearance = { ...NAVY_ON_CREAM, logo: true, frame: true, frameText: "Scan me" };
    const drawing = qrStyledDrawing(codeH, appearance, { picture: picture() });
    expect(drawing.nodes.map((n) => n.tag)).toEqual([
      "rect",
      "rect",
      "path",
      "rect",
      "image",
      "text",
    ]);
    const doc = parse(buildQrSvg(codeH, appearance, { picture: picture() }));
    expect(Array.from(doc.documentElement.children).map((c) => c.tagName)).toEqual(
      drawing.nodes.map((n) => n.tag),
    );
    expect(drawing.layout.height).toBe(1216);
  });
});
