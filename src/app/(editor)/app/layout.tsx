import type { ReactNode } from "react";
import { ErrorMonitor } from "@/components/app/error-monitor";

/**
 * The app host's layout (everything under src/app/(editor)/app/): it passes its children through
 * and mounts the one component that starts Sentry in the browser when a DSN is set (M9-10). The
 * marketing site, the tenant pages and the share page are other route groups and never reach it.
 */
export default function AppHostLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <ErrorMonitor />
      {children}
    </>
  );
}
