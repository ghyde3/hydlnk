import { PlainNotFound } from "@/components/tenant/plain-not-found";

/** Sub-paths of a tenant host (/login, /editor, /auth/callback...) never offer to claim anything. */
export default function UnknownTenantPathNotFound() {
  return <PlainNotFound />;
}
