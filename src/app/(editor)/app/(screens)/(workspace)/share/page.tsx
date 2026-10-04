import type { Metadata } from "next";
import { ShareTab } from "@/components/workspace/share/share-tab";
import { requireAppUser } from "@/lib/auth/gate";

export const metadata: Metadata = { title: "Share" };

/**
 * The Share tab (M7-04): the page's address, share card, QR code and private preview links.
 * Exactly `/share` is this signed-in screen; `/share/{token}` is the ungated private preview of
 * M6-10, which the proxy rewrites to `/app/shared-draft` (src/lib/previews/share-headers.ts).
 */
export default async function SharePage() {
  await requireAppUser();
  return <ShareTab />;
}
