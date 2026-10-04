import { ExternalLink } from "lucide-react";
import { Icon } from "@/components/app/icon";
import { PortalButton } from "./portal-button";

/**
 * "Manage billing" (M4-07): the primary charcoal button with the external-link icon that opens
 * Stripe's customer portal. Show it to any account that has a Stripe customer id (a Free account
 * that once subscribed included); the endpoint answers 409 "Nothing to manage yet." without one.
 */
export function ManageBillingButton() {
  return (
    <PortalButton intent="manage" variant="primary">
      Manage billing
      <Icon icon={ExternalLink} size={14} />
    </PortalButton>
  );
}
