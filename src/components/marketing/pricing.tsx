import { clientEnv } from "@/lib/env/client";
import { MAX_YEARLY_SAVINGS_PERCENT } from "@/lib/marketing/prices";
import { appOrigin } from "@/lib/routing/urls";
import { PLANS, type Plan, type PlanPrice } from "./plans";
import { Check } from "./primitives";

function PriceBlock({ price }: { price: PlanPrice }) {
  return (
    <>
      <p className="mt-2 flex flex-wrap items-baseline gap-1.5">
        <span className="text-[40px] leading-none font-bold tracking-[-0.03em]">
          {price.amount}
        </span>
        <span className="text-sm text-text-2">{price.per}</span>
      </p>
      <p className="mt-1.5 font-mono text-xs text-text-2">{price.note}</p>
    </>
  );
}

/**
 * The price of one card. A paid plan renders both billing periods and the Monthly | Yearly toggle
 * (BillingToggle) hides one of them with CSS, so the toggle needs no JavaScript. Free costs the
 * same either way and renders once.
 */
function PlanPriceView({ plan }: { plan: Plan }) {
  const { monthly, yearly } = plan.price;
  if (monthly === yearly) return <PriceBlock price={monthly} />;
  return (
    <>
      <div data-billing-view="monthly">
        <PriceBlock price={monthly} />
      </div>
      <div data-billing-view="yearly">
        <PriceBlock price={yearly} />
      </div>
    </>
  );
}

function PlanBody({ plan, signupHref }: { plan: Plan; signupHref: string }) {
  return (
    <div className="flex flex-1 flex-col gap-[18px] p-[clamp(20px,5vw,26px)]">
      <div>
        <h3 className="text-[15px] font-semibold">{plan.name}</h3>
        <PlanPriceView plan={plan} />
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
        {plan.dash?.map((line) => (
          <li key={line} className="flex items-start gap-2.5 text-text-2">
            <span aria-hidden="true" className="w-4 shrink-0 text-center">
              –
            </span>
            <span>{line}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Monthly | Yearly, a segmented control made of two radio buttons (a fieldset with a legend, so a
 * screen reader announces "Billing period, Yearly, 2 of 2" and the arrow keys move between them).
 * Yearly is the default. The choice is read by CSS alone (`[data-billing-root]:has(...)` in
 * marketing.css), which is why it works with JavaScript off. Each label is 44px tall.
 */
function BillingToggle() {
  return (
    <fieldset className="bt">
      <legend className="sr-only">Billing period</legend>
      <label className="bt-option">
        <input type="radio" name="billing" value="monthly" className="sr-only" />
        <span>Monthly</span>
      </label>
      <label className="bt-option">
        <input type="radio" name="billing" value="yearly" defaultChecked className="sr-only" />
        <span>Yearly</span>
        <span className="bt-save">Save up to {MAX_YEARLY_SAVINGS_PERCENT}%</span>
      </label>
    </fieldset>
  );
}

/**
 * The billing toggle over Free, Pro (recommended) and Studio. Every CTA goes to sign-up on the app
 * host: upgrading happens from the account's billing page once the page exists.
 */
export function PlanCards() {
  const signupHref = `${appOrigin(clientEnv.NEXT_PUBLIC_ROOT_DOMAIN)}/signup`;
  return (
    <div data-billing-root="">
      <BillingToggle />
      <div
        data-plan-cards=""
        className="mt-6 grid grid-cols-[repeat(auto-fit,minmax(min(100%,300px),1fr))] items-stretch gap-3"
      >
        {PLANS.map((plan) =>
          plan.featured ? (
            <div
              key={plan.id}
              className="flex flex-col overflow-hidden rounded-md border border-ink bg-surface"
            >
              <div className="flex items-center gap-2 bg-ink px-4 py-2 font-mono text-[11px] tracking-[0.08em] text-on-ink uppercase">
                <span aria-hidden="true" className="inline-block size-1.5 bg-brass" />
                Recommended
              </div>
              <PlanBody plan={plan} signupHref={signupHref} />
            </div>
          ) : (
            <div key={plan.id} className="flex flex-col rounded-md border border-line-2 bg-surface">
              <PlanBody plan={plan} signupHref={signupHref} />
            </div>
          ),
        )}
      </div>
    </div>
  );
}
