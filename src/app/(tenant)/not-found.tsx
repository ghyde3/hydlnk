import { headers } from "next/headers";
import { PlainNotFound } from "@/components/tenant/plain-not-found";
import { UnclaimedPanel } from "@/components/tenant/unclaimed-panel";
import { clientEnv } from "@/lib/env/client";
import { checkHandle } from "@/lib/handles/availability";
import { classifyHost } from "@/lib/routing/host";

/**
 * 404 for a tenant host with no page behind it (M1-15). A free handle gets the "This address isn’t
 * claimed." panel with a way to claim it; everything else (reserved, malformed, custom domains,
 * suspended accounts) gets the plain 404. Reads the handle from the Host header because
 * not-found components receive no route params. Kept dynamic and uncacheable by that header read.
 */
export default async function TenantNotFound() {
  const host = (await headers()).get("host") ?? "";
  const { kind, handle } = classifyHost(host, clientEnv.NEXT_PUBLIC_ROOT_DOMAIN);

  let claimable = false;
  if (kind === "tenant" && handle) {
    try {
      claimable = (await checkHandle(handle)).status === "available";
    } catch (error) {
      console.error("[tenant] availability lookup for the 404 page failed", error);
    }
  }
  return claimable && handle ? <UnclaimedPanel handle={handle} /> : <PlainNotFound />;
}
