"use client";

import { ArrowDown, ArrowUp } from "lucide-react";
import { useId, useRef, useState } from "react";
import { Icon } from "@/components/app/icon";
import { FORM_BUTTON, FORM_BUTTON_DANGER } from "@/components/blocks/field";
import { TextField } from "@/components/blocks/text-field";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { NAV_MAX_ITEMS, NAV_MESSAGES, SUB_PAGE_LIMITS } from "@/lib/document";
import { STORAGE_FULL_MESSAGE } from "@/lib/editor/messages";
import type { SubSaveStatus } from "@/lib/site-pages/saver";
import { PathField } from "./pages-card";
import { ToggleRow } from "./toggle-row";

const SAVE_TEXT: Record<SubSaveStatus, string> = {
  idle: "",
  pending: "Saving…",
  saving: "Saving…",
  saved: "Saved",
  error: "Not saved. Retrying…",
  "too-large": "This page is too large to save. Remove some content.",
  "storage-full": STORAGE_FULL_MESSAGE,
  invalid: "This page can’t be saved yet. Fix the field with an error.",
  "signed-out": "You’re signed out. Sign in again to save.",
  blocked: "A link on this page points to a blocked site. Change it to save.",
  missing: "This page was deleted somewhere else. Reload to continue.",
};

/**
 * The settings of the open sub-page (M11-08): title, description, path, its place in the menu and
 * Delete. Title, description, path and the menu are draft: they save as you type and go live with
 * Publish. Delete is not draft: the page leaves the live site now, so the confirmation says so.
 */
export function PageSettingsCard() {
  const { site, liveUrl } = useWorkspace();
  const headingId = useId();
  const [menuMessage, setMenuMessage] = useState<string | null>(null);
  const id = site.activeId;
  const settings = site.activeSettings;
  const item = site.items.find((entry) => entry.id === id);
  if (!settings || !item) return null;
  const own = (field: string) =>
    site.fieldErrors[id]?.find((error) => error.field === field)?.message ?? null;
  const pathError = site.pathError(settings.path, id) ?? own("path");
  const menuItems = site.items.filter((entry) => !entry.home && entry.inMenu);
  const position = item.menuIndex;

  return (
    <section
      aria-labelledby={headingId}
      data-testid="page-settings"
      // Its fields are not steps of the draft history: Ctrl+Z in them is the browser's own.
      data-native-undo=""
      className="flex flex-col gap-3 rounded-md border border-line bg-surface p-3.5"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h2 id={headingId} className="text-sm font-semibold [overflow-wrap:anywhere]">
          Page settings
        </h2>
        <span role="status" data-testid="page-save-status" className="text-xs text-text-2">
          {SAVE_TEXT[site.saveStatus]}
        </span>
      </div>
      <TextField
        label="Title"
        field="page-title"
        max={SUB_PAGE_LIMITS.title}
        value={settings.title}
        error={settings.title.trim() === "" ? "Add a page title." : own("title")}
        onChange={(title) => site.updateSettings(id, { title })}
      />
      <TextField
        label="Description"
        field="page-description"
        max={SUB_PAGE_LIMITS.description}
        value={settings.description}
        error={own("description")}
        hint="Shown in search results and link previews."
        onChange={(description) => site.updateSettings(id, { description })}
      />
      <PathField
        label="Path"
        field="page-path"
        value={settings.path}
        error={pathError}
        hint={`Live at ${liveUrl.replace(/^https?:\/\//, "")}/${settings.path.trim()}`}
        onChange={(path) => site.updateSettings(id, { path })}
      />

      <div className="flex flex-col gap-2">
        <ToggleRow
          label="Show in the menu"
          testId="page-in-menu"
          pressed={item.inMenu}
          onToggle={() => {
            // The menu holds at most NAV_MAX_ITEMS pages: past that the draft would not save.
            if (!item.inMenu && menuItems.length >= NAV_MAX_ITEMS) {
              setMenuMessage(NAV_MESSAGES.menuFull);
              return;
            }
            setMenuMessage(null);
            site.toggleMenu(id);
          }}
        />
        {menuMessage ? (
          <p role="alert" data-testid="page-menu-full" className="m-0 text-[13px] text-bad">
            {menuMessage}
          </p>
        ) : null}
        {item.inMenu && position !== null ? (
          <div className="flex flex-wrap items-center gap-2" data-testid="menu-order">
            <span className="text-[13px] text-text-2">
              Menu place {position + 1} of {menuItems.length}
            </span>
            <button
              type="button"
              data-testid="menu-up"
              aria-label={`Move ${item.title} up in the menu`}
              disabled={position === 0}
              onClick={() => site.moveInMenu(id, -1)}
              className={FORM_BUTTON}
            >
              <Icon icon={ArrowUp} size={16} />
            </button>
            <button
              type="button"
              data-testid="menu-down"
              aria-label={`Move ${item.title} down in the menu`}
              disabled={position === menuItems.length - 1}
              onClick={() => site.moveInMenu(id, 1)}
              className={FORM_BUTTON}
            >
              <Icon icon={ArrowDown} size={16} />
            </button>
          </div>
        ) : null}
      </div>

      <DeletePage id={id} title={item.title} />
    </section>
  );
}

/** Delete with a confirmation that says the page leaves the live site now (a native modal dialog). */
function DeletePage({ id, title }: { id: string; title: string }) {
  const { site } = useWorkspace();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleId = useId();
  const bodyId = useId();

  async function confirmDelete() {
    if (pending) return;
    setPending(true);
    setError(null);
    const result = await site.remove(id);
    setPending(false);
    if (result.ok) dialogRef.current?.close();
    else setError(result.message);
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        data-testid="delete-page"
        onClick={() => dialogRef.current?.showModal()}
        className={`${FORM_BUTTON_DANGER} self-start`}
      >
        Delete page
      </button>
      <dialog
        ref={dialogRef}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        data-testid="delete-page-dialog"
        onClose={() => {
          setError(null);
          triggerRef.current?.focus();
        }}
        className="m-auto max-h-[calc(100dvh-32px)] w-[calc(100%-32px)] max-w-[440px] overflow-y-auto rounded-md border border-line bg-surface p-4 text-ink backdrop:bg-ink/60 hl:p-5"
      >
        <div className="flex flex-col gap-4">
          <h2 id={titleId} className="text-base font-bold [overflow-wrap:anywhere]">
            Delete {title}?
          </h2>
          <p id={bodyId} className="m-0 text-sm leading-relaxed text-text-2">
            This page leaves the live site now, without waiting for Publish. Its menu entry goes and
            page links to it stop showing. This can’t be undone.
          </p>
          {error ? (
            <p role="alert" className="m-0 text-[13px] text-bad">
              {error}
            </p>
          ) : null}
          <div className="flex flex-col-reverse gap-2 hl:flex-row hl:justify-end">
            <button
              type="button"
              onClick={() => dialogRef.current?.close()}
              className={FORM_BUTTON}
            >
              Cancel
            </button>
            <button
              type="button"
              data-testid="delete-page-confirm"
              disabled={pending}
              onClick={() => void confirmDelete()}
              className="inline-flex min-h-11 cursor-pointer items-center justify-center rounded-md border border-bad bg-bad px-4 text-sm font-semibold text-surface disabled:cursor-progress disabled:opacity-70"
            >
              {pending ? "Deleting…" : "Delete page"}
            </button>
          </div>
        </div>
      </dialog>
    </>
  );
}
