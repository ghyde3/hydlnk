import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { FONT_CATALOG } from "../src/lib/design/fonts";
import { TENANT_ASSET_PREFIX, TENANT_FONT_DIR } from "../src/lib/tenant-assets/constants";
import type { FontManifestFamily } from "../src/lib/tenant-assets/fonts";
import {
  googleCssUrl,
  manifestRows,
  parseGoogleFontsCss,
  type GoogleFace,
} from "../src/lib/tenant-assets/google-css";
import { readWoff2Names } from "../src/lib/tenant-assets/woff2";

/**
 * Vendors the tenant theme fonts (M8-01): for every family of FONT_ALLOWLIST and every heading
 * weight src/lib/design/fonts.ts lists for it, the woff2 files Google Fonts serves a Chrome browser,
 * split by the same unicode ranges, saved unmodified as public/_t/f/{family}-{subset}.{hash}.woff2,
 * with src/lib/tenant-assets/font-manifest.json (what tenantFontFaces reads) and a NOTICE.txt with
 * each family's license and copyright (read from the font files' own name tables).
 *
 * THIS SCRIPT DOWNLOADS FROM THE NETWORK (fonts.googleapis.com for the stylesheets, fonts.gstatic.com
 * for the files: roughly 4 MB in about 150 files) and so is run by hand, once, with the owner's say-so,
 * and again only when the allowlist changes. The result is committed: no build and no request of the
 * running app ever fetches a font. A variable file that serves several weights is saved once.
 *
 *   pnpm tenant-fonts                  all 18 families
 *   pnpm tenant-fonts --dry            fetch the files, print the table, write nothing
 *   pnpm tenant-fonts --dry --only Inter,Fraunces
 *
 * Prints, at the end, the table of every family's latin file size next to the size Google serves
 * (they are the same bytes), for the PROGRESS.md entry of the wave.
 */

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/131.0.0.0 Safari/537.36";

const root = join(import.meta.dirname, "..");
const outDir = join(root, "public", TENANT_ASSET_PREFIX, TENANT_FONT_DIR);
const args = process.argv.slice(2);
const dry = args.includes("--dry");
const onlyArg = args.indexOf("--only");
const only = onlyArg >= 0 ? new Set(args[onlyArg + 1]?.split(",")) : null;
if (only && !dry) throw new Error("--only is for a --dry look; the manifest needs every family");

async function get(url: string): Promise<Response> {
  const response = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!response.ok) throw new Error(`${response.status} for ${url}`);
  return response;
}

const slug = (family: string) => family.toLowerCase().replace(/[^a-z0-9]+/g, "-");

interface Downloaded {
  bytes: Buffer;
  hash: string;
  googleBytes: number;
}

const downloads = new Map<string, Downloaded>();

async function download(url: string): Promise<Downloaded> {
  const known = downloads.get(url);
  if (known) return known;
  const response = await get(url);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.toString("latin1", 0, 4) !== "wOF2") throw new Error(`Not a woff2 file: ${url}`);
  const googleBytes = Number(response.headers.get("content-length") ?? bytes.length);
  const entry = {
    bytes,
    hash: createHash("sha256").update(bytes).digest("hex").slice(0, 12),
    googleBytes,
  };
  downloads.set(url, entry);
  return entry;
}

const MANIFEST_SOURCE =
  "fonts.googleapis.com/css2 (Chrome user agent); the woff2 files of fonts.gstatic.com, saved unmodified";
const families: Record<string, FontManifestFamily> = {};
const files = new Map<string, Buffer>();
const notices: string[] = [];
const report: string[] = [];

for (const entry of FONT_CATALOG) {
  if (only && !only.has(entry.family)) continue;
  const weights = [...entry.weights];
  const css = await (await get(googleCssUrl(entry.family, weights))).text();
  const faces = parseGoogleFontsCss(css).filter(
    (face: GoogleFace) => face.style === "normal" && face.family === entry.family,
  );
  if (faces.length === 0) throw new Error(`Google served no faces for ${entry.family}`);

  let copyright = "";
  let license = "";
  const googleBytes = new Map<string, number>();
  const saved = new Map<GoogleFace, { file: string; bytes: number }>();
  for (const face of faces) {
    const file = await download(face.url);
    const names = readWoff2Names(file.bytes);
    const family = names.get(16) ?? names.get(1) ?? "";
    if (!family.toLowerCase().includes(entry.family.split(" ")[0]!.toLowerCase())) {
      throw new Error(`${face.url} is "${family}", not ${entry.family}`);
    }
    copyright ||= names.get(0) ?? "";
    const text = `${names.get(13) ?? ""} ${names.get(14) ?? ""}`;
    const id = /apache/i.test(text)
      ? "Apache-2.0"
      : /open font license|ofl|openfontlicense/i.test(text)
        ? "OFL-1.1"
        : "";
    if (!id) throw new Error(`Cannot tell the license of ${entry.family}: ${text}`);
    if (license && license !== id) throw new Error(`${entry.family} files disagree on the license`);
    license = id;
    const name = `${slug(entry.family)}-${face.subset}.${file.hash}.woff2`;
    files.set(name, file.bytes);
    googleBytes.set(name, file.googleBytes);
    saved.set(face, { file: name, bytes: file.bytes.length });
  }
  const rows = manifestRows(faces, weights, (face) => saved.get(face)!);
  families[entry.family] = {
    license,
    faces: rows,
  };
  notices.push(
    `${entry.family}\n  License: ${license === "OFL-1.1" ? "SIL Open Font License, Version 1.1 (https://openfontlicense.org)" : "Apache License, Version 2.0 (https://www.apache.org/licenses/LICENSE-2.0)"}\n  ${copyright}`,
  );
  for (const weight of weights) {
    const latin = rows.find((row) => row.weight === weight && row.subset === "latin");
    if (latin) {
      report.push(
        `| ${entry.family} | ${weight} | ${latin.bytes} | ${googleBytes.get(latin.file)} | ${rows.filter((row) => row.weight === weight).length} |`,
      );
    }
  }
  console.log(`${entry.family}: ${new Set(rows.map((row) => row.file)).size} files`);
}

console.log(
  "\n| Family | Weight | Latin file, ours (bytes) | Latin file, Google (bytes) | Subsets |",
);
console.log("|---|---|---|---|---|");
console.log(report.join("\n"));

if (dry) {
  console.log("\n--dry: nothing written");
  process.exit(0);
}

mkdirSync(outDir, { recursive: true });
for (const name of readdirSync(outDir)) {
  if (name.endsWith(".woff2") && !files.has(name)) rmSync(join(outDir, name));
}
for (const [name, bytes] of files) writeFileSync(join(outDir, name), bytes);
writeFileSync(
  join(outDir, "NOTICE.txt"),
  `The font files in this folder are unmodified copies of the woff2 files that Google Fonts serves for\n` +
    `the families below, vendored so a published page loads them from its own host. Each family is\n` +
    `licensed under the license named here; the copyright notices are the fonts' own.\n\n` +
    `${notices.join("\n\n")}\n`,
);
writeFileSync(
  join(root, "src/lib/tenant-assets/font-manifest.json"),
  `${JSON.stringify({ source: MANIFEST_SOURCE, families }, null, 2)}\n`,
);
console.log(`\nwrote ${files.size} files to public/${TENANT_ASSET_PREFIX}/${TENANT_FONT_DIR}`);
