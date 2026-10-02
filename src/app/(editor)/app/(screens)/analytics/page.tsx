import type { Metadata } from "next";
import { PlaceholderCard, ScreenBody, ScreenHeader } from "@/components/app/screen";

export const metadata: Metadata = { title: "Analytics" };

/** Placeholder until Milestone 4 builds the dashboard; the title and breadcrumb stay. */
export default function AnalyticsScreen() {
  return (
    <>
      <ScreenHeader breadcrumb="Last 30 days · No data yet" title="Analytics" />
      <ScreenBody>
        <PlaceholderCard>Views, clicks and referrers will appear here.</PlaceholderCard>
      </ScreenBody>
    </>
  );
}
