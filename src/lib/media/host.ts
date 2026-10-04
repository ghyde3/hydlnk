import { clientEnv } from "@/lib/env/client";
import { classifyHost } from "@/lib/routing/host";

/**
 * Which hosts the `/media` route answers on: the canonical media origin only, i.e. the root host
 * (and the deployment hosts `*.vercel.app` and local loopback that `classifyHost` already treats as
 * the marketing host). The CDN keeps one copy of an image per host, so a route that answered on
 * every handle-shaped host (`a1.hydlnk.com`, `a2.hydlnk.com`, ...) would let anyone force a cache
 * miss, a function call and a Storage fetch per made-up label. Every other host (`app.`, a handle,
 * a custom domain, `www`, anything else) gets the short 404 and Storage is not asked. Pure of the
 * request: the caller passes the Host header's value.
 */
export function mediaHostAllowed(
  host: string,
  rootDomain: string = clientEnv.NEXT_PUBLIC_ROOT_DOMAIN,
): boolean {
  return classifyHost(host, rootDomain).kind === "marketing";
}
