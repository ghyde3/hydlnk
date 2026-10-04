import { Check } from "lucide-react";
import type { ReactNode } from "react";
import { CHECK_ON_FILL_STROKE, Icon } from "@/components/app/icon";
import { Logo } from "@/components/logo";
import { clientEnv } from "@/lib/env/client";
import { rootOrigin } from "@/lib/routing/urls";
import { BrandHandlePill, BrandHandleProvider } from "./brand-handle";

const BULLETS = [
  "Every block, theme and design option",
  "Per-link analytics from day one",
  "Bring your own domain whenever you’re ready",
];

/**
 * Shared frame of the log in, sign up and claim screens (Signup.dc.html): a charcoal brand panel
 * on the left from 760px up, a slim charcoal bar with only the logo below it, and the form column
 * (content centered, max 400px) next to it. `children` is the form column's content.
 *
 * `handle` seeds the pill in the panel; a form inside can keep it live with
 * useBrandHandle().setHandle(value) from "./brand-handle".
 */
export function AuthLayout({ children, handle = "" }: { children: ReactNode; handle?: string }) {
  const home = `${rootOrigin(clientEnv.NEXT_PUBLIC_ROOT_DOMAIN)}/`;

  return (
    <BrandHandleProvider initialHandle={handle}>
      <div className="flex min-h-dvh flex-col bg-surface hl:flex-row">
        <aside className="flex min-w-0 flex-col bg-ink px-5 py-3 text-on-ink hl:min-h-dvh hl:flex-[1_1_480px] hl:justify-between hl:gap-12 hl:px-12 hl:py-8">
          <a
            href={home}
            aria-label="HYDLNK home"
            className="inline-flex min-h-11 items-center self-start"
          >
            <Logo />
          </a>
          <div className="hidden hl:block">
            <p className="text-[44px] leading-[1.08] font-bold tracking-[-0.03em]">
              Claim your name.
            </p>
            <BrandHandlePill />
            <ul className="mt-8 flex flex-col gap-3 text-[15px] text-line-2">
              {BULLETS.map((text) => (
                <li key={text} className="flex items-center gap-2.5">
                  <Icon
                    icon={Check}
                    size={16}
                    strokeWidth={CHECK_ON_FILL_STROKE}
                    className="text-brass"
                  />
                  {text}
                </li>
              ))}
            </ul>
          </div>
          <p className="hidden text-[13px] text-on-ink-muted hl:block">
            Free forever. No card required.
          </p>
        </aside>

        <main className="flex min-w-0 flex-1 justify-center px-5 py-7 hl:min-h-dvh hl:flex-[1_1_520px] hl:items-center hl:px-6 hl:py-14">
          <div className="w-full max-w-[400px]">{children}</div>
        </main>
      </div>
    </BrandHandleProvider>
  );
}
