import { DEMO_BRANDS, type DemoTheme } from "./brands";
import { DemoPage, PhoneFrame } from "./demo-page";

const BUTTONS: Record<DemoTheme["buttonStyle"], string> = {
  fill: "solid buttons",
  outline: "outlined buttons",
  soft: "soft buttons",
  shadow: "shadow buttons",
  pill: "pill buttons",
};

const BACKGROUNDS: Record<DemoTheme["bgType"], string> = {
  solid: "flat background",
  gradient: "gradient background",
  image: "photo background",
};

/** What a visitor can see about the look, in plain words: "Fraunces headings · solid buttons". */
export function lookLine(theme: DemoTheme): string {
  return `${theme.fontHeading} headings · ${BUTTONS[theme.buttonStyle]} · ${BACKGROUNDS[theme.bgType]}`;
}

/**
 * The three demo brands side by side, each in its own system theme. On narrow screens the row
 * scrolls sideways inside itself (snap per phone); the region is focusable so keyboard users can
 * scroll it too. The page itself never scrolls sideways.
 */
export function DemoGallery() {
  return (
    <div>
      <div
        role="region"
        aria-label="Demo pages"
        tabIndex={0}
        className="-mx-6 flex snap-x snap-mandatory gap-6 overflow-x-auto px-6 pb-4 min-[1024px]:justify-center"
      >
        {DEMO_BRANDS.map((brand) => (
          <figure
            key={brand.id}
            className="flex w-[290px] shrink-0 snap-center flex-col items-center gap-4"
          >
            <PhoneFrame>
              <DemoPage brand={brand} badge={brand.id === "fennmoor"} />
            </PhoneFrame>
            <figcaption className="flex flex-col items-center gap-1 text-center">
              <span className="text-sm font-semibold">
                {brand.name} <span className="font-normal text-text-2">· {brand.theme.name}</span>
              </span>
              <span className="text-balance font-mono text-xs leading-[1.6] text-text-2">
                {lookLine(brand.theme)}
              </span>
            </figcaption>
          </figure>
        ))}
      </div>
      <p className="mt-4 text-center font-mono text-xs text-text-3">
        Demo pages for fictional brands. The themes are HYDLNK’s own.
      </p>
    </div>
  );
}
