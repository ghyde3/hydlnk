"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Field, FORM_BUTTON, controlClass } from "@/components/blocks/field";
import { TextField } from "@/components/blocks/text-field";
import { SUSPENDED_REASON, useAccountSuspended } from "@/components/admin/suspension-context";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { SUB_PAGE_LIMITS, suggestPath } from "@/lib/document";
import { PLAN_LIMITS } from "@/lib/limits/table";
import { ToggleRow } from "./toggle-row";

/**
 * The Pages card of the Edit tab (M11-08): the site's pages as a list, Home first and then the
 * sub-pages in menu order (the ones that are not in the menu after them), and "Add page". Choosing a
 * row opens that page in the builder and the preview. "Add page" opens a small form: a title, and a
 * path suggested from it that can be edited and is checked as it is typed against the path rule, the
 * reserved list and the site's other paths. At the plan's pages per site the button gives way to the
 * limit message with an upgrade link (the server refuses too).
 *
 * A new page exists at once (it is created on the server) but is not live until Publish; deleting
 * one is immediate and lives on the page's own settings.
 */
export function PagesCard() {
  const { site, plan } = useWorkspace();
  const suspended = useAccountSuspended();
  const headingId = useId();
  const [adding, setAdding] = useState(false);
  const addButton = useRef<HTMLButtonElement>(null);
  const { limit } = site;
  const subCount = site.items.length - 1;

  return (
    <section
      aria-labelledby={headingId}
      data-testid="pages-card"
      className="flex flex-col gap-3 rounded-md border border-line bg-surface p-3.5"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h2 id={headingId} className="text-sm font-semibold">
          Pages
        </h2>
        <span data-testid="pages-count" className="text-xs text-text-2">
          {limit.unlimited
            ? `${limit.used} pages`
            : `${limit.used} of ${PLAN_LIMITS[plan].pagesPerSite} pages`}
        </span>
      </div>

      <ul className="m-0 flex list-none flex-col gap-1.5 p-0" data-testid="page-list">
        {site.items.map((item) => {
          const active = item.id === site.activeId;
          return (
            <li key={item.id} className="min-w-0">
              <button
                type="button"
                data-testid="page-row"
                data-page-id={item.id}
                aria-current={active ? "page" : undefined}
                onClick={() => site.select(item.id)}
                className={`flex min-h-11 w-full min-w-0 cursor-pointer flex-wrap items-center justify-between gap-x-3 gap-y-0.5 rounded-md border px-3 py-1.5 text-left ${
                  active ? "border-ink bg-page" : "border-line-3 bg-surface"
                }`}
              >
                <span className="min-w-0 text-sm font-semibold [overflow-wrap:anywhere] text-ink">
                  {item.title}
                </span>
                <span className="flex min-w-0 items-center gap-2 text-xs text-text-2">
                  <span className="font-mono [overflow-wrap:anywhere]">{item.path}</span>
                  {item.home ? null : (
                    <span data-testid="page-menu-state">
                      {item.inMenu ? "In menu" : "Not in menu"}
                    </span>
                  )}
                  {site.pagesWithErrors.has(item.id) ? (
                    <span data-testid="page-needs-fix" className="font-semibold text-bad">
                      Needs a fix
                    </span>
                  ) : null}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {site.items
        .filter((item) => item.id !== site.activeId && site.pagesWithErrors.has(item.id))
        .map((item) => (
          <p
            key={item.id}
            role="alert"
            data-testid="page-fix-prompt"
            className="m-0 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-bad"
          >
            <span className="min-w-0 [overflow-wrap:anywhere]">
              Publish found a problem on {item.title}.
            </span>
            <button
              type="button"
              onClick={() => site.select(item.id)}
              className={`${FORM_BUTTON} text-ink`}
            >
              Open {item.title}
            </button>
          </p>
        ))}

      {subCount > 0 ? (
        <ToggleRow
          label="Show the menu on the site"
          testId="menu-shown"
          pressed={site.menuShown}
          onToggle={() => site.setMenuShown(!site.menuShown)}
        />
      ) : null}

      {limit.atLimit ? (
        <p
          role="status"
          data-testid="page-limit-note"
          className="m-0 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-text-2"
        >
          <span>{site.limitMessage}</span>
          {plan === "studio" ? null : (
            <Link
              href="/settings#plans"
              className="inline-flex min-h-11 items-center font-semibold text-ink underline"
            >
              Upgrade
            </Link>
          )}
        </p>
      ) : adding ? (
        <AddPageForm
          onDone={() => {
            setAdding(false);
          }}
          onCancel={() => {
            setAdding(false);
            requestAnimationFrame(() => addButton.current?.focus());
          }}
        />
      ) : (
        <button
          ref={addButton}
          type="button"
          data-testid="add-page"
          disabled={suspended}
          title={suspended ? SUSPENDED_REASON : undefined}
          onClick={() => setAdding(true)}
          className={`${FORM_BUTTON} self-start`}
        >
          Add page
        </button>
      )}
      <p className="m-0 text-xs text-text-2">Pages go live when you publish.</p>
    </section>
  );
}

function AddPageForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const { site } = useWorkspace();
  const [title, setTitle] = useState("");
  const [path, setPath] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const titleRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    titleRef.current?.querySelector("input")?.focus();
  }, []);

  // The path follows the title until the person edits it.
  const suggested = suggestPath(title.trim() === "" ? "New page" : title, site.takenPaths);
  const shown = path ?? suggested;
  const problem = site.pathError(shown, null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending || problem !== null) return;
    setPending(true);
    setFailure(null);
    const result = await site.add({ title, path: shown.trim() });
    setPending(false);
    if (result.ok) onDone();
    else setFailure(result.message);
  }

  return (
    <form
      onSubmit={submit}
      data-testid="add-page-form"
      data-native-undo=""
      aria-label="Add page"
      className="flex flex-col gap-3 rounded-md border border-line bg-page p-3"
    >
      <div ref={titleRef}>
        <TextField
          label="Page title"
          field="new-page-title"
          max={SUB_PAGE_LIMITS.title}
          value={title}
          onChange={setTitle}
          hint="Shown in the menu and as the page’s heading."
        />
      </div>
      <PathField
        value={shown}
        onChange={setPath}
        error={problem}
        field="new-page-path"
        label="Path"
      />
      {failure ? (
        <p role="alert" data-testid="add-page-error" className="m-0 text-[13px] text-bad">
          {failure}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={pending || problem !== null}
          data-testid="add-page-submit"
          className="inline-flex min-h-11 cursor-pointer items-center justify-center rounded-md bg-ink px-4 text-sm font-semibold text-surface disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? "Adding…" : "Add page"}
        </button>
        <button type="button" onClick={onCancel} className={FORM_BUTTON}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/** The path field: a leading "/" and the live message under it. */
export function PathField({
  value,
  onChange,
  error,
  field,
  label,
  hint,
}: {
  value: string;
  onChange: (next: string) => void;
  error: string | null;
  field: string;
  label: string;
  hint?: string;
}) {
  return (
    <Field label={label} error={error} hint={hint}>
      {(control) => (
        <div className="flex min-w-0 items-center gap-2">
          <span aria-hidden="true" className="font-mono text-base text-text-2">
            /
          </span>
          <input
            {...control}
            type="text"
            value={value}
            data-field={field}
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            maxLength={SUB_PAGE_LIMITS.draftPath}
            onChange={(event) => onChange(event.target.value.replace(/^\/+/, ""))}
            className={controlClass(error !== null, "font-mono")}
          />
        </div>
      )}
    </Field>
  );
}
