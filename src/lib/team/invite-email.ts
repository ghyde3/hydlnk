import "server-only";
import { createElement } from "react";
import { render } from "react-email";
import { SiteInvite } from "@/emails/site-invite";
import { INVITE_TTL_DAYS, type MemberRole } from "./constants";

/** The invite email's words (Wave F, M19-08, T14): a fixed subject; no site name, no free text. */
export const SITE_INVITE_SUBJECT = "You’re invited to work on a HYDLNK site";

const ROLE_PHRASE: Readonly<Record<MemberRole, string>> = {
  editor: "an editor",
  publisher: "a publisher",
};

export async function siteInviteEmail(
  to: string,
  role: MemberRole,
  inviteUrl: string,
): Promise<{ to: string; subject: string; text: string; html: string }> {
  const element = createElement(SiteInvite, {
    roleLabel: ROLE_PHRASE[role],
    inviteUrl,
    days: INVITE_TTL_DAYS,
  });
  const [html, text] = await Promise.all([render(element), render(element, { plainText: true })]);
  return { to, subject: SITE_INVITE_SUBJECT, text, html };
}
