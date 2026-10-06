import { preload } from "react-dom";
import { clientEnv } from "@/lib/env/client";
import { ClaimForm } from "../claim-form";
import { DemoPage, PhoneFrame } from "../demo/demo-page";
import { Container, H1 } from "../primitives";
import { ADDRESS_SUFFIX } from "./address";
import { LOOK_FONT_VARIABLES } from "./fonts";
import { LiveHandle, SpecimenLine } from "./live-handle";
import { DemoPhoneName, LookCycle } from "./look-cycle";
import { LOOKS, OPENING_LOOK, lookPaletteVars, phoneVars } from "./looks";

/** The opening look's pictures, fetched with the page so its phone is whole on first paint. */
function preloadFirstLook() {
  const { brand } = OPENING_LOOK;
  const names = [
    brand.avatar.image,
    ...brand.blocks.flatMap((block) =>
      block.type === "card" || block.type === "image" ? [block.image] : [],
    ),
  ].slice(0, 3);
  for (const name of names) {
    preload(`/marketing/demo/${name}.avif`, {
      as: "image",
      type: "image/avif",
      fetchPriority: "high",
    });
  }
}

/** The phone's accessible name per look, e.g. "Demo page: Fennmoor Ceramics in Ivory". */
const PHONE_LABELS: Readonly<Record<string, string>> = Object.fromEntries(
  LOOKS.map(({ brand, theme }) => [brand.id, `Demo page: ${brand.name} in ${theme.name}`]),
);

/**
 * Home hero. HYDLNK's own frame is the page: the h1, the subhead, the charcoal claim panel and the
 * look tabs stay in HYDLNK's colors and Public Sans whatever look is picked. Only the stage (a
 * bounded window beside them) wears the look: the visitor's address set huge in the look's own face
 * and the demo page in the phone. Typing in the claim field replaces "you" in both.
 *
 * The look tabs are radio buttons, and home.css restyles the stage from the checked one with :has(),
 * so switching works without JavaScript and the arrow keys move between looks. With JavaScript the
 * looks also advance on their own (look-cycle.tsx), with a cobalt bar filling under the active tab and
 * a Pause control beside them.
 */
export function Hero() {
  preloadFirstLook();

  return (
    <section
      aria-labelledby="hero-title"
      className={`sp-hero border-b border-line bg-surface pt-[clamp(32px,7vw,72px)] pb-[clamp(40px,8vw,72px)] ${LOOK_FONT_VARIABLES}`}
      style={lookPaletteVars()}
    >
      <Container>
        <div className="grid gap-x-12 gap-y-8 min-[1080px]:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] min-[1080px]:items-center">
          <div className="min-w-0">
            <p className="inline-flex items-center gap-2 rounded-sm border border-line px-2.5 py-1.5 font-mono text-xs tracking-[0.08em] text-text-2 uppercase">
              <span aria-hidden="true" className="inline-block size-1.5 bg-brass" />
              Link in bio, with real design control
            </p>
            <h1 id="hero-title" className={`mt-5 ${H1}`}>
              One link. Designed like <span className="text-accent-text">it’s yours.</span>
            </h1>
            <p className="mt-5 max-w-[520px] text-[clamp(16px,4.2vw,18px)] leading-[1.55] text-pretty text-text-2">
              A link-in-bio page that looks like your brand, not ours. Pick your layout, colors and
              fonts, and connect your own domain on Pro.
            </p>
            <div className="mt-7">
              <ClaimForm id="hero-handle" rootDomain={clientEnv.NEXT_PUBLIC_ROOT_DOMAIN} />
            </div>
            <p className="mt-3 text-sm leading-5 text-text-2">
              Claim your name in seconds, publish in minutes.
            </p>

            <div className="sp-looks">
              <span id="sp-looks-label" className="sp-looks-label">
                Pick a look
              </span>
              <div role="radiogroup" aria-labelledby="sp-looks-label" className="sp-tabs-row">
                {LOOKS.map(({ brand, theme, face }, index) => (
                  <label key={brand.id} className="sp-tab">
                    <input
                      type="radio"
                      name="sp-look"
                      id={`sp-look-${brand.id}`}
                      value={brand.id}
                      defaultChecked={index === 0}
                      className="sr-only"
                    />
                    <span
                      aria-hidden="true"
                      className="sp-tab-glyph"
                      style={{
                        background: theme.bg,
                        color: theme.text,
                        borderColor: theme.border,
                        fontFamily: face.family,
                        fontWeight: face.weight,
                      }}
                    >
                      Aa
                    </span>
                    <span className="sp-tab-name">{theme.name}</span>
                    <span aria-hidden="true" className="sp-tab-bar" />
                  </label>
                ))}
              </div>
              <LookCycle />
            </div>
          </div>

          <div className="hm-stage">
            <SpecimenLine faces={LOOKS.map((look) => look.face)} className="hm-stage-line" />
            <DemoPhoneName
              labels={PHONE_LABELS}
              initial={OPENING_LOOK.brand.id}
              className="hm-stage-phone"
            >
              <PhoneFrame className="sp-phone">
                <span className="sp-phone-bar">
                  <LiveHandle />
                  {ADDRESS_SUFFIX}
                </span>
                <div className="sp-phone-pages">
                  {LOOKS.map(({ brand, theme }) => (
                    <div
                      key={brand.id}
                      data-look={brand.id}
                      className="sp-phone-page"
                      style={phoneVars(theme)}
                    >
                      <DemoPage brand={brand} inlineTheme={false} badge />
                    </div>
                  ))}
                </div>
              </PhoneFrame>
            </DemoPhoneName>
          </div>
        </div>
      </Container>
    </section>
  );
}
