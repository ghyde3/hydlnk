import { clientEnv } from "@/lib/env/client";
import { appOrigin } from "@/lib/routing/urls";
import { issuerFor, mcpResourceUrl } from "./metadata";

/**
 * The deployment's own addresses, read from NEXT_PUBLIC_ROOT_DOMAIN once per call and from nothing
 * else (M10-02): no request header ever reaches the issuer, the resource or a redirect target.
 */
export function oauthConfig() {
  const rootDomain = clientEnv.NEXT_PUBLIC_ROOT_DOMAIN;
  return {
    rootDomain,
    /** http://app.localhost:3000 or https://app.hydlnk.com */
    appOrigin: appOrigin(rootDomain),
    issuer: issuerFor(rootDomain),
    /** The canonical MCP URL: the `resource` of every authorize request and token. */
    resource: mcpResourceUrl(rootDomain),
  };
}
