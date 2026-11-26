import { createElement as h } from "react";
import { Body, Container, Head, Html, Link, Text } from "react-email";
import { EMAIL_FONT_STACK, EMAIL_TEXT_COLOR } from "./domain-live";

/**
 * The owner's copy of a contact form message (Wave D, M17-10): which form, who wrote (name and
 * address) and the message, each as React text, so nothing a visitor typed can become markup. No
 * image, no stylesheet, no tracking pixel, no remote resource. Server only by use: the one importer
 * is src/lib/forms/email-content.ts. Written with `createElement` for the reason domain-live.tsx
 * gives (Playwright's JSX transform).
 */

export interface FormMessageProps {
  formTitle: string;
  /** The page's address, e.g. "mara.hydlnk.com". */
  pageAddress: string;
  name: string;
  email: string;
  message: string;
  /** The Audience screen on the app host. */
  audienceUrl: string;
}

const line = { fontSize: "16px", lineHeight: "24px", margin: "0 0 8px" } as const;

export function FormMessage(props: FormMessageProps) {
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
        { style: { maxWidth: "560px", width: "100%" } },
        h(Text, { style: line }, `${props.formTitle} on ${props.pageAddress}`),
        h(Text, { style: line }, `From: ${props.name} <${props.email}>`),
        h(Text, { style: { ...line, whiteSpace: "pre-wrap" } }, props.message),
        h(Text, { style: line }, "Reply to this email to answer them."),
        h(
          Link,
          {
            href: props.audienceUrl,
            style: { color: EMAIL_TEXT_COLOR, textDecoration: "underline" },
          },
          "See every submission in Audience",
        ),
      ),
    ),
  );
}

export default FormMessage;
