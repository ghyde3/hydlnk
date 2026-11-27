import { adminClient } from "./auth";

/**
 * G22 (Wave F, S3): POST /api/media refuses an upload that names no site (`x-hl-site`). The raw-HTTP
 * upload specs of M2 to M5 post with a cookie header only; this reads the signed-in user from that
 * cookie (the Supabase SSR `sb-…-auth-token` value, chunked or not) and names their own first site,
 * which is what the editor sends for an owner. No cookie, or one that is not a session: no header,
 * so a signed-out or forged request is still refused by the session check first.
 */
export async function uploadSiteHeader(cookie: string | undefined): Promise<Record<string, string>> {
  const userId = cookie ? sessionUserId(cookie) : null;
  if (!userId) return {};
  const { data } = await adminClient()
    .from("pages")
    .select("id")
    .eq("owner_id", userId)
    .order("created_at", { ascending: true })
    .limit(1);
  const site = data?.[0]?.id as string | undefined;
  return site ? { "x-hl-site": site } : {};
}

function sessionUserId(cookie: string): string | null {
  const parts = new Map<string, string>();
  for (const pair of cookie.split(/;\s*/)) {
    const at = pair.indexOf("=");
    if (at > 0) parts.set(pair.slice(0, at), pair.slice(at + 1));
  }
  const base = [...parts.keys()].find((name) => /^sb-.+-auth-token(?:\.0)?$/.test(name));
  if (!base) return null;
  const stem = base.replace(/\.0$/, "");
  let value = parts.get(stem) ?? "";
  for (let i = 0; parts.has(`${stem}.${i}`); i++) value += parts.get(`${stem}.${i}`);
  try {
    const json = value.startsWith("base64-")
      ? Buffer.from(value.slice("base64-".length), "base64url").toString("utf8")
      : decodeURIComponent(value);
    const token = (JSON.parse(json) as { access_token?: string }).access_token ?? "";
    const payload = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8"));
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}
