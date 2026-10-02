import { NORTHFOLD, SMOKE_PHOTO } from "../demo/brands";
import { DemoPage, PhoneFrame } from "../demo/demo-page";
import "./token-playground.css";

interface Group {
  name: string;
  legend: string;
  hint: string;
  options: { value: string; label: string }[];
}

const GROUPS: Group[] = [
  {
    name: "tp-theme",
    legend: "Theme",
    hint: "A complete set of 23 tokens.",
    options: [
      { value: "smoke", label: "Smoke" },
      { value: "noir", label: "Noir" },
      { value: "ivory", label: "Ivory" },
    ],
  },
  {
    name: "tp-button",
    legend: "buttonStyle",
    hint: "Overrides the theme’s button style.",
    options: [
      { value: "theme", label: "Theme" },
      { value: "fill", label: "Fill" },
      { value: "outline", label: "Outline" },
      { value: "soft", label: "Soft" },
      { value: "shadow", label: "Shadow" },
      { value: "pill", label: "Pill" },
    ],
  },
  {
    name: "tp-radius",
    legend: "radius",
    hint: "Corners on buttons, cards and tiles.",
    options: [
      { value: "theme", label: "Theme" },
      { value: "0", label: "0" },
      { value: "8", label: "8" },
      { value: "16", label: "16" },
      { value: "28", label: "28" },
    ],
  },
  {
    name: "tp-font",
    legend: "fontHeading",
    hint: "The name, headers and card titles.",
    options: [
      { value: "theme", label: "Theme" },
      { value: "fraunces", label: "Fraunces" },
      { value: "instrument", label: "Instrument Serif" },
      { value: "geist", label: "Geist" },
    ],
  },
  {
    name: "tp-bg",
    legend: "bgType",
    hint: "Solid colour, gradient or a photo.",
    options: [
      { value: "theme", label: "Theme" },
      { value: "solid", label: "Solid" },
      { value: "gradient", label: "Gradient" },
      { value: "image", label: "Image" },
    ],
  },
];

/**
 * The token playground: pick a theme, then override single tokens on top of it, and the demo
 * page follows. Plain radio groups and CSS (`:has()`), no JavaScript: the choices are real form
 * controls (keyboard and screen reader friendly), and the page they restyle is a decorative demo.
 * "Theme" in each group means no override, which is how the product resolves tokens too: the page's
 * own overrides win over its theme.
 */
export function TokenPlayground() {
  return (
    <div className="tp grid items-start gap-x-14 gap-y-10 min-[1024px]:grid-cols-[minmax(0,1fr)_auto]">
      <div className="flex flex-col gap-5">
        {GROUPS.map((group) => (
          <fieldset key={group.name} className="min-w-0">
            <legend className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="font-mono text-[13px] font-medium text-ink">{group.legend}</span>
              <span className="text-[13px] text-text-2">{group.hint}</span>
            </legend>
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {group.options.map((option, index) => (
                <label key={option.value} className="tp-option">
                  <input
                    type="radio"
                    name={group.name}
                    value={option.value}
                    defaultChecked={index === 0}
                    className="sr-only"
                  />
                  {option.label}
                </label>
              ))}
            </div>
          </fieldset>
        ))}
        <p className="text-sm leading-[1.6] text-text-2">
          This is how resolution works in the editor too: a theme sets every token, and anything
          you set on the page wins over it. Choose <span className="font-mono">Theme</span> to
          take an override off again.
        </p>
      </div>
      <figure className="flex flex-col items-center gap-3 justify-self-center">
        <PhoneFrame>
          <DemoPage brand={NORTHFOLD} theme={SMOKE_PHOTO} inlineTheme={false} />
        </PhoneFrame>
        <figcaption className="font-mono text-xs text-text-2">
          Northfold Studio, a demo page, restyled live
        </figcaption>
      </figure>
    </div>
  );
}
