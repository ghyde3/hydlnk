"use client";

import { useActionState, useMemo } from "react";
import { claimHandleAction } from "@/lib/handles/actions";
import { IDLE_FORM_STATE } from "@/lib/handles/form-state";
import { HandleField, type ServerHandleResult } from "./handle-field";

/**
 * The claim step's form (M1-14, Signup.dc.html): Handle field with live availability and
 * "Claim it". No email field and no Google button: the account is already signed in. `notice` is
 * the "was taken while you were signing up" line, shown above the field.
 */
export function ClaimForm({
  initialHandle = "",
  notice,
}: {
  initialHandle?: string;
  notice?: string;
}) {
  const [state, action, pending] = useActionState(claimHandleAction, IDLE_FORM_STATE);
  const serverResult = useMemo<ServerHandleResult | null>(
    () => (state.kind === "handle" ? { handle: state.handle, status: state.status } : null),
    [state],
  );
  const formError = state.kind === "error" ? state.message : null;

  return (
    <form action={action} noValidate className="flex flex-col gap-5">
      {notice ? (
        <p
          role="status"
          className="rounded-md bg-brass-soft px-3 py-2.5 text-sm leading-normal text-brass-soft-text"
        >
          {notice}
        </p>
      ) : null}
      <HandleField id="cl-handle" initialValue={initialHandle} serverResult={serverResult} />
      <button
        type="submit"
        disabled={pending}
        className="flex min-h-12 w-full cursor-pointer items-center justify-center rounded-md bg-ink px-4 text-[15px] font-semibold text-surface disabled:cursor-default disabled:opacity-70"
      >
        Claim it
      </button>
      {formError ? (
        <p role="alert" className="-mt-2 text-[13px] text-bad">
          {formError}
        </p>
      ) : null}
    </form>
  );
}
