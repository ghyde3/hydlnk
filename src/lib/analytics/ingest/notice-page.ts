/**
 * The small HTML pages the tracking routes answer with when there is no redirect to send: "Too many
 * clicks" (429) and "link not found" (404). A route handler cannot render the app's layouts, so this
 * is one self-contained document in the HYDLNK UI look (docs/DESIGN.md: charcoal ink on the warm
 * canvas, brass accent, 6px corners), with the values declared as --hl-* variables and used through
 * them. No tenant token appears here: this is HYDLNK speaking, not the page's owner. Nothing in it
 * comes from the request, so there is nothing to escape.
 */

export interface NoticePage {
  /** The HTTP status, shown as the small eyebrow. */
  status: number;
  /** The whole message, one sentence or two. */
  message: string;
  /** Where "Go to hydlnk.com" points (the HYDLNK root origin). */
  homeHref: string;
}

export function noticePageHtml({ status, message, homeHref }: NoticePage): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${status} - HYDLNK</title>
<style>
:root {
  --hl-ink: #1c1b1a;
  --hl-text-2: #5e5a54;
  --hl-page: #f4f3f0;
  --hl-surface: #ffffff;
  --hl-line: #e2dfd9;
  --hl-brass: #b8914f;
  --hl-radius: 6px;
  --hl-font-ui: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --hl-font-mono: ui-monospace, SFMono-Regular, Menlo, monospace;
}
*, *::before, *::after { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body {
  margin: 0;
  min-height: 100dvh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px 16px;
  background: var(--hl-page);
  color: var(--hl-ink);
  font-family: var(--hl-font-ui);
  line-height: 1.5;
}
main {
  width: 100%;
  max-width: 440px;
  padding: 32px 24px;
  background: var(--hl-surface);
  border: 1px solid var(--hl-line);
  border-radius: var(--hl-radius);
  text-align: center;
}
.brand { margin: 0 0 20px; font-size: 12px; font-weight: 700; letter-spacing: 0.14em; }
.brand::before { content: ""; display: inline-block; width: 8px; height: 8px; margin-right: 8px; background: var(--hl-brass); transform: rotate(45deg); }
.code { margin: 0 0 8px; font-family: var(--hl-font-mono); font-size: 12px; letter-spacing: 0.08em; color: var(--hl-text-2); }
h1 { margin: 0 0 24px; font-size: 22px; line-height: 1.25; font-weight: 700; letter-spacing: -0.015em; overflow-wrap: anywhere; }
a {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 44px;
  padding: 0 20px;
  border-radius: var(--hl-radius);
  background: var(--hl-ink);
  color: var(--hl-page);
  font-size: 14px;
  font-weight: 600;
  text-decoration: none;
}
a:focus-visible { outline: 2px solid var(--hl-brass); outline-offset: 2px; }
</style>
</head>
<body>
<main>
<p class="brand">HYDLNK</p>
<p class="code">${status}</p>
<h1>${message}</h1>
<a href="${homeHref}">Go to hydlnk.com</a>
</main>
</body>
</html>
`;
}

export const TOO_MANY_CLICKS_MESSAGE = "Too many clicks from your network. Try again in a minute.";
export const LINK_NOT_FOUND_MESSAGE = "This link isn’t available.";
