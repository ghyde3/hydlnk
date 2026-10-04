import { SCOPE_PUBLISH, SCOPE_READ, SCOPE_WRITE, type OauthScope } from "./constants";

/**
 * Every sentence a person reads on the authorize and consent screens (M10-11 to M10-14), in one file
 * so the copy rules (Gary's, 2026-10-03: sentence case, verb-first buttons, no "please", no
 * exclamation marks, no em dashes, American English) are checked in one place
 * (tests/unit/marketing-copy.test.ts guards this file and src/components/oauth/).
 */

/** The error page of /oauth/authorize: one title, one reason by class, one way out. */
export const AUTHORIZE_ERROR_TITLE = "This sign-in request isn’t valid.";
export const AUTHORIZE_ERROR_NEXT = "Go back to the app and try again.";

export type AuthorizeErrorClass =
  "unknown_app" | "bad_redirect" | "cannot_verify" | "too_many" | "invalid";

export const AUTHORIZE_ERROR_REASON: Readonly<Record<AuthorizeErrorClass, string>> = {
  unknown_app: "We don’t recognize this app.",
  bad_redirect: "This app’s return address isn’t allowed.",
  cannot_verify: "We couldn’t verify this app.",
  too_many: "Too many requests. Try again in a minute.",
  invalid: "The request has something we can’t read.",
};

/** The consent screen. */
export const CONSENT_TITLE = "Connect an app";

export const consentHeading = (name: string): string => `${name} wants to connect to your HYDLNK`;

export const REGISTERED_NOT_VERIFIED = "Registered automatically. HYDLNK hasn’t verified this app.";
export const addressLine = (host: string): string => `Address: ${host}`;
export const returnLine = (host: string): string => `When you choose, you’ll go back to ${host}.`;
export const RETURN_LOOPBACK_LINE =
  "When you choose, you’ll go back to a program on this computer (localhost).";
export const LOOPBACK_WARNING =
  "Only continue if you started this connection from an app on this computer.";
export const differentSiteLine = (host: string): string =>
  `This app sends you back to a different site: ${host}.`;
export const connectingAs = (email: string): string => `Connecting as ${email}.`;

export const SCOPE_LABELS: Readonly<Record<OauthScope, { title: string; hint: string }>> = {
  [SCOPE_READ]: {
    title: "See your sites, pages and analytics",
    hint: "Always included",
  },
  [SCOPE_WRITE]: {
    title: "Edit your drafts",
    hint: "Add, change and remove blocks, design choices and your profile in your drafts. Nothing goes live until you publish.",
  },
  [SCOPE_PUBLISH]: {
    title: "Publish your pages",
    hint: "Make your draft live on your public page, the same as the Publish button.",
  },
};

export const STAYS_CONNECTED =
  "It stays connected while you use it. You can remove it any time in Settings.";
export const CONNECTED_BEFORE =
  "You’ve connected this app before. Allowing again replaces what it can do now.";
export const allowedNow = (scopes: readonly OauthScope[]): string =>
  `Allowed now: ${scopes.map((scope) => PLAIN_SCOPE[scope]).join(", ")}.`;

/** The scopes in the lower-case words of a sentence. */
export const PLAIN_SCOPE: Readonly<Record<OauthScope, string>> = {
  [SCOPE_READ]: "see your pages and analytics",
  [SCOPE_WRITE]: "edit your drafts",
  [SCOPE_PUBLISH]: "publish your pages",
};

export const SUSPENDED_NOTICE =
  "Your account is suspended, so you can’t connect apps. Contact support to appeal.";

export const ALLOW_LABEL = "Allow";
export const DENY_LABEL = "Deny";

/** The pages that answer a decision or a visit to a request that cannot be answered. */
export const REQUEST_EXPIRED = "This request expired. Go back to the app and try again.";
export const REQUEST_ANSWERED = "This request was already answered.";
export const REQUEST_SOMEONE_ELSE =
  "This request was started by someone else. Go back to the app and start again.";
export const APP_CHANGED = "This app changed its settings. Go back to the app and try again.";
export const GRANT_LIMIT = "You have 20 connected apps. Remove one in Settings, then try again.";
export const OPEN_SETTINGS = "Open Settings";
export const CONSENT_RATE_LIMITED = "Too many tries. Try again in a while.";
export const CONSENT_FORBIDDEN = "This request expired. Go back to the app and try again.";

/** Error descriptions sent back to the client in a redirect (RFC 6749 section 4.1.2.1): fixed English. */
export const REDIRECT_ERRORS = {
  access_denied: "The person said no.",
  invalid_request: "The request is missing something or has something we can’t read.",
  pkce_required: "PKCE with S256 is required.",
  unsupported_response_type: "Use response_type=code.",
  invalid_scope: "That scope isn’t one this server knows.",
  invalid_target: "That resource isn’t one this server issues tokens for.",
  consent_required: "The person has to answer on the consent screen.",
  request_not_supported: "Send the parameters in the query, not in a request object.",
  request_uri_not_supported: "Send the parameters in the query, not by reference.",
  server_error: "We couldn’t finish that request. Try again.",
  temporarily_unavailable: "We couldn’t finish that request. Try again.",
} as const;

export type RedirectErrorCode = keyof typeof REDIRECT_ERRORS;

/** The Connected apps card (M10-18). */
export const CONNECTED_APPS_TITLE = "Connected apps";
export const CONNECTED_APPS_INTRO =
  "Apps you’ve let manage your pages, like Claude or ChatGPT. Remove one to cut off its access.";
export const CONNECTED_APPS_LINK = "How to connect an app";
export const CONNECTED_APPS_EMPTY = "No apps are connected yet.";
export const CONNECTED_APPS_LOAD_ERROR =
  "We couldn’t load your connected apps. Reload to try again.";
export const REGISTERED_NOT_VERIFIED_SHORT = "Registered automatically. Not verified.";
export const SCOPE_ABILITIES: Readonly<Record<OauthScope, string>> = {
  [SCOPE_READ]: "Can see your pages and analytics",
  [SCOPE_WRITE]: "Can edit your drafts",
  [SCOPE_PUBLISH]: "Can publish your pages",
};
export const connectedOn = (date: string): string => `Connected ${date}`;
export const lastUsedOn = (date: string): string => `Last used ${date}`;
export const NOT_USED_YET = "Not used yet";
export const REVOKE_LABEL = "Revoke";
export const revokeLabelFor = (name: string): string => `Revoke ${name}`;
export const revokedNotice = (name: string): string => `${name} can no longer access your pages.`;
export const REVOKE_RATE_LIMITED = "You’ve done that a lot. Try again in a while.";
export const REVOKE_FAILED = "We couldn’t revoke that app. Try again.";
export const DISCONNECT_FAILED = "We couldn’t disconnect your apps. Try again.";
