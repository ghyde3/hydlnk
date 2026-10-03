import { clientEnv } from "@/lib/env/client";
import { ClaimForm } from "./claim-form";
import { Container, H1 } from "./primitives";
import { Showreel } from "./showreel";

/**
 * Home hero: the h1 (the page's largest text and its LCP candidate), then the handle claim, then
 * the showreel in a fixed-ratio box below, so the video never moves the copy. The claim is the one
 * action on the first screen: a charcoal panel with a white field and a brass button, in the
 * right column on desktop and straight under the subhead on a phone.
 */
export function Hero() {
  return (
    <section
      aria-labelledby="hero-title"
      className="border-b border-line bg-surface pt-[clamp(32px,7vw,72px)] pb-[clamp(40px,8vw,72px)]"
    >
      <Container>
        <div className="grid gap-x-12 gap-y-7 min-[1080px]:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] min-[1080px]:items-center">
          <div className="min-w-0">
            <p className="inline-flex items-center gap-2 rounded-sm border border-line px-2.5 py-1.5 font-mono text-xs tracking-[0.08em] text-text-2 uppercase">
              <span aria-hidden="true" className="inline-block size-1.5 bg-brass" />
              Link in bio, with real design control
            </p>
            <h1 id="hero-title" className={`mt-5 ${H1}`}>
              One link. Designed like <span className="text-brass-text">it’s yours.</span>
            </h1>
            <p className="mt-5 max-w-[520px] text-[clamp(16px,4.2vw,18px)] leading-[1.55] text-pretty text-text-2">
              A link-in-bio page that looks like your brand, not ours. Pick your layout, colors and
              fonts, and connect your own domain on Pro.
            </p>
          </div>
          <div className="min-w-0">
            <ClaimForm id="hero-handle" rootDomain={clientEnv.NEXT_PUBLIC_ROOT_DOMAIN} />
          </div>
        </div>
        <div className="mt-[clamp(32px,6vw,56px)]">
          <Showreel label="Video preview, no sound: a HYDLNK page gets claimed, built one block at a time, restyled with a few different themes, then shown on a custom domain with its analytics." />
        </div>
      </Container>
    </section>
  );
}
