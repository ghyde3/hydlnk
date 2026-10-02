import type { Metadata } from "next";
import type { ReactNode } from "react";
import { HydlnkDocument } from "@/components/hydlnk-document";

export const metadata: Metadata = {
  title: {
    default: "HYDLNK — Link in bio, with real design control",
    template: "%s | HYDLNK",
  },
  description:
    "Block layouts, a full theme system and your own domain — so your link page looks like your brand, not ours.",
};

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return <HydlnkDocument>{children}</HydlnkDocument>;
}
