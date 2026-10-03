import type { ReactNode } from "react";
import type { StepState, StepView } from "./view-model";

const CIRCLE: Record<StepState, string> = {
  done: "border-good bg-good text-surface",
  current: "border-ink bg-surface text-ink",
  todo: "border-line-2 bg-surface text-text-3",
};

/**
 * The numbered circle of a step (DESIGN.md -> step list): green with a check when done, an ink
 * outline for the current step, a grey outline for what is still to do. The circle carries its own
 * text alternative ("Step 2 of 3, current") because the digit or the check alone says nothing.
 */
function StepCircle({ step }: { step: StepView }) {
  return (
    <span
      role="img"
      aria-label={step.label}
      data-step-state={step.state}
      className={`flex size-[26px] shrink-0 items-center justify-center rounded-full border font-mono text-xs font-medium ${CIRCLE[step.state]}`}
    >
      {step.state === "done" ? (
        <svg
          viewBox="0 0 24 24"
          width={13}
          height={13}
          aria-hidden="true"
          focusable="false"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.6}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M5 12.5l4.5 4.5L19 7.5" />
        </svg>
      ) : (
        <span aria-hidden="true">{step.n}</span>
      )}
    </span>
  );
}

/**
 * The three-step setup list of one domain card: a real ordered list, one item per step, the single
 * column on every width. `extra` renders under step 2's text (the DNS records).
 */
export function StepList({ steps, extra }: { steps: StepView[]; extra?: ReactNode }) {
  return (
    <ol data-domain-steps className="m-0 flex list-none flex-col px-4 pt-[18px] pb-1 hl:px-5">
      {steps.map((step) => (
        <li key={step.n} className="flex gap-3.5 pb-5 last:pb-[18px]">
          <StepCircle step={step} />
          <div className="flex min-w-0 flex-1 flex-col gap-2.5 pt-[3px]">
            <div>
              <div className="text-[15px] font-semibold">{step.title}</div>
              <p className="mt-[3px] text-[13px] leading-normal text-text-2">{step.text}</p>
            </div>
            {step.n === 2 ? extra : null}
          </div>
        </li>
      ))}
    </ol>
  );
}
