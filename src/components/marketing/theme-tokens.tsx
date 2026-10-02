import { ArrowLink, Eyebrow, H2, LEAD } from "./primitives";

// Noir's palette: tenant theme values shown as data, not HYDLNK tokens.
const NOIR_SWATCHES = ["#16120E", "#221B13", "#EFE8DC", "#A79E90", "#C9A86A"] as const;

const ROW = "grid grid-cols-[120px_minmax(0,1fr)] border-b border-line";
const LABEL = "px-4 py-3 text-text-2";
const MONO_VALUE = "px-4 py-3 font-mono text-[13px]";
const CHIP = "px-2.5 py-1 rounded-sm";

/** The resolve order, as four chips joined by arrows. */
export function ResolveChain() {
  return (
    <div className="flex flex-wrap items-center gap-2 font-mono text-[13px]">
      <span className={`${CHIP} border border-line-2 text-text-2`}>system</span>
      <span aria-hidden="true" className="text-text-3">
        →
      </span>
      <span className={`${CHIP} border border-line-2`}>theme</span>
      <span aria-hidden="true" className="text-text-3">
        →
      </span>
      <span className={`${CHIP} border border-line-2`}>page</span>
      <span aria-hidden="true" className="text-text-3">
        →
      </span>
      <span className={`${CHIP} border border-ink bg-ink text-surface`}>block</span>
    </div>
  );
}

/** One real theme (Noir) as a token card: 23 tokens in five groups. */
export function NoirTokenCard() {
  return (
    <div className="min-w-0 overflow-hidden rounded-md border border-line-2 bg-surface text-sm">
      <div className="flex items-center justify-between border-b border-line bg-page px-4 py-3">
        <span className="font-semibold">Theme · Noir</span>
        <span className="font-mono text-xs text-text-2">23 tokens</span>
      </div>
      <div className={ROW}>
        <span className={LABEL}>Color</span>
        <span className="flex flex-wrap items-center gap-1.5 px-4 py-2.5">
          {NOIR_SWATCHES.map((color, index) => (
            <span
              key={color}
              style={{ background: color }}
              className={`inline-block size-[22px] rounded-sm ${
                index === 2 ? "border border-line-2" : ""
              } ${index === 4 ? "outline-2 outline-offset-2 outline-ink" : ""}`}
            />
          ))}
        </span>
      </div>
      <div className={ROW}>
        <span className={LABEL}>Type</span>
        <span className={MONO_VALUE}>Instrument Serif / Geist</span>
      </div>
      <div className={ROW}>
        <span className={LABEL}>Shape</span>
        <span className={MONO_VALUE}>radius 12 · border 1</span>
      </div>
      <div className={ROW}>
        <span className={LABEL}>Buttons</span>
        <span className="flex flex-wrap gap-1.5 px-4 py-2 text-[13px]">
          <span className="rounded-sm bg-ink px-2.5 py-[5px] text-surface">Fill</span>
          <span className="rounded-sm border border-ink px-2.5 py-1">Outline</span>
          <span className="rounded-sm bg-page px-2.5 py-[5px]">Soft</span>
          <span className="rounded-sm bg-surface px-2.5 py-[5px] shadow-[2px_2px_0_var(--hl-ink)] ring-1 ring-ink">
            Shadow
          </span>
          <span className="rounded-[999px] bg-ink px-3 py-[5px] text-surface">Pill</span>
        </span>
      </div>
      <div className={ROW}>
        <span className={LABEL}>Spacing</span>
        <span className={MONO_VALUE}>regular · 480 · center</span>
      </div>
      <div className="grid grid-cols-[120px_minmax(0,1fr)]">
        <span className={LABEL}>Background</span>
        <span className={MONO_VALUE}>solid</span>
      </div>
    </div>
  );
}

/** Home: the theme system in one section, with the Noir token card on the right. */
export function ThemeTokens() {
  return (
    <div className="flex flex-wrap items-center gap-[clamp(36px,7vw,64px)]">
      <div className="min-w-0 flex-[1_1_420px]">
        <Eyebrow>The theme system</Eyebrow>
        <h2 id="design-title" className={`mt-3.5 ${H2}`}>
          Every choice is a token.
        </h2>
        <p className={`mt-4 ${LEAD}`}>
          Colour, type, shape, spacing and background are 23 tokens. Every block reads from them,
          which is why a theme can be saved, swapped and reused without anything breaking.
        </p>
        <Eyebrow className="mt-7">How a style resolves</Eyebrow>
        <div className="mt-3">
          <ResolveChain />
        </div>
        <p className="mt-3 text-sm leading-[1.6] text-text-2">
          Later wins. Block overrides cover colour, button style and radius, so pages stay coherent.
        </p>
        <ArrowLink href="/design-control" className="mt-4">
          Explore the design system
        </ArrowLink>
      </div>
      <div className="min-w-0 flex-[1_1_520px]">
        <NoirTokenCard />
      </div>
    </div>
  );
}
