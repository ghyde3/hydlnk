import { clientEnv } from "@/lib/env/client";
import { ClaimForm } from "./claim-form";
import { PhoneMock } from "./phone-mock";
import { Container } from "./primitives";

const CHIP =
  "absolute hidden flex-col gap-0.5 rounded-md border border-line-2 bg-surface px-3 py-2.5 hl:flex";
const CHIP_LABEL = "font-mono text-[11px] tracking-[0.06em] text-text-3 uppercase";

/** Hero: copy and the handle claim on the left, a sample tenant page with token chips on the right. */
export function Hero() {
  return (
    <section className="border-b border-line bg-surface pt-[clamp(48px,10vw,88px)] pb-[clamp(56px,11vw,96px)]">
      <Container className="flex flex-wrap items-center gap-[clamp(36px,7vw,64px)]">
        <div className="min-w-0 flex-[1_1_520px]">
          <p className="inline-flex items-center gap-2 rounded-sm border border-line px-2.5 py-1.5 font-mono text-xs tracking-[0.08em] text-text-2 uppercase">
            <span aria-hidden="true" className="inline-block size-1.5 bg-brass" />
            Link in bio, with real design control
          </p>
          <h1 className="mt-6 text-[clamp(38px,8.5vw,60px)] leading-[1.04] font-bold tracking-[-0.03em]">
            One link. <br />
            Designed like <span className="text-brass-text">it’s yours.</span>
          </h1>
          <p className="mt-5 max-w-[520px] text-[clamp(16px,4.2vw,18px)] leading-[1.6] text-text-2">
            Block layouts, a full theme system and your own domain — so your link page looks like
            your brand, not ours.
          </p>
          <div className="mt-8">
            <ClaimForm id="hero-handle" rootDomain={clientEnv.NEXT_PUBLIC_ROOT_DOMAIN} />
          </div>
          <p className="mt-3.5 text-[13px] text-text-2">
            Free forever · No card required · Custom domains from $5/mo
          </p>
        </div>

        <div className="flex min-w-0 flex-[1_1_380px] justify-center">
          <div className="relative h-[620px] w-full max-w-[460px]">
            <PhoneMock />
            <div aria-hidden="true" className={`${CHIP} top-16 left-0`}>
              <span className={CHIP_LABEL}>fontHeading</span>
              <span className="text-[13px] font-semibold">Instrument Serif</span>
            </div>
            <div aria-hidden="true" className={`${CHIP} top-[190px] right-0`}>
              <span className={CHIP_LABEL}>accent</span>
              <span className="flex items-center gap-2 font-mono text-[13px]">
                <span className="inline-block size-3.5 rounded-[3px] bg-[#C9A86A]" />
                #C9A86A
              </span>
            </div>
            <div aria-hidden="true" className={`${CHIP} top-[404px] left-0`}>
              <span className={CHIP_LABEL}>radius</span>
              <span className="font-mono text-[13px]">12px</span>
            </div>
            <div aria-hidden="true" className={`${CHIP} top-[500px] right-0`}>
              <span className={CHIP_LABEL}>buttonStyle</span>
              <span className="font-mono text-[13px]">outline · fill on 1</span>
            </div>
          </div>
        </div>
      </Container>
    </section>
  );
}
