"use client";

import { useId, useState, type FormEvent } from "react";
import { FORM_BUTTON, FORM_BUTTON_DANGER, controlClass } from "@/components/blocks/field";
import type { TermSummary } from "@/lib/content/schemas/summaries";
import { POST_LIMITS } from "@/lib/content/schemas";
import { POST_TEST_IDS } from "@/lib/blog/test-ids";
import { createTerm, deleteTerm, refusalMessage, renameTerm } from "@/lib/posts/client";

/**
 * The category and tag pickers of the post editor (M16-14). The blog's terms are listed as
 * checkboxes (a child category sits under its parent); choosing one writes its id into the post's
 * draft. Terms are created, renamed and deleted here too, through the terms routes: the server
 * checks the owner and the cap of 500 (HL015) and this only reports what it answered. Deleting a
 * term leaves every post alone; it drops out of the live pages at their next publish.
 */

const NAME_MAX = 80;

interface Props {
  taxonomy: "category" | "tag";
  siteId: string;
  /** Every term of the blog (both kinds); this picker shows its own. */
  terms: TermSummary[];
  onTermsChange: (next: TermSummary[]) => void;
  selected: string[];
  onSelect: (ids: string[]) => void;
  disabled: boolean;
}

const WORDS = {
  category: {
    title: "Categories",
    one: "category",
    add: "Add category",
    none: "No categories yet.",
  },
  tag: { title: "Tags", one: "tag", add: "Add tag", none: "No tags yet." },
} as const;

/** Top-level terms by name, each followed by its children. */
function ordered(terms: TermSummary[]): Array<{ term: TermSummary; child: boolean }> {
  const byName = (a: TermSummary, b: TermSummary) => a.name.localeCompare(b.name);
  const ids = new Set(terms.map((term) => term.id));
  const top = terms.filter((term) => term.parentId === null || !ids.has(term.parentId));
  return top.sort(byName).flatMap((term) => [
    { term, child: false },
    ...terms
      .filter((child) => child.parentId === term.id)
      .sort(byName)
      .map((child) => ({ term: child, child: true })),
  ]);
}

export function TermPicker({
  taxonomy,
  siteId,
  terms,
  onTermsChange,
  selected,
  onSelect,
  disabled,
}: Props) {
  const words = WORDS[taxonomy];
  const headingId = useId();
  const nameId = useId();
  const parentId = useId();
  const own = terms.filter((term) => term.taxonomy === taxonomy);
  const rows = ordered(own);
  const [name, setName] = useState("");
  const [parent, setParent] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [managing, setManaging] = useState(false);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const full = selected.length >= POST_LIMITS.terms;

  const toggle = (id: string) =>
    onSelect(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);

  async function add(event: FormEvent) {
    event.preventDefault();
    const clean = name.trim();
    if (clean === "" || busy) return;
    setBusy(true);
    setError(null);
    const out = await createTerm(siteId, {
      taxonomy,
      name: clean,
      ...(taxonomy === "category" && parent !== "" ? { parentId: parent } : {}),
    });
    setBusy(false);
    if (out.kind !== "ok") {
      setError(refusalMessage(out));
      return;
    }
    onTermsChange([...terms, out.term]);
    if (!full) onSelect([...selected, out.term.id]);
    setName("");
    setParent("");
  }

  async function saveName() {
    if (!renaming || busy) return;
    const clean = renaming.name.trim();
    if (clean === "") return;
    setBusy(true);
    setError(null);
    const out = await renameTerm(siteId, renaming.id, clean);
    setBusy(false);
    if (out.kind !== "ok") {
      setError(refusalMessage(out));
      return;
    }
    onTermsChange(terms.map((term) => (term.id === out.term.id ? out.term : term)));
    setRenaming(null);
  }

  async function remove(id: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    const out = await deleteTerm(siteId, id);
    setBusy(false);
    setConfirming(null);
    if (out.kind !== "ok") {
      setError(refusalMessage(out));
      return;
    }
    // Its children become top-level, as the database makes them.
    onTermsChange(
      terms
        .filter((term) => term.id !== id)
        .map((term) => (term.parentId === id ? { ...term, parentId: null } : term)),
    );
    if (selected.includes(id)) onSelect(selected.filter((x) => x !== id));
  }

  return (
    <section
      aria-labelledby={headingId}
      data-testid={taxonomy === "category" ? POST_TEST_IDS.categories : POST_TEST_IDS.tags}
      className="flex min-w-0 flex-col gap-2"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-3">
        <h3 id={headingId} className="m-0 text-[13px] font-semibold text-ink-2">
          {words.title}
        </h3>
        {own.length > 0 ? (
          <button
            type="button"
            aria-pressed={managing}
            disabled={disabled}
            onClick={() => {
              setManaging(!managing);
              setRenaming(null);
              setConfirming(null);
            }}
            className={FORM_BUTTON}
          >
            {managing ? "Done" : "Rename or delete"}
          </button>
        ) : null}
      </div>

      {rows.length === 0 ? (
        <p className="m-0 text-[13px] text-text-2">{words.none}</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          {rows.map(({ term, child }) => (
            <li
              key={term.id}
              data-term-id={term.id}
              className={`flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 ${child ? "pl-6" : ""}`}
            >
              {renaming?.id === term.id ? (
                <>
                  <input
                    type="text"
                    aria-label={`New name for ${term.name}`}
                    value={renaming.name}
                    maxLength={NAME_MAX}
                    onChange={(event) => setRenaming({ id: term.id, name: event.target.value })}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void saveName();
                      }
                    }}
                    className={controlClass(false, "flex-1 basis-40")}
                  />
                  <button type="button" disabled={busy} onClick={saveName} className={FORM_BUTTON}>
                    Save name
                  </button>
                  <button type="button" onClick={() => setRenaming(null)} className={FORM_BUTTON}>
                    Cancel
                  </button>
                </>
              ) : (
                <>
                  <label className="flex min-h-11 min-w-0 flex-1 cursor-pointer items-center gap-2.5 text-sm text-ink">
                    <input
                      type="checkbox"
                      checked={selected.includes(term.id)}
                      disabled={disabled || (full && !selected.includes(term.id))}
                      onChange={() => toggle(term.id)}
                      className="size-5 shrink-0 accent-[var(--hl-ink)]"
                    />
                    <span className="min-w-0 [overflow-wrap:anywhere]">{term.name}</span>
                  </label>
                  {managing && confirming !== term.id ? (
                    <>
                      <button
                        type="button"
                        disabled={disabled}
                        aria-label={`Rename ${term.name}`}
                        onClick={() => setRenaming({ id: term.id, name: term.name })}
                        className={FORM_BUTTON}
                      >
                        Rename
                      </button>
                      <button
                        type="button"
                        disabled={disabled}
                        aria-label={`Delete ${term.name}`}
                        onClick={() => setConfirming(term.id)}
                        className={FORM_BUTTON_DANGER}
                      >
                        Delete
                      </button>
                    </>
                  ) : null}
                  {confirming === term.id ? (
                    <>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void remove(term.id)}
                        className={FORM_BUTTON_DANGER}
                      >
                        Delete {words.one}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirming(null)}
                        className={FORM_BUTTON}
                      >
                        Keep
                      </button>
                    </>
                  ) : null}
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {confirming ? (
        <p className="m-0 text-xs text-text-2">
          Posts keep their text. The {words.one} leaves each live post the next time it is
          published.
        </p>
      ) : null}

      <form onSubmit={add} className="flex min-w-0 flex-wrap items-end gap-2">
        <div className="flex min-w-0 flex-1 basis-44 flex-col gap-1.5">
          <label htmlFor={nameId} className="text-xs text-text-2">
            New {words.one}
          </label>
          <input
            id={nameId}
            type="text"
            data-field={`new-${taxonomy}`}
            value={name}
            maxLength={NAME_MAX}
            disabled={disabled}
            onChange={(event) => setName(event.target.value)}
            className={controlClass(false)}
          />
        </div>
        {taxonomy === "category" && own.some((term) => term.parentId === null) ? (
          <div className="flex min-w-0 flex-1 basis-36 flex-col gap-1.5">
            <label htmlFor={parentId} className="text-xs text-text-2">
              Inside
            </label>
            <select
              id={parentId}
              value={parent}
              disabled={disabled}
              onChange={(event) => setParent(event.target.value)}
              className={controlClass(false)}
            >
              <option value="">No parent</option>
              {own
                .filter((term) => term.parentId === null)
                .map((term) => (
                  <option key={term.id} value={term.id}>
                    {term.name}
                  </option>
                ))}
            </select>
          </div>
        ) : null}
        <button
          type="submit"
          data-testid={`add-${taxonomy}`}
          disabled={disabled || busy || name.trim() === ""}
          className={FORM_BUTTON}
        >
          {words.add}
        </button>
      </form>
      <div aria-live="polite" className="empty:hidden">
        {error ? (
          <p data-testid={`${taxonomy}-error`} className="m-0 text-[13px] text-bad">
            {error}
          </p>
        ) : null}
        {full ? (
          <p className="m-0 text-xs text-text-2">
            A post holds up to {POST_LIMITS.terms} {words.title.toLowerCase()}.
          </p>
        ) : null}
      </div>
    </section>
  );
}
