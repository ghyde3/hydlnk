import { rateLimitClientKey } from "@/lib/analytics/ingest/client-ip";
import { oauthConfig } from "@/lib/oauth/config";
import { postEndpoint } from "@/lib/oauth/endpoint";
import { mediaType, readCappedBody } from "@/lib/oauth/http";
import { defaultOauthStore } from "@/lib/oauth/store-supabase";
import { TOKEN_MAX_BODY_BYTES, handleTokenRequest } from "@/lib/oauth/token";
import { rateLimit } from "@/lib/rate-limit";

// The token endpoint (M10-15, M10-16): the authorization code grant with PKCE and refresh rotation.
// Public clients, no cookie, no session; it never fetches a URL.
export const dynamic = "force-dynamic";

const endpoint = postEndpoint((request) =>
  handleTokenRequest(
    {
      clientKey: rateLimitClientKey(request.headers),
      mediaType: mediaType(request),
      authorization: request.headers.get("authorization"),
      readBody: () => readCappedBody(request, TOKEN_MAX_BODY_BYTES),
    },
    {
      store: defaultOauthStore(),
      limit: (key, limit, window) => rateLimit(key, limit, window),
      resource: oauthConfig().resource,
    },
  ),
);

export const POST = endpoint.POST;
export const OPTIONS = endpoint.OPTIONS;
export const GET = endpoint.GET;
export const HEAD = endpoint.HEAD;
export const PUT = endpoint.PUT;
export const PATCH = endpoint.PATCH;
export const DELETE = endpoint.DELETE;
