import { PlainNotFound } from "@/components/tenant/plain-not-found";

/**
 * The tenant group's 404 (custom-domain stub, unknown hosts): the plain panel. Static on purpose:
 * Next.js renders a not-found element into every page of its segment, so reading the Host header
 * here (as Milestone 1 did, to offer "Claim this handle") would make every tenant page dynamic and
 * uncacheable. The claim panel for an unclaimed handle lives in t/[handle]/(home)/layout.tsx, which
 * knows the handle from its params.
 */
export default function TenantNotFound() {
  return <PlainNotFound />;
}
