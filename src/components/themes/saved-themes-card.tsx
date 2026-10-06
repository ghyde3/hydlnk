"use client";

import { useId, useRef, useState } from "react";
import {
  SAVED_THEMES_HINT,
  THEMES_LOAD_FAILED_MESSAGE,
  THEME_DELETED_NOTICE,
} from "@/lib/editor/messages";
import { ownThemes } from "@/lib/themes";
import { DeleteThemeDialog } from "./delete-theme-dialog";
import { RenameThemeDialog } from "./rename-theme-dialog";
import { SaveAsThemeButton } from "./save-as-theme-button";
import { ThemeCard } from "./theme-card";
import { ThemeCarousel } from "./theme-carousel";
import type { ThemeLibrary, ThemeMessage } from "./use-theme-library";

/**
 * The Design screen's "Themes" card (M3-19 .. M3-24, laid out as two carousels by M7-06): one card
 * whose title is visually hidden, holding two horizontally scrolling rows, "Your themes · N" first
 * (with "Save as theme" at its right) and "HYDLNK themes · 16" after it. The applied theme's card is
 * pressed, outlined in brass and tagged "Applied" (or "Edited" once the page's own style changes
 * it); its row scrolls to it. Pressing a card applies it to the draft, with an Undo. A card's "More"
 * menu has Preview, and for the user's own themes Rename and Delete. A saved theme can also be
 * updated from the page's tokens. All state is the `library` the screen made with
 * `useThemeLibrary`; this component only draws it.
 *
 * Messages (Applied with Undo, Saved, Updated, Renamed, Deleted, the Free limit, errors) show in
 * one polite status region above the rows. On a phone a success message is fixed above the bottom
 * tab bar, clear of the mini phone at its right; errors and the limit message stay in the card,
 * with a 44px Dismiss. The card is the same height whatever the number of themes: every card is
 * 94px tall, and a row with no themes shows its hint in a box as tall as a card.
 */
export function SavedThemesCard({
  library,
  loadFailed,
  onPreview,
  previewingId = null,
  onBeforeSave,
  deletedNotice = false,
}: {
  library: ThemeLibrary;
  /**
   * M6-44: every card's menu gets a Preview item that calls this with the theme's id and the card's
   * More button (the focus to come back to). Without it there is no Preview item, and a system
   * theme's card has no menu.
   */
  onPreview?: ((id: string, button: HTMLElement) => void) | undefined;
  /** The theme on show in the preview, or null. */
  previewingId?: string | null;
  /** Runs first on every press of "Save as theme": the Design screen ends a theme preview here (M6-44). */
  onBeforeSave?: (() => void) | undefined;
  /**
   * The page's theme is gone (M5-16, M9-34): a draft that names a deleted theme, or the theme the
   * person has just deleted. The card says so under its message region, in its own status element.
   */
  deletedNotice?: boolean;
  /**
   * Set when the server could not read the themes (M5-16): the card says so and offers Retry instead
   * of the rows, and nothing else on the screen changes.
   */
  loadFailed?: { onRetry: () => void; retrying: boolean } | null | undefined;
}) {
  const { themes, applied, edited } = library;
  const [deleting, setDeleting] = useState<{ id: string; name: string } | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const ownHeading = useRef<HTMLHeadingElement>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const ownId = useId();
  const systemId = useId();

  const own = ownThemes(themes);
  const system = themes.filter((theme) => theme.system);
  const appliedIsOwn = applied !== null && !applied.system;

  // The rows look for the applied card again after anything that can move it: an apply, an undo, a
  // redo (the applied theme changes, or the tag flips between Applied and Edited), a save (a card
  // joins the list), a retry that brought the themes. A rename or a delete does not: the row stays
  // where the person left it.
  const syncKey = `${themes.map((theme) => theme.id).join(",")}|${edited}`;

  function closeDialog(restoreFocus: boolean) {
    setDeleting(null);
    setRenaming(null);
    if (restoreFocus) setTimeout(() => trigger.current?.focus(), 0);
  }

  const card = (theme: (typeof themes)[number]) => (
    <ThemeCard
      key={theme.id}
      theme={theme}
      tag={library.tagFor(theme.id)}
      onApply={() => library.apply(theme.id)}
      onPreview={onPreview ? (button) => onPreview(theme.id, button) : undefined}
      previewing={previewingId === theme.id}
      onRename={(button) => {
        trigger.current = button;
        setRenaming({ id: theme.id, name: theme.name });
      }}
      onDelete={(button) => {
        trigger.current = button;
        setDeleting({ id: theme.id, name: theme.name });
      }}
    />
  );

  return (
    <section
      aria-labelledby={titleId}
      data-testid="saved-themes-card"
      className="flex flex-col rounded-md border border-line bg-surface p-4 hl:p-5"
    >
      <h2 id={titleId} className="sr-only">
        Themes
      </h2>

      <div role="status" aria-live="polite" data-testid="theme-message-region">
        {library.message ? <Message message={library.message} library={library} /> : null}
      </div>

      {deletedNotice ? (
        <p
          role="status"
          data-testid="theme-deleted-notice"
          className="mb-3 rounded-md border border-line-2 bg-surface px-4 py-3 text-sm text-ink-2"
        >
          {THEME_DELETED_NOTICE}
        </p>
      ) : null}

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
        <div className="mb-3">
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

      {loadFailed ? null : (
        <>
          <ThemeCarousel
            headingId={ownId}
            headingRef={ownHeading}
            title={`Your themes · ${own.length}`}
            testId="own-themes"
            appliedId={appliedIsOwn ? applied.id : null}
            syncKey={syncKey}
            action={<SaveAsThemeButton library={library} onBefore={onBeforeSave} />}
            empty={
              own.length === 0 ? (
                <p
                  data-testid="saved-themes-hint"
                  className="m-0 box-border flex h-[94px] items-center rounded-md border border-dashed border-line-3 px-4 text-[13px] leading-normal text-text-2"
                >
                  {SAVED_THEMES_HINT}
                </p>
              ) : null
            }
          >
            {own.map(card)}
          </ThemeCarousel>

          <div className="mt-4">
            <ThemeCarousel
              headingId={systemId}
              title={`HYDLNK themes · ${system.length}`}
              testId="system-themes"
              appliedId={applied?.system ? applied.id : null}
              syncKey={syncKey}
            >
              {system.map(card)}
            </ThemeCarousel>
          </div>
        </>
      )}

      {renaming ? (
        <RenameThemeDialog
          key={renaming.id}
          initial={renaming.name}
          onSubmit={(input) => library.rename(renaming.id, input)}
          onClose={() => closeDialog(true)}
        />
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
              // The card that held the trigger is gone with the theme: land on the row's heading.
              if (gone) setTimeout(() => ownHeading.current?.focus(), 0);
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
        className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-bad-line bg-surface py-1 pr-1 pl-4 text-sm text-bad"
      >
        <span className="min-w-0 flex-1 basis-[200px] py-2">{message.text}</span>
        <button type="button" onClick={library.dismissMessage} className={DISMISS}>
          Dismiss
        </button>
      </div>
    );
  }
  // A success message: fixed above the bottom tab bar on a phone, ending 72px from the right edge so
  // the mini phone (48px wide, 16px from the edge) keeps 8px of room; in the card from 760px up.
  return (
    <div
      data-testid="theme-message"
      data-kind={message.kind}
      className="fixed bottom-[calc(68px+env(safe-area-inset-bottom))] left-4 right-[72px] z-30 flex min-h-11 items-center justify-between gap-3 rounded-md bg-ink py-1 pr-1 pl-4 text-sm text-on-ink hl:static hl:z-auto hl:mb-3 hl:w-fit hl:max-w-full hl:min-w-[280px]"
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
