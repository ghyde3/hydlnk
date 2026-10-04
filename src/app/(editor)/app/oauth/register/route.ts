import { rateLimitClientKey } from "@/lib/analytics/ingest/client-ip";
import { postEndpoint } from "@/lib/oauth/endpoint";
import { mediaType, readCappedBody } from "@/lib/oauth/http";
import { REGISTER_MAX_BODY_BYTES, registerClient } from "@/lib/oauth/register";
import { defaultOauthStore } from "@/lib/oauth/store-supabase";
import { rateLimit } from "@/lib/rate-limit";

// Dynamic Client Registration (RFC 7591), public clients only (M10-10). No session, no cookie.
export const dynamic = "force-dynamic";

const endpoint = postEndpoint((request) =>
  registerClient(
    {
      clientKey: rateLimitClientKey(request.headers),
      mediaType: mediaType(request),
      readBody: () => readCappedBody(request, REGISTER_MAX_BODY_BYTES),
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
