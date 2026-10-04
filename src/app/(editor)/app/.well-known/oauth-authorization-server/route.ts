import {
  authorizationServerMetadataResponse,
  metadataMethodNotAllowed,
  metadataPreflightResponse,
} from "@/lib/oauth/well-known";

// A public document (M10-03): nothing here reads a request, a cookie or the database.
export const dynamic = "force-dynamic";

export function GET(): Response {
  return authorizationServerMetadataResponse();
}

export function HEAD(): Response {
  return new Response(null, {
    status: 200,
    headers: authorizationServerMetadataResponse().headers,
  });
}

export function OPTIONS(): Response {
  return metadataPreflightResponse();
}

export const POST = metadataMethodNotAllowed;
export const PUT = metadataMethodNotAllowed;
export const PATCH = metadataMethodNotAllowed;
export const DELETE = metadataMethodNotAllowed;
