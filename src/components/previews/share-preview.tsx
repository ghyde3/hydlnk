"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { SUSPENDED_REASON, useAccountSuspended } from "@/components/admin/suspension-context";
import { createPreviewLink, listPreviewLinks, revokePreviewLink } from "@/lib/previews/actions";
import { formatLinkDate } from "@/lib/previews/dates";
import { PREVIEW_LINK_LIMIT, PREVIEW_LINK_MESSAGES } from "@/lib/previews/messages";
import type { PreviewLinkSummary } from "@/lib/previews/types";

const BUTTON =
  "inline-flex min-h-11 w-full items-center justify-center rounded-md border px-4 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50 hl:w-auto";
const SECONDARY = `${BUTTON} border-line-3 bg-surface text-ink`;
const DANGER = `${BUTTON} border-bad-line bg-surface text-bad`;

const subscribeNothing = () => () => {};

const TURN_OFF_FAILED = "Couldn’t turn off the link. Try again.";

/** The error line for a failed call: the reason's own sentence, the generic one for anything else. */
function messageFor(reason: keyof typeof PREVIEW_LINK_MESSAGES | undefined): string {
  return PREVIEW_LINK_MESSAGES[reason ?? "failed"];
}

interface CreatedLink {
  id: string;
  url: string;
  expiresAt: string;
}

/**
 * "Share preview" (M6-12): a secondary button in the editor header that opens a modal dialog (a
 * native <dialog> shown with showModal(), so focus stays inside, the page behind is inert and Escape
 * closes it and gives focus back to the button). The dialog makes private links to the saved draft:
 * "Create link" first writes pending edits (`flush`), then asks the server (`createPreviewLink`) and
 * shows the full address once in a read-only field with "Copy link" and, where the browser has it,
 * "Share...". Under "Active links" every live link of this page is listed by its dates, each with
 * "Turn off", which acts at once and replaces the row with "Turned off.".
 *
 * The address and the token exist only in this component's state: never in storage, a cookie, the
 * URL or an attribute other than the field's value, and closing the dialog clears them. Only a hash
 * is stored on the server, so a link that was shown cannot be shown again. Everything the server
 * refuses (five active links, too many creates, signed out, a network or server failure) shows in
 * a `role="alert"` line inside the dialog, with the button enabled again except at the limit.
 */
export function SharePreview({
  pageId,
  flush,
}: {
  pageId: string;
  /** Writes pending edits and resolves true once they are stored (the autosave queue's flush). */
  flush: () => Promise<boolean>;
}) {
  const suspended = useAccountSuspended();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const copyRef = useRef<HTMLButtonElement>(null);
  const fieldRef = useRef<HTMLInputElement>(null);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const titleId = useId();
  const bodyId = useId();
  const fieldId = useId();

  const [open, setOpen] = useState(false);
  const [created, setCreated] = useState<CreatedLink | null>(null);
  const [links, setLinks] = useState<PreviewLinkSummary[] | null>(null);
  const [turnedOff, setTurnedOff] = useState<ReadonlySet<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [atLimit, setAtLimit] = useState(false);
  const [copied, setCopied] = useState(false);
  // The server and the first render say no; the browser says yes where the Web Share API exists.
  const canShare = useSyncExternalStore(
    subscribeNothing,
    () => typeof navigator.share === "function",
    () => false,
  );

  useEffect(() => {
    return () => {
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
    };
  }, []);

  // The live links of this page, read each time the dialog opens (never with an address).
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void listPreviewLinks(pageId)
      .then((result) => {
        if (cancelled || !result.ok) return;
        setLinks(result.links);
        setAtLimit(result.links.length >= PREVIEW_LINK_LIMIT);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [open, pageId]);

  function clearSecrets() {
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
    setCreated(null);
    setCopied(false);
    setError(null);
    setLinks(null);
    setTurnedOff(new Set());
    setAtLimit(false);
  }

  async function create() {
    if (creating || atLimit) return;
    setCreating(true);
    setError(null);
    try {
      // The link shows what is saved, so the newest edits are written first (as Publish does).
      const stored = await flush();
      if (!stored) {
        // The edits could not be written. If the session ended, say so (the same sentence the server
        // gives for a signed-out create); anything else is the generic line.
        const probe = await listPreviewLinks(pageId).catch(() => null);
        setError(
          messageFor(
            probe && !probe.ok && probe.reason === "unauthorized" ? "unauthorized" : "failed",
          ),
        );
        return;
      }
      const result = await createPreviewLink(pageId);
      if (!result.ok) {
        if (result.reason === "preview_link_limit") setAtLimit(true);
        setError(messageFor(result.reason));
        return;
      }
      setCreated({ id: result.id, url: result.url, expiresAt: result.expiresAt });
      setCopied(false);
      const listed = await listPreviewLinks(pageId).catch(() => null);
      if (listed?.ok) {
        setLinks(listed.links);
        setAtLimit(listed.links.length >= PREVIEW_LINK_LIMIT);
      }
      requestAnimationFrame(() => copyRef.current?.focus());
    } catch {
      // The request itself failed (a 5xx from the action, the network dropped).
      setError(PREVIEW_LINK_MESSAGES.failed);
    } finally {
      setCreating(false);
    }
  }

  async function copy() {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.url);
    } catch {
      // No clipboard access: select the address so a manual copy is one keystroke.
      fieldRef.current?.select();
      return;
    }
    setCopied(true);
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopied(false), 2000);
  }

  async function share() {
    if (!created) return;
    try {
      await navigator.share({ title: "Draft preview", url: created.url });
    } catch {
      // Dismissing the share sheet is not an error.
    }
  }

  async function turnOff(id: string) {
    setError(null);
    try {
      const result = await revokePreviewLink(id);
      if (!result.ok) {
        setError(result.reason === "unauthorized" ? messageFor("unauthorized") : TURN_OFF_FAILED);
        return;
      }
      setTurnedOff((current) => new Set(current).add(id));
      setAtLimit(false);
      if (created?.id === id) setCreated(null);
    } catch {
      setError(TURN_OFF_FAILED);
    }
  }

  const expires = created ? formatLinkDate(created.expiresAt) : null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={suspended}
        title={suspended ? SUSPENDED_REASON : undefined}
        onClick={() => {
          setOpen(true);
          dialogRef.current?.showModal();
        }}
        className="inline-flex min-h-11 cursor-pointer items-center rounded-md border border-line-3 bg-surface px-3.5 text-sm font-semibold text-ink disabled:cursor-not-allowed disabled:opacity-50"
      >
        Share preview
      </button>

      <dialog
        ref={dialogRef}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        onClose={() => {
          setOpen(false);
          clearSecrets();
          triggerRef.current?.focus();
        }}
        onKeyDown={(event) => {
          // Escape closes this dialog and nothing behind it (the preview tab's own Escape).
          if (event.key === "Escape") event.stopPropagation();
          if (event.key !== "Tab") return;
          const focusable = Array.from(
            event.currentTarget.querySelectorAll<HTMLElement>(
              'input:not([type="hidden"]), button:not([disabled])',
            ),
          );
          const first = focusable[0];
          const last = focusable[focusable.length - 1];
          if (!first || !last) return;
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }}
        className="m-auto max-h-[calc(100dvh-32px)] w-[calc(100%-32px)] max-w-[480px] overflow-y-auto rounded-md border border-line bg-surface p-4 text-ink backdrop:bg-ink/60 hl:p-5"
      >
        <div className="flex flex-col gap-4">
          <h2 id={titleId} className="text-base font-bold">
            Share a preview
          </h2>
          <div id={bodyId} className="flex flex-col gap-1.5 text-sm leading-relaxed text-text-2">
            <div>
              Anyone with the link can see your unpublished draft for 7 days. They can’t edit it.
            </div>
            <div>Shows your latest saved draft.</div>
          </div>

          <button
            type="button"
            onClick={() => void create()}
            disabled={creating || atLimit}
            aria-busy={creating || undefined}
            className={`${BUTTON} border-ink bg-ink text-surface`}
          >
            {creating ? "Creating..." : "Create link"}
          </button>

          {created ? (
            <div className="flex flex-col gap-2.5">
              <label htmlFor={fieldId} className="text-[13px] font-semibold text-ink-2">
                Preview link
              </label>
              <input
                ref={fieldRef}
                id={fieldId}
                type="text"
                readOnly
                value={created.url}
                onFocus={(event) => event.currentTarget.select()}
                autoComplete="off"
                spellCheck={false}
                className="min-h-11 w-full rounded-md border border-line-3 bg-surface px-3 font-mono text-base"
              />
              <div className="flex flex-col gap-2 hl:flex-row">
                <button
                  ref={copyRef}
                  type="button"
                  onClick={() => void copy()}
                  className={SECONDARY}
                >
                  {copied ? "Copied" : "Copy link"}
                </button>
                {canShare ? (
                  <button type="button" onClick={() => void share()} className={SECONDARY}>
                    Share...
                  </button>
                ) : null}
              </div>
              <span role="status" aria-live="polite" className="sr-only">
                {copied ? "Link copied." : ""}
              </span>
              <div className="flex flex-col gap-1 text-[13px] leading-snug text-text-2">
                <div>This link expires {expires}.</div>
                <div>Copy it now. You can’t see this link again.</div>
              </div>
            </div>
          ) : null}

          {error ? (
            <div role="alert" className="text-sm text-bad">
              {error}
            </div>
          ) : atLimit ? (
            <div role="alert" className="text-sm text-bad">
              {PREVIEW_LINK_MESSAGES.preview_link_limit}
            </div>
          ) : null}

          {links && links.length > 0 ? (
            <section aria-labelledby={`${titleId}-links`} className="flex flex-col gap-2">
              <h3 id={`${titleId}-links`} className="text-[13px] font-semibold text-ink-2">
                Active links
              </h3>
              <ul className="flex flex-col">
                {links.map((link) => (
                  <li
                    key={link.id}
                    data-preview-link={link.id}
                    className="flex flex-col gap-2 border-t border-line py-2.5 first:border-t-0 hl:flex-row hl:items-center hl:justify-between"
                  >
                    {turnedOff.has(link.id) ? (
                      <span role="status" className="text-sm text-text-2">
                        Turned off.
                      </span>
                    ) : (
                      <>
                        <span className="text-sm">
                          Created {formatLinkDate(link.createdAt, false)}, expires{" "}
                          {formatLinkDate(link.expiresAt, false)}
                        </span>
                        <button
                          type="button"
                          onClick={() => void turnOff(link.id)}
                          className={DANGER}
                        >
                          Turn off
                        </button>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <div className="flex flex-col-reverse gap-2 hl:flex-row hl:justify-end">
            <button type="button" onClick={() => dialogRef.current?.close()} className={SECONDARY}>
              Close
            </button>
          </div>
        </div>
      </dialog>
    </>
  );
}
