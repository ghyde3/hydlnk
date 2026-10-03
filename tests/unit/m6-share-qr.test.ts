// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  QR_ERROR_LEVEL,
  QR_QUIET_ZONE,
  drawnSize,
  makeQr,
  qrPathData,
  qrSvg,
  type QrCode,
} from "@/lib/qr/generate";
import { publicPageAddress } from "@/lib/qr/address";

/**
 * M6-31: the QR code generator (src/lib/qr). The code is made in the browser by qrcode-generator;
 * these tests check what the dialog saves: the module matrix, the SVG file (one background rect and
 * one path, nothing that can run or load) and the address helper. The PNG (a canvas) and the
 * decode of both files are in tests/e2e/m6/qr.spec.ts.
 */

const ADDRESS = "http://mara.localhost:3000/";

/** Rebuilds the module matrix from the path data of the SVG (the inverse of `qrPathData`). */
function matrixFromPath(d: string, size: number): boolean[][] {
  const grid = Array.from({ length: size }, () => Array.from({ length: size }, () => false));
  for (const run of d.matchAll(/M(\d+) (\d+)h(\d+)v1h-(\d+)z/g)) {
    const [x, y, w, back] = [run[1], run[2], run[3], run[4]].map(Number) as [
      number,
      number,
      number,
      number,
    ];
    expect(back).toBe(w);
    for (let i = 0; i < w; i += 1) grid[y - QR_QUIET_ZONE]![x - QR_QUIET_ZONE + i] = true;
  }
  return grid;
}

describe("M6-31 makeQr", () => {
  it("makes a square code of an odd side with the three finder patterns", () => {
    const code = makeQr(ADDRESS);
    // 27 bytes at error correction level M: version 3, 29 modules on a side.
    expect(QR_ERROR_LEVEL).toBe("M");
    expect(code.size).toBe(29);
    expect(code.modules).toHaveLength(29);
    for (const row of code.modules) expect(row).toHaveLength(29);
    const finder = (top: number, left: number) => {
      for (let r = 0; r < 7; r += 1) {
        for (let c = 0; c < 7; c += 1) {
          const ring = Math.max(Math.abs(r - 3), Math.abs(c - 3));
          // Dark outer ring, light ring, dark 3x3 core.
          expect(code.modules[top + r]![left + c], `finder ${top},${left} at ${r},${c}`).toBe(
            ring !== 2,
          );
        }
      }
    };
    finder(0, 0);
    finder(0, 22);
    finder(22, 0);
    // The timing pattern alternates along row 6 and column 6 between the finders.
    for (let i = 8; i < 21; i += 1) {
      expect(code.modules[6]![i]).toBe(i % 2 === 0);
      expect(code.modules[i]![6]).toBe(i % 2 === 0);
    }
  });

  it("is deterministic and differs for a different address", () => {
    expect(makeQr(ADDRESS).modules).toEqual(makeQr(ADDRESS).modules);
    expect(makeQr("http://mara.localhost:3001/").modules).not.toEqual(makeQr(ADDRESS).modules);
    // Longer addresses (a long custom domain) get a bigger code, still square.
    const long = makeQr(`https://${"a".repeat(60)}.example.com/`);
    expect(long.size).toBeGreaterThan(29);
    expect((long.size - 17) % 4).toBe(0);
  });

  it("refuses an empty, non-ASCII or control-character string instead of mangling it", () => {
    expect(() => makeQr("")).toThrow();
    expect(() => makeQr("https://exämple.com/")).toThrow();
    expect(() => makeQr("https://example.com/\u0000")).toThrow();
    expect(() => makeQr("https://example.com/\n")).toThrow();
    expect(() => makeQr("🔗")).toThrow();
  });
});

describe("M6-31 qrSvg", () => {
  const code = makeQr(ADDRESS);
  const svg = qrSvg(code);
  const doc = new DOMParser().parseFromString(svg, "image/svg+xml");

  it("is one svg with xmlns and a viewBox that holds the code and its quiet zone", () => {
    expect(doc.querySelector("parsererror")).toBeNull();
    const root = doc.documentElement;
    expect(root.tagName).toBe("svg");
    expect(root.getAttribute("xmlns")).toBe("http://www.w3.org/2000/svg");
    const side = code.size + 2 * QR_QUIET_ZONE;
    expect(drawnSize(code)).toBe(side);
    expect(root.getAttribute("viewBox")).toBe(`0 0 ${side} ${side}`);
    expect(svg.startsWith("<svg")).toBe(true);
  });

  it("is made of one background rect and one path, black on white", () => {
    const root = doc.documentElement;
    expect(Array.from(root.children).map((child) => child.tagName)).toEqual(["rect", "path"]);
    const rect = root.querySelector("rect")!;
    const side = String(code.size + 2 * QR_QUIET_ZONE);
    expect(rect.getAttribute("width")).toBe(side);
    expect(rect.getAttribute("height")).toBe(side);
    expect(rect.getAttribute("fill")).toBe("#ffffff");
    expect(root.querySelector("path")!.getAttribute("fill")).toBe("#000000");
  });

  it("has no script, foreignObject, image, link, style or event attribute", () => {
    for (const tag of ["script", "foreignObject", "image", "use", "a", "style", "link"]) {
      expect(doc.getElementsByTagName(tag), tag).toHaveLength(0);
    }
    for (const el of Array.from(doc.getElementsByTagName("*"))) {
      for (const attr of Array.from(el.attributes)) {
        expect(attr.name, `${el.tagName}@${attr.name}`).not.toMatch(/^on/i);
        expect(attr.name).not.toBe("style");
        expect(attr.name).not.toMatch(/href/i);
        // The namespace declaration is the one URL the file may hold.
        if (attr.name === "xmlns") continue;
        expect(attr.value).not.toMatch(/https?:|javascript:|data:|url\(/i);
      }
    }
    // The only text anywhere is the namespace on the root: no external reference at all.
    expect(svg.match(/https?:\/\/[^"\s]*/g)).toEqual(["http://www.w3.org/2000/svg"]);
    expect(svg).not.toMatch(/<!|<\?|&/);
  });

  it("draws exactly the dark modules of the matrix, shifted by the quiet zone", () => {
    const d = doc.querySelector("path")!.getAttribute("d")!;
    expect(d).toBe(qrPathData(code));
    expect(matrixFromPath(d, code.size)).toEqual(code.modules.map((row) => [...row]));
    // Every coordinate stays inside the quiet zone's margin.
    for (const run of d.matchAll(/M(\d+) (\d+)h(\d+)/g)) {
      const [x, y, w] = [Number(run[1]), Number(run[2]), Number(run[3])];
      expect(x).toBeGreaterThanOrEqual(QR_QUIET_ZONE);
      expect(y).toBeGreaterThanOrEqual(QR_QUIET_ZONE);
      expect(x + w).toBeLessThanOrEqual(code.size + QR_QUIET_ZONE);
      expect(y + 1).toBeLessThanOrEqual(code.size + QR_QUIET_ZONE);
    }
  });

  it("is built from numbers only: an address never reaches the markup", () => {
    const hostile: QrCode = makeQr("http://a.example/?x=%22%3E%3Cscript%3E");
    const out = qrSvg(hostile);
    expect(out).not.toContain("script");
    expect(out).not.toContain("a.example");
    expect(out).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 \d+ \d+"/);
  });
});

describe("M6-31 publicPageAddress", () => {
  it("is the handle's origin with a slash when there is no custom domain", () => {
    expect(
      publicPageAddress({ handle: "mara", primaryDomain: null, rootDomain: "localhost:3000" }),
    ).toBe("http://mara.localhost:3000/");
    expect(
      publicPageAddress({ handle: "mara", primaryDomain: null, rootDomain: "hydlnk.com" }),
    ).toBe("https://mara.hydlnk.com/");
  });

  it("is https and the hostname with a slash for the primary custom domain", () => {
    expect(
      publicPageAddress({
        handle: "mara",
        primaryDomain: "links.maraokafor.com",
        rootDomain: "hydlnk.com",
      }),
    ).toBe("https://links.maraokafor.com/");
    expect(
      publicPageAddress({
        handle: "mara",
        primaryDomain: "links.example.test",
        rootDomain: "localhost:3000",
      }),
    ).toBe("https://links.example.test/");
  });

  it("never carries a query string or a tracking parameter", () => {
    for (const primaryDomain of [null, "links.example.com"]) {
      const address = publicPageAddress({
        handle: "mara",
        primaryDomain,
        rootDomain: "hydlnk.com",
      });
      expect(address).not.toMatch(/[?#]/);
      expect(address.endsWith("/")).toBe(true);
    }
  });
});
