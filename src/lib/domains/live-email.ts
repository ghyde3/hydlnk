import { createElement } from "react";
import { render } from "react-email";
import { DomainLive } from "@/emails/domain-live";

/**
 * The "your domain is live" email (M5-23, M9-09): the words, nothing else. Subject
 * "links.example.test is live", body "Your page is now served at https://links.example.test.", one
 * "Open links.example.test" link, an HTML and a plain-text part, no exclamation marks.
 *
 * The template is src/emails/domain-live.tsx (react-email). `render` is asynchronous, so this
 * function is too. Kept as a `.ts` module (no JSX) so its name and importers stay as they were.
 */

export interface LiveEmailContent {
  subject: string;
  text: string;
  html: string;
}

/**
 * `hostname` is a stored domains.hostname (lower case letters, digits, hyphens and dots). The sender
 * checks it against HOSTNAME_PATTERN before calling this (see email.ts); React escapes whatever it is
 * handed regardless.
 */
export async function liveEmailContent(hostname: string): Promise<LiveEmailContent> {
  const element = createElement(DomainLive, { hostname });
  const [html, text] = await Promise.all([render(element), render(element, { plainText: true })]);
  return { subject: `${hostname} is live`, text, html };
}
