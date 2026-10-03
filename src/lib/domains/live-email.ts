/**
 * The "your domain is live" email (M5-23): the words, nothing else. Pure, so a test can read them.
 * Subject "links.example.test is live", body "Your page is now served at https://links.example.test.",
 * one "Open links.example.test" link, an HTML and a plain-text part, no exclamation marks.
 */

export interface LiveEmailContent {
  subject: string;
  text: string;
  html: string;
}

const escapeHtml = (value: string): string =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** `hostname` is a stored domains.hostname: lower case letters, digits, hyphens and dots (punycode). */
export function liveEmailContent(hostname: string): LiveEmailContent {
  const origin = `https://${hostname}`;
  const sentence = `Your page is now served at ${origin}.`;
  const label = `Open ${hostname}`;
  return {
    subject: `${hostname} is live`,
    text: `${sentence}\n\n${label}: ${origin}/\n`,
    html:
      `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#1c1b19;line-height:1.5">` +
      `<p>${escapeHtml(sentence)}</p>` +
      `<p><a href="${escapeHtml(origin)}/" style="color:#1c1b19">${escapeHtml(label)}</a></p>` +
      `</body></html>`,
  };
}
