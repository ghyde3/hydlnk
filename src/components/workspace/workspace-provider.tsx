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
import type { SaveHold } from "@/lib/editor/autosave";
import type { HomeEntryRef } from "@/lib/editor/save-client";
import { useIsDesktop } from "@/components/editor/use-is-desktop";
import { useUndoRedo } from "@/components/editor/use-undo-redo";
import { useSitePages, type SiteArchive, type SubPageInit } from "@/components/site/use-site-pages";
import { useThemeLibrary, useThemePreview } from "@/components/themes";
import {
  previewBlocks,
  toPublishForm,
  type DraftDoc,
  type PublishDoc,
  type PublishError,
} from "@/lib/document";
import { useMinuteClock } from "@/lib/schedule/use-minute-clock";
import { firedRevToAdopt, nextFireOf } from "@/lib/schedule/adopt";
import { useFireWatch } from "@/lib/schedule/use-fire-watch";
import type { EntryScheduleSummary } from "@/lib/schedule/types";
import { fetchSiteSchedules } from "@/lib/posts/client";
import {
  publishDesign,
  publishPage,
  publishSitePage,
  unpublishSite,
  type PageChrome,
} from "@/lib/editor/contracts";
import {
  BLOCKED_PUBLISH_DISABLED_REASON,
  BLOCKED_PUBLISH_NOTE,
  PUBLISH_FAILED_MESSAGE,
  UNPUBLISH_RATE_LIMITED_MESSAGE,
  UNPUBLISH_FAILED_MESSAGE,
  UNPUBLISH_SIGNED_OUT_MESSAGE,
  UNPUBLISH_SUSPENDED_MESSAGE,
} from "@/lib/editor/messages";
import { initialEditorState } from "@/lib/editor/state";
import type { PublishStatus } from "@/lib/editor/status";
import { homeForSite } from "@/lib/publish/site-checks";
import { splitPublishState, type ItemPublishState } from "@/lib/publish/status";
import { restorePageRevision } from "@/lib/site-pages/entry-revisions-client";
import { HOME_PAGE_ID, itemStateOf } from "@/lib/site-pages/pages";
import type { PlanId } from "@/lib/limits/table";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import type { TokenSet } from "@/lib/theme";
import { fetchThemeLibrary, themeById, type ThemeRow } from "@/lib/themes";
import {
  WORKSPACE_PANEL_ID,
  WORKSPACE_TABS,
  WorkspaceContextProvider,
  type PublishNote,
  type PublishState,
  type PublishTarget,
  type ShareTarget,
  type WorkspaceTab,
  type WorkspaceValue,
} from "./workspace-context";
import { failureTab } from "./failure-tab";
import {
  PUBLISH_CONFLICT_MESSAGE,
  PUBLISH_SIGNED_OUT_MESSAGE,
  PUBLISH_UNSAVED_MESSAGE,
  publishFailureNote,
  restoreRevisionMessage,
} from "./publish-note";
import { workspaceReducer, type WorkspaceAction } from "./workspace-reducer";

export interface WorkspaceProviderProps {
  // Page identity: live, the layout passes them on every render (a rename refreshes the route).
  pageId: string;
  ownerId: string;
  /** The signed-in user's sign-in address (the form block's "Email me each message" helper line). */
  accountEmail?: string;
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
  /** Home's page entry (id and rev) when the site has one: Home's blocks are saved there (1b1-17). */
  home: HomeEntryRef | null;
  repaired: boolean;
  hasPublished: boolean;
  published: PublishDoc | null;
  publishedAt: string | null;
  /** The draft's own theme row as the server read it (used only when the library could not be read). */
  themeTokens: Partial<TokenSet> | null;
  templateThemes: Record<string, Partial<TokenSet>>;
  themes: ThemeRow[];
  themesFailed: boolean;
  /** The site's sub-pages (M11-08), read once like the draft. */
  subPages: SubPageInit[];
  /** Page entries in the trash: they still count toward the plan's pages per site (1b1-18). */
  trashedPages?: number;
  /** The site's types with an archive (the blog), on or off: what the menu may name besides pages (M16-08). */
  archives?: SiteArchive[];

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
    home: props.home,
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

  const autosave = useAutosave({
    pageId,
    draft,
    initialRevKey: initial.revKey,
    home: initial.home,
    repaired: initial.repaired,
  });
  const { flush, savedDraft, currentStatus, blocked } = autosave;

  // The site's sub-pages (M11-08): their own settings, block editors and save queue; the menu is
  // Home's draft, edited through `editDraft`.
  const site = useSitePages({
    siteId: pageId,
    plan,
    initial: props.subPages,
    trashedPages: props.trashedPages ?? 0,
    initialArchives: props.archives ?? [],
    homeTitle: "Home",
    nav: draft.nav,
    homeBlocks: draft.blocks,
    editDraft,
  });
  const {
    flush: flushSite,
    markPublished: markSitePublished,
    markUnpublished: markSiteUnpublished,
    applyPublishErrors: applySiteErrors,
    clearPublishErrors: clearSiteErrors,
  } = site;

  // One undo history at a time: the open page's (Home's, or the open sub-page's).
  const undoRedo = useUndoRedo({
    history: site.activeEditor ? site.activeEditor.history : state.history,
    step: (direction, expect) => {
      const action = {
        type: direction === "undo" ? "history/undo" : "history/redo",
        expect,
      } as const;
      if (site.activeEditor) site.dispatchActive(action);
      else dispatch(action);
    },
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
  // The preview draws every block that has not ended (Wave E, M20-06): the owner is still editing
  // the upcoming ones; an ended one is gone from the live page, so it is gone here too.
  const minute = useMinuteClock();
  const shownForm = useMemo(() => {
    const shown = preview.form ?? form;
    return { ...shown, blocks: previewBlocks(shown.blocks, minute) };
  }, [preview.form, form, minute]);

  // Publish ---------------------------------------------------------------------------------------
  const [published, setPublished] = useState({
    has: initial.hasPublished,
    doc: initial.published,
  });
  const [publishedAt, setPublishedAt] = useState(initial.publishedAt);
  // What is being published right now (M15-10): everything, the design, Home, or one page's id.
  const [publishingItem, setPublishingItem] = useState<PublishTarget | null>(null);
  const publishing = publishingItem !== null;
  const [publishNote, setPublishNote] = useState<PublishNote | null>(null);
  const [publishedToken, setPublishedToken] = useState<number | null>(null);
  // Publish stores Home's menu without entries for pages no longer in the site (`homeForSite`), so
  // the chip compares that stored shape, not a draft menu that still names a removed page.
  // A menu item that names one of the site's archives (the blog) is stored too (M16-08).
  const siteIds = site.titles.map((page) => page.id);
  const archiveIds = site.archives.map((archive) => archive.typeId);
  const storedForm = homeForSite(form, siteIds, archiveIds);
  const storedPublished = published.doc ? homeForSite(published.doc, siteIds, archiveIds) : null;
  // The site publishes in parts (M15-10): the design, Home's blocks and each page have their own state.
  const split = splitPublishState({
    hasPublished: published.has,
    published: storedPublished,
    form: storedForm,
  });
  const homeStatus: PublishStatus =
    split.home === "live"
      ? "published"
      : split.home === "draft"
        ? "not-published"
        : "unpublished-changes";
  const { pageStates } = site;
  const publishState = useMemo<PublishState>(() => {
    const pages: Record<string, ItemPublishState> = {};
    // A site that is not live has no live page, whatever a page's own copy says.
    for (const [id, state] of Object.entries(pageStates)) {
      pages[id] = published.has ? itemStateOf(state) : "draft";
    }
    return { design: split.design, home: split.home, pages };
  }, [split.design, split.home, pageStates, published.has]);
  // The toolbar chip keeps the three site-level values: live only when every part is.
  const status: PublishStatus = !published.has
    ? "not-published"
    : split.design === "live" && split.home === "live" && !site.dirty
      ? "published"
      : "unpublished-changes";

  const draftRef = useRef(draft);
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  const { revKey, homeRev, adoptHomeRev, hold: holdHomeSaves } = autosave;
  const {
    markPagePublished: markSitePagePublished,
    revisions: siteRevisions,
    snapshotForms: snapshotSiteForms,
    holdSaves: holdSiteSaves,
    hasUnsaved: siteHasUnsaved,
  } = site;
  const homeEntryId = initial.home?.entryId ?? null;

  const publishingRef = useRef(false);
  // The publish in flight, settled either way: Restore waits for it, so it sends the revs that publish left.
  const publishInFlight = useRef<Promise<void> | null>(null);
  const lastPublish = useRef<PublishTarget>("all");

  /** Publish freezes what is stored, so both queues write their newest edits first. False: a note says why. */
  const storeEdits = useCallback(async (): Promise<boolean> => {
    const stored = await flush();
    if (!stored) {
      // A signed-out session has its own banner; a link to a blocked site has its message under
      // the field (retrying cannot help); anything else can be tried again.
      const why = currentStatus();
      setPublishNote(
        why === "signed-out"
          ? { message: PUBLISH_SIGNED_OUT_MESSAGE, retry: false }
          : why === "blocked"
            ? { message: BLOCKED_PUBLISH_NOTE, retry: false }
            : { message: PUBLISH_UNSAVED_MESSAGE, retry: true },
      );
      return false;
    }
    // The sub-pages' newest edits are stored first too.
    if (!(await flushSite())) {
      setPublishNote({ message: PUBLISH_UNSAVED_MESSAGE, retry: true });
      return false;
    }
    return true;
  }, [flush, flushSite, currentStatus]);

  /**
   * A save and a publish of the same entry never overlap (M15-10). Publish stores the pending edits,
   * then HOLDS the save queues it covers (`home`: the design and Home's blocks, one queue; `site`:
   * the sub-pages) until its answer is in: the publish can move an entry's rev, and a save sent
   * meanwhile would carry the rev from before and be refused (the edit lost, "changed in another
   * tab"), or would land first and make the publish a false conflict. Typing is never blocked: the
   * edits wait in the queue and are sent on `release()`, with the revs the publish answered when it
   * succeeded and with the revs held before when it did not.
   *
   * Returns null (a note says why) when the edits cannot be stored. The caller releases, always.
   */
  const storeAndHold = useCallback(
    async (covers: { home: boolean; site: boolean }): Promise<SaveHold | null> => {
      for (let attempt = 0; attempt < 3; attempt++) {
        if (!(await storeEdits())) return null;
        const holds = [
          ...(covers.home ? [holdHomeSaves()] : []),
          ...(covers.site ? [holdSiteSaves()] : []),
        ];
        const held: SaveHold = {
          settled: Promise.all(holds.map((hold) => hold.settled)).then(() => undefined),
          release: () => holds.forEach((hold) => hold.release()),
        };
        // A write that was already on the wire is answered before the revs are read.
        await held.settled;
        // What the editor records as published must be what is stored at this moment. The sub-pages'
        // forms are snapshotted as typed, and Home's snapshot is the last draft known stored
        // (`storedHome`): an edit typed while the other queue was being written (after its own queue
        // was flushed, before this hold) is in neither, so the hold is given back and it is stored
        // first. An edit typed from here on waits in its queue and is not part of the snapshot.
        const homeStored = ["idle", "saved"].includes(currentStatus());
        if ((!covers.home || homeStored) && (!covers.site || !siteHasUnsaved())) return held;
        held.release();
      }
      setPublishNote({ message: PUBLISH_UNSAVED_MESSAGE, retry: true });
      return null;
    },
    [storeEdits, holdHomeSaves, holdSiteSaves, siteHasUnsaved, currentStatus],
  );

  /**
   * The design and Home's blocks as the database holds them: the newest draft the queue stored, or
   * (no save since the load) the draft the workspace loaded. Never the draft on screen, which can
   * hold an edit that is not stored.
   */
  const loadedDraft = initial.draft;
  const storedHome = useCallback(() => savedDraft() ?? loadedDraft, [savedDraft, loadedDraft]);

  /**
   * A refused publish: show what failed, on the tab that holds it (a soft navigation: the toolbar,
   * the preview and the draft stay). The reducer asks for focus on the first field. Errors on a
   * sub-page (M11-05) go to that page's editor, which opens; Home's stay here. A refusal with no
   * field to point at (a conflict, a suspended account) is the publish note.
   */
  const showRefusal = useCallback(
    (result: { errors: PublishError[]; reason?: string }) => {
      const homeErrors = result.errors.filter((error) => !error.subPageId);
      dispatch({ type: "publish/errors", errors: homeErrors });
      applySiteErrors(result.errors);
      const tab =
        homeErrors.length === 0 && result.errors.length > 0 ? "edit" : failureTab(homeErrors);
      if (tab !== null && tab !== activeTabRef.current) router.push(hrefOf(tab));
      if (result.errors.length === 0) setPublishNote(publishFailureNote(result.reason));
    },
    [applySiteErrors, router],
  );

  /** One publish action at a time; the request failing (a 5xx, the network) is the retryable note. */
  const runPublish = useCallback(
    async (target: PublishTarget, action: () => Promise<boolean>): Promise<boolean> => {
      if (publishingRef.current) return false;
      publishingRef.current = true;
      setPublishingItem(target);
      setPublishNote(null);
      lastPublish.current = target;
      try {
        const run = action();
        publishInFlight.current = run.then(
          () => undefined,
          () => undefined,
        );
        return await run;
      } catch {
        // Nothing was published, the draft is stored, the status keeps saying "Unpublished changes".
        setPublishNote({ message: PUBLISH_FAILED_MESSAGE, retry: true });
        return false;
      } finally {
        publishingRef.current = false;
        setPublishingItem(null);
      }
    },
    [],
  );
  /** Publish all changes: the design and every page that changed, in one transaction. */
  const publishAll = useCallback(
    () =>
      runPublish("all", async () => {
        const held = await storeAndHold({ home: true, site: true });
        if (!held) return false;
        try {
          // What is stored now is what the server publishes: an edit typed while it answers is not live.
          const snapshot = storedHome();
          const siteForms = snapshotSiteForms();
          // What this tab holds: the gate refuses (`conflict`) when any of it was saved elsewhere since.
          const heldHome = homeRev();
          const sentPages = siteRevisions();
          const expected =
            homeEntryId !== null && heldHome !== null
              ? { designRev: revKey(), entries: { ...sentPages, [homeEntryId]: heldHome } }
              : undefined;
          const result = await publishPage(pageId, expected);
          if (!result.ok) {
            showRefusal(result);
            return false;
          }
          // Publish can move an entry's rev without changing its draft. The answer names the revs it
          // left, read under its own locks: those are adopted, and nothing is read again (a rev
          // another writer made since must stay a conflict on the next save).
          markSitePublished(siteForms, result.revs.entries, sentPages);
          const homeLeft = homeEntryId === null ? undefined : result.revs.entries[homeEntryId];
          if (homeLeft !== undefined && heldHome !== null) adoptHomeRev(homeLeft, heldHome);
          setPublished({
            has: true,
            doc: toPublishForm(snapshot, themeTokensOf(snapshot.theme.ref)),
          });
          setPublishedAt(result.publishedAt);
          dispatch({ type: "publish/clear-errors" });
          clearSiteErrors();
          setPublishedToken((token) => (token ?? 0) + 1);
          return true;
        } finally {
          // Now the edits typed meanwhile are sent, with the revs adopted above (or, after a refusal
          // or a failed request, with the revs held before).
          held.release();
        }
      }),
    [
      runPublish,
      storeAndHold,
      storedHome,
      snapshotSiteForms,
      homeRev,
      homeEntryId,
      revKey,
      siteRevisions,
      pageId,
      showRefusal,
      markSitePublished,
      adoptHomeRev,
      themeTokensOf,
      clearSiteErrors,
    ],
  );

  /** Publish page: Home ("home") or one sub-page. Nothing else goes live. */
  const publishPageById = useCallback(
    (id: string) =>
      runPublish(id, async () => {
        const isHome = id === HOME_PAGE_ID;
        // Home's blocks are saved by the design's queue; a sub-page by the sub-pages' queue.
        const held = await storeAndHold({ home: isHome, site: !isHome });
        if (!held) return false;
        try {
          const entryId = isHome ? homeEntryId : id;
          const rev = isHome ? homeRev() : siteRevisions()[id];
          if (entryId === null || rev === null || rev === undefined) {
            setPublishNote(publishFailureNote("conflict"));
            return false;
          }
          // What is stored now is what the server publishes: an edit typed while it answers is not live.
          const snapshot = storedHome();
          const form = isHome ? undefined : snapshotSiteForms().get(id);
          const result = await publishSitePage(pageId, entryId, rev);
          if (!result.ok) {
            showRefusal(result);
            return false;
          }
          if (isHome) {
            adoptHomeRev(result.rev, rev);
            const blocks = toPublishForm(snapshot, themeTokensOf(snapshot.theme.ref)).blocks;
            setPublished((current) =>
              current.doc ? { has: true, doc: { ...current.doc, blocks } } : current,
            );
            dispatch({ type: "publish/clear-errors" });
          } else {
            markSitePagePublished(id, { rev: result.rev, sent: rev, form });
            clearSiteErrors();
          }
          setPublishedToken((token) => (token ?? 0) + 1);
          return true;
        } finally {
          held.release();
        }
      }),
    [
      runPublish,
      storeAndHold,
      homeEntryId,
      homeRev,
      siteRevisions,
      storedHome,
      snapshotSiteForms,
      pageId,
      showRefusal,
      adoptHomeRev,
      themeTokensOf,
      markSitePagePublished,
      clearSiteErrors,
    ],
  );

  /** Publish design: theme, menu and profile. No page changes. */
  const publishDesignOnly = useCallback(
    () =>
      runPublish("design", async () => {
        const held = await storeAndHold({ home: true, site: false });
        if (!held) return false;
        try {
          const snapshot = storedHome();
          // Publish design moves no rev (the design's rev is the draft's own): nothing to adopt.
          const result = await publishDesign(pageId, revKey());
          if (!result.ok) {
            showRefusal(result);
            return false;
          }
          const next = toPublishForm(snapshot, themeTokensOf(snapshot.theme.ref));
          setPublished((current) => ({
            has: true,
            doc: { ...next, blocks: current.doc?.blocks ?? [] },
          }));
          setPublishedAt(result.publishedAt);
          dispatch({ type: "publish/clear-errors" });
          setPublishedToken((token) => (token ?? 0) + 1);
          return true;
        } finally {
          held.release();
        }
      }),
    [runPublish, storeAndHold, storedHome, pageId, revKey, showRefusal, themeTokensOf],
  );

  /** Retry on the publish note: the action that failed, not always Publish all. */
  const retryPublish = useCallback(() => {
    const target = lastPublish.current;
    if (target === "all") void publishAll();
    else if (target === "design") void publishDesignOnly();
    else void publishPageById(target);
  }, [publishAll, publishDesignOnly, publishPageById]);

  /**
   * Restore one of a page's revisions into its DRAFT (M15-10). Both queues write first (the restore
   * is checked against the rev the editor holds), then the workspace reloads: the provider reads the
   * drafts once, on mount. Nothing is published; the page then reads "Unpublished changes".
   */
  const restoreRevision = useCallback(
    async (id: string, rev: number): Promise<{ ok: true } | { ok: false; message: string }> => {
      // A publish still answering can move the page's rev: the restore is sent after it, with that rev.
      await publishInFlight.current;
      const stored = (await flush()) && (await flushSite());
      if (!stored) {
        return { ok: false, message: "Couldn’t restore. Your latest changes aren’t saved yet." };
      }
      const isHome = id === HOME_PAGE_ID;
      const entryId = isHome ? homeEntryId : id;
      const held = isHome ? homeRev() : siteRevisions()[id];
      if (entryId === null || held === null || held === undefined) {
        return { ok: false, message: PUBLISH_CONFLICT_MESSAGE };
      }
      const answer = await restorePageRevision(pageId, entryId, rev, held);
      if (answer.kind === "ok") {
        window.location.reload();
        return { ok: true };
      }
      return { ok: false, message: restoreRevisionMessage(answer.kind) };
    },
    [flush, flushSite, homeEntryId, homeRev, siteRevisions, pageId],
  );

  /**
   * A schedule that fires while the workspace is open (Wave E, M20-10 step 3): the site's schedules are
   * read on open, after a publish and after a Schedule; once a pending time has passed the shared
   * watch reads them again, and every page that still holds the rev its fire found takes the rev the
   * fire left (`firedRevToAdopt`: the draft is the server's), so its next save is no false conflict.
   * Home's rev goes to Home's queue, a sub-page's to the sub-pages' queue (each adopts only while it
   * still holds the rev sent, as after a publish).
   */
  const [siteSchedules, setSiteSchedules] = useState<Record<string, EntryScheduleSummary>>({});
  const takeSiteSchedules = useCallback(
    (entries: Record<string, EntryScheduleSummary>) => {
      setSiteSchedules(entries);
      const revs = siteRevisions();
      for (const [entryId, summary] of Object.entries(entries)) {
        const isHome = entryId === homeEntryId;
        const held = isHome ? homeRev() : revs[entryId];
        const rev = firedRevToAdopt(held, summary.fired);
        if (rev === null || held === null || held === undefined) continue;
        if (isHome) adoptHomeRev(rev, held);
        else markSitePagePublished(entryId, { rev, sent: held, form: undefined });
      }
    },
    [homeEntryId, homeRev, siteRevisions, adoptHomeRev, markSitePagePublished],
  );
  const readSiteSchedules = useCallback(async () => {
    const out = await fetchSiteSchedules(pageId);
    if (out.kind === "ok") takeSiteSchedules(out.entries);
  }, [pageId, takeSiteSchedules]);
  useEffect(() => {
    let current = true;
    void fetchSiteSchedules(pageId).then((out) => {
      if (current && out.kind === "ok") takeSiteSchedules(out.entries);
    });
    return () => {
      current = false;
    };
  }, [pageId, takeSiteSchedules, publishedToken]);
  useFireWatch(nextFireOf(Object.values(siteSchedules)), readSiteSchedules);

  /**
   * Schedule or cancel for one page (Wave E, M20-07): Home ("home") or a sub-page. Both queues write
   * first (the schedule snapshots the stored draft, at the rev this tab holds), then `send` runs with
   * the page's entry id and that rev. Scheduling changes no rev and nothing live. Null when the page's
   * rev is not known here (its first save has not answered).
   */
  const schedulePage = useCallback(
    async <T,>(
      id: string,
      send: (entryId: string, rev: number) => Promise<T>,
    ): Promise<{ ok: true; value: T } | { ok: false; message: string }> => {
      await publishInFlight.current;
      const stored = (await flush()) && (await flushSite());
      if (!stored) {
        return {
          ok: false,
          message: "Your latest changes aren’t saved yet, so nothing was scheduled.",
        };
      }
      const isHome = id === HOME_PAGE_ID;
      const entryId = isHome ? homeEntryId : id;
      const held = isHome ? homeRev() : siteRevisions()[id];
      if (entryId === null || held === null || held === undefined) {
        return { ok: false, message: PUBLISH_CONFLICT_MESSAGE };
      }
      const value = await send(entryId, held);
      // The open workspace watches the new time for its fire (below).
      void readSiteSchedules();
      return { ok: true, value };
    },
    [flush, flushSite, homeEntryId, homeRev, siteRevisions, readSiteSchedules],
  );
  /** The rev this tab holds for a page's entry, or null. */
  const pageRev = useCallback(
    (id: string): number | null => (id === HOME_PAGE_ID ? homeRev() : siteRevisions()[id]) ?? null,
    [homeRev, siteRevisions],
  );

  // Unpublish (M14-02): the site goes back to its placeholder, the draft stays. Nothing here
  // flushes: the draft is untouched by it, so edits in flight keep saving as they do.
  const [unpublishing, setUnpublishing] = useState(false);
  const unpublish = useCallback(async (): Promise<
    { ok: true } | { ok: false; message: string }
  > => {
    if (unpublishing) return { ok: false, message: UNPUBLISH_FAILED_MESSAGE };
    setUnpublishing(true);
    try {
      const result = await unpublishSite(pageId);
      if (!result.ok) {
        return {
          ok: false,
          message:
            result.reason === "unauthorized"
              ? UNPUBLISH_SIGNED_OUT_MESSAGE
              : result.reason === "account_suspended"
                ? UNPUBLISH_SUSPENDED_MESSAGE
                : result.reason === "rate_limited"
                  ? UNPUBLISH_RATE_LIMITED_MESSAGE
                  : UNPUBLISH_FAILED_MESSAGE,
        };
      }
      markSiteUnpublished();
      setPublished({ has: false, doc: null });
      setPublishedAt(null);
      setPublishNote(null);
      router.refresh();
      return { ok: true };
    } catch {
      return { ok: false, message: UNPUBLISH_FAILED_MESSAGE };
    } finally {
      setUnpublishing(false);
    }
  }, [unpublishing, pageId, markSiteUnpublished, router]);

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
  // The open page's blocks and where a block action goes: Home's, or the open sub-page's (M11-08).
  const siteRef = useRef(site);
  useEffect(() => {
    siteRef.current = site;
  }, [site]);
  const onPreviewTap = useCallback(
    (raw: PreviewTap) => {
      // During a theme preview (M6-44) a tap does nothing.
      if (previewing) return;
      const open = siteRef.current;
      const sub = open.activeEditor;
      // The profile belongs to Home: a tap on it in a sub-page's header goes there.
      if (sub && raw.kind === "profile") open.select("home");
      const tap = checkTap(
        raw,
        sub && raw.kind !== "profile" ? sub.draft.blocks : draftRef.current.blocks,
      );
      if (!tap) return;
      if (activeTabRef.current !== "edit") router.push("/editor");
      if (tap.kind === "profile") {
        tapNonce.current += 1;
        setProfileTap({ part: tap.part, nonce: tapNonce.current });
      } else if (sub) {
        open.dispatchActive({ type: "expand", id: tap.blockId, itemId: tap.itemId });
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
      ...(props.accountEmail ? { accountEmail: props.accountEmail } : {}),
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
      site,
      dispatch: dispatch as Dispatch<WorkspaceAction>,
      editDraft,
      repaired: initial.repaired,
      autosave,
      undoRedo,
      status,
      homeStatus,
      publishedForm: published.doc,
      hasPublished: published.has,
      publishedAt,
      liveOgUrl,
      publishing,
      publishingItem,
      publishState,
      publish: () => void publishAll(),
      publishAll,
      publishPageById,
      publishDesignOnly,
      retryPublish,
      restoreRevision,
      schedulePage,
      pageRev,
      homeEntryId,
      unpublish,
      unpublishing,
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
      props.accountEmail,
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
      site,
      editDraft,
      initial.repaired,
      autosave,
      undoRedo,
      status,
      homeStatus,
      published.doc,
      published.has,
      publishedAt,
      liveOgUrl,
      publishing,
      publishingItem,
      publishState,
      publishAll,
      publishPageById,
      publishDesignOnly,
      retryPublish,
      restoreRevision,
      schedulePage,
      pageRev,
      homeEntryId,
      unpublish,
      unpublishing,
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
