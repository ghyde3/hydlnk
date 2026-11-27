import "server-only";
import { siteAccessFor } from "@/lib/access/server";
import { getPrimaryDomain } from "@/lib/domains/primary";

/**
 * The primary custom domain of a site shared with the user (Wave F, C18, R10): what the Share tab's
 * QR code and share card name for a member, read-only. Domains stay owner-only under RLS
 * (domains_select_own), so the member's session reads none; here the one access helper decides
 * (need `read`) and the page's own cached rule answers (`getPrimaryDomain`, the oldest verified
 * domain, the same one og:url names). Nothing about domain management is exposed. A refusal or a
 * failed read is null: the handle address is always live.
 */
export async function loadSharedPrimaryDomain(actorId: string, siteId: string): Promise<string | null> {
  const allowed = await siteAccessFor({ actorId, siteId, need: "read", source: "editor" });
  if (!allowed.ok) return null;
  try {
    return await getPrimaryDomain(allowed.access.siteId);
  } catch (error) {
    console.error("[team] reading the shared site's domain failed", error instanceof Error ? error.name : "unknown");
    return null;
  }
}
