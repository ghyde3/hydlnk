import { rateLimitClientKey } from "@/lib/analytics/ingest/client-ip";
import { postEndpoint } from "@/lib/oauth/endpoint";
import { mediaType, readCappedBody } from "@/lib/oauth/http";
import { REVOKE_MAX_BODY_BYTES, handleRevokeRequest } from "@/lib/oauth/revoke";
import { defaultOauthStore } from "@/lib/oauth/store-supabase";
import { rateLimit } from "@/lib/rate-limit";

// Token revocation, RFC 7009 (M10-17): always 200 for a well-formed request, no oracle.
export const dynamic = "force-dynamic";

const endpoint = postEndpoint((request) =>
  handleRevokeRequest(
    {
      clientKey: rateLimitClientKey(request.headers),
      mediaType: mediaType(request),
      authorization: request.headers.get("authorization"),
      readBody: () => readCappedBody(request, REVOKE_MAX_BODY_BYTES),
    },
    { store: defaultOauthStore(), limit: (key, limit, window) => rateLimit(key, limit, window) },
  ),
);

export const POST = endpoint.POST;
export const OPTIONS = endpoint.OPTIONS;
export const GET = endpoint.GET;
export const HEAD = endpoint.HEAD;
export const PUT = endpoint.PUT;
export const PATCH = endpoint.PATCH;
export const DELETE = endpoint.DELETE;
