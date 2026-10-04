"use client";

import { useRouter, useSelectedLayoutSegment } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import { SUSPENDED_REASON, useAccountSuspended } from "@/components/admin/suspension-context";
import { checkTap, type PreviewTap } from "@/components/editor/preview-taps";
import { useAutosave } from "@/components/editor/use-autosave";
import { useIsDesktop } from "@/components/editor/use-is-desktop";
import { useUndoRedo } from "@/components/editor/use-undo-redo";
import { useThemeLibrary, useThemePreview } from "@/components/themes";
import { toPublishForm, type DraftDoc, type PublishDoc } from "@/lib/document";
import { publishPage, type PageChrome } from "@/lib/editor/contracts";
import {
  BLOCKED_PUBLISH_DISABLED_REASON,
  BLOCKED_PUBLISH_NOTE,
  PUBLISH_FAILED_MESSAGE,
} from "@/lib/editor/messages";
import { initialEditorState } from "@/lib/editor/state";
import { computePublishStatus } from "@/lib/editor/status";
import type { PlanId } from "@/lib/limits/table";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import type { TokenSet } from "@/lib/theme";
import { fetchThemeLibrary, themeById, type ThemeRow } from "@/lib/themes";
import {
  WORKSPACE_PANEL_ID,
  WORKSPACE_TABS,
  WorkspaceContextProvider,
  type PublishNote,
  type ShareTarget,
  type WorkspaceTab,
  type WorkspaceValue,
} from "./workspace-context";
import { failureTab } from "./failure-tab";
import { workspaceReducer, type WorkspaceAction } from "./workspace-reducer";

export interface WorkspaceProviderProps {
  // Page identity: live, the layout passes them on every render (a rename refreshes the route).
  pageId: string;
  ownerId: string;
  plan: PlanId;
  handle: string;
  address: string;
  name: string;
  liveUrl: string;
  publicAddress: string;
  primaryDomain: string | null;
  chrome: PageChrome;

  // Draft data: read ONCE, when the workspace opens. A refreshed value never replaces what the
  // person is editing, recreates the save queue or clears the history: only the page id (the
  // layout's `key`) starts over.
  draft: DraftDoc;
  revKey: string | null;
  repaired: boolean;
  hasPublished: boolean;
  published: PublishDoc | null;
  publishedAt: string | null;
  /** The draft's own theme row as the server read it (used only when the library could not be read). */
  themeTokens: Partial<TokenSet> | null;
  templateThemes: Record<string, Partial<TokenSet>>;
  themes: ThemeRow[];
  themesFailed: boolean;

  children: ReactNode;
}

const hrefOf = (tab: WorkspaceTab): string => WORKSPACE_TABS.find((t) => t.id === tab)!.href;

/** The layout segment of the open route ("editor", "design", "share") as a tab. */
function tabOfSegment(segment: string | null): WorkspaceTab {
  return WORKSPACE_TABS.find((tab) => tab.segment === segment)?.id ?? "edit";
}

/**
 * The workspace's state (M7-02): the draft, its history, its one autosave queue, undo and redo,
 * Publish, the saved-themes library and the theme preview, shared by the Edit, Design and Share
 * tabs. See ./README.md. This is the ONLY module that calls `useAutosave` and `useUndoRedo`.
 */
export function WorkspaceProvider(props: WorkspaceProviderProps) {
  const { pageId, ownerId, plan, chrome, children } = props;
  const router = useRouter();
  const isDesktop = useIsDesktop();
  const suspended = useAccountSuspended();
  const activeTab = tabOfSegment(useSelectedLayoutSegment());
  const activeTabRef = useRef(activeTab);
  useEffect(() => {
    activeTabRef.current = activeTab;
  }, [activeTab]);

  // Frozen on mount: see the note on the props.
  const [initial] = useState(() => ({
    draft: props.draft,
    revKey: props.revKey,
    repaired: props.repaired,
    hasPublished: props.hasPublished,
    published: props.published,
    publishedAt: props.publishedAt,
    themeTokens: props.themeTokens,
    templateThemes: props.templateThemes,
    themes: props.themes,
    themesFailed: props.themesFailed,
  }));

  const [state, dispatch] = useReducer(workspaceReducer, initial.draft, initialEditorState);
  const { draft } = state;

  // Writes made in one synchronous run are one gesture: they share a batch number and one undo step.
  const batch = useRef({ id: 0, open: false });
  const editDraft = useCallback((update: (draft: DraftDoc) => DraftDoc, group?: string) => {
    if (!batch.current.open) {
      batch.current.open = true;
      batch.current.id += 1;
      queueMicrotask(() => {
        batch.current.open = false;
      });
    }
    dispatch({ type: "draft/edit", update, group, at: Date.now(), batch: batch.current.id });
  }, []);
  const setDraft = useCallback<Dispatch<SetStateAction<DraftDoc>>>(
    (value) => editDraft(typeof value === "function" ? value : () => value),
    [editDraft],
  );

  const autosave = useAutosave({ pageId, draft, initialRevKey: initial.revKey });
  const { flush, savedDraft, currentStatus, blocked } = autosave;

  const undoRedo = useUndoRedo({
    history: state.history,
    step: (direction, expect) =>
      dispatch({ type: direction === "undo" ? "history/undo" : "history/redo", expect }),
    scope: `#${WORKSPACE_PANEL_ID}`,
    nativeWithin: '[data-testid="saved-themes-card"]',
  });

  // The saved themes: loaded by the layout, held here, so the preview, the status chip and Publish
  // see a theme applied on the Design tab in the same frame.
  const library = useThemeLibrary({
    initialThemes: initial.themes,
    ownerId,
    plan,
    draft,
    setDraft,
  });
  const { themes, replaceThemes } = library;
  const [themesFailed, setThemesFailed] = useState(initial.themesFailed);
  const [retryingThemes, setRetryingThemes] = useState(false);
  const retryThemes = useCallback(() => {
    setRetryingThemes(true);
    void (async () => {
      try {
        const result = await fetchThemeLibrary(createBrowserSupabase());
        if (result.ok) {
          replaceThemes(result.themes);
          setThemesFailed(false);
        }
      } finally {
        setRetryingThemes(false);
      }
    })();
  }, [replaceThemes]);
  const themesLoad = useMemo(
    () => ({ failed: themesFailed, retrying: retryingThemes, retry: retryThemes }),
    [themesFailed, retryingThemes, retryThemes],
  );

  // The tokens of the theme a draft points at: the library's row when the library was read, else
  // the theme the page loaded with or one of the template themes (an unreadable library).
  const loadedRef = initial.draft.theme.ref;
  const { themeTokens: loadedTokens, templateThemes } = initial;
  const themeTokensOf = useCallback(
    (ref: string | null): Partial<TokenSet> | null => {
      if (ref === null) return null;
      if (themes.length > 0) return themeById(themes, ref)?.tokens ?? null;
      if (ref === loadedRef && loadedTokens !== null) return loadedTokens;
      return templateThemes[ref] ?? null;
    },
    [themes, loadedRef, loadedTokens, templateThemes],
  );
  const themeTokens = themeTokensOf(draft.theme.ref);
  const themeDeleted =
    !themesFailed && draft.theme.ref !== null && themeById(themes, draft.theme.ref) === null;

  // One publish form per draft: the preview draws it and the status chip compares it.
  const form = useMemo(() => toPublishForm(draft, themeTokens), [draft, themeTokens]);

  const preview = useThemePreview({
    draft,
    themes,
    applyTheme: library.apply,
    // Phone: the mini phone opens its sheet while a preview is on (M7-09); nothing to switch here.
    showPreview: () => {},
    showStyle: () => {},
  });
  const shownForm = preview.form ?? form;

  // Publish ---------------------------------------------------------------------------------------
  const [published, setPublished] = useState({
    has: initial.hasPublished,
    doc: initial.published,
  });
  const [publishedAt, setPublishedAt] = useState(initial.publishedAt);
  const [publishing, setPublishing] = useState(false);
  const [publishNote, setPublishNote] = useState<PublishNote | null>(null);
  const [publishedToken, setPublishedToken] = useState<number | null>(null);
  const status = computePublishStatus({
    hasPublished: published.has,
    published: published.doc,
    form,
  });

  const draftRef = useRef(draft);
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  const publish = useCallback(async () => {
    if (publishing) return;
    setPublishing(true);
    setPublishNote(null);
    try {
      // Publish freezes what is stored, so the newest edits are written first.
      const stored = await flush();
      if (!stored) {
        // A signed-out session has its own banner; a link to a blocked site has its message under
        // the field (retrying cannot help); anything else can be tried again.
        const why = currentStatus();
        setPublishNote(
          why === "signed-out"
            ? { message: "Couldn’t publish. Sign in again, then try again.", retry: false }
            : why === "blocked"
              ? { message: BLOCKED_PUBLISH_NOTE, retry: false }
              : { message: "Couldn’t publish. Your latest changes aren’t saved yet.", retry: true },
        );
        return;
      }
      const snapshot = savedDraft() ?? draftRef.current;
      const result = await publishPage(pageId);
      if (result.ok) {
        setPublished({
          has: true,
          doc: toPublishForm(snapshot, themeTokensOf(snapshot.theme.ref)),
        });
        setPublishedAt(result.publishedAt);
        dispatch({ type: "publish/clear-errors" });
        setPublishedToken((token) => (token ?? 0) + 1);
        return;
      }
      // The gate refused: show what failed, on the tab that holds it (a soft navigation: the
      // toolbar, the preview and the draft stay). The reducer asks for focus on the first field.
      dispatch({ type: "publish/errors", errors: result.errors });
      const tab = failureTab(result.errors);
      if (tab !== null && tab !== activeTabRef.current) router.push(hrefOf(tab));
      if (result.errors.length === 0) {
        setPublishNote(
          result.reason === "unauthorized"
            ? { message: "Couldn’t publish. Sign in again, then try again.", retry: false }
            : result.reason === "account_suspended"
              ? { message: "Couldn’t publish. Your account is suspended.", retry: false }
              : { message: PUBLISH_FAILED_MESSAGE, retry: true },
        );
      }
    } catch {
      // The request itself failed (a 5xx from the action, the network dropped): nothing was
      // published, the draft is stored, the status chip keeps saying "Unpublished changes".
      setPublishNote({ message: PUBLISH_FAILED_MESSAGE, retry: true });
    } finally {
      setPublishing(false);
    }
  }, [publishing, flush, savedDraft, currentStatus, pageId, themeTokensOf, router]);

  // A "Couldn’t publish. A link points to a blocked site" note belongs to the refusal it was shown
  // for: once a save has gone through (the refusal is gone) it is stale and is not shown.
  const shownNote =
    publishNote && publishNote.message === BLOCKED_PUBLISH_NOTE && blocked === null
      ? null
      : publishNote;

  const publishDisabledReason = suspended
    ? SUSPENDED_REASON
    : blocked !== null
      ? BLOCKED_PUBLISH_DISABLED_REASON
      : null;

  // The page's current social image, as the live page's metadata names it (M2-30).
  const publishedMs = publishedAt ? Date.parse(publishedAt) : Number.NaN;
  const liveOgUrl = published.has
    ? `${props.liveUrl}/og${Number.isFinite(publishedMs) ? `?v=${publishedMs}` : ""}`
    : null;

  // Tap to edit (M6-03) -------------------------------------------------------------------------
  const [profileTap, setProfileTap] = useState<WorkspaceValue["profileTap"]>(null);
  const tapNonce = useRef(0);
  const clearProfileTap = useCallback(
    (nonce: number) => setProfileTap((current) => (current?.nonce === nonce ? null : current)),
    [],
  );
  const previewing = preview.theme !== null;
  const onPreviewTap = useCallback(
    (raw: PreviewTap) => {
      // During a theme preview (M6-44) a tap does nothing.
      if (previewing) return;
      const tap = checkTap(raw, draftRef.current.blocks);
      if (!tap) return;
      if (activeTabRef.current !== "edit") router.push("/editor");
      if (tap.kind === "profile") {
        tapNonce.current += 1;
        setProfileTap({ part: tap.part, nonce: tapNonce.current });
      } else {
        dispatch({ type: "expand", id: tap.blockId, itemId: tap.itemId });
      }
    },
    [previewing, router],
  );

  // The Share tab's focus protocol -----------------------------------------------------------------
  const [shareFocus, setShareFocus] = useState<WorkspaceValue["shareFocus"]>(null);
  const shareNonce = useRef(0);
  const openShare = useCallback(
    (target: ShareTarget) => {
      shareNonce.current += 1;
      setShareFocus({ target, nonce: shareNonce.current });
      router.push(`/share#${target}`);
    },
    [router],
  );
  const clearShareFocus = useCallback(
    (nonce: number) => setShareFocus((current) => (current?.nonce === nonce ? null : current)),
    [],
  );

  const value = useMemo<WorkspaceValue>(
    () => ({
      pageId,
      ownerId,
      plan,
      handle: props.handle,
      address: props.address,
      name: props.name,
      liveUrl: props.liveUrl,
      publicAddress: props.publicAddress,
      primaryDomain: props.primaryDomain,
      chrome,
      state,
      draft,
      dispatch: dispatch as Dispatch<WorkspaceAction>,
      editDraft,
      repaired: initial.repaired,
      autosave,
      undoRedo,
      status,
      publishedForm: published.doc,
      hasPublished: published.has,
      publishedAt,
      liveOgUrl,
      publishing,
      publish: () => void publish(),
      publishNote: shownNote,
      publishedToken,
      publishDisabledReason,
      themeTokens,
      form,
      shownForm,
      templateThemes,
      library,
      themesLoad,
      themeDeleted,
      preview,
      activeTab,
      isDesktop,
      onPreviewTap,
      profileTap,
      clearProfileTap,
      openShare,
      shareFocus,
      clearShareFocus,
    }),
    [
      pageId,
      ownerId,
      plan,
      props.handle,
      props.address,
      props.name,
      props.liveUrl,
      props.publicAddress,
      props.primaryDomain,
      chrome,
      state,
      draft,
      editDraft,
      initial.repaired,
      autosave,
      undoRedo,
      status,
      published.doc,
      published.has,
      publishedAt,
      liveOgUrl,
      publishing,
      publish,
      shownNote,
      publishedToken,
      publishDisabledReason,
      themeTokens,
      form,
      shownForm,
      templateThemes,
      library,
      themesLoad,
      themeDeleted,
      preview,
      activeTab,
      isDesktop,
      onPreviewTap,
      profileTap,
      clearProfileTap,
      openShare,
      shareFocus,
      clearShareFocus,
    ],
  );

  return <WorkspaceContextProvider value={value}>{children}</WorkspaceContextProvider>;
}
