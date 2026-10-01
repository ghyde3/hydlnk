import { NotFoundPanel } from "@/components/not-found-panel";
import { SiteFooter } from "@/components/marketing/site-footer";
import { SiteHeader } from "@/components/marketing/site-header";

export default function MarketingNotFound() {
  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />
      <NotFoundPanel />
      <SiteFooter />
    </div>
  );
}
