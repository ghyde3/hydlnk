import { notFound } from "next/navigation";

/** Tenant pages have no sub-paths yet: /t/<handle>/anything is the plain tenant 404. */
export default function UnknownTenantPath(): never {
  notFound();
}
