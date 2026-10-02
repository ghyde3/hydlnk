import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { HydlnkDocument } from "@/components/hydlnk-document";
import { clientEnv } from "@/lib/env/client";
import { rootOrigin } from "@/lib/routing/urls";

export const metadata: Metadata = {
  // Canonical and Open Graph URLs are written relative to the root host (hydlnk.com in production).
  metadataBase: new URL(rootOrigin(clientEnv.NEXT_PUBLIC_ROOT_DOMAIN)),
  title: {
    default: "HYDLNK — Link in bio, with real design control",
    template: "%s | HYDLNK",
  },
  description:
    "Block layouts, a full theme system and your own domain — so your link page looks like your brand, not ours.",
  applicationName: "HYDLNK",
};

export const viewport: Viewport = {
  themeColor: "#1C1B1A",
};

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return <HydlnkDocument>{children}</HydlnkDocument>;
}
