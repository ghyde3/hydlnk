import { clientEnv } from "@/lib/env/client";
import { appOrigin } from "@/lib/routing/urls";

/**
 * "Claim your handle". A plain GET form: submitting it navigates to
 * <app origin>/signup?handle=<value>, which is the hand-off PLAN.md describes. No JavaScript is
 * needed, so it works before hydration. Handle rules and availability are checked on the app host.
 */
export function ClaimForm({ id }: { id: string }) {
  const rootDomain = clientEnv.NEXT_PUBLIC_ROOT_DOMAIN;

  return (
    <form
      method="get"
      action={`${appOrigin(rootDomain)}/signup`}
      className="flex w-full max-w-[500px] flex-wrap items-center gap-1.5 rounded-md border border-line-3 bg-surface py-1 pr-1 pl-3.5 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-brass"
    >
      <label htmlFor={id} className="sr-only">
        Claim your handle
      </label>
      <input
        id={id}
        name="handle"
        type="text"
        placeholder="yourname"
        autoComplete="off"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        maxLength={30}
        className="min-h-11 min-w-0 flex-1 basis-28 bg-transparent font-mono text-ink outline-none"
      />
      <span className="font-mono text-base text-text-3">.{rootDomain}</span>
      <button
        type="submit"
        className="min-h-11 basis-full cursor-pointer rounded-sm bg-ink px-[18px] text-sm font-semibold text-surface hl:ml-1.5 hl:basis-auto"
      >
        Claim it
      </button>
    </form>
  );
}
