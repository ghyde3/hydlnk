import { FENNMOOR, NORTHFOLD, WRENHAVEN, type DemoBrand, type DemoTheme } from "../demo/brands";
import { DemoPage, PhoneFrame } from "../demo/demo-page";
import { ADDRESS_SUFFIX } from "./address";
import { LOOK_FONT_VARIABLES } from "./fonts";
import { phoneVars } from "./looks";

/**
 * Three demo people, each on a painted wall, with their demo brand's page restyled to that wall's
 * three colors in a phone over the picture's corner. The portraits were generated with Higgsfield
 * (prompts embedded in the PNG sources in assets/portrait-sources/) and are labeled as demos. The palettes were sampled from the
 * walls and adjusted only where a text pair needed WCAG AA.
 */
interface Person {
  brand: DemoBrand;
  role: string;
  /** File stem in public/marketing/portraits: <stem>-480 and <stem>-960, AVIF and WebP. */
  portrait: string;
  alt: string;
  theme: DemoTheme;
}

function painted(
  brand: DemoBrand,
  colors: Pick<
    DemoTheme,
    "bg" | "surface" | "text" | "textMuted" | "accent" | "buttonBg" | "buttonText" | "border"
  >,
): DemoTheme {
  return { ...brand.theme, ...colors, buttonStyle: "fill", bgType: "solid" };
}

const PEOPLE: readonly Person[] = [
  {
    brand: FENNMOOR,
    role: "Pottery studio",
    portrait: "portrait-ceramicist",
    alt: "Demo portrait: a ceramicist in plum overalls and an olive T-shirt holds a small stoneware cup in front of an ochre wall.",
    theme: painted(FENNMOOR, {
      bg: "#D69849",
      surface: "#C98B40",
      text: "#35340F",
      textMuted: "#35340F",
      accent: "#5E2D47",
      buttonBg: "#5E2D47",
      buttonText: "#F6E6CB",
      border: "#A97535",
    }),
  },
  {
    brand: WRENHAVEN,
    role: "Coffee roaster",
    portrait: "portrait-roaster",
    alt: "Demo portrait: a coffee roaster in a brick-red shirt and a cream apron holds a bag of coffee in front of a deep teal wall.",
    theme: painted(WRENHAVEN, {
      bg: "#2A5055",
      surface: "#335C61",
      text: "#F1E6D2",
      textMuted: "#D9CFBC",
      accent: "#A44A33",
      buttonBg: "#A44A33",
      buttonText: "#F1E6D2",
      border: "#4A6E72",
    }),
  },
  {
    brand: NORTHFOLD,
    role: "Photographer",
    portrait: "portrait-photographer",
    alt: "Demo portrait: a photographer in a navy coat and sand trousers holds a camera in front of a brick-red wall.",
    theme: painted(NORTHFOLD, {
      bg: "#9C4838",
      surface: "#8E4030",
      text: "#F0DFC0",
      textMuted: "#F0DFC0",
      accent: "#1A2542",
      buttonBg: "#1A2542",
      buttonText: "#F0DFC0",
      border: "#B76655",
    }),
  },
];

const PORTRAITS = "/marketing/portraits";

/** A third of the container on desktop, the full column below 900px. */
const CARD_SIZES = "(min-width: 1240px) 380px, (min-width: 900px) 31vw, calc(100vw - 32px)";

/**
 * The three people as cards in HYDLNK's own frame: white, a 1px line, 6px corners, Public Sans.
 * Only the picture and the phone inside each card wear the person's brand.
 */
export function PeopleGallery() {
  return (
    <ul className={`grid gap-3 min-[900px]:grid-cols-3 ${LOOK_FONT_VARIABLES}`}>
      {PEOPLE.map(({ brand, role, portrait, alt, theme }, index) => (
        <li
          key={brand.id}
          className="overflow-hidden rounded-md border border-line bg-surface"
        >
          <figure className="m-0">
            <div className="hm-person-frame">
              {/* Plain responsive files, not the image optimizer (tests/unit/media-static.test.ts). */}
              <picture>
                <source
                  type="image/avif"
                  srcSet={`${PORTRAITS}/${portrait}-480.avif 480w, ${PORTRAITS}/${portrait}-960.avif 960w`}
                  sizes={CARD_SIZES}
                />
                <source
                  type="image/webp"
                  srcSet={`${PORTRAITS}/${portrait}-480.webp 480w, ${PORTRAITS}/${portrait}-960.webp 960w`}
                  sizes={CARD_SIZES}
                />
                <img
                  src={`${PORTRAITS}/${portrait}-960.webp`}
                  alt={alt}
                  width={960}
                  height={1034}
                  loading={index === 0 ? "eager" : "lazy"}
                  decoding="async"
                  className="hm-person-portrait"
                />
              </picture>
              <div aria-hidden="true" className="hm-person-phone">
                <PhoneFrame>
                  <span className="hm-person-bar" style={{ background: theme.bg, color: theme.text }}>
                    {brand.handle}
                    {ADDRESS_SUFFIX}
                  </span>
                  <div className="hm-person-page" style={phoneVars(theme)}>
                    <DemoPage brand={brand} theme={theme} inlineTheme={false} />
                  </div>
                </PhoneFrame>
              </div>
            </div>
            <figcaption className="flex items-baseline justify-between gap-3 px-[18px] py-3.5">
              <span className="text-[15px] font-semibold">{brand.name}</span>
              <span className="text-sm text-text-2">{role}, demo</span>
            </figcaption>
          </figure>
        </li>
      ))}
    </ul>
  );
}
