import { createElement as h, type ReactNode } from "react";
import { Body, Container, Head, Html, Link, Text } from "react-email";
import { linksIn } from "@/lib/forms/contract";
import { EMAIL_FONT_STACK, EMAIL_TEXT_COLOR } from "./domain-live";

/**
 * The owner's copy of a contact form message (Wave D, M17-10): which form, who wrote (name and
 * address, each labelled as typed by the visitor: nothing proves either) and the message, each as
 * React text, so nothing a visitor typed can become markup. A link in the message is plain text,
 * never an anchor: no `<a>` is built from it, and each one is split into spans at its `://` and dots
 * so mail clients that turn URLs in a text run into links (Gmail, Outlook) leave it as text; the
 * `format-detection` meta asks Apple Mail and iOS the same. No image, no stylesheet, no tracking
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
  const pieces = link.split(/(:\/\/|\.)/).filter((piece) => piece !== "");
  return h("span", { key }, ...pieces.map((piece, i) => h("span", { key: i }, piece)));
}

/** The message as text, its links as inert pieces (`linksIn`, the same rule the route counts). */
export function messageText(message: string): ReactNode[] {
  const out: ReactNode[] = [];
  let rest = message;
  let key = 0;
  for (const link of linksIn(message)) {
    const at = rest.indexOf(link);
    if (at < 0) continue;
    if (at > 0) out.push(rest.slice(0, at));
    out.push(inertLink(link, key++));
    rest = rest.slice(at + link.length);
  }
  if (rest !== "") out.push(rest);
  return out;
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
