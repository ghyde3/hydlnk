import { FENNMOOR } from "./demo/brands";
import { DemoPage } from "./demo/demo-page";

const STEPS = [
  { title: "Domain added", note: "links.yourbrand.com" },
  { title: "DNS record found", note: "CNAME · links" },
  { title: "SSL issued", note: "https is on" },
] as const;

/**
 * A still of the editor's custom-domain card once everything is done: the domain with its status,
 * the three setup steps (all complete) and the address bar result. Decorative; the page explains
 * the same steps in text.
 */
export function DomainSetupMock() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-3">
      <div className="overflow-hidden rounded-md border border-line-2 bg-surface">
        <div className="flex items-center gap-2 border-b border-line bg-page px-3 py-2.5">
          <span className="flex gap-1.5">
            <span className="size-2.5 rounded-[50%] bg-line-3" />
            <span className="size-2.5 rounded-[50%] bg-line-3" />
            <span className="size-2.5 rounded-[50%] bg-line-3" />
          </span>
          <span className="ml-2 flex min-w-0 flex-1 items-center gap-2 rounded-sm border border-line bg-surface px-2.5 py-1.5 font-mono text-[13px]">
            <svg
              viewBox="0 0 24 24"
              className="size-3.5 shrink-0 fill-none stroke-good stroke-[2.2]"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="5" y="10.5" width="14" height="10" rx="2" />
              <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
            </svg>
            <span className="truncate">links.yourbrand.com</span>
          </span>
        </div>
        <div className="h-[300px]">
          <DemoPage brand={FENNMOOR} />
        </div>
      </div>

      <div className="rounded-md border border-line-2 bg-surface p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-mono text-sm">links.yourbrand.com</span>
          <span className="rounded-sm bg-good-bg px-2 py-[3px] font-mono text-[11px] tracking-[0.06em] text-[#2B7448] uppercase">
            Verified
          </span>
        </div>
        <ol className="mt-4 flex flex-col gap-3">
          {STEPS.map((step) => (
            <li key={step.title} className="flex items-center gap-3">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-[50%] bg-good text-surface">
                <svg
                  viewBox="0 0 24 24"
                  className="size-3.5 fill-none stroke-current stroke-[2.6]"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M5 12.5l4.5 4.5L19 7.5" />
                </svg>
              </span>
              <span className="flex flex-1 flex-wrap items-baseline justify-between gap-x-3">
                <span className="text-sm font-semibold">{step.title}</span>
                <span className="font-mono text-xs text-text-2">{step.note}</span>
              </span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
