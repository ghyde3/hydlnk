import type { Metadata } from "next";
import type { ReactNode } from "react";
import { HydlnkDocument } from "@/components/hydlnk-document";

/**
 * The root layout of the shared preview (M6-10): a route group of its own, not part of `(editor)`.
 * A share link draws a draft that never went through Publish, to anyone holding the link, on the app
 * host. Next.js draws the root `not-found.tsx` and `error.tsx` of a route's group into the payload of
 * every request for it, so if this route sat in `(editor)` the app's own 404 (which reads the
 * signed-in session to draw the app shell) would run on every share request, and the editor's client
 * code would be on the road to it. Here the share route has its own 404 and its own error page, none
 * of which reads a session, and its tree has nothing of the signed-in app in it.
 *
 * The URL is unchanged: route groups add no path segment, so the proxy still rewrites /share/* to
 * /app/share (src/lib/previews/share-proxy.ts).
 */
export const metadata: Metadata = {
  title: "HYDLNK",
  // A shared draft is never for a search index.
  robots: { index: false, follow: false },
};

export default function ShareRootLayout({ children }: { children: ReactNode }) {
  return <HydlnkDocument>{children}</HydlnkDocument>;
}
