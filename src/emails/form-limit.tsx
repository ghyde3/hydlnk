import { createElement as h } from "react";
import { Body, Container, Head, Html, Link, Text } from "react-email";
import { EMAIL_FONT_STACK, EMAIL_TEXT_COLOR } from "./domain-live";

/**
 * The one email of a month in which the account's forms reached their limit (Wave D, M17-02): no
 * visitor text at all, only the plan's numbers. Server only by use: the one importer is
 * src/lib/forms/email-content.ts. Written with `createElement` (see domain-live.tsx).
 */

export interface FormLimitProps {
  /** "You’ve reached this month’s limit of 100 form submissions on Free." */
  sentence: string;
  audienceUrl: string;
}

export function FormLimit({ sentence, audienceUrl }: FormLimitProps) {
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
        h(Text, { style: { fontSize: "16px", lineHeight: "24px", margin: "0 0 8px" } }, sentence),
        h(
          Text,
          { style: { fontSize: "16px", lineHeight: "24px", margin: "0 0 8px" } },
          "New submissions are not saved until the 1st of next month. Visitors still see your success message.",
        ),
        h(
          Link,
          { href: audienceUrl, style: { color: EMAIL_TEXT_COLOR, textDecoration: "underline" } },
          "Open Audience",
        ),
      ),
    ),
  );
}

export default FormLimit;
