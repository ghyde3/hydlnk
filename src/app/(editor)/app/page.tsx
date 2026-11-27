import { redirect } from "next/navigation";
import { requireAppUser } from "@/lib/auth/gate";
import { requireUser } from "@/lib/auth/session";
import { resumeInvite } from "@/lib/team/resume";
import { resumeOauthRequest } from "@/lib/oauth/resume";

/**
 * The app host's landing route. It renders nothing: signed out goes to /login, signed in without a
 * page to /claim, signed in with a page to /editor (see requireAppUser). No return-URL parameter.
 */
export default async function AppHome(): Promise<never> {
  // Wave F (M19-08): an invite link opened signed out comes back here after the sign-in, before the
  // gate would send an account with no site to /claim.
  await requireUser();
  await resumeInvite();
  const { user } = await requireAppUser();
  // Wave L (M10-12): back to the consent screen of the app that started this sign-in, when it did.
  await resumeOauthRequest(user.id);
  redirect("/editor");
}
