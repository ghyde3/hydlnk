import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { qrLogoOf } from "@/components/workspace/share/qr-style-state";

vi.mock("@/lib/env/client", () => ({
  clientEnv: {
    NEXT_PUBLIC_ROOT_DOMAIN: "localhost:3000",
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
  },
}));

/**
 * M9-25: the rules the Style group of the QR card must keep, read from the files so a later edit
 * cannot quietly break them: the QR module stays apart from the theme, nothing but the page's public
 * address is encoded, the logo's one request is the only request, and the copy is plain.
 */

const read = (file: string) => readFileSync(file, "utf8");
const code = (file: string) =>
  read(file)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
const LIB = "src/lib/qr";
const SHARE = "src/components/workspace/share";
const libFiles = readdirSync(LIB)
  .filter((name) => name.endsWith(".ts"))
  .map((name) => join(LIB, name));

describe("M9-25 the QR module stays apart from the theme and the renderer", () => {
  it.each(libFiles)("%s imports no theme, no renderer, no component and no framework", (file) => {
    const imports = [...code(file).matchAll(/from "([^"]+)"/g)].map((match) => match[1]!);
    for (const spec of imports) {
      expect(spec, `${file} imports ${spec}`).not.toMatch(
        /^@\/(lib\/theme|lib\/themes|components)|page-renderer|^react|^next|supabase|^@\/lib\/env/,
      );
    }
  });

  it("M9-25 the only thing taken from outside the QR module besides the address helper's own is normalizeHex", () => {
    const outside = libFiles.flatMap((file) =>
      [...code(file).matchAll(/from "(@\/[^"]+)"/g)].map((match) => `${file}: ${match[1]}`),
    );
    expect(outside.sort()).toEqual([
      `${LIB}/address.ts: @/lib/editor/urls`, // M6-31's, for the page's own address
      `${LIB}/style.ts: @/lib/design/color`,
    ]);
  });

  it("M9-25 colors reach the drawing only through requireHex (normalizeHex), never as given", () => {
    const style = code(`${LIB}/style.ts`);
    expect(style).toMatch(/export function requireHex/);
    for (const file of [`${LIB}/styled-svg.ts`, `${LIB}/styled-png.ts`]) {
      expect(code(file), file).toMatch(/requireHex\(/);
    }
    // No color is concatenated into markup anywhere without having passed through it.
    const svg = code(`${LIB}/styled-svg.ts`);
    expect(svg).toMatch(/const ink = requireHex\(appearance\.code\)/);
    expect(svg).toMatch(/const field = requireHex\(appearance\.background\)/);
  });

  it("M9-25 the page's theme is read in one file outside the QR module and the card", () => {
    const readers = readdirSync(SHARE)
      .filter((name) => /\.(ts|tsx)$/.test(name))
      .filter((name) => /@\/lib\/theme/.test(code(join(SHARE, name))));
    expect(readers).toEqual(["qr-style-state.ts"]);
  });
});

describe("M9-25 nothing but the page's public address is encoded", () => {
  it("M9-25 every makeQr call in the card encodes publicAddress, and no other file makes a code", () => {
    const card = code(`${SHARE}/qr-card.tsx`);
    const calls = [...card.matchAll(/makeQr\(([^)]*)\)/g)].map((match) => match[1]!.trim());
    expect(calls.length).toBeGreaterThan(0);
    for (const args of calls) expect(args.split(",")[0]!.trim()).toBe("publicAddress");
    for (const name of readdirSync(SHARE)) {
      if (name === "qr-card.tsx" || !/\.(ts|tsx)$/.test(name)) continue;
      expect(code(join(SHARE, name)), name).not.toMatch(/\bmakeQr\b/);
    }
  });

  it("M9-25 the style controls import nothing that can make or change a code", () => {
    const controls = code(`${SHARE}/qr-style-controls.tsx`);
    expect(controls).not.toMatch(
      /lib\/qr\/(generate|png|styled|layout)|publicAddress|useWorkspace/,
    );
  });
});

describe("M9-25 the logo is the one request, and only from the first-party media address", () => {
  it("M9-25 `new Image(` appears in one file: qr-logo.ts, which asks anonymously", () => {
    const files = [...libFiles, ...readdirSync(SHARE).map((name) => join(SHARE, name))].filter(
      (f) => /\.(ts|tsx)$/.test(f),
    );
    const found = files.filter((file) => /new Image\s*\(/.test(code(file)));
    expect(found).toEqual([`${SHARE}/qr-logo.ts`]);
    expect(code(`${SHARE}/qr-logo.ts`)).toMatch(/crossOrigin = "anonymous"/);
  });

  it("M9-25 no file of the feature calls fetch, XMLHttpRequest, a beacon, storage or the location", () => {
    for (const file of [
      ...libFiles,
      ...[
        "qr-card.tsx",
        "qr-logo.ts",
        "qr-nodes.tsx",
        "qr-style-controls.tsx",
        "qr-style-state.ts",
      ].map((name) => join(SHARE, name)),
    ]) {
      expect(code(file), file).not.toMatch(
        /\bfetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket|EventSource|localStorage|sessionStorage|indexedDB|document\.cookie|window\.location|URLSearchParams/,
      );
    }
  });

  it("M9-25 the address that is loaded is built by mediaUrl from an image reference", () => {
    const state = code(`${SHARE}/qr-style-state.ts`);
    expect(state).toMatch(/mediaUrl\(logo\.path\)/);
    expect(state).toMatch(/imageRefSchema\.safeParse/);
  });

  it("M9-25 the request is made only while the switch is on, once per address", () => {
    const logo = code(`${SHARE}/qr-logo.ts`);
    expect(logo).toMatch(/if \(!enabled \|\| src === null\) return;/);
    expect(logo).toMatch(/requests\.get\(src\)/);
  });
});

describe("M9-25 the Style group is state of the card, never stored", () => {
  it("M9-25 no document field, no autosave, no storage", () => {
    for (const name of ["qr-card.tsx", "qr-style-controls.tsx"]) {
      expect(code(join(SHARE, name)), name).not.toMatch(
        /editDraft|dispatch|autosave|localStorage|sessionStorage|useRouter|document\.cookie/,
      );
    }
    expect(code(`${SHARE}/qr-card.tsx`)).toMatch(/useState<QrStyle>\(DEFAULT_QR_STYLE\)/);
  });
});

describe("M9-25 copy and tokens", () => {
  const files = [`${SHARE}/qr-card.tsx`, `${SHARE}/qr-style-controls.tsx`, `${LIB}/style.ts`];
  it.each(files)(
    "%s has no please, no exclamation mark and no successfully in its sentences",
    (file) => {
      const strings = [...read(file).matchAll(/"([^"\n]{12,})"|>([^<>{}\n]{12,})</g)].map(
        (match) => match[1] ?? match[2] ?? "",
      );
      for (const text of strings) {
        if (!/\s/.test(text.trim())) continue;
        expect(text, file).not.toMatch(/please|successfully/i);
        expect(text, file).not.toContain("!");
      }
    },
  );

  it("M9-25 the Style group uses HYDLNK UI tokens only: no tenant variable, no inline color", () => {
    const controls = code(`${SHARE}/qr-style-controls.tsx`);
    expect(controls).not.toMatch(/--t-|var\(--|style=\{\{/);
    expect(controls).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it("M9-25 the specified sentences and names are there", () => {
    const controls = read(`${SHARE}/qr-style-controls.tsx`);
    for (const text of [
      "Black and white",
      "Page colors",
      "Custom",
      "Code color",
      "Background",
      "Add my logo in the center",
      "Add a logo or a photo to your page first.",
      "Add a frame with text",
      "Frame text",
      "Reset style",
    ]) {
      expect(controls, text).toContain(text);
    }
  });
});

describe("M9-25 qrLogoOf: the page's logo, else its photo", () => {
  const ref = (name: string) => ({
    path: `00000000-0000-4000-8000-000000000001/${name}.webp`,
    width: 400,
    height: 400,
  });

  it("M9-25 the logo wins over the photo", () => {
    expect(qrLogoOf({ logo: ref("logo-aaaa"), photo: ref("avatar-bbbb") })).toEqual(
      ref("logo-aaaa"),
    );
  });

  it("M9-25 the photo when there is no logo, whatever the logo's absent form", () => {
    for (const profile of [
      { photo: ref("avatar-bbbb") },
      { logo: null, photo: ref("avatar-bbbb") },
      { logo: undefined, photo: ref("avatar-bbbb") },
    ]) {
      expect(qrLogoOf(profile)).toEqual(ref("avatar-bbbb"));
    }
  });

  it("M9-25 neither: null; a value that is not an image reference is ignored", () => {
    expect(qrLogoOf({ photo: null })).toBeNull();
    expect(qrLogoOf({})).toBeNull();
    expect(qrLogoOf(null)).toBeNull();
    expect(qrLogoOf(undefined)).toBeNull();
    expect(qrLogoOf("x")).toBeNull();
    expect(qrLogoOf({ logo: "https://evil.example/x.png", photo: null })).toBeNull();
    expect(
      qrLogoOf({
        logo: { path: "../../etc/passwd", width: 1, height: 1 },
        photo: ref("avatar-bbbb"),
      }),
    ).toEqual(ref("avatar-bbbb"));
    expect(
      qrLogoOf({ logo: { path: "https://evil.example/x.png", width: 1, height: 1 }, photo: null }),
    ).toBeNull();
  });
});
