import { clientEnv } from "@/lib/env/client";
import { rootOrigin } from "@/lib/routing/urls";

/**
 * HYDLNK logo link for the app chrome: brass 8px diamond plus the wordmark, 44px tall, pointing at
 * the marketing site on the root host (a plain anchor: it leaves the app host).
 */
export function AppLogo({ size }: { size: "sidebar" | "bar" }) {
  return (
    <a
      href={`${rootOrigin(clientEnv.NEXT_PUBLIC_ROOT_DOMAIN)}/`}
      aria-label="HYDLNK home"
      className={`inline-flex min-h-11 shrink-0 items-center gap-2.5 text-on-ink no-underline ${
        size === "sidebar" ? "px-2" : ""
      }`}
    >
      <span aria-hidden="true" className="inline-block size-2 shrink-0 rotate-45 bg-brass" />
      <span
        className={`font-bold tracking-[0.14em] ${size === "sidebar" ? "text-sm" : "text-[13px]"}`}
      >
        HYDLNK
      </span>
    </a>
  );
}
