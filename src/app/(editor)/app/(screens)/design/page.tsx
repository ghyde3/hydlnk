import type { Metadata } from "next";
import { PlaceholderCard, ScreenBody, ScreenHeader } from "@/components/app/screen";

export const metadata: Metadata = { title: "Design" };

/** Placeholder until Milestone 3 builds the token panel; the title and breadcrumb stay. */
export default function DesignScreen() {
  return (
    <>
      <ScreenHeader breadcrumb="Theme · Default" title="Design" />
      <ScreenBody>
        <PlaceholderCard>Your theme and design tokens will appear here.</PlaceholderCard>
      </ScreenBody>
    </>
  );
}
