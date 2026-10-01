import type { ReactNode } from "react";
import { Chip, Container, Eyebrow, H2, LEAD, SECTION_Y } from "./primitives";

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="size-5 fill-none stroke-current stroke-[1.8]"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

const FEATURES: { title: string; body: string; pro?: boolean; icon: ReactNode }[] = [
  {
    title: "Blocks, not just buttons",
    body: "Link buttons, cards, headers, text, images, video and music embeds, social rows and two-column grids, in any order.",
    icon: (
      <Icon>
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
      </Icon>
    ),
  },
  {
    title: "A real theme system",
    body: "Colors, type, shape, spacing and backgrounds are tokens. Change one and the whole page follows.",
    icon: (
      <Icon>
        <path d="M4 6h16" />
        <path d="M4 12h16" />
        <path d="M4 18h16" />
        <circle cx="9" cy="6" r="2" />
        <circle cx="15" cy="12" r="2" />
        <circle cx="7" cy="18" r="2" />
      </Icon>
    ),
  },
  {
    title: "Saved themes",
    body: "Save a look once and apply it to any page, or start from a set of house themes.",
    icon: (
      <Icon>
        <path d="M12 3l9 5-9 5-9-5 9-5z" />
        <path d="M3 13l9 5 9-5" />
      </Icon>
    ),
  },
  {
    title: "Per-link analytics",
    body: "Views, clicks and click-through for every link on the free plan — not just one total.",
    icon: (
      <Icon>
        <path d="M4 20V11" />
        <path d="M10 20V4" />
        <path d="M16 20v-7" />
        <path d="M21 20H3" />
      </Icon>
    ),
  },
  {
    title: "Your own domain",
    body: "Serve your page from links.yourbrand.com. Set one DNS record and SSL is issued automatically.",
    pro: true,
    icon: (
      <Icon>
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18" />
        <path d="M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9s1.3-6.4 3.8-9z" />
      </Icon>
    ),
  },
  {
    title: "Fast and cookie-free",
    body: "Pages are cached at the edge, and analytics use no cookies — so visitors never see a consent banner.",
    icon: (
      <Icon>
        <path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z" />
      </Icon>
    ),
  },
];

/** #features: what every plan gets. Six cards, single column on phones, three columns on desktop. */
export function Features() {
  return (
    <section id="features" className={`border-b border-line bg-surface ${SECTION_Y}`}>
      <Container>
        <div className="max-w-[720px]">
          <Eyebrow>Free on every plan</Eyebrow>
          <h2 className={`mt-3.5 ${H2}`}>Design control is the product, so it’s free.</h2>
          <p className={`mt-4 ${LEAD}`}>
            Every plan gets every block and the whole theme system. You pay for your own domain or
            more pages — never to make your page look good.
          </p>
        </div>
        <div className="mt-10 grid grid-cols-[repeat(auto-fit,minmax(min(100%,320px),1fr))] gap-3">
          {FEATURES.map((feature) => (
            <article
              key={feature.title}
              className="flex flex-col gap-2.5 rounded-md border border-line bg-surface p-[22px]"
            >
              <div className="flex items-center justify-between">
                <div className="flex size-10 items-center justify-center rounded-md border border-line bg-page text-brass-text">
                  {feature.icon}
                </div>
                {feature.pro ? <Chip tone="brass">Pro</Chip> : null}
              </div>
              <h3 className="mt-1.5 text-base font-semibold">{feature.title}</h3>
              <p className="text-[15px] leading-[1.6] text-text-2">{feature.body}</p>
            </article>
          ))}
        </div>
      </Container>
    </section>
  );
}
