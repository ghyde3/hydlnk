import { cookies } from "next/headers";
import { rateLimitClientKey } from "@/lib/analytics/ingest/client-ip";
import {
  authorizeErrorResponse,
  consentResponse,
  messageResponse,
} from "@/components/oauth/render";
import { ensureAccount } from "@/lib/auth/accounts";
import { getSessionUser } from "@/lib/auth/session";
import { authorizeRequest } from "@/lib/oauth/authorize";
import { OAUTH_RESUME_COOKIE } from "@/lib/oauth/constants";
import { oauthConfig } from "@/lib/oauth/config";
import { methodNotAllowed } from "@/lib/oauth/http";
import { clientRedirectResponse } from "@/lib/oauth/redirect";
import { clearResumeCookieHeader, resumeCookieHeader } from "@/lib/oauth/resume";
import { authorizeDeps } from "@/lib/oauth/runtime";
import { protocolFor } from "@/lib/routing/urls";

// The authorize endpoint and the consent screen (M10-11 to M10-13). A route handler, not a page:
// the 400 and 429 statuses, the 303 to /login with its cookie and the exact headers of a redirect to
// an app are things a page cannot send. GET only; the decision is a post to /oauth/consent.
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const config = oauthConfig();
  const secure = protocolFor(config.rootDomain) === "https";
  const user = await getSessionUser();
  if (user) {
    try {
      await ensureAccount(user.id);
    } catch {
      // requireUser() self-heals on the next page load; the row is only needed to bind a request.
    }
  }
  const jar = await cookies();

  const clientKey = rateLimitClientKey(request.headers);
  const result = await authorizeRequest(
    {
      rawQuery: new URL(request.url).search.replace(/^\?/, ""),
      clientKey,
      user,
      resumeId: jar.get(OAUTH_RESUME_COOKIE)?.value ?? null,
    },
    authorizeDeps(clientKey),
  );

  switch (result.kind) {
    case "error_page":
      return authorizeErrorResponse(result.errorClass, result.status, result.retryAfter);
    case "redirect":
      return clientRedirectResponse(result.location);
    case "login": {
      // No query string at all: nothing about the request travels in a URL.
      const response = new Response(null, {
        status: 303,
        headers: { Location: `${config.appOrigin}/login`, "Cache-Control": "no-store" },
      });
      response.headers.append("Set-Cookie", resumeCookieHeader(result.requestId, secure));
      return response;
    }
    case "consent":
      return consentResponse(result.view);
    case "message":
      return messageResponse(result.message, result.status);
    case "invalid_resume": {
      const response = authorizeErrorResponse("invalid", 400);
      response.headers.append("Set-Cookie", clearResumeCookieHeader(secure));
      return response;
    }
  }
}

const refuse = () => methodNotAllowed("GET");
export const HEAD = refuse;
export const POST = refuse;
export const PUT = refuse;
export const PATCH = refuse;
export const DELETE = refuse;
