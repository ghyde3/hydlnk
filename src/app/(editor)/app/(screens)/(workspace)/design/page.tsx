import type { Metadata } from "next";
import { DesignTab } from "@/components/design/design-screen";
import { requireAppUser } from "@/lib/auth/gate";

export const metadata: Metadata = { title: "Design" };

/** The Design tab (M3-06, M7-02): the page's theme tokens. See the workspace layout. */
export default async function DesignPage() {
  await requireAppUser();
  return <DesignTab />;
}
