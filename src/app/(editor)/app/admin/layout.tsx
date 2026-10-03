import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { AdminShell } from "@/components/admin/admin-shell";
import { requireAdmin } from "@/lib/admin/auth";

export const metadata: Metadata = {
  title: { template: "%s — HYDLNK admin", default: "Admin — HYDLNK" },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

/**
 * Shell for /admin (M5-04), outside the `(screens)` group so it gets the admin chrome and not the
 * user's page switcher and plan card. `requireAdmin` sends a signed-out visitor to /login and gives
 * a signed-in non-admin the app's 404, identical to an unknown route, before anything renders. Every
 * admin page calls it too (a layout does not re-run on a soft navigation), and every admin mutation
 * is guarded again on the server (`executeAdminAction`).
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const admin = await requireAdmin();
  return <AdminShell email={admin.email}>{children}</AdminShell>;
}
