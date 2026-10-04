import { NOTICE_CSS } from "./notice-page";

/**
 * The interstitial of a locked link (M9-29): the HYDLNK notice page with a small form in it. Shown by
 * `GET /r/<pageId>/<id>` for a locked link instead of the redirect, and again, with a sentence, when
 * a try fails. It is plain HTML with a real `<form method="post">`: it works with JavaScript off,
 * and a link preview bot that fetches it sees this page and never the destination.
 *
 * Nothing from the tenant is in it (no label, no host, no destination); the `action` is built from
 * the two validated ids by the caller. Every sentence is a constant of this module, so there is
 * nothing to escape.
 */

export type LockPageKind = "age" | "code";

export const AGE_HEADING = "This link may contain sensitive content.";
export const AGE_LEAD = "Continue?";
export const CODE_HEADING = "This link is locked.";
export const CODE_LEAD = "Enter the code to continue.";

export const WRONG_CODE_MESSAGE = "That code didn’t match. Try again.";
export const MISSING_CODE_MESSAGE = "Enter the code.";
export const MISSING_CONFIRM_MESSAGE = "Press Continue to open this link.";
export const TOO_MANY_TRIES_MESSAGE = "Too many tries. Wait a minute and try again.";
/** A link many different visitors have tried to open with wrong codes (the hot link, M9-29). */
export const LINK_BUSY_MESSAGE = "This link has had a lot of tries. Wait 10 minutes and try again.";
export const LOCK_UNAVAILABLE_MESSAGE =
  "This link can’t be opened right now. Try again in a moment.";

const LOCK_CSS = `
h1 { margin: 0 0 8px; font-size: 20px; }
.lead { margin: 0 0 20px; color: var(--hl-text-2); font-size: 15px; overflow-wrap: anywhere; }
.error { margin: 0 0 16px; text-align: left; padding: 10px 12px; border: 1px solid var(--hl-line); border-left: 3px solid #a3362b; border-radius: var(--hl-radius); font-size: 14px; overflow-wrap: anywhere; }
form { display: flex; flex-direction: column; gap: 12px; margin: 0 0 12px; }
label { font-size: 13px; font-weight: 600; text-align: left; }
input[type="text"] {
  width: 100%;
  min-height: 44px;
  padding: 0 12px;
  border: 1px solid var(--hl-line);
  border-radius: var(--hl-radius);
  background: var(--hl-surface);
  color: var(--hl-ink);
  font: inherit;
  font-size: 16px;
}
input[type="text"]:focus-visible, button:focus-visible { outline: 2px solid var(--hl-brass); outline-offset: 2px; }
button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 44px;
  padding: 0 20px;
  border: 0;
  border-radius: var(--hl-radius);
  background: var(--hl-ink);
  color: var(--hl-page);
  font: inherit;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}
a.back { display: flex; width: 100%; border: 1px solid var(--hl-line); background: transparent; color: var(--hl-ink); }
`;

export interface LockPage {
  kind: LockPageKind;
  /** `/r/<pageId>/<id>`: where the form posts (built by the caller from the two validated ids). */
  action: string;
  /** A sentence to show above the form (a wrong code, too many tries), or null. */
  error?: string | null;
  /** The status shown as the small eyebrow, when it is not 200. */
  status?: number;
}

export function lockPageHtml({ kind, action, error = null, status = 200 }: LockPage): string {
  const heading = kind === "age" ? AGE_HEADING : CODE_HEADING;
  const lead = kind === "age" ? AGE_LEAD : CODE_LEAD;
  const field =
    kind === "age"
      ? `<input type="hidden" name="confirm" value="1">`
      : `<label for="code">Code</label>
<input id="code" name="code" type="text" inputmode="text" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" maxlength="64" required>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${heading} - HYDLNK</title>
<style>
${NOTICE_CSS}${LOCK_CSS}</style>
</head>
<body>
<main>
<p class="brand">HYDLNK</p>
${status === 200 ? "" : `<p class="code">${status}</p>\n`}<h1>${heading}</h1>
<p class="lead">${lead}</p>
${error ? `<p class="error" role="alert">${error}</p>\n` : ""}<form method="post" action="${action}">
${field}
<button type="submit">Continue</button>
</form>
<a class="back" href="/">Go back</a>
</main>
</body>
</html>
`;
}

/** The headers of every interstitial response: no cache, no index, no referrer, no framing. */
export const LOCK_PAGE_HEADERS: Readonly<Record<string, string>> = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Robots-Tag": "noindex",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  // No `form-action` directive, on purpose (a deviation from M9-29's wording, which had `form-action
  // 'self'`): Chromium also checks it against the redirect that answers the POST, so with 'self' the
  // 303 to the destination is blocked and nobody could pass the lock. Naming the destination there
  // instead would put its host in a header, which this page must never do. The page holds no tenant
  // text, no script and no style from outside, and `default-src 'none'` covers everything else.
  "Content-Security-Policy":
    "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
};
