import type { Metadata } from "next";
import { PlaceholderCard, ScreenBody, ScreenHeader } from "@/components/app/screen";

export const metadata: Metadata = { title: "Domains" };

/** Placeholder until Milestone 4 builds the domain flow; the title and breadcrumb stay. */
export default function DomainsScreen() {
  return (
    <>
      <ScreenHeader breadcrumb="Where your page lives" title="Domains" />
      <ScreenBody>
        <PlaceholderCard>
          Your hydlnk.com address and custom domain will appear here.
        </PlaceholderCard>
      </ScreenBody>
    </>
  );
}
