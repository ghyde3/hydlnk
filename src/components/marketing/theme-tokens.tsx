// Noir's palette: tenant theme values shown as data, not HYDLNK UI colors.
const NOIR_SWATCHES = ["#16120E", "#221B13", "#EFE8DC", "#A79E90", "#C9A86A"] as const;

const ROW = "grid grid-cols-[120px_minmax(0,1fr)] border-b border-line";
const LABEL = "px-4 py-3 text-text-2";
const VALUE = "px-4 py-3 text-[13px]";
const CHIP = "px-2.5 py-1 rounded-sm";

/** Which choice wins, in order: the default, the theme, your page, then a single block. */
export function ResolveChain() {
  return (
    <div className="flex flex-wrap items-center gap-2 font-mono text-[13px]">
      <span className={`${CHIP} border border-line-2 text-text-2`}>HYDLNK default</span>
      <span aria-hidden="true" className="text-text-3">
        →
      </span>
      <span className={`${CHIP} border border-line-2`}>Theme</span>
      <span aria-hidden="true" className="text-text-3">
        →
      </span>
      <span className={`${CHIP} border border-line-2`}>Your page</span>
      <span aria-hidden="true" className="text-text-3">
        →
      </span>
      <span className={`${CHIP} border border-ink bg-ink text-surface`}>One block</span>
    </div>
  );
}

/** One real theme (Noir) as a card: its 23 settings in six groups, in plain words. */
export function NoirTokenCard() {
  return (
    <div className="min-w-0 overflow-hidden rounded-md border border-line-2 bg-surface text-sm">
      <div className="flex items-center justify-between border-b border-line bg-page px-4 py-3">
        <span className="font-semibold">Noir theme</span>
        <span className="font-mono text-xs text-text-2">23 settings</span>
      </div>
      <div className={ROW}>
        <span className={LABEL}>Colors</span>
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
        <span className={LABEL}>Fonts</span>
        <span className={VALUE}>Instrument Serif / Geist</span>
      </div>
      <div className={ROW}>
        <span className={LABEL}>Corners</span>
        <span className={VALUE}>Rounded · thin border</span>
      </div>
      <div className={ROW}>
        <span className={LABEL}>Buttons</span>
        <span className="flex flex-wrap gap-1.5 px-4 py-2 text-[13px]">
          <span className="rounded-sm bg-ink px-2.5 py-[5px] text-surface">Solid</span>
          <span className="rounded-sm border border-ink px-2.5 py-1">Outline</span>
          <span className="rounded-sm bg-page px-2.5 py-[5px]">Soft</span>
          <span className="rounded-sm bg-surface px-2.5 py-[5px] shadow-[2px_2px_0_var(--hl-ink)] ring-1 ring-ink">
            Shadow
          </span>
          <span className="rounded-[999px] bg-ink px-3 py-[5px] text-surface">Pill</span>
        </span>
      </div>
      <div className={ROW}>
        <span className={LABEL}>Layout</span>
        <span className={VALUE}>Regular spacing · centered</span>
      </div>
      <div className="grid grid-cols-[120px_minmax(0,1fr)]">
        <span className={LABEL}>Background</span>
        <span className={VALUE}>Flat color</span>
      </div>
    </div>
  );
}
