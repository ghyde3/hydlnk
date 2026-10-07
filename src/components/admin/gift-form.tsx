"use client";

import { useRouter } from "next/navigation";
import { useId, useRef, useState, type FormEvent } from "react";
import { postAdmin } from "@/lib/blocklist/admin-client";
import { endedMessage, giftedMessage } from "@/lib/billing/gift-view";

/**
 * The forms of /admin/accounts/{id}/gift (M13-07): Give plan (Pro or Studio, an optional end day, a
 * reason) and End gift. Posts to the two admin routes; the server checks the caller is an admin again
 * and answers every refusal with the sentence shown here. One result panel, so the outcome survives
 * the refresh that brings the new state. Every string from the server is React text.
 */

const PRIMARY =
  "inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-md bg-ink px-[18px] text-sm font-semibold text-surface disabled:cursor-not-allowed disabled:opacity-50";
const SECONDARY =
  "inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-md border border-line-3 bg-surface px-4 text-sm font-semibold text-ink disabled:cursor-not-allowed disabled:opacity-50";
const CONTROL =
  "min-h-11 w-full min-w-0 rounded-md border border-line-3 bg-surface px-3 text-base font-normal text-ink";

type Result = { kind: "ok" | "error"; text: string } | null;

export function GiftForm({ accountId, hasGift }: { accountId: string; hasGift: boolean }) {
  const router = useRouter();
  const [plan, setPlan] = useState<"pro" | "studio">("pro");
  const [until, setUntil] = useState("");
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState<"give" | "end" | null>(null);
  const [result, setResult] = useState<Result>(null);
  const sending = useRef(false);
  const ids = { plan: useId(), until: useId(), reason: useId(), hint: useId() };
  const base = `/api/admin/accounts/${encodeURIComponent(accountId)}`;

  async function give(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending.current) return;
    sending.current = true;
    setPending("give");
    setResult(null);
    const response = await postAdmin<Record<string, unknown>>(`${base}/gift`, {
      plan,
      until: until === "" ? null : until,
      reason,
    });
    sending.current = false;
    setPending(null);
    if (!response.ok) {
      setResult({ kind: "error", text: response.message });
      return;
    }
    setResult({ kind: "ok", text: giftedMessage(response.data) });
    setUntil("");
    setReason("");
    router.refresh();
  }

  async function end() {
    if (sending.current) return;
    sending.current = true;
    setPending("end");
    setResult(null);
    const response = await postAdmin<Record<string, unknown>>(`${base}/end-gift`, {});
    sending.current = false;
    setPending(null);
    if (!response.ok) {
      setResult({ kind: "error", text: response.message });
      return;
    }
    setResult({ kind: "ok", text: endedMessage(response.data) });
    router.refresh();
  }

  return (
    <>
      <form
        noValidate
        aria-label="Give a plan"
        onSubmit={(event) => void give(event)}
        className="flex flex-col gap-3 rounded-md border border-line bg-surface p-4 hl:p-5"
      >
        <h2 className="text-base font-bold">{hasGift ? "Replace the gift" : "Give a plan"}</h2>
        <div className="grid gap-3 hl:grid-cols-2">
          <div className="flex min-w-0 flex-col gap-1.5">
            <label htmlFor={ids.plan} className="text-[13px] font-semibold text-ink-2">
              Plan
            </label>
            <select
              id={ids.plan}
              name="plan"
              value={plan}
              onChange={(event) => setPlan(event.target.value === "studio" ? "studio" : "pro")}
              className={CONTROL}
            >
              <option value="pro">Pro</option>
              <option value="studio">Studio</option>
            </select>
          </div>
          <div className="flex min-w-0 flex-col gap-1.5">
            <label htmlFor={ids.until} className="text-[13px] font-semibold text-ink-2">
              Ends on
            </label>
            <input
              id={ids.until}
              name="until"
              type="date"
              value={until}
              onChange={(event) => setUntil(event.target.value)}
              aria-describedby={ids.hint}
              className={CONTROL}
            />
            <p id={ids.hint} className="text-xs text-text-2">
              Optional. The gift lasts through that day (UTC). Leave empty for no end date.
            </p>
          </div>
        </div>
        <div className="flex min-w-0 flex-col gap-1.5">
          <label htmlFor={ids.reason} className="text-[13px] font-semibold text-ink-2">
            Reason
          </label>
          <textarea
            id={ids.reason}
            name="reason"
            rows={3}
            maxLength={500}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            className={`${CONTROL} py-2`}
          />
          <p className="text-xs text-text-2">
            Optional, up to 500 characters. The account owner can read it.
          </p>
        </div>
        <div className="flex flex-col gap-2 hl:flex-row">
          <button
            type="submit"
            disabled={pending !== null}
            aria-busy={pending === "give"}
            className={`${PRIMARY} w-full hl:w-auto`}
          >
            {pending === "give" ? "Giving..." : "Give plan"}
          </button>
          {hasGift ? (
            <button
              type="button"
              disabled={pending !== null}
              aria-busy={pending === "end"}
              onClick={() => void end()}
              className={`${SECONDARY} w-full hl:w-auto`}
            >
              {pending === "end" ? "Ending..." : "End gift"}
            </button>
          ) : null}
        </div>
      </form>
      {result ? (
        <p
          role={result.kind === "error" ? "alert" : "status"}
          data-gift-result={result.kind}
          className={`rounded-md border bg-surface p-4 text-[15px] [overflow-wrap:anywhere] ${
            result.kind === "error" ? "border-bad-line text-bad" : "border-line text-ink"
          }`}
        >
          {result.text}
        </p>
      ) : null}
    </>
  );
}
