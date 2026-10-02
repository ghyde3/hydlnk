import type { Metadata } from "next";
import { CtaBand } from "@/components/marketing/cta-band";
import { DomainAnalytics } from "@/components/marketing/domain-analytics";
import { Faq } from "@/components/marketing/faq";
import { Features } from "@/components/marketing/features";
import { Hero } from "@/components/marketing/hero";
import { Pricing } from "@/components/marketing/pricing";
import { SiteFooter } from "@/components/marketing/site-footer";
import { SiteHeader } from "@/components/marketing/site-header";
import { ThemeTokens } from "@/components/marketing/theme-tokens";

export const metadata: Metadata = {
  title: { absolute: "HYDLNK — Link in bio, with real design control" },
  description:
    "Block layouts, a full theme system and your own domain — so your link page looks like your brand, not ours.",
};

export default function HomePage() {
  return (
    <div id="top" className="flex min-h-dvh flex-col bg-surface">
      <SiteHeader landing />
      <main className="flex-1">
        <Hero />
        <Features />
        <ThemeTokens />
        <DomainAnalytics />
        <Pricing />
        <Faq />
        <CtaBand />
      </main>
      <SiteFooter />
    </div>
  );
}
