import type { Metadata } from "next";
import { AuthHeading } from "@/components/auth/auth-heading";
import { AuthLayout } from "@/components/auth/auth-layout";
import { AcceptInviteForm } from "@/components/team/accept-invite-form";
import { signOut } from "@/lib/auth/actions";
import { requireUser } from "@/lib/auth/session";
import { dismissInvite } from "@/lib/team/actions";
import { TEAM_MESSAGES } from "@/lib/team/core";
import { pendingInviteToken } from "@/lib/team/resume";

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
  return (
    <AuthLayout>
      <AuthHeading
        title={token ? "Join a site" : "This invite link doesn’t work"}
        intro={
          token
            ? "You were invited to edit a site on HYDLNK. Accept to start working on it."
            : TEAM_MESSAGES.invite_used
        }
      />
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
