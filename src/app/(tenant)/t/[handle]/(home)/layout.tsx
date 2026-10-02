import type { ReactNode } from "react";
import { AddressPanel } from "@/components/tenant/address-panel";
import { PlainNotFound } from "@/components/tenant/plain-not-found";
import { UnavailablePanel } from "@/components/tenant/unavailable-panel";
import { UnclaimedPanel } from "@/components/tenant/unclaimed-panel";
import { checkHandle } from "@/lib/handles/availability";
import type { HandleStatus } from "@/lib/handles/status";
import { getTenantPageState } from "../../../published-page";

/**
 * Wraps only the tenant home page (not /t/[handle]/anything). For a published or unpublished
 * handle it is transparent. For a handle with nothing to show (page.tsx answers with notFound(),
 * so the status is 404) it draws the 404 itself: the Milestone 1 "This address isn't claimed."
 * panel with a way to claim a free handle, or the plain 404 for a reserved, malformed or
 * suspended one. A suspended owner's page gets "This page isn’t available." (M5-08). It runs while
 * the page is generated, so the Host header is never read.
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
  // A suspended owner (M5-08): the handle is held, so never the claim panel, and never any content.
  if (state.kind === "suspended") {
    return (
      <>
        <UnavailablePanel />
        {children}
      </>
    );
  }
  if (state.kind !== "missing") return children;

  let status: HandleStatus | null = null;
  try {
    status = (await checkHandle(handle)).status;
  } catch (error) {
    console.error("[tenant] availability lookup for the 404 page failed", error);
  }
  // A reserved or malformed address says so (M5-20) and never offers to claim it.
  const panel =
    status === "available" ? (
      <UnclaimedPanel handle={handle} />
    ) : status === "reserved" ? (
      <AddressPanel kind="reserved" />
    ) : status === "short" || status === "too_long" || status === "invalid" ? (
      <AddressPanel kind="invalid" />
    ) : (
      <PlainNotFound />
    );
  return (
    <>
      {panel}
      {children}
    </>
  );
}
