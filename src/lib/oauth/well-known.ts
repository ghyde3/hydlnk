import "server-only";
import { metadataCorsOptionsRequestHandler } from "mcp-handler";
import { oauthConfig } from "./config";
import { getCorsHeaders, jsonResponse, methodNotAllowed } from "./http";
import { authorizationServerMetadata, protectedResourceMetadata } from "./metadata";

/**
 * Answers of the two `/.well-known/` documents (M10-03). The route files only call these, so the
 * documents and their headers live in one place. A document is public JSON, cached for five minutes,
 * readable from any origin (a browser-based MCP client fetches it), built from the configured root
 * domain and never from a request header, and costs no database read.
 */

const DOCUMENT_HEADERS = {
  "Cache-Control": "public, max-age=300",
  "X-Content-Type-Options": "nosniff",
  ...getCorsHeaders(),
} as const;

export function authorizationServerMetadataResponse(): Response {
  return jsonResponse(200, authorizationServerMetadata(oauthConfig().rootDomain), {
    ...DOCUMENT_HEADERS,
  });
}

export function protectedResourceMetadataResponse(): Response {
  return jsonResponse(200, protectedResourceMetadata(oauthConfig().rootDomain), {
    ...DOCUMENT_HEADERS,
  });
}

/** The preflight of a metadata document (the library's own handler: CORS headers, no body). */
export function metadataPreflightResponse(): Response {
  return metadataCorsOptionsRequestHandler()();
}

export function metadataMethodNotAllowed(): Response {
  return methodNotAllowed("GET, HEAD, OPTIONS", getCorsHeaders());
}
