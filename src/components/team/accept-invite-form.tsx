"use client";

import { useActionState } from "react";
import { acceptInvite, type AcceptInviteState } from "@/lib/team/actions";

/** Accept is a POST (a Server Action): opening or prefetching the link accepts nothing (M19-08). */
export function AcceptInviteForm() {
  const [state, action, pending] = useActionState<AcceptInviteState, FormData>(acceptInvite, null);
  return (
    <form action={action} className="flex flex-col gap-3">
      {state ? (
        <p role="alert" className="rounded-md bg-brass-soft px-3 py-2.5 text-sm leading-normal text-brass-soft-text">
          {state.message}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="flex min-h-12 w-full cursor-pointer items-center justify-center rounded-md bg-ink px-4 text-[15px] font-semibold text-surface disabled:cursor-default disabled:opacity-70"
      >
        {pending ? "Joining…" : "Accept invite"}
      </button>
    </form>
  );
}
