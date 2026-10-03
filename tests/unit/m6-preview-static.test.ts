import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * M6-03: where tap handling lives. The renderer (src/components/page/) outputs the attributes a tap
 * is read from and handles no click itself; the editor's preview frame does the reading. So the
 * renderer imports nothing from the editor, and the one click handler in it is the YouTube
 * facade's Play button.
 */

const DIR = join(process.cwd(), "src/components/page");
const files = readdirSync(DIR).filter((name) => /\.(tsx?|css)$/.test(name));

function source(name: string): string {
  return readFileSync(join(DIR, name), "utf8");
}

describe("M6-03 the page renderer is independent of the editor", () => {
  it("M6-03 no file in src/components/page/ imports from src/components/editor/ or src/lib/editor/", () => {
    expect(files.length).toBeGreaterThan(5);
    const offenders = files.filter((name) =>
      /from\s+["'](?:@\/components\/editor|@\/lib\/editor|(?:\.\.?\/)+(?:components\/)?editor|(?:\.\.\/)+lib\/editor)(?:\/[^"']*)?["']/.test(
        source(name),
      ),
    );
    expect(offenders).toEqual([]);
    // Nothing that reaches the editor under another spelling either (contracts.ts is the editor's
    // seam INTO the renderer, not the other way round).
    for (const name of files) {
      expect(source(name), name).not.toMatch(/components\/editor|lib\/editor/);
    }
  });

  it("M6-03 no click handler in src/components/page/ other than the YouTube facade's Play button", () => {
    const handlers = files.filter(
      (name) =>
        /\bon(?:Click|ClickCapture|DoubleClick|PointerDown|PointerUp|MouseDown|MouseUp|Tap|Touch\w*)\s*=/.test(
          source(name),
        ) ||
        /addEventListener\(\s*["'](?:click|pointer\w+|mouse\w+|touch\w+)["']/.test(source(name)),
    );
    expect(handlers).toEqual(["embed-facade.tsx"]);
    const facade = source("embed-facade.tsx");
    expect(facade.match(/\bonClick\s*=/g)).toHaveLength(1);
    expect(facade).toMatch(
      /className="pg-embed-play"[\s\S]{0,200}onClick=\{\(\) => setPlaying\(true\)\}/,
    );
  });

  it("M6-03 the renderer itself does not output tap handling: the attributes only", () => {
    const blocks = source("blocks.tsx");
    const profile = source("profile.tsx");
    expect(blocks).toContain("data-block-id");
    expect(blocks).toContain("data-item-id");
    expect(`${blocks}${profile}`).not.toMatch(/\bonClick\b|\bonKeyDown\b|dispatch\(/);
  });
});
