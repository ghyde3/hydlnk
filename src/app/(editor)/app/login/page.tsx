import type { Metadata } from "next";
import { AuthLayout } from "@/components/auth/auth-layout";
import { LoginForm } from "@/components/auth/login-form";
import { redirectIfSignedIn } from "@/lib/auth/gate";

export const metadata: Metadata = { title: { absolute: "HYDLNK — Log in" } };

/** Copy for the `?error=` codes /auth/callback redirects here with. Unknown codes show nothing. */
const NOTICES: Record<string, string> = {
  link_invalid: "That sign-in link expired or was already used. Request a new one.",
};

export default async function LoginPage({ searchParams }: PageProps<"/app/login">) {
  // Signed-in visitors go on to /editor or /claim. Nothing here reads ?next=, ?redirect_to= or
  // ?return_to=: no return-URL parameter exists anywhere in the sign-in flow.
  await redirectIfSignedIn();
  const { error, deleted } = await searchParams;
  const code = Array.isArray(error) ? error[0] : error;
  const notice = code && Object.hasOwn(NOTICES, code) ? NOTICES[code] : undefined;
  // The delete-account action redirects here with ?deleted=1 (M1-22): neutral status text, not the
  // red alert used for failures. An error code, if any, wins.
  const flag = Array.isArray(deleted) ? deleted[0] : deleted;
  const status = !notice && flag === "1" ? "Your account was deleted." : undefined;

  return (
    <AuthLayout>
      <LoginForm notice={notice} status={status} />
    </AuthLayout>
  );
}
