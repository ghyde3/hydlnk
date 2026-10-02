import { clientEnv } from "@/lib/env/client";
import { appOrigin } from "@/lib/routing/urls";
import { PLANS, type Plan } from "./plans";
import { Check } from "./primitives";

function PlanBody({ plan, signupHref }: { plan: Plan; signupHref: string }) {
  return (
    <div className="flex flex-1 flex-col gap-[18px] p-[clamp(20px,5vw,26px)]">
      <div>
        <h3 className="text-[15px] font-semibold">{plan.name}</h3>
        <p className="mt-2 flex flex-wrap items-baseline gap-1.5">
          <span className="text-[40px] leading-none font-bold tracking-[-0.03em]">{plan.price}</span>
          <span className="text-sm text-text-2">{plan.per}</span>
        </p>
        <p className="mt-1.5 font-mono text-xs text-text-2">{plan.note}</p>
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

/**
 * Free, Pro (recommended) and Studio. Every CTA goes to sign-up on the app host: upgrading happens
 * from the account's billing page once the page exists.
 */
export function PlanCards() {
  const signupHref = `${appOrigin(clientEnv.NEXT_PUBLIC_ROOT_DOMAIN)}/signup`;
  return (
    <div
      data-plan-cards=""
      className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,300px),1fr))] items-stretch gap-3"
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
  );
}
