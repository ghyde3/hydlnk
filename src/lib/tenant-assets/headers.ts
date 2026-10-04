import manifest from "./font-manifest.json";
import { TENANT_SCRIPT_FILE } from "./generated";

/**
 * The response headers of the static tenant assets under /_t/ (M8-01, M8-05, M8-07): the hashed
 * script (`/_t/p.{hash}.js`) and the font files (`/_t/f/{name}.{hash}.woff2`). They are files in
 * public/, which the platform serves as they are (never through the proxy or a function), so the
 * only place to say how they are cached is next.config.ts: its `headers()` returns this list.
 *
 *   headers: async () => TENANT_ASSET_HEADERS,
 *
 * One rule per file, by its exact path: every name carries the hash of its bytes, so a year,
 * immutable is always right for a file that exists, and a path that does not exist (an old hash, a
 * typo, the notices file beside the fonts) matches nothing and is never cached as if it were a file.
 * No cookie and nothing per visitor. Imports only the generated constants and the font manifest, so
 * next.config.ts can import it by relative path.
 */

type HeaderRule = { source: string; headers: { key: string; value: string }[] };

const IMMUTABLE = { key: "Cache-Control", value: "public, max-age=31536000, immutable" };
const NOSNIFF = { key: "X-Content-Type-Options", value: "nosniff" };

/** The rules for a script file name and the font file names (each exactly once). */
export function tenantAssetHeaders(script: string, fonts: readonly string[]): HeaderRule[] {
  return [
    {
      // Next serves .js files from public/ as application/javascript; the policy and the spec say text/javascript.
      source: `/_t/${script}`,
      headers: [IMMUTABLE, { key: "Content-Type", value: "text/javascript; charset=utf-8" }, NOSNIFF],
    },
    ...[...new Set(fonts)].sort().map((file) => ({
      source: `/_t/f/${file}`,
      headers: [IMMUTABLE, { key: "Content-Type", value: "font/woff2" }, NOSNIFF],
    })),
  ];
}

const fontFiles = Object.values(
  (manifest as { families: Record<string, { faces: { file: string }[]; } | undefined> }).families,
).flatMap((family) => family?.faces.map((face) => face.file) ?? []);

export const TENANT_ASSET_HEADERS = tenantAssetHeaders(TENANT_SCRIPT_FILE, fontFiles);
