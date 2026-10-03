import type { PreviewLinkFailure } from "./types";

/**
 * What the Share preview dialog says for each refusal (M6-09, M6-12), plain words and never a
 * server error. The server answers with a `reason`; the message travels with it so the dialog and a
 * direct caller read the same sentence.
 */
export const PREVIEW_LINK_LIMIT = 5;

export const PREVIEW_LINK_MESSAGES: Record<PreviewLinkFailure, string> = {
  unauthorized: "You’re signed out. Sign in again, then try again.",
  not_found: "Couldn’t create the link. Try again.",
  account_suspended: "Your account is suspended.",
  preview_link_limit: `You have ${PREVIEW_LINK_LIMIT} active preview links. Turn one off to make another.`,
  rate_limited: "You’ve created a lot of links. Try again in a while.",
  failed: "Couldn’t create the link. Try again.",
};

/** The HTTP status each refusal stands for (the action reports it; a route would send it). */
export const PREVIEW_LINK_STATUS: Record<PreviewLinkFailure, number> = {
  unauthorized: 401,
  not_found: 404,
  account_suspended: 403,
  preview_link_limit: 409,
  rate_limited: 429,
  failed: 500,
};

/** The one sentence every inactive share link answers with (unknown, malformed, expired, turned off, suspended, deleted). */
export const INACTIVE_LINK_MESSAGE =
  "This preview link isn’t active. Ask the owner for a new link.";
