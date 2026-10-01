import type { Metadata } from "next";
import type { ReactNode } from "react";
import { HydlnkDocument } from "@/components/hydlnk-document";

export const metadata: Metadata = {
  title: { default: "HYDLNK", template: "%s | HYDLNK" },
  // The app host holds the editor and the sign-in pages; none of it belongs in a search index.
  robots: { index: false, follow: false },
};

export default function EditorRootLayout({ children }: { children: ReactNode }) {
  return <HydlnkDocument>{children}</HydlnkDocument>;
}
