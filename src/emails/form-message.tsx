import { createElement as h, type ReactNode } from "react";
import { Body, Container, Head, Html, Link, Text } from "react-email";
import { linkParts, neutralizeLinks } from "@/lib/forms/contract";
import { EMAIL_FONT_STACK, EMAIL_TEXT_COLOR } from "./domain-live";

/**
 * The owner's copy of a contact form message (Wave D, M17-10): which form, who wrote (name and
 * address, each labelled as typed by the visitor: nothing proves either) and the message, each as
 * React text, so nothing a visitor typed can become markup. A link in the message (`linksIn`: a
 * scheme link, a `www.` host or a bare host with a path) is plain text, never an anchor: no `<a>` is
 * built from it, and each one is split into spans at its `://`, `:`, `@` and dots so mail clients
 * that turn URLs in a text run into links (Gmail, Outlook) leave it as text; the `format-detection`
 * meta asks Apple Mail and iOS the same. The plain-text part (`messageEmailText`) keeps the
 * message's line breaks and writes each link inert (`neutralizeLinks`: `https[:]//evil[.]example`).
 * No image, no stylesheet, no tracking
 * pixel, no remote resource. Server only by use: the one importer
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

/** The labels of what the visitor typed (plain wording: nothing checks a name or an address). */
export const FORM_MESSAGE_LABELS = {
  name: "Name (as typed by the visitor)",
  email: "Email (as typed by the visitor)",
} as const;

/** One link as text in pieces: `https`, `://`, `example`, `.`, `com/x`, so no client links it. */
function inertLink(link: string, key: number): ReactNode {
  const pieces = link.split(/(:\/\/|:|@|\.)/).filter((piece) => piece !== "");
  return h("span", { key }, ...pieces.map((piece, i) => h("span", { key: i }, piece)));
}

/** The message as text, its links as inert pieces (`linkParts`, the same rule the route counts). */
export function messageText(message: string): ReactNode[] {
  return linkParts(message).map((part, key) => (part.link ? inertLink(part.text, key) : part.text));
}

/** The closing lines of both parts. */
const REPLY_LINE = "Reply to this email to answer them.";
const AUDIENCE_LINK_TEXT = "See every submission in Audience";

/**
 * The plain-text part, line by line: the same lines as the HTML part, the message with its line
 * breaks and its links written inert (`neutralizeLinks`), HYDLNK's own Audience address last.
 */
export function messageEmailText(props: FormMessageProps): string {
  return [
    `${props.formTitle} on ${props.pageAddress}`,
    `${FORM_MESSAGE_LABELS.name}: ${props.name}`,
    `${FORM_MESSAGE_LABELS.email}: ${props.email}`,
    "",
    neutralizeLinks(props.message),
    "",
    REPLY_LINE,
    `${AUDIENCE_LINK_TEXT}: ${props.audienceUrl}`,
    "",
  ].join("\n");
}

export function FormMessage(props: FormMessageProps) {
  return h(
    Html,
    { lang: "en" },
    h(
      Head,
      null,
      h("meta", {
        name: "format-detection",
        content: "telephone=no, date=no, address=no, email=no, url=no",
      }),
    ),
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
        h(Text, { style: line }, `${FORM_MESSAGE_LABELS.name}: ${props.name}`),
        h(Text, { style: line }, `${FORM_MESSAGE_LABELS.email}: ${props.email}`),
        h(Text, { style: { ...line, whiteSpace: "pre-wrap" } }, ...messageText(props.message)),
        h(Text, { style: line }, REPLY_LINE),
        h(
          Link,
          {
            href: props.audienceUrl,
            style: { color: EMAIL_TEXT_COLOR, textDecoration: "underline" },
          },
          AUDIENCE_LINK_TEXT,
        ),
      ),
    ),
  );
}

export default FormMessage;
