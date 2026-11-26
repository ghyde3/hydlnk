import type { Metadata } from "next";
import { AuthHeading } from "@/components/auth/auth-heading";
import { AuthLayout } from "@/components/auth/auth-layout";
import { AcceptInviteForm } from "@/components/team/accept-invite-form";
import { signOut } from "@/lib/auth/actions";
import { requireUser } from "@/lib/auth/session";
import { dismissInvite } from "@/lib/team/actions";
import { TEAM_MESSAGES, type TeamError } from "@/lib/team/core";
import { inviteResult, pendingInviteToken } from "@/lib/team/resume";

export const metadata: Metadata = { title: { absolute: "HYDLNK — Join a site" } };

/**
 * /invite (M19-08): where an invite link lands once the person is signed in. It reads only the
 * HttpOnly invite cookie (set by GET /invite/{token}) and nothing in the database: accepting is the
 * POST below, which checks the token, its expiry and that this session's confirmed email is the
 * invited one. Signed out goes to /login (the sign-in comes back here). No site name is shown before
 * the invite is accepted.
 */
export default async function InvitePage() {
  const user = await requireUser();
  const token = await pendingInviteToken();
  // S7: an Accept refused for good dropped the cookie; say why (another address, a password session).
  const refused = token ? null : await inviteResult(Object.keys(TEAM_MESSAGES) as TeamError[]);
  // The wrong account or a password session: the link still works for the right sign-in.
  const signInAgain = refused === "invite_email" || refused === "invite_session";
  return (
    <AuthLayout>
      <AuthHeading
        title={token ? "Join a site" : "This invite link doesn’t work"}
        intro={
          token
            ? "You were invited to edit a site on HYDLNK. Accept to start working on it."
            : signInAgain
              ? "Open the link in the invite email again once you’re signed in the right way."
              : TEAM_MESSAGES[refused ?? "invite_used"]
        }
      />
      {signInAgain && refused ? (
        <p
          role="alert"
          data-invite-refused={refused}
          className="mt-5 rounded-md bg-brass-soft px-3 py-2.5 text-sm leading-normal text-brass-soft-text"
        >
          {TEAM_MESSAGES[refused]}
        </p>
      ) : null}
      {token ? (
        <div className="mt-7 flex flex-col gap-2">
          <AcceptInviteForm />
          <form action={dismissInvite}>
            <button
              type="submit"
              className="flex min-h-11 w-full cursor-pointer items-center justify-center font-semibold text-ink underline"
            >
              Not now
            </button>
          </form>
        </div>
      ) : null}
      <div className="mt-6 text-sm text-text-2">
        <p>
          Signed in as{" "}
          <span className="font-semibold text-ink [overflow-wrap:anywhere]">{user.email}</span>. The
          invite works only for the address it was sent to: sign out, then open the link in the
          email again.
        </p>
        <form action={signOut}>
          <button
            type="submit"
            className="inline-flex min-h-11 cursor-pointer items-center font-semibold text-ink underline"
          >
            Sign out
          </button>
        </form>
      </div>
    </AuthLayout>
  );
}
