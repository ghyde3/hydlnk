import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildTenantScript, generatedModuleSource } from "../src/lib/tenant-assets/build";
import { TENANT_ASSET_PREFIX } from "../src/lib/tenant-assets/constants";

/**
 * Builds the tenant script (M8-05): reads src/lib/tenant-assets/script/tenant.js, writes the hashed
 * file public/_t/p.{hash}.js (removing older hashed copies) and the generated constants module
 * src/lib/tenant-assets/generated.ts. Safe to run any number of times; with nothing changed it
 * rewrites identical bytes. `pnpm tenant-assets` runs it, and so should `pnpm dev`, `pnpm build`
 * and `pnpm test` (see the note in the PROGRESS entry of Wave J).
 */
const root = join(import.meta.dirname, "..");
const source = readFileSync(join(root, "src/lib/tenant-assets/script/tenant.js"), "utf8");
const built = buildTenantScript(source);

const dir = join(root, "public", TENANT_ASSET_PREFIX);
mkdirSync(dir, { recursive: true });
for (const name of readdirSync(dir)) {
  if (/^p\.[0-9a-f]{12}\.js$/.test(name) && name !== built.file) rmSync(join(dir, name));
}
writeFileSync(join(dir, built.file), built.code);
writeFileSync(join(root, "src/lib/tenant-assets/generated.ts"), generatedModuleSource(built));
console.log(`tenant script: ${built.src} (${built.code.length} bytes), ${built.integrity}`);
