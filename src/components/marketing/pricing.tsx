import { clientEnv } from "@/lib/env/client";
import { appOrigin } from "@/lib/routing/urls";
import { Container, Eyebrow, H2, LEAD, SECTION_Y } from "./primitives";

type Plan = {
  name: string;
  price: string;
  per: string;
  blurb: string;
  cta: string;
  featured?: boolean;
  lead?: string;
  items: string[];
  dash?: string;
};

const PLANS: Plan[] = [
  {
    name: "Free",
    price: "$0",
    per: "forever",
    blurb: "One page that looks properly designed.",
    cta: "Start free",
    items: [
      "1 page",
      "Every block and the full theme system",
      "3 saved themes",
      "yourname.hydlnk.com",
      "Per-link clicks, last 30 days",
      "10 MB of uploads",
    ],
    dash: "Small “Made with HYDLNK” badge",
  },
  {
    name: "Pro",
    price: "$5",
    per: "/ month · or $48 a year",
    blurb: "For creators and small brands on their own domain.",
    cta: "Go Pro",
    featured: true,
    lead: "Everything in Free, plus",
    items: [
      "1 custom domain with SSL",
      "3 pages",
      "No badge",
      "Unlimited saved themes",
      "1 year of analytics with referrers, devices and countries",
      "100 MB of uploads",
    ],
  },
  {
    name: "Studio",
    price: "$15",
    per: "/ month",
    blurb: "For agencies and teams running pages for others.",
    cta: "Start Studio",
    lead: "Everything in Pro, plus",
    items: ["15 pages and 15 custom domains", "Themes shared across pages", "1 GB of uploads"],
  },
];

function Check({ className }: { className: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={`mt-0.5 size-4 shrink-0 fill-none stroke-[2] ${className}`}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

function PlanBody({ plan, signupHref }: { plan: Plan; signupHref: string }) {
  return (
    <div className="flex flex-1 flex-col gap-[18px] p-[clamp(20px,5vw,26px)]">
      <div>
        <h3 className="text-[15px] font-semibold">{plan.name}</h3>
        <p className="mt-2 flex flex-wrap items-baseline gap-1.5">
          <span className="text-[40px] leading-none font-bold tracking-[-0.03em]">
            {plan.price}
          </span>
          <span className="text-sm text-text-2">{plan.per}</span>
        </p>
        <p className="mt-2.5 text-sm leading-normal text-text-2">{plan.blurb}</p>
      </div>
      <a
        href={signupHref}
        className={`flex min-h-11 items-center justify-center rounded-md text-sm font-semibold ${
          plan.featured ? "bg-ink text-surface" : "border border-line-3 text-ink"
        }`}
      >
        {plan.cta}
      </a>
      <ul className="flex flex-col gap-2.5 border-t border-line pt-4 text-sm">
        {plan.lead ? (
          <li className="font-mono text-[11px] tracking-[0.06em] text-text-2 uppercase">
            {plan.lead}
          </li>
        ) : null}
        {plan.items.map((item) => (
          <li key={item} className="flex items-start gap-2.5">
            <Check className={plan.featured ? "stroke-brass-text" : "stroke-ink"} />
            <span>{item}</span>
          </li>
        ))}
        {plan.dash ? (
          <li className="flex items-start gap-2.5 text-text-2">
            <span aria-hidden="true" className="w-4 shrink-0 text-center">
              –
            </span>
            <span>{plan.dash}</span>
          </li>
        ) : null}
      </ul>
    </div>
  );
}

/** #pricing: Free, Pro (recommended) and Studio. Upgrading is wired in Milestone 4. */
export function Pricing() {
  const signupHref = `${appOrigin(clientEnv.NEXT_PUBLIC_ROOT_DOMAIN)}/signup`;

  return (
    <section id="pricing" className={`border-b border-line bg-page ${SECTION_Y}`}>
      <Container>
        <div className="max-w-[720px]">
          <Eyebrow>Pricing</Eyebrow>
          <h2 className={`mt-3.5 ${H2}`}>Pay for your domain, not your design.</h2>
          <p className={`mt-4 ${LEAD}`}>
            No commerce fees on any plan. Cancel anytime from your billing portal.
          </p>
        </div>
        <div className="mt-10 grid grid-cols-[repeat(auto-fit,minmax(min(100%,300px),1fr))] items-stretch gap-3">
          {PLANS.map((plan) =>
            plan.featured ? (
              <div
                key={plan.name}
                className="flex flex-col overflow-hidden rounded-md border border-ink bg-surface"
              >
                <div className="flex items-center gap-2 bg-ink px-4 py-2 font-mono text-[11px] tracking-[0.08em] text-on-ink uppercase">
                  <span aria-hidden="true" className="inline-block size-1.5 bg-brass" />
                  Recommended
                </div>
                <PlanBody plan={plan} signupHref={signupHref} />
              </div>
            ) : (
              <div
                key={plan.name}
                className="flex flex-col rounded-md border border-line-2 bg-surface"
              >
                <PlanBody plan={plan} signupHref={signupHref} />
              </div>
            ),
          )}
        </div>
      </Container>
    </section>
  );
}
