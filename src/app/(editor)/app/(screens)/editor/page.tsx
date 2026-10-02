import type { Metadata } from "next";
import { PlaceholderCard, ScreenBody, ScreenHeader } from "@/components/app/screen";
import { getAppContext } from "@/lib/pages/context";
import { handleAddress } from "@/lib/pages/plans";

export const metadata: Metadata = { title: "Editor" };

/** Placeholder until Milestone 2 builds the editor; the title and breadcrumb stay. */
export default async function EditorScreen() {
  const { current } = await getAppContext();
  return (
    <>
      <ScreenHeader breadcrumb={`${handleAddress(current.handle)} / main`} title="Main page" />
      <ScreenBody>
        <PlaceholderCard>Your profile and blocks will appear here.</PlaceholderCard>
      </ScreenBody>
    </>
  );
}
