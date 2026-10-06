"use client";

import { useId, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { SUSPENDED_REASON, useAccountSuspended } from "@/components/admin/suspension-context";
import { addDomainAction } from "@/lib/domains/actions";
import { pageOptionLabel, type PageOption } from "./page-options";
import { FIELD, FIELD_LABEL, PRIMARY } from "./ui";
import { ADD_FAILED, EMPTY_HOSTNAME } from "./view-model";

/**
 * The add form of the Custom domain card (M4-11, M5-18): a labelled "Domain" input (16px,
 * placeholder links.yourname.com), a labelled "Serves" select listing the account's pages (the
 * current page first selected) and "Add domain". It stacks on a phone, full width and 44px tall, and
 * sits on one row from 760px up. The server validates the hostname, the plan and the limit and
 * returns the sentence shown under the fields; this form never decides any of that. A successful
 * add refreshes the route, so the new card, the usage line and (at the limit) the missing form all
 * arrive without a reload.
 */
export function AddDomainForm({
  pages,
  currentPageId,
}: {
  pages: PageOption[];
  currentPageId: string;
}) {
  const router = useRouter();
  const suspended = useAccountSuspended();
  const [hostname, setHostname] = useState("");
  const [pageId, setPageId] = useState(currentPageId);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [, startTransition] = useTransition();
  const inputId = useId();
  const selectId = useId();
  const errorId = useId();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (adding || suspended) return;
    const value = hostname.trim();
    if (value === "") {
      setError(EMPTY_HOSTNAME);
      return;
    }
    setAdding(true);
    setError(null);
    try {
      const result = await addDomainAction({ hostname: value, pageId });
      if (result.ok) {
        setHostname("");
        startTransition(() => router.refresh());
      } else {
        setError(result.message.trim() === "" ? ADD_FAILED : result.message);
      }
    } catch {
      setError(ADD_FAILED);
    }
    setAdding(false);
  }

  return (
    <form
      onSubmit={(event) => void submit(event)}
      noValidate
      data-add-domain-form
      className="grid gap-3 px-4 py-3.5 hl:grid-cols-[minmax(0,1fr)_minmax(0,16rem)_auto] hl:items-end hl:px-5"
    >
      <div className="flex min-w-0 flex-col gap-1.5">
        <label htmlFor={inputId} className={FIELD_LABEL}>
          Domain
        </label>
        <input
          id={inputId}
          name="hostname"
          type="text"
          inputMode="url"
          autoCapitalize="none"
          autoCorrect="off"
          autoComplete="off"
          spellCheck={false}
          placeholder="links.yourname.com"
          value={hostname}
          onChange={(event) => {
            setHostname(event.target.value);
            if (error) setError(null);
          }}
          disabled={adding || suspended}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          className={`${FIELD} font-mono`}
        />
      </div>
      <div className="flex min-w-0 flex-col gap-1.5">
        <label htmlFor={selectId} className={FIELD_LABEL}>
          Serves
        </label>
        <select
          id={selectId}
          name="pageId"
          value={pageId}
          onChange={(event) => setPageId(event.target.value)}
          disabled={adding || suspended}
          className={FIELD}
        >
          {pages.map((page) => (
            <option key={page.id} value={page.id}>
              {pageOptionLabel(page)}
            </option>
          ))}
        </select>
      </div>
      <button
        type="submit"
        disabled={adding || suspended}
        aria-busy={adding || undefined}
        title={suspended ? SUSPENDED_REASON : undefined}
        className={`${PRIMARY} w-full hl:w-auto`}
      >
        {adding ? "Adding…" : "Add domain"}
      </button>
      <p
        id={errorId}
        role="alert"
        data-add-domain-error
        className="text-[13px] leading-normal text-bad empty:hidden hl:col-span-3"
      >
        {error}
      </p>
    </form>
  );
}
