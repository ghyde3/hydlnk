import { redirect } from "next/navigation";
import { requireAppUser } from "@/lib/auth/gate";
import { resumeOauthRequest } from "@/lib/oauth/resume";

/**
 * The app host's landing route. It renders nothing: signed out goes to /login, signed in without a
 * page to /claim, signed in with a page to /editor (see requireAppUser). No return-URL parameter.
 */
export default async function AppHome(): Promise<never> {
  const { user } = await requireAppUser();
  // Wave L (M10-12): back to the consent screen of the app that started this sign-in, when it did.
  await resumeOauthRequest(user.id);
  redirect("/editor");
}
