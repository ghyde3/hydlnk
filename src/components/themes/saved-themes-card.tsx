"use client";

import { useRef, useState } from "react";
import { SAVED_THEMES_HINT, THEMES_LOAD_FAILED_MESSAGE } from "@/lib/editor/messages";
import { ownThemes } from "@/lib/themes";
import { DeleteThemeDialog } from "./delete-theme-dialog";
import { ThemeCard } from "./theme-card";
import type { ThemeLibrary, ThemeMessage } from "./use-theme-library";

/**
 * The Design screen's "Saved themes" card (M3-19 .. M3-24): every system theme, then the user's
 * own, in a grid of cards; the applied one is pressed and tagged "Applied" (or "Edited" once the
 * page overrides change it). Pressing a card applies it to the draft, with an Undo. A saved theme
 * can be updated from the page's tokens, renamed and deleted. All state is the `library` the
 * screen made with `useThemeLibrary`; this component only draws it.
 *
 * Messages (Applied with Undo, Saved, Updated, Renamed, Deleted, the Free limit, errors) show in
 * one polite status region above the grid. On a phone a success message is fixed above the bottom
 * tab bar, where the editor's own toasts sit; errors and the limit message stay in the card, with
 * a 44px Dismiss.
 */
export function SavedThemesCard({
  library,
  loadFailed,
}: {
  library: ThemeLibrary;
  /**
   * Set when the server could not read the themes (M5-16): the row says so and offers Retry instead
   * of the grid, and nothing else on the screen changes.
   */
  loadFailed?: { onRetry: () => void; retrying: boolean } | null | undefined;
}) {
  const { themes, applied, edited } = library;
  const [deleting, setDeleting] = useState<{ id: string; name: string } | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const trigger = useRef<HTMLElement | null>(null);

  function closeDialog(restoreFocus: boolean) {
    setDeleting(null);
    if (restoreFocus) setTimeout(() => trigger.current?.focus(), 0);
  }

  return (
    <section
      aria-labelledby="saved-themes-title"
      data-testid="saved-themes-card"
      className="flex flex-col gap-3 rounded-md border border-line bg-surface p-4 hl:p-5"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2
          id="saved-themes-title"
          ref={heading}
          tabIndex={-1}
          className="m-0 text-sm font-semibold outline-none"
        >
          Saved themes
        </h2>
        <span className="text-xs text-text-2">
          Applying one replaces your page’s own style changes
        </span>
      </div>

      <div role="status" aria-live="polite" data-testid="theme-message-region">
        {library.message ? <Message message={library.message} library={library} /> : null}
      </div>

      {loadFailed ? (
        <div
          role="alert"
          data-testid="themes-load-error"
          className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-bad-line bg-surface py-1 pr-1 pl-4 text-sm text-bad"
        >
          <span className="min-w-0 flex-1 basis-[200px] py-2">{THEMES_LOAD_FAILED_MESSAGE}</span>
          <button
            type="button"
            onClick={loadFailed.onRetry}
            disabled={loadFailed.retrying}
            aria-busy={loadFailed.retrying || undefined}
            className={`${DISMISS} disabled:cursor-progress disabled:opacity-70`}
          >
            Retry
          </button>
        </div>
      ) : null}

      {!loadFailed && applied && !applied.system && edited ? (
        <div>
          <button
            type="button"
            data-testid="theme-update"
            disabled={library.pending}
            onClick={() => void library.updateApplied()}
            className="inline-flex min-h-11 max-w-full cursor-pointer items-center rounded-md border border-line-3 bg-surface px-3.5 py-2 text-left text-sm font-semibold break-words text-ink disabled:cursor-not-allowed disabled:opacity-50"
          >
            Update {applied.name}
          </button>
        </div>
      ) : null}

      <ul
        className="m-0 grid list-none gap-2 p-0 empty:hidden"
        style={{ gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))" }}
        data-testid="theme-grid"
        hidden={loadFailed ? true : undefined}
      >
        {themes.map((theme) => (
          <ThemeCard
            key={theme.id}
            theme={theme}
            tag={library.tagFor(theme.id)}
            onApply={() => library.apply(theme.id)}
            onRename={(input) => library.rename(theme.id, input)}
            onDelete={(button) => {
              trigger.current = button;
              setDeleting({ id: theme.id, name: theme.name });
            }}
          />
        ))}
      </ul>

      {!loadFailed && ownThemes(themes).length === 0 ? (
        <p data-testid="saved-themes-hint" className="m-0 text-[13px] leading-normal text-text-2">
          {SAVED_THEMES_HINT}
        </p>
      ) : null}

      {deleting ? (
        <DeleteThemeDialog
          name={deleting.name}
          busy={library.pending}
          onCancel={() => closeDialog(true)}
          onConfirm={() => {
            const target = deleting;
            void library.remove(target.id).then((gone) => {
              setDeleting(null);
              // The card that held the trigger is gone with the theme: land on the heading.
              if (gone) setTimeout(() => heading.current?.focus(), 0);
              else setTimeout(() => trigger.current?.focus(), 0);
            });
          }}
        />
      ) : null}
    </section>
  );
}

const DISMISS =
  "inline-flex min-h-11 shrink-0 cursor-pointer items-center justify-center rounded-md border border-bad-line bg-surface px-4 text-[13px] font-semibold text-bad";

function Message({ message, library }: { message: ThemeMessage; library: ThemeLibrary }) {
  if (message.kind === "limit" || message.kind === "error") {
    return (
      <div
        data-testid="theme-message"
        data-kind={message.kind}
        className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-bad-line bg-surface py-1 pr-1 pl-4 text-sm text-bad"
      >
        <span className="min-w-0 flex-1 basis-[200px] py-2">{message.text}</span>
        <button type="button" onClick={library.dismissMessage} className={DISMISS}>
          Dismiss
        </button>
      </div>
    );
  }
  return (
    <div
      data-testid="theme-message"
      data-kind={message.kind}
      className="fixed inset-x-4 bottom-[calc(68px+env(safe-area-inset-bottom))] z-30 flex min-h-11 items-center justify-between gap-3 rounded-md bg-ink py-1 pr-1 pl-4 text-sm text-on-ink hl:static hl:inset-auto hl:z-auto hl:w-fit hl:max-w-full hl:min-w-[280px]"
    >
      <span className="min-w-0 py-2 break-words">{message.text}</span>
      {message.undo ? (
        <button
          type="button"
          data-testid="theme-undo"
          onClick={library.undo}
          className="inline-flex min-h-11 shrink-0 cursor-pointer items-center rounded-sm px-4 font-semibold text-ink-link"
        >
          Undo
        </button>
      ) : null}
    </div>
  );
}
