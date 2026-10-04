import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Static checks for M6-31 (the QR code), M6-32 and M6-33 (the share card): the files read as text,
 * so a later edit cannot quietly bring back a network call, a tenant token or an input. The rules:
 * HYDLNK UI tokens only (the two token systems never mix), no request of their own, no input that
 * could change what the QR code encodes, and plain copy (no "please", no exclamation mark, no
 * "successfully").
 */

const read = (file: string) => readFileSync(file, "utf8");
const filesIn = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesIn(path) : [path];
  });

const QR_CARD = "src/components/workspace/share/qr-card.tsx";
const QR_FILES = [QR_CARD, ...filesIn("src/lib/qr")];
const SHARE_UI_FILES = [
  "src/components/editor/share-card.tsx",
  "src/components/editor/share-card-preview.tsx",
];
const UI_FILES = [...QR_FILES, ...SHARE_UI_FILES];

/** Comments out of the way: only code and strings are looked at. */
const code = (file: string) =>
  read(file)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("M6-31 / M6-33 the two token systems stay apart", () => {
  it.each(UI_FILES)(
    "%s imports nothing from the tenant renderer, the tenant theme or the Design screen",
    (file) => {
      const source = code(file);
      for (const forbidden of [
        "@/components/page",
        "@/components/tenant",
        "@/components/themes",
        "@/components/design",
        "@/lib/theme",
        "@/lib/themes",
        "page-renderer",
      ]) {
        expect(source, `${file} imports ${forbidden}`).not.toContain(forbidden);
      }
    },
  );

  it.each(UI_FILES)("%s uses no tenant variable and no font or color of its own", (file) => {
    const source = code(file);
    expect(source).not.toMatch(/--t-/);
    expect(source).not.toMatch(/var\(--/);
    expect(source).not.toMatch(/fontFamily|font-family/);
    expect(source).not.toMatch(
      /\bstyle=\{\{[^}]*\b(color|background|backgroundColor|border|borderColor)\b/,
    );
  });

  it.each(SHARE_UI_FILES)("%s has no hex color literal at all", (file) => {
    expect(code(file)).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it("the QR drawing is the one place with colors, and they are black and white", () => {
    for (const file of QR_FILES) {
      const hex = code(file).match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
      for (const value of hex)
        expect(["#ffffff", "#000000"], `${file} ${value}`).toContain(value.toLowerCase());
    }
  });

  it("the QR card sets the colors on the drawing, never from a class or a theme", () => {
    const source = code(QR_CARD);
    expect(source).toContain('fill="#ffffff"');
    expect(source).toContain('fill="#000000"');
  });
});

describe("M6-31 the QR code makes no request and takes no input", () => {
  it.each(QR_FILES)("%s has no network call, storage or location read", (file) => {
    const source = code(file);
    for (const forbidden of [
      /\bfetch\s*\(/,
      /XMLHttpRequest/,
      /sendBeacon/,
      /WebSocket/,
      /EventSource/,
      /new Image\s*\(/,
      /localStorage|sessionStorage|indexedDB/,
      /document\.cookie/,
      /useSearchParams|URLSearchParams|window\.location|location\.(search|href|hash)/,
      /server-only|@\/lib\/supabase|@\/lib\/env/,
    ]) {
      expect(source, `${file} matches ${forbidden}`).not.toMatch(forbidden);
    }
  });

  it("the card has no field: nothing can change what is encoded", () => {
    const source = code(QR_CARD);
    expect(source).not.toMatch(/<(input|textarea|select|form)\b/);
    expect(source).not.toMatch(/contentEditable/i);
    // The address is a prop, never state.
    expect(source).not.toMatch(/useState<?[^(]*>?\(\s*address/);
    expect(source).not.toMatch(/setAddress/);
  });

  it("the encoded address is decided on the server and passed in", () => {
    const route = read("src/app/(editor)/app/(screens)/(workspace)/layout.tsx");
    expect(route).toContain("publicPageAddress(");
    expect(route).toContain("loadPrimaryDomain(");
    expect(route).toMatch(/publicAddress=\{publicPageAddress\(/);
    // The card encodes the workspace's `publicAddress` prop and nothing else.
    const card = read(QR_CARD);
    expect(card).toMatch(/const \{ publicAddress, handle, hasPublished \} = useWorkspace\(\)/);
    expect(card).toMatch(/makeQr\(publicAddress\)/);
    const address = read("src/lib/qr/address.ts");
    expect(address).not.toMatch(/searchParams|location|window|document/);
  });

  it("the primary domain is read with the owner's session, never the secret key", () => {
    const source = read("src/lib/editor/page-address.ts");
    expect(source).toContain("createServerSupabase");
    expect(source).not.toMatch(/supabase\/admin|createAdminSupabase|SUPABASE_SECRET_KEY/);
  });

  it("there is no QR route: no src/app path named qr", () => {
    const paths = filesIn("src/app").map((file) => file.replace(/\\/g, "/"));
    expect(paths.filter((path) => /\/qr(\/|\.|$)/.test(path))).toEqual([]);
    expect(existsSync("src/app/api/qr")).toBe(false);
  });

  it("is made by one small bundled MIT package that package.json names", () => {
    const pkg = JSON.parse(read("package.json")) as { dependencies: Record<string, string> };
    expect(pkg.dependencies["qrcode-generator"]).toBeDefined();
    const license = JSON.parse(read("node_modules/qrcode-generator/package.json")) as {
      license: string;
    };
    expect(license.license).toBe("MIT");
    expect(code("src/lib/qr/generate.ts")).toMatch(/from "qrcode-generator"/);
    for (const file of filesIn("src/lib/qr")) {
      const imports = [...code(file).matchAll(/from "([^"]+)"/g)].map((match) => match[1]!);
      for (const spec of imports)
        expect(
          ["qrcode-generator", "./generate", "@/lib/editor/urls"],
          `${file}: ${spec}`,
        ).toContain(spec);
    }
  });
});

describe("M6-33 the share card calls nothing of its own", () => {
  it.each(SHARE_UI_FILES)("%s has no network call, storage or secret-key import", (file) => {
    const source = code(file);
    for (const forbidden of [
      /\bfetch\s*\(/,
      /XMLHttpRequest/,
      /sendBeacon/,
      /localStorage|sessionStorage|indexedDB/,
      /@\/lib\/supabase|SUPABASE_SECRET_KEY|createAdminSupabase/,
      /dangerouslySetInnerHTML|innerHTML|insertAdjacentHTML/,
    ]) {
      expect(source, `${file} matches ${forbidden}`).not.toMatch(forbidden);
    }
  });

  it("writes only through the share actions", () => {
    const source = code("src/components/editor/share-card.tsx");
    const types = [...source.matchAll(/type:\s*"([^"]+)"/g)].map((match) => match[1]!);
    expect([...new Set(types)].sort()).toEqual(
      ["focus/handled", "share/description", "share/focus", "share/image", "share/title"].sort(),
    );
  });

  it("uploads through the shared upload control with kind content", () => {
    const source = code("src/components/editor/share-card.tsx");
    expect(source).toMatch(/<ImageUploadControl[\s\S]*?kind="content"/);
  });

  it("draws the preview card with HYDLNK classes: white surface, 1px line, 6px radius, mono address", () => {
    const source = code("src/components/editor/share-card-preview.tsx");
    expect(source).toMatch(/border border-line bg-surface/);
    expect(source).toMatch(/rounded-md/);
    expect(source).toMatch(/font-mono text-xs/);
    expect(source).toMatch(/line-clamp-2/);
    // The picture's position is built from numbers by M6-23's helper, never from a document string.
    expect(source).toMatch(/objectPositionOf\(/);
    expect(source).not.toMatch(/objectPosition:\s*`/);
  });
});

describe("M6-32 the renderer and the generated image never read the share card", () => {
  it("nothing in src/components/page mentions share", () => {
    for (const file of filesIn("src/components/page")) {
      if (!/\.(tsx?|css)$/.test(file)) continue;
      expect(code(file), file).not.toMatch(/\.share\b|\bshare\./);
    }
  });

  it("the share image module draws no text and loads no font", () => {
    const source = code("src/lib/publish/share-og.ts");
    expect(source).not.toMatch(/ImageResponse|loadOgFont|drawable/);
  });
});

describe("M6-31 to M6-33 copy: plain words", () => {
  /** Quoted strings and JSX text of a source file. */
  function words(file: string): string[] {
    const source = code(file);
    const out: string[] = [];
    for (const match of source.matchAll(
      /"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'|`((?:[^`\\]|\\.)*)`/g,
    )) {
      out.push(match[1] ?? match[2] ?? match[3] ?? "");
    }
    for (const match of source.matchAll(/>([^<>{}]+)</g)) out.push(match[1]!);
    // Sentences only: template literals with code in them, and what merely sits between a generic's
    // angle brackets or a comparison, are not copy.
    return out.filter((text) => /[a-zA-Z]{3}/.test(text) && !/\$\{|[;(){}=]/.test(text));
  }

  it.each([...QR_FILES.filter((file) => file === QR_CARD), ...SHARE_UI_FILES])(
    "%s has no please, no exclamation mark and no successfully",
    (file) => {
      for (const text of words(file)) {
        // Class names and code-ish strings have no spaces and no sentence; a sentence is checked.
        if (!/\s/.test(text.trim())) continue;
        expect(text, `${file}: ${text}`).not.toMatch(/please/i);
        expect(text, `${file}: ${text}`).not.toMatch(/successfully/i);
        expect(text, `${file}: ${text}`).not.toContain("!");
      }
    },
  );

  it("the exported sentences are the specified ones", async () => {
    const qr = read(QR_CARD);
    expect(qr).toContain("This page isn’t available right now.");
    expect(qr).toContain("Publish your page first. Then you can download its QR code.");
    expect(qr).toContain("Scan it to open your page.");
    expect(qr).toContain("QR code for your page");
    const card = read("src/components/editor/share-card.tsx");
    expect(card).toContain("How your page looks when you send its link");
    expect(card).toContain(
      "Wide images work best, at least 1200 pixels across. Leave it empty and we make one from your name and colors.",
    );
    expect(card).toContain("Leave empty to use your display name.");
    expect(card).toContain("Leave empty to use your bio.");
    const preview = read("src/components/editor/share-card-preview.tsx");
    expect(preview).toContain("We make this image from your name and colors when you publish.");
    expect(preview).toContain("Apps draw cards a little differently. This is close.");
  });
});
