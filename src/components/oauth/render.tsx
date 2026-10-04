import "server-only";
import type { ReactNode } from "react";
import { APP_CONTENT_SECURITY_POLICY } from "@/lib/routing/app-headers";
import { HTML_DOCTYPE } from "@/lib/oauth/http";
import { renderStatic } from "@/lib/tenant-render/static-markup";
import type { ConsentView, MessageKind } from "@/lib/oauth/authorize";
import {
  APP_CHANGED,
  AUTHORIZE_ERROR_TITLE,
  CONSENT_FORBIDDEN,
  CONSENT_RATE_LIMITED,
  CONSENT_TITLE,
  GRANT_LIMIT,
  REQUEST_ANSWERED,
  REQUEST_EXPIRED,
  REQUEST_SOMEONE_ELSE,
  type AuthorizeErrorClass,
} from "@/lib/oauth/messages";
import { ConsentScreen } from "./consent-screen";
import { AuthorizeErrorScreen, MessageScreen } from "./message-screen";
import { OauthDocument } from "./oauth-document";

/**
 * The OAuth screens as finished responses (M10-11 to M10-14). A route handler answers them, so the
 * status (400, 403, 429), the cookie and the redirects are exact; the HTML is rendered once on the
 * server with no hydration markers and no script. The headers are the app host's (never framed, no
 * sniffing) plus `no-store` and `Referrer-Policy: no-referrer`, and NO `form-action` directive:
 * Chrome applies it to the redirect that follows a post, so a policy naming only 'self' would block
 * the return to the app.
 */

function screenHeaders(extra: Record<string, string> = {}): Headers {
  const headers = new Headers({
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": APP_CONTENT_SECURITY_POLICY,
  });
  for (const [name, value] of Object.entries(extra)) headers.set(name, value);
  return headers;
}

function page(
  title: string,
  body: ReactNode,
  status: number,
  extra?: Record<string, string>,
): Response {
  const html = `${HTML_DOCTYPE}${renderStatic(<OauthDocument title={title}>{body}</OauthDocument>)}`;
  return new Response(html, { status, headers: screenHeaders(extra) });
}

export function consentResponse(view: ConsentView): Response {
  return page(CONSENT_TITLE, <ConsentScreen view={view} />, 200);
}

export function authorizeErrorResponse(
  errorClass: AuthorizeErrorClass,
  status: number,
  retryAfter?: number,
): Response {
  return page(
    AUTHORIZE_ERROR_TITLE,
    <AuthorizeErrorScreen errorClass={errorClass} />,
    status,
    retryAfter ? { "Retry-After": String(retryAfter) } : undefined,
  );
}

const MESSAGE_TEXT: Record<MessageKind, string> = {
  expired: REQUEST_EXPIRED,
  answered: REQUEST_ANSWERED,
  someone_else: REQUEST_SOMEONE_ELSE,
  app_changed: APP_CHANGED,
  grant_limit: GRANT_LIMIT,
  rate_limited: CONSENT_RATE_LIMITED,
  forbidden: CONSENT_FORBIDDEN,
};

export function messageResponse(
  kind: MessageKind,
  status: number,
  extra?: Record<string, string>,
): Response {
  return page(
    CONSENT_TITLE,
    <MessageScreen
      text={MESSAGE_TEXT[kind]}
      settingsHref={kind === "grant_limit" ? "/settings" : undefined}
    />,
    status,
    extra,
  );
}
