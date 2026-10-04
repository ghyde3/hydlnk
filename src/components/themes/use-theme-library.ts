"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { DocTheme, DraftDoc } from "@/lib/document";
import type { PlanId } from "@/lib/limits/table";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import { resolveTokens, type TokenSet } from "@/lib/theme";
import {
  SAVED_THEME_LIMIT,
  cardTag,
  checkThemeName,
  deleteSavedTheme,
  insertSavedTheme,
  isEdited,
  nextThemeName,
  ownThemes,
  renameSavedTheme,
  resolvedTokensFor,
  savedThemeLimitMessage,
  themeById,
  themeStatusLabel,
  updateSavedThemeTokens,
  type ThemeOpFailure,
  type ThemeRow,
} from "@/lib/themes";

/** How long a success message (with its Undo, when it has one) stays: longer than the 8 s the Design acceptance asks for. */
export const THEME_MESSAGE_MS = 10_000;

export type ThemeMessageKind =
  "applied" | "undone" | "saved" | "updated" | "renamed" | "deleted" | "limit" | "error";

/**
 * What the saved-themes card says after an action. Success messages (and the Undo of an apply)
 * disappear after `THEME_MESSAGE_MS`; the limit message and errors stay until dismissed or until
 * the next action. `token` changes with every message, so a repeat of the same text announces again.
 */
export interface ThemeMessage {
  kind: ThemeMessageKind;
  text: string;
  /** True for "Applied X.": the message carries an Undo button. */
  undo: boolean;
  token: number;
}

export type RenameResult = { ok: true } | { ok: false; message: string };

export interface ThemeLibraryOptions {
  /** Every theme the user may use, read under RLS: system themes first, then their own. */
  initialThemes: ThemeRow[];
  /** The signed-in user's id: the owner of every theme they save. */
  ownerId: string;
  /** The account's plan, for the wording of the limit message; Free when omitted. */
  plan?: PlanId;
  /** The Design screen's draft and its setter: a theme action only ever writes `draft.theme`. */
  draft: DraftDoc;
  setDraft: Dispatch<SetStateAction<DraftDoc>>;
}

export interface ThemeLibrary {
  themes: ThemeRow[];
  /** The page's theme as the Design header says it: "Theme · Noir · edited", "Theme · Default". */
  statusLabel: string;
  /** The draft's theme row, or null: none, deleted, or not the user's to read. */
  applied: ThemeRow | null;
  /** The page overrides change something on top of the applied theme. */
  edited: boolean;
  /** The tag on a theme's card: only the applied one has one, "Applied" or "Edited". */
  tagFor: (id: string) => "Applied" | "Edited" | null;
  /** An action is in flight: the buttons that write say so and ignore a second press. */
  pending: boolean;
  message: ThemeMessage | null;
  dismissMessage: () => void;
  /**
   * M9-34: the person just deleted the theme this page used, so the Design tab shows the M5-16 notice
   * at once. It stays until a theme is applied (the draft stops being on the default), Undo restores the
   * theme, or the page is reloaded (a reload shows it only for a draft that still names a deleted theme).
   */
  deletedNotice: boolean;
  /** M3-20: point the draft at a theme and clear its page overrides; the message carries Undo. */
  apply: (id: string) => void;
  /** Undo of the last "Applied" (the previous theme comes back) or "Deleted" (the theme is created again, and applied when it was the page's). */
  undo: () => void;
  /** M3-21: save the page's resolved tokens as a new theme and apply it. */
  saveAsTheme: () => Promise<void>;
  /** M3-23: write the page's resolved tokens into the applied saved theme and clear the overrides. */
  updateApplied: () => Promise<void>;
  /** M3-23: rename a saved theme. Resolves with the message to show when it is refused. */
  rename: (id: string, input: string) => Promise<RenameResult>;
  /** M3-24: delete a saved theme. Resolves true when it is gone. */
  remove: (id: string) => Promise<boolean>;
  /** M5-16: the list the screen could not load on the server arrived (Retry): replace what is held. */
  replaceThemes: (rows: ThemeRow[]) => void;
}

/** Shallow equality of two override sets: every value is a primitive. */
function sameOverrides(a: DocTheme["overrides"], b: DocTheme["overrides"]): boolean {
  const x = a as Record<string, unknown>;
  const y = b as Record<string, unknown>;
  const keys = Object.keys(x);
  return keys.length === Object.keys(y).length && keys.every((key) => x[key] === y[key]);
}

const hasOverrides = (theme: DocTheme): boolean => Object.keys(theme.overrides).length > 0;

const FAILURE_TEXT: Record<Exclude<ThemeOpFailure, "limit">, string> = {
  invalid: "Couldn’t save the theme. Use a name of 40 characters or fewer.",
  denied: "Couldn’t save the theme. Sign in again, then try again.",
  missing: "Couldn’t find that theme. Reload the page, then try again.",
  error: "Couldn’t save the theme. Try again.",
};

/**
 * The saved-themes logic of the Design screen (M3-19 .. M3-24) as one hook, shared by the card and
 * by the header's "Save as theme" button. It owns the list of themes and the message; the draft
 * stays the screen's, and a theme action only ever changes `draft.theme` through `setDraft`, so the
 * screen's own autosave writes it and nothing is published until Publish.
 *
 * Writes to the `themes` table go through `@/lib/themes/client` with the user's own session (RLS
 * and the limit trigger decide, never this hook).
 */
export function useThemeLibrary(options: ThemeLibraryOptions): ThemeLibrary {
  const { ownerId, plan = "free", draft, setDraft } = options;
  const [themes, setThemes] = useState<ThemeRow[]>(options.initialThemes);
  const [message, setMessage] = useState<ThemeMessage | null>(null);
  const [pending, setPending] = useState(false);
  // M9-34: the page's theme was just deleted here (see `ThemeLibrary.deletedNotice`).
  const [deletedAppliedNotice, setDeletedAppliedNotice] = useState(false);

  // The latest values for callbacks that outlive a render (an awaited request, a timer).
  const draftRef = useRef(draft);
  const themesRef = useRef(themes);
  const pendingRef = useRef(false);
  const tokenRef = useRef(0);
  /** Set by an apply: what Undo restores, and what the draft looked like right after it. */
  const undoRef = useRef<{ previous: DocTheme; appliedId: string } | null>(null);
  /** Set by a delete: what its Undo creates again (the theme's name and resolved tokens) and whether it was the page's. */
  const deletedUndoRef = useRef<{ name: string; tokens: TokenSet; wasApplied: boolean } | null>(
    null,
  );
  useEffect(() => {
    draftRef.current = draft;
    themesRef.current = themes;
  }, [draft, themes]);

  const show = useCallback((kind: ThemeMessageKind, text: string, undo = false) => {
    tokenRef.current += 1;
    if (!undo) {
      undoRef.current = null;
      deletedUndoRef.current = null;
    }
    setMessage({ kind, text, undo, token: tokenRef.current });
  }, []);

  const dismissMessage = useCallback(() => {
    undoRef.current = null;
    deletedUndoRef.current = null;
    setMessage(null);
  }, []);

  // Success messages go away on their own; the limit message and errors wait for the person.
  const token = message?.token ?? null;
  const sticky = message?.kind === "limit" || message?.kind === "error";
  useEffect(() => {
    if (token === null || sticky) return;
    const timer = setTimeout(() => {
      undoRef.current = null;
      deletedUndoRef.current = null;
      setMessage((current) => (current?.token === token ? null : current));
    }, THEME_MESSAGE_MS);
    return () => clearTimeout(timer);
  }, [token, sticky]);

  // Undo restores the theme as it was before the apply. Once the page's theme has been changed
  // some other way (a color edited, another theme applied) the Undo would throw that edit away,
  // so it goes.
  const draftTheme = draft.theme;
  useEffect(() => {
    const pendingUndo = undoRef.current;
    if (!pendingUndo) return;
    if (draftTheme.ref !== pendingUndo.appliedId || hasOverrides(draftTheme)) {
      undoRef.current = null;
      setMessage((current) => (current?.undo ? null : current));
    }
  }, [draftTheme]);

  const apply = useCallback(
    (id: string) => {
      const target = themeById(themesRef.current, id);
      if (!target) return;
      const current = draftRef.current.theme;
      if (current.ref === id && !hasOverrides(current)) return; // nothing to replace
      undoRef.current = { previous: current, appliedId: id };
      setDeletedAppliedNotice(false);
      setDraft((doc) => ({ ...doc, theme: { ref: id, overrides: {} } }));
      show("applied", `Applied ${target.name}.`, true);
    },
    [setDraft, show],
  );

  /** Runs one write at a time: a second press while one is in flight does nothing. */
  const exclusive = useCallback(async <T>(work: () => Promise<T>): Promise<T | undefined> => {
    if (pendingRef.current) return undefined;
    pendingRef.current = true;
    setPending(true);
    try {
      return await work();
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }, []);

  /**
   * The Undo of a "Deleted" message (M9-34): the theme is created again with its name and resolved
   * tokens (a new row, so a page that named the old id is not brought back), and applied when it was
   * this page's theme and the page is still on the default. A failure says so and keeps the Undo.
   */
  const restoreDeleted = useCallback(async () => {
    const restoring = deletedUndoRef.current;
    if (!restoring) return;
    await exclusive(async () => {
      const result = await insertSavedTheme(
        createBrowserSupabase(),
        ownerId,
        restoring.name,
        restoring.tokens,
      );
      if (!result.ok) {
        if (result.reason === "limit") {
          const used = ownThemes(themesRef.current).length;
          show("limit", savedThemeLimitMessage(used, SAVED_THEME_LIMIT[plan] ?? used));
        } else {
          show("error", FAILURE_TEXT[result.reason]);
        }
        return;
      }
      const restored = result.theme;
      setThemes((all) => [...all, restored]);
      if (restoring.wasApplied) {
        setDraft((doc) =>
          doc.theme.ref === null
            ? { ...doc, theme: { ref: restored.id, overrides: doc.theme.overrides } }
            : doc,
        );
      }
      setDeletedAppliedNotice(false);
      show("undone", "Undone.");
    });
  }, [exclusive, ownerId, plan, setDraft, show]);

  const undo = useCallback(() => {
    if (deletedUndoRef.current) {
      void restoreDeleted();
      return;
    }
    const pendingUndo = undoRef.current;
    if (!pendingUndo) return;
    const { previous } = pendingUndo;
    setDraft((doc) => ({ ...doc, theme: { ref: previous.ref, overrides: previous.overrides } }));
    show("undone", "Undone.");
  }, [restoreDeleted, setDraft, show]);

  const saveAsTheme = useCallback(async () => {
    await exclusive(async () => {
      const snapshot = draftRef.current.theme;
      const list = themesRef.current;
      const name = nextThemeName(list);
      const tokens = resolvedTokensFor(list, snapshot);
      const result = await insertSavedTheme(createBrowserSupabase(), ownerId, name, tokens);
      if (!result.ok) {
        if (result.reason === "limit") {
          const used = ownThemes(list).length;
          const limit = SAVED_THEME_LIMIT[plan] ?? used;
          show("limit", savedThemeLimitMessage(used, limit));
        } else {
          show("error", FAILURE_TEXT[result.reason]);
        }
        return;
      }
      const saved = result.theme;
      setThemes((all) => [...all, saved]);
      // The new theme is the page's own look as of the press, so it replaces the overrides. If the
      // person edited the page while the request was out, those edits stay as overrides on the
      // page and the theme is saved without being applied.
      setDraft((doc) =>
        sameOverrides(doc.theme.overrides, snapshot.overrides) && doc.theme.ref === snapshot.ref
          ? { ...doc, theme: { ref: saved.id, overrides: {} } }
          : doc,
      );
      setDeletedAppliedNotice(false);
      show("saved", `Saved as ${saved.name}.`);
    });
  }, [exclusive, ownerId, plan, setDraft, show]);

  const updateApplied = useCallback(async () => {
    await exclusive(async () => {
      const snapshot = draftRef.current.theme;
      const list = themesRef.current;
      const target = themeById(list, snapshot.ref);
      if (!target || target.system) return;
      const tokens = resolvedTokensFor(list, snapshot);
      const result = await updateSavedThemeTokens(createBrowserSupabase(), target.id, tokens);
      if (!result.ok) {
        show("error", FAILURE_TEXT[result.reason === "limit" ? "error" : result.reason]);
        return;
      }
      const updated = result.theme;
      setThemes((all) => all.map((row) => (row.id === updated.id ? updated : row)));
      setDraft((doc) =>
        doc.theme.ref === updated.id && sameOverrides(doc.theme.overrides, snapshot.overrides)
          ? { ...doc, theme: { ref: updated.id, overrides: {} } }
          : doc,
      );
      show("updated", `Updated ${updated.name}.`);
    });
  }, [exclusive, setDraft, show]);

  const rename = useCallback(
    async (id: string, input: string): Promise<RenameResult> => {
      const checked = checkThemeName(input);
      if (!checked.ok) return { ok: false, message: checked.message };
      const outcome = await exclusive(async (): Promise<RenameResult> => {
        const result = await renameSavedTheme(createBrowserSupabase(), id, checked.name);
        if (!result.ok) {
          return {
            ok: false,
            message:
              result.reason === "invalid"
                ? "Use 40 characters or fewer."
                : "Couldn’t rename the theme. Try again.",
          };
        }
        const renamed = result.theme;
        setThemes((all) => all.map((row) => (row.id === renamed.id ? renamed : row)));
        show("renamed", `Renamed to ${renamed.name}.`);
        return { ok: true };
      });
      return outcome ?? { ok: false, message: "One moment, still saving." };
    },
    [exclusive, show],
  );

  const remove = useCallback(
    async (id: string): Promise<boolean> => {
      const outcome = await exclusive(async () => {
        const target = themeById(themesRef.current, id);
        if (!target || target.system) return false;
        const result = await deleteSavedTheme(createBrowserSupabase(), id);
        if (!result.ok) {
          show("error", "Couldn’t delete the theme. Try again.");
          return false;
        }
        setThemes((all) => all.filter((row) => row.id !== id));
        // This page's draft stops pointing at it (the overrides stay). Other pages keep their
        // dangling reference, which every reader resolves to the default.
        const wasApplied = draftRef.current.theme.ref === id;
        setDraft((doc) =>
          doc.theme.ref === id
            ? { ...doc, theme: { ref: null, overrides: doc.theme.overrides } }
            : doc,
        );
        // M9-34: deleting the theme this page uses shows the M5-16 notice at once, next to the
        // "Deleted" message; its Undo creates the theme again (and applies it when it was the page's).
        setDeletedAppliedNotice(wasApplied);
        undoRef.current = null;
        deletedUndoRef.current = {
          name: target.name,
          tokens: resolveTokens(target.tokens, {}),
          wasApplied,
        };
        show("deleted", `Deleted ${target.name}.`, true);
        return true;
      });
      return outcome === true;
    },
    [exclusive, setDraft, show],
  );

  const applied = useMemo(() => themeById(themes, draft.theme.ref), [themes, draft.theme.ref]);
  const edited = useMemo(() => isEdited(themes, draft.theme), [themes, draft.theme]);
  const statusLabel = useMemo(() => themeStatusLabel(themes, draft.theme), [themes, draft.theme]);
  const tagFor = useCallback(
    (id: string) => cardTag(themes, draft.theme, id),
    [themes, draft.theme],
  );

  return {
    themes,
    statusLabel,
    applied,
    edited,
    tagFor,
    pending,
    message,
    dismissMessage,
    deletedNotice: deletedAppliedNotice,
    apply,
    undo,
    saveAsTheme,
    updateApplied,
    rename,
    remove,
    replaceThemes: setThemes,
  };
}
