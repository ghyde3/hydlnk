import type { ReactNode } from "react";
import { PlainNotFound } from "@/components/tenant/plain-not-found";
import { UnclaimedPanel } from "@/components/tenant/unclaimed-panel";
import { checkHandle } from "@/lib/handles/availability";
import { getTenantPageState } from "../../../published-page";

/**
 * Wraps only the tenant home page (not /t/[handle]/anything). For a published or unpublished
 * handle it is transparent. For a handle with nothing to show (page.tsx answers with notFound(),
 * so the status is 404) it draws the 404 itself: the Milestone 1 "This address isn't claimed."
 * panel with a way to claim a free handle, or the plain 404 for a reserved, malformed or
 * suspended one. It runs while the page is generated, so the Host header is never read.
 */
export default async function HomeLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ handle: string }>;
}) {
  const { handle } = await params;
  const state = await getTenantPageState(handle);
  if (state.kind !== "missing") return children;

  let claimable = false;
  try {
    claimable = (await checkHandle(handle)).status === "available";
  } catch (error) {
    console.error("[tenant] availability lookup for the 404 page failed", error);
  }
  return (
    <>
      {claimable ? <UnclaimedPanel handle={handle} /> : <PlainNotFound />}
      {children}
    </>
  );
}
