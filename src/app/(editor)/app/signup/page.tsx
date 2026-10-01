import Link from "next/link";
import type { Metadata } from "next";
import { Logo } from "@/components/logo";
import { clientEnv } from "@/lib/env/client";

export const metadata: Metadata = { title: "Sign up" };

/** Placeholder for the sign-up screen. The landing page's claim form lands here with ?handle=. */
export default async function SignupPage({ searchParams }: PageProps<"/app/signup">) {
  const { handle } = await searchParams;
  const requested = (Array.isArray(handle) ? handle[0] : handle)?.trim().slice(0, 64);

  return (
    <div className="flex min-h-dvh flex-col">
      <div className="flex min-h-14 items-center bg-ink px-4 text-on-ink hl:px-6">
        <Link href="/" aria-label="HYDLNK home" className="inline-flex min-h-11 items-center">
          <Logo />
        </Link>
      </div>
      <main className="mx-auto w-full max-w-[640px] flex-1 p-4 hl:p-8">
        <div className="rounded-md border border-line bg-surface p-5">
          <h1 className="text-[22px] leading-[1.2] font-bold tracking-[-0.01em]">Sign up</h1>
          <p className="mt-3 font-mono text-xs tracking-[0.08em] text-text-2 uppercase">Handle</p>
          <p className="mt-1 font-mono text-base break-all">
            {requested
              ? `${requested}.${clientEnv.NEXT_PUBLIC_ROOT_DOMAIN}`
              : "No handle chosen yet"}
          </p>
          <p className="mt-4 text-[15px] leading-relaxed text-text-2">
            Sign-up arrives in Milestone 1. Your handle will be checked and claimed there.
          </p>
        </div>
      </main>
    </div>
  );
}
