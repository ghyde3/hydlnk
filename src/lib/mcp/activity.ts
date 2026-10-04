import "server-only";
import type { AdminClient, ActivityRow } from "./types";

/**
 * The activity log (M10-32): one row per tool call, with the tool, the page and the outcome, and
 * never any content. The table (`mcp_activity`) has no column that could hold an argument, a result,
 * a URL or an address, so nothing here could write one.
 */
export async function recordActivityRow(admin: AdminClient, row: ActivityRow): Promise<void> {
  let grantId = row.grantId;
  if (grantId === null) {
    // The verified token says which grant it belongs to; read it when the verifier did not.
    const { data } = await admin
      .from("oauth_tokens")
      .select("grant_id")
      .eq("id", row.tokenId)
      .maybeSingle();
    grantId = data?.grant_id ?? null;
  }
  const { error } = await admin.from("mcp_activity").insert({
    user_id: row.userId,
    client_id: row.clientId,
    grant_id: grantId,
    tool: row.tool,
    page_id: row.pageId,
    ok: row.ok,
    error_code: row.errorCode,
  });
  if (error) throw new Error(`activity insert failed: ${error.code ?? "unknown"}`);
}
