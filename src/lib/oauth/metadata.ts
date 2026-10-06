import "server-only";
import { generateProtectedResourceMetadata } from "mcp-handler";
import { appOrigin, rootOrigin } from "@/lib/routing/urls";
import {
  AUTHORIZATION_SERVER_METADATA_PATH,
  MCP_PATH,
  OAUTH_SCOPES,
  PROTECTED_RESOURCE_METADATA_PATH,
} from "./constants";

/**
 * The two discovery documents of the connector (M10-03), built in one place from
 * `appOrigin(NEXT_PUBLIC_ROOT_DOMAIN)` and nothing else: never from `Host`, `X-Forwarded-Host`,
 * `X-Forwarded-Proto` or `Forwarded`, which an attacker can set (M10-02). The routes, the 401
 * challenge of /mcp (M10-04) and the OAuth endpoints only read from here.
 *
 *   issuer      https://app.hydlnk.com          http://app.localhost:3000
 *   resource    https://app.hydlnk.com/mcp      http://app.localhost:3000/mcp
 *
 * `resource` is character for character what a person types into Claude or ChatGPT, because Claude
 * requires the two to be equal.
 *
 * Two members are pinned because the clients depend on them (read on 2026-10-04, see
 * tests/unit/m10-oauth-metadata.test.ts): Claude uses a Client ID Metadata Document only when the
 * metadata advertises BOTH `client_id_metadata_document_supported: true` AND `"none"` in
 * `token_endpoint_auth_methods_supported` (claude.com/docs/connectors/building/authentication), and
 * ChatGPT refuses a server without `code_challenge_methods_supported: ["S256"]` or
 * `authorization_response_iss_parameter_supported: true` (developers.openai.com/apps-sdk/build/auth).
 */

/** `https://app.hydlnk.com`: the issuer string, no trailing slash (RFC 8414 section 3.3, RFC 9207). */
export function issuerFor(rootDomain: string): string {
  return appOrigin(rootDomain);
}

/** The canonical MCP URL, the `resource` of every token. */
export function mcpResourceUrl(rootDomain: string): string {
  return `${appOrigin(rootDomain)}${MCP_PATH}`;
}

/** Where the 401 challenge points a client that has no token yet. */
export function protectedResourceMetadataUrl(rootDomain: string): string {
  return `${appOrigin(rootDomain)}${PROTECTED_RESOURCE_METADATA_PATH}`;
}

export function authorizationServerMetadataUrl(rootDomain: string): string {
  return `${appOrigin(rootDomain)}${AUTHORIZATION_SERVER_METADATA_PATH}`;
}

/** The marketing page that explains the connector; the metadata names it as documentation. */
export function connectPageUrl(rootDomain: string): string {
  return `${rootOrigin(rootDomain)}/connect`;
}

/** RFC 8414 authorization server metadata: exactly these members, no more. */
export function authorizationServerMetadata(rootDomain: string): Record<string, unknown> {
  const issuer = issuerFor(rootDomain);
  return {
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/oauth/token`,
    registration_endpoint: `${issuer}/oauth/register`,
    revocation_endpoint: `${issuer}/oauth/revoke`,
    scopes_supported: [...OAUTH_SCOPES],
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    revocation_endpoint_auth_methods_supported: ["none"],
    client_id_metadata_document_supported: true,
    authorization_response_iss_parameter_supported: true,
    service_documentation: connectPageUrl(rootDomain),
  };
}

/**
 * RFC 9728 protected resource metadata for the MCP endpoint. Built with
 * `generateProtectedResourceMetadata` (its `additionalMetadata` carries the extra fields), not
 * `protectedResourceHandler`, which cannot add fields.
 */
export function protectedResourceMetadata(rootDomain: string): Record<string, unknown> {
  return {
    ...generateProtectedResourceMetadata({
      authServerUrls: [issuerFor(rootDomain)],
      resourceUrl: mcpResourceUrl(rootDomain),
      additionalMetadata: {
        scopes_supported: [...OAUTH_SCOPES],
        bearer_methods_supported: ["header"],
        resource_name: "HYDLNK",
        resource_documentation: connectPageUrl(rootDomain),
      },
    }),
  };
}
