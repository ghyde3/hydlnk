import type { Metadata } from "next";
import { ScreenBody, ScreenHeader } from "@/components/app/screen";
import { CustomDomainCard } from "@/components/domains/custom-domain-card";
import { DomainCard } from "@/components/domains/domain-card";
import { HydlnkAddressCard } from "@/components/domains/hydlnk-address-card";
import type { PageOption } from "@/components/domains/page-options";
import { StudioUpsell } from "@/components/domains/studio-upsell";
import { showsStudioUpsell } from "@/components/domains/view-model";
import { loadAccountUsage } from "@/lib/limits/usage";
import { getAppContext } from "@/lib/pages/context";
import { handleAddress } from "@/lib/pages/plans";
import { loadDomainCards } from "./load-domains";

export const metadata: Metadata = { title: "Domains" };

/**
 * Domains (Domains.dc.html, M4-10, M4-14 .. M4-17, M5-18). Top to bottom: "Your HYDLNK address"
 * (the current page's), the Custom domain card (usage line and the add form, or the locked state on
 * Free), one card per custom domain across the whole account, and for a Pro account the Studio
 * strip.
 *
 * The gate runs first (`getAppContext`, which sends a signed-out request to sign-in before anything
 * below is read). Everything shown is the signed-in user's own: the domains come from the
 * account-keyed server query, the usage number from the server's usage function, and another
 * account's domains never reach this page. The plan only decides what is offered; the server
 * actions and the database enforce the limit on write.
 */
export default async function DomainsScreen() {
  const { user, pages, current, plan } = await getAppContext();
  const [usage, cards] = await Promise.all([loadAccountUsage(user.id), loadDomainCards(user.id)]);
  const options: PageOption[] = pages.map((page) => ({
    id: page.id,
    address: handleAddress(page.handle),
    published: page.published_at !== null,
  }));

  return (
    <>
      <ScreenHeader breadcrumb="Where your page lives" title="Domains" />
      <ScreenBody>
        <HydlnkAddressCard handle={current.handle} published={current.published_at !== null} />
        <CustomDomainCard
          plan={plan}
          used={usage.domains}
          pages={options}
          currentPageId={current.id}
        />
        {cards.map(({ domain, stale }) => (
          <DomainCard key={domain.id} domain={domain} pages={options} stale={stale} />
        ))}
        {showsStudioUpsell(plan) ? <StudioUpsell /> : null}
      </ScreenBody>
    </>
  );
}
