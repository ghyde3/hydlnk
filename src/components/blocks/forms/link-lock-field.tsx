"use client";

import { useId, useState, useTransition } from "react";
import {
  LOCK_CODE_MAX,
  LOCK_SET_FAILED_MESSAGE,
  codePointLength,
  lockCodeError,
  type LinkBlock,
  type PublishError,
} from "@/lib/document";
import { Field, FORM_BUTTON, controlClass } from "../field";

/**
 * 'Lock this link' (M9-30), under 'Link tags': a select, 'Not locked', 'Age check' or 'Code'. An age
 * check needs nothing else. 'Code' shows a Code field and a 'Set code' button that calls the
 * `hashLinkCode` Server Action and writes `{kind: 'code', salt, hash}` into the draft; after that the
 * group says a code is set (it can never be shown again) and offers 'Remove lock'.
 *
 * The plaintext code lives in this component's state and nowhere else: it is sent in the one Server
 * Action request, never put in the draft, the undo history, the console or a DOM attribute, and the
 * field is cleared the moment the hash comes back. On every plan.
 */

export const CODE_SET_NOTE = "A code is set. Enter a new one to change it.";

type Choice = "none" | "age" | "code";

function choiceOf(block: LinkBlock): Choice {
  const kind = block.lock?.kind;
  return kind === "age" ? "age" : kind === "code" ? "code" : "none";
}

/** The Publish gate's message for this block's lock. */
export function lockErrorOf(errors: readonly PublishError[], blockId: string): string | null {
  const hit = errors.find(
    (error) => error.blockId === blockId && error.itemId === undefined && error.field === "lock",
  );
  return hit ? hit.message : null;
}

export function LinkLockField({
  block,
  errors,
  onChange,
}: {
  block: LinkBlock;
  errors: readonly PublishError[];
  onChange: (next: LinkBlock) => void;
}) {
  const choice = choiceOf(block);
  const [code, setCode] = useState("");
  const [failed, setFailed] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const statusId = useId();

  const hasCode =
    block.lock?.kind === "code" && typeof block.lock.hash === "string" && block.lock.hash !== "";
  const publishError = lockErrorOf(errors, block.id);
  // Typing shows the rule at once; nothing is sent until 'Set code'.
  const typed = code === "" ? null : lockCodeError(code);
  const fieldError = problem ?? typed ?? (hasCode ? null : publishError);

  function choose(next: Choice): void {
    setCode("");
    setFailed(false);
    setProblem(null);
    if (next === choice) return;
    if (next === "none") {
      const rest: LinkBlock = { ...block };
      delete rest.lock;
      onChange(rest);
    } else {
      onChange({ ...block, lock: { kind: next } });
    }
  }

  function setNewCode(): void {
    const error = lockCodeError(code);
    if (error !== null) {
      setProblem(error);
      return;
    }
    setProblem(null);
    setFailed(false);
    const sent = code;
    startTransition(async () => {
      try {
        // Loaded when a code is set, not with the form: the Server Action module reaches server-only
        // code, which a unit test that only draws the form must never import.
        const { hashLinkCode } = await import("@/lib/links/actions");
        const result = await hashLinkCode(sent);
        if (!result.ok) {
          setProblem(result.message);
          return;
        }
        // The plaintext is gone from this component the moment the hash is here.
        setCode("");
        onChange({ ...block, lock: { kind: "code", salt: result.salt, hash: result.hash } });
      } catch {
        setFailed(true);
      }
    });
  }

  return (
    <div data-testid="link-lock-field" className="flex min-w-0 flex-col gap-2">
      <Field label="Lock this link" hint="Ask for an age check or a code before this link opens.">
        {(control) => (
          <select
            {...control}
            value={choice}
            data-field="lock-kind"
            onChange={(event) => choose(event.target.value as Choice)}
            className={controlClass(false, "py-0")}
          >
            <option value="none">Not locked</option>
            <option value="age">Age check</option>
            <option value="code">Code</option>
          </select>
        )}
      </Field>

      {choice === "code" ? (
        <div className="flex flex-col gap-2">
          <Field
            label="Code"
            error={fieldError}
            suffix={
              <span className="font-mono text-[11px] text-text-2" aria-hidden="true">
                {codePointLength(code)} / {LOCK_CODE_MAX}
              </span>
            }
          >
            {(control) => (
              <input
                {...control}
                type="text"
                value={code}
                data-field="lock-code"
                autoComplete="off"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                placeholder="Choose a code"
                aria-describedby={[control["aria-describedby"], statusId].filter(Boolean).join(" ")}
                onChange={(event) => {
                  setProblem(null);
                  setCode(event.target.value.slice(0, 64));
                }}
                className={controlClass(fieldError !== null, "font-mono")}
              />
            )}
          </Field>
          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              data-testid="lock-set-code"
              disabled={pending || code === ""}
              onClick={setNewCode}
              className={FORM_BUTTON}
            >
              {pending ? "Setting code" : "Set code"}
            </button>
            {hasCode ? (
              <button
                type="button"
                data-testid="lock-remove"
                onClick={() => choose("none")}
                className={FORM_BUTTON}
              >
                Remove lock
              </button>
            ) : null}
          </div>
          <div id={statusId} role="status" className="empty:hidden">
            {failed ? (
              <p className="m-0 flex flex-wrap items-center gap-2 text-[13px] text-bad">
                {LOCK_SET_FAILED_MESSAGE}
                <button type="button" onClick={setNewCode} className={FORM_BUTTON}>
                  Retry
                </button>
              </p>
            ) : hasCode ? (
              <p className="m-0 text-[13px] text-text-2">{CODE_SET_NOTE}</p>
            ) : null}
          </div>
        </div>
      ) : choice === "age" ? (
        <p className="m-0 text-xs text-text-2">
          Visitors are asked whether they want to continue before this link opens.
        </p>
      ) : null}
    </div>
  );
}
