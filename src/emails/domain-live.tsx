import { createElement as h } from "react";
import { Body, Container, Head, Html, Link, Text } from "react-email";

/**
 * The "your domain is live" email (M5-23, rebuilt with react-email in M9-09): the words, nothing
 * else. One sentence and one link; no image, no stylesheet, no tracking pixel, no remote resource.
 *
 * Server only by use, not by an import: the one importer is src/lib/domains/live-email.ts (a Vitest
 * scan keeps it that way), and a test renders this component directly, so there is no `server-only`
 * import here. Each text below is ONE string: React would otherwise split `Open {hostname}` into
 * two text nodes and the HTML renderer would put a comment between them.
 *
 * Written with `createElement`, not JSX syntax, on purpose: the Playwright specs of the domain flow
 * run the real email sender in the test process (tests/e2e/m4/domains-core-helpers.ts), and
 * Playwright's transform rewrites JSX in any .tsx file it loads into its own component-test
 * runtime, which React cannot render. A file with no JSX in it is left alone.
 */

export interface DomainLiveProps {
  /** A stored domains.hostname: lower case letters, digits, hyphens and dots (punycode). */
  hostname: string;
}

/** The old email's colors and font stack. */
export const EMAIL_TEXT_COLOR = "#1c1b19";
export const EMAIL_FONT_STACK = "-apple-system,Segoe UI,Helvetica,Arial,sans-serif";

export function DomainLive({ hostname }: DomainLiveProps) {
  const origin = `https://${hostname}`;
  return h(
    Html,
    { lang: "en" },
    h(Head),
    h(
      Body,
      {
        style: {
          fontFamily: EMAIL_FONT_STACK,
          color: EMAIL_TEXT_COLOR,
          lineHeight: 1.5,
          fontSize: "16px",
          margin: 0,
          padding: "24px 16px",
        },
      },
      h(
        Container,
        { style: { maxWidth: "480px", width: "100%" } },
        h(
          Text,
          { style: { fontSize: "16px", lineHeight: "24px", margin: "0 0 8px" } },
          `Your site is now served at ${origin}.`,
        ),
        h(
          Link,
          {
            href: `${origin}/`,
            style: {
              color: EMAIL_TEXT_COLOR,
              display: "inline-block",
              fontSize: "16px",
              lineHeight: "20px",
              padding: "12px 0",
              textDecoration: "underline",
            },
          },
          `Open ${hostname}`,
        ),
      ),
    ),
  );
}

export default DomainLive;
