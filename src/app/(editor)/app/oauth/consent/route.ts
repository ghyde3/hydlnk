import { messageResponse } from "@/components/oauth/render";
import { getSessionUser } from "@/lib/auth/session";
import { CONSENT_MAX_BODY_BYTES, decideConsent } from "@/lib/oauth/consent";
import { oauthConfig } from "@/lib/oauth/config";
import { mediaType, methodNotAllowed, readCappedBody } from "@/lib/oauth/http";
import { clientRedirectResponse } from "@/lib/oauth/redirect";
import { clearResumeCookieHeader } from "@/lib/oauth/resume";
import { consentDeps } from "@/lib/oauth/runtime";
import { protocolFor } from "@/lib/routing/urls";

// The person's answer to the consent screen (M10-13, M10-14): a plain form post, so it works with
// JavaScript off and answers a real 303. Origin is checked here and a per-render form secret in the
// core; everything else about the request is read from the pending row, never from the form.
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const config = oauthConfig();
  const secure = protocolFor(config.rootDomain) === "https";

  if (mediaType(request) !== "application/x-www-form-urlencoded") {
    return messageResponse("forbidden", 403);
  }
  const body = await readCappedBody(request, CONSENT_MAX_BODY_BYTES);
  if (!body.ok) return messageResponse("forbidden", 403);

  const user = await getSessionUser();
  const result = await decideConsent(
    {
      origin: request.headers.get("origin"),
      secFetchSite: request.headers.get("sec-fetch-site"),
      user,
      fields: new URLSearchParams(body.text),
    },
    consentDeps(),
  );

  switch (result.kind) {
    case "redirect":
      return clientRedirectResponse(result.location, {
        "Set-Cookie": clearResumeCookieHeader(secure),
      });
    case "login":
      return new Response(null, {
        status: 303,
        headers: { Location: `${config.appOrigin}/login`, "Cache-Control": "no-store" },
      });
    case "message":
      return messageResponse(
        result.message,
        result.status,
        result.clearResume ? { "Set-Cookie": clearResumeCookieHeader(secure) } : undefined,
      );
  }
}

const refuse = () => methodNotAllowed("POST");
export const GET = refuse;
export const HEAD = refuse;
export const PUT = refuse;
export const PATCH = refuse;
export const DELETE = refuse;
