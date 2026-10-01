import { ClaimForm } from "@/components/marketing/claim-form";
import { SiteFooter } from "@/components/marketing/site-footer";
import { SiteHeader } from "@/components/marketing/site-header";

export default function HomePage() {
  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />
      <main className="flex-1 bg-surface">
        <section className="mx-auto max-w-[1200px] px-4 py-12 hl:px-6 hl:py-24">
          <div className="max-w-[720px]">
            <p className="inline-flex items-center gap-2 rounded-sm border border-line px-2.5 py-1.5 font-mono text-xs tracking-[0.08em] text-text-2 uppercase">
              <span aria-hidden="true" className="inline-block size-1.5 bg-brass" />
              Link in bio, with real design control
            </p>
            <h1 className="mt-6 text-[clamp(38px,6vw,60px)] leading-[1.04] font-bold tracking-[-0.03em]">
              One link.
              <br />
              Designed like <span className="text-brass-text">it’s yours.</span>
            </h1>
            <p className="mt-5 max-w-[520px] text-[clamp(16px,2.4vw,18px)] leading-relaxed text-text-2">
              Block layouts, a full theme system and your own domain, so your link page looks like
              your brand, not ours.
            </p>
            <div className="mt-8">
              <ClaimForm id="hero-handle" />
            </div>
            <p className="mt-3.5 text-[13px] text-text-2">
              Free forever · No card required · Custom domains from $5/mo
            </p>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
