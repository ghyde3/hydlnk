import type { ReactNode } from "react";
import "./tenant.css";

/**
 * Root layout for tenant pages (/t/[handle], /sites/[pageId]). Deliberately separate from the
 * HYDLNK UI layouts: no globals.css, no HYDLNK fonts, no --hl-* variables. A tenant page is styled
 * by its own --t-* variables and by tenant.css, and by nothing else.
 */
export default function TenantRootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
