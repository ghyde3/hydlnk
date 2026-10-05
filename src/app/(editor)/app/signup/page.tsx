import Link from "next/link";
import type { Metadata } from "next";
import { AuthLayout } from "@/components/auth/auth-layout";
import { AuthHeading } from "@/components/auth/auth-heading";
import { SignupForm } from "@/components/auth/signup-form";
import { redirectIfSignedIn } from "@/lib/auth/gate";
import { clientEnv } from "@/lib/env/client";
import { rootOrigin } from "@/lib/routing/urls";

export const metadata: Metadata = { title: { absolute: "HYDLNK — Sign up" } };

/**
 * Sign up screen (Signup.dc.html). The landing page's claim form arrives here with ?handle=. This
 * file is the layout: brand panel, heading, legal line and the log in link. The handle and email
 * fields, the buttons and the handle availability live in <SignupForm>.
 */
export default async function SignupPage({ searchParams }: PageProps<"/app/signup">) {
  // Signed-in visitors never see this page. ?next=, ?redirect_to= and ?return_to= are never read.
  await redirectIfSignedIn();
  const { handle } = await searchParams;
  const initialHandle = (Array.isArray(handle) ? handle[0] : handle)?.trim().slice(0, 64) ?? "";
  const legalBase = rootOrigin(clientEnv.NEXT_PUBLIC_ROOT_DOMAIN);

  return (
    <AuthLayout handle={initialHandle}>
      <AuthHeading
        title="Create your site"
        intro={"Pick a handle and we’ll email you a sign-in link. No password to remember."}
      />
      <div className="mt-7">
        <SignupForm initialHandle={initialHandle} />
      </div>
      <p className="mt-6 text-[13px] leading-relaxed text-text-2">
        By continuing you agree to the{" "}
        <a href={`${legalBase}/terms`} className="text-ink underline">
          Terms
        </a>{" "}
        and{" "}
        <a href={`${legalBase}/privacy`} className="text-ink underline">
          Privacy Policy
        </a>
        .
      </p>
      <p className="mt-4 flex flex-wrap items-center gap-x-1.5 text-sm text-text-2">
        Already have a site?
        <Link
          href="/login"
          className="inline-flex min-h-11 min-w-11 items-center font-semibold text-ink"
        >
          Log in
        </Link>
      </p>
    </AuthLayout>
  );
}
