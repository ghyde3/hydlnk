import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthHeading } from "@/components/auth/auth-heading";
import { AuthLayout } from "@/components/auth/auth-layout";
import { ClaimForm } from "@/components/auth/claim-form";
import { signOut } from "@/lib/auth/actions";
import { requireClaimUser } from "@/lib/auth/gate";
import { handleDisplayHost, normalizeHandle, validateHandle } from "@/lib/handles/rules";
import { readPendingHandle } from "@/lib/handles/pending-server";

export const metadata: Metadata = { title: { absolute: "HYDLNK — Claim your handle" } };

const firstOf = (value: string | string[] | undefined): string =>
  (Array.isArray(value) ? value[0] : value) ?? "";

/**
 * Claim step for a signed-in account without a page (M1-14, Signup.dc.html). The gate sends
 * signed-out visitors to /login and accounts that already have a page to /editor. A handle chosen
 * on /signup is claimed first, by /claim/resume; only when that fails (or there is none) does the
 * visitor see the form. `?pending=done` marks "already tried", which is what stops the redirect
 * from coming back here.
 *
 * Query parameters (all optional, set by /claim/resume): handle (prefill, normalized and
 * length-capped), reason=taken (shows the notice).
 */
export default async function ClaimPage({ searchParams }: PageProps<"/app/claim">) {
  const user = await requireClaimUser();
  const params = await searchParams;

  if (firstOf(params.pending) !== "done" && (await readPendingHandle())) {
    redirect("/claim/resume");
  }

  const prefill = normalizeHandle(firstOf(params.handle)).slice(0, 64);
  const notice =
    firstOf(params.reason) === "taken" && validateHandle(prefill) === "ok"
      ? `${handleDisplayHost(prefill)} was taken while you were signing up. Pick another.`
      : undefined;

  return (
    <AuthLayout handle={prefill}>
      <AuthHeading title="Pick your handle" intro="This is your hydlnk.com address." />
      <div className="mt-7">
        <ClaimForm initialHandle={prefill} notice={notice} />
      </div>
      <div className="mt-6 text-sm text-text-2">
        <p>
          Signed in as{" "}
          <span className="font-semibold text-ink [overflow-wrap:anywhere]">{user.email}</span>. Not
          you?
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
