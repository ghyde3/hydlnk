import { createElement as h } from "react";
import { Body, Container, Head, Html, Link, Text } from "react-email";
import { EMAIL_FONT_STACK, EMAIL_TEXT_COLOR } from "./domain-live";

/**
 * The invite to a site (Wave F, M19-08, T14): fixed words, the role, the link and its expiry. No site
 * name, no free text from anyone and no remote resource (no image, no font). Server only by use:
 * the one importer is src/lib/team/invite-email.ts. Written with `createElement` (see domain-live.tsx).
 */
export interface SiteInviteProps {
  /** "an editor" or "a publisher". */
  roleLabel: string;
  inviteUrl: string;
  days: number;
}

const TEXT = { fontSize: "16px", lineHeight: "24px", margin: "0 0 8px" } as const;

export function SiteInvite({ roleLabel, inviteUrl, days }: SiteInviteProps) {
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
        h(Text, { style: TEXT }, `You’re invited to work on a HYDLNK site as ${roleLabel}.`),
        h(
          Text,
          { style: TEXT },
          `Open the link below and sign in with this email address to accept. It works once, for ${days} days.`,
        ),
        h(Link, { href: inviteUrl, style: { color: EMAIL_TEXT_COLOR, textDecoration: "underline" } }, inviteUrl),
        h(
          Text,
          { style: { ...TEXT, margin: "16px 0 0" } },
          "If you weren’t expecting this, you can ignore it. Nothing happens unless you accept.",
        ),
      ),
    ),
  );
}

export default SiteInvite;
