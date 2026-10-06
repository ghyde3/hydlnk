import type { Metadata } from "next";
import { EditTab } from "@/components/editor/editor-screen";
import { requireAppUser } from "@/lib/auth/gate";

export const metadata: Metadata = { title: "Editor" };

/**
 * The Edit tab (M7-02): the profile, the "Add a block" card and the blocks. The draft and everything
 * around it (toolbar, preview, notices) belong to the workspace layout, which read them once. A
 * layout does not re-run on a soft navigation between tabs, so this page runs the sign-in gate
 * itself: a session that ended since the workspace opened sends the visitor to /login.
 */
export default async function EditPage() {
  await requireAppUser();
  return <EditTab />;
}
