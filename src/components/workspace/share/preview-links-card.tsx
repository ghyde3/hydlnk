"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { SUSPENDED_REASON, useAccountSuspended } from "@/components/admin/suspension-context";
import { createPreviewLink, listPreviewLinks, revokePreviewLink } from "@/lib/previews/actions";
import { formatLinkDate } from "@/lib/previews/dates";
import { PREVIEW_LINK_LIMIT, PREVIEW_LINK_MESSAGES } from "@/lib/previews/messages";
import type { PreviewLinkSummary } from "@/lib/previews/types";
import { useWorkspace } from "../workspace-context";
import { CARD, CARD_TITLE, DANGER_BUTTON, PRIMARY_BUTTON, SECONDARY_BUTTON } from "./styles";

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
 * "Private preview links" (M7-04, M6-12), inline on the Share tab instead of a dialog. 'Create
 * link' first writes pending edits (`autosave.flush`), then asks the server (`createPreviewLink`)
 * and shows the full address once in a read-only field with 'Copy link' and, where the browser has
 * it, 'Share...'. Under 'Active links' every live link of this page is listed by its dates, each
 * with 'Turn off', which acts at once and replaces the row with 'Turned off.'.
 *
 * The address and the token exist only in this component's state: never in storage, a cookie, the
 * URL or an attribute other than the field's value, and leaving the Share tab clears them (the
 * component unmounts). Only a hash is stored on the server, so a link that was shown cannot be shown
 * again. The list is read once when the tab opens. Everything the server refuses (five active links,
 * too many creates, signed out, a network or server failure) shows in a `role="alert"` line here,
 * with the button enabled again except at the limit.
 */
export function PreviewLinksCard() {
  const { pageId, autosave } = useWorkspace();
  const { flush } = autosave;
  const suspended = useAccountSuspended();
  const copyRef = useRef<HTMLButtonElement>(null);
  const fieldRef = useRef<HTMLInputElement>(null);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const headingId = useId();
  const fieldId = useId();

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

  // The live links of this page, read once when the tab opens (never with an address). The ref keeps
  // React's development double-run of effects from asking twice; a result that arrives after the
  // tab was left sets state on an unmounted component, which does nothing.
  const listed = useRef(false);
  useEffect(() => {
    if (listed.current) return;
    listed.current = true;
    void listPreviewLinks(pageId)
      .then((result) => {
        if (!result.ok) return;
        setLinks(result.links);
        setAtLimit(result.links.length >= PREVIEW_LINK_LIMIT);
      })
      .catch(() => undefined);
  }, [pageId]);

  async function create() {
    if (creating || atLimit || suspended) return;
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
    <section
      aria-labelledby={headingId}
      id="preview-links"
      data-testid="preview-links-card"
      className={CARD}
    >
      <h2 id={headingId} className={CARD_TITLE}>
        Private preview links
      </h2>
      <div className="flex flex-col gap-1.5 text-sm leading-relaxed text-text-2">
        <div>
          Anyone with the link can see your unpublished draft for 7 days. They can’t edit it.
        </div>
        <div>Shows your latest saved draft.</div>
      </div>

      <div>
        <button
          type="button"
          onClick={() => void create()}
          disabled={creating || atLimit || suspended}
          aria-busy={creating || undefined}
          title={suspended ? SUSPENDED_REASON : undefined}
          className={PRIMARY_BUTTON}
        >
          {creating ? "Creating..." : "Create link"}
        </button>
      </div>

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
              className={SECONDARY_BUTTON}
            >
              {copied ? "Copied" : "Copy link"}
            </button>
            {canShare ? (
              <button type="button" onClick={() => void share()} className={SECONDARY_BUTTON}>
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
        <section aria-labelledby={`${headingId}-links`} className="flex flex-col gap-2">
          <h3 id={`${headingId}-links`} className="text-[13px] font-semibold text-ink-2">
            Active links
          </h3>
          <ul className="m-0 flex list-none flex-col p-0">
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
                      className={DANGER_BUTTON}
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
    </section>
  );
}
