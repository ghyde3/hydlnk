import { clientEnv } from "@/lib/env/client";
import { perMonthBilledYearlyText } from "@/lib/marketing/prices";
import { ClaimForm } from "./claim-form";
import { Container, H1 } from "./primitives";
import { Showreel } from "./showreel";

/**
 * Home hero: the h1 (the page's largest text and its LCP candidate) and the handle claim first,
 * then the showreel in a fixed-ratio box below, so the video never moves the copy.
 */
export function Hero() {
  return (
    <section
      aria-labelledby="hero-title"
      className="border-b border-line bg-surface pt-[clamp(40px,8vw,72px)] pb-[clamp(40px,8vw,72px)]"
    >
      <Container>
        <div className="grid gap-x-12 gap-y-6 min-[1080px]:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] min-[1080px]:items-end">
          <div className="min-w-0">
            <p className="inline-flex items-center gap-2 rounded-sm border border-line px-2.5 py-1.5 font-mono text-xs tracking-[0.08em] text-text-2 uppercase">
              <span aria-hidden="true" className="inline-block size-1.5 bg-brass" />
              Link in bio, with real design control
            </p>
            <h1 id="hero-title" className={`mt-6 ${H1}`}>
              One link. Designed like <span className="text-brass-text">it’s yours.</span>
            </h1>
          </div>
          <div className="min-w-0">
            <p className="max-w-[520px] text-[clamp(16px,4.2vw,18px)] leading-[1.6] text-text-2">
              Block layouts, a full theme system and your own domain — so your link page looks like
              your brand, not ours.
            </p>
            <div className="mt-6">
              <ClaimForm id="hero-handle" rootDomain={clientEnv.NEXT_PUBLIC_ROOT_DOMAIN} />
            </div>
            <p className="mt-3.5 text-[13px] text-text-2">
              Free forever · No card required · Bring your own domain from{" "}
              {perMonthBilledYearlyText("pro")}
            </p>
          </div>
        </div>
        <div className="mt-[clamp(32px,6vw,56px)]">
          <Showreel label="Showreel: a HYDLNK page is claimed, built block by block, restyled through several themes by changing its tokens, then shown on a custom domain with its analytics. No sound." />
        </div>
      </Container>
    </section>
  );
}
