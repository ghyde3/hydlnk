/**
 * Re-fetches the three real Client ID Metadata Documents the unit fixtures were copied from
 * (tests/unit/fixtures/cimd/, read on 2026-10-04) and checks each against the validator of
 * src/lib/oauth/client-document.ts. A manual check before launch, by hand, with the network on:
 *
 *   pnpm exec tsx scripts/check-client-docs.ts
 *
 * Nothing in CI runs it (no CI network). It prints one line per document and exits 1 when any no
 * longer validates or has drifted from its fixture in a member the validator reads.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { validateClientDocument } from "../src/lib/oauth/client-document";

const DOCUMENTS = [
  ["https://claude.ai/oauth/mcp-oauth-client-metadata", "claude.json", "claude.ai"],
  ["https://claude.ai/oauth/claude-code-client-metadata", "claude-code.json", "claude.ai"],
  ["https://chatgpt.com/oauth/client.json", "chatgpt.json", "chatgpt.com"],
] as const;

let failed = false;
for (const [url, file, host] of DOCUMENTS) {
  const response = await fetch(url, { headers: { Accept: "application/json" }, redirect: "error" });
  const live = (await response.json()) as Record<string, unknown>;
  const fixture = JSON.parse(
    readFileSync(resolve(process.cwd(), "tests/unit/fixtures/cimd", file), "utf8"),
  ) as Record<string, unknown>;
  const result = validateClientDocument(live, url, host);
  const drift = ["client_name", "redirect_uris", "token_endpoint_auth_method", "logo_uri"].filter(
    (name) => JSON.stringify(live[name]) !== JSON.stringify(fixture[name]),
  );
  const ok = response.status === 200 && result.ok && drift.length === 0;
  if (!ok) failed = true;
  console.log(
    `${ok ? "ok  " : "FAIL"} ${url} status=${response.status} valid=${result.ok}${drift.length > 0 ? ` drifted=${drift.join(",")}` : ""}`,
  );
}
process.exit(failed ? 1 : 0);
