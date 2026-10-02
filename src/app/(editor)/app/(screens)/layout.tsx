import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { AppShellFrame } from "@/components/app/app-shell-frame";
import { getAppContext } from "@/lib/pages/context";

// Every signed-in screen is titled "<Screen> — HYDLNK": a page exports `title: "Screen"` and this
// template adds the suffix. (Sign-in pages outside this group keep the root layout's template.)
export const metadata: Metadata = {
  title: { template: "%s — HYDLNK", default: "HYDLNK" },
};

// viewport-fit=cover lets the phone tab bar's env(safe-area-inset-bottom) padding take effect.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

/**
 * Shell for the signed-in screens (/editor, /design, /analytics, /domains, /settings). The gate
 * (requireAppUser, inside getAppContext) sends signed-out visitors to /login and users without a
 * page to /claim before anything renders.
 *
 * A layout does not re-run on a soft navigation between its pages, so it is not enough on its own
 * once a screen reads data: every screen that loads user data calls getAppContext() (or
 * requireAppUser()) itself, as /editor and /settings do.
 */
export default async function ScreensLayout({ children }: { children: ReactNode }) {
  const context = await getAppContext();
  return <AppShellFrame context={context}>{children}</AppShellFrame>;
}
