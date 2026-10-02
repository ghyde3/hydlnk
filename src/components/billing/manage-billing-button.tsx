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
      <svg
        viewBox="0 0 24 24"
        width={14}
        height={14}
        aria-hidden="true"
        focusable="false"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M14 4h6v6" />
        <path d="M20 4l-9 9" />
        <path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
      </svg>
    </PortalButton>
  );
}
