"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { flushSync } from "react-dom";
import { blockedFieldErrors } from "@/lib/blocklist/fields";
import { toPublishForm, type DraftDoc, type PublishDoc } from "@/lib/document";
import { publishPage, type PageChrome } from "@/lib/editor/contracts";
import {
  BLOCKED_PUBLISH_NOTE,
  CORRUPTED_NOTICE,
  PUBLISH_FAILED_MESSAGE,
} from "@/lib/editor/messages";
import { editorReducer, initialEditorState } from "@/lib/editor/state";
import { DEFAULT_PAGE_NAME } from "@/lib/pages/name";
import { computePublishStatus } from "@/lib/editor/status";
import type { TokenSet } from "@/lib/theme";
import { PageTokensProvider } from "@/components/themes";
import { StartFromTemplate, TemplateToast } from "@/components/templates";
import { AddBlockCard } from "./add-block-card";
import { BlockList } from "./block-list";
import { EditorHeader } from "./editor-header";
import { InlineNotice } from "./inline-notice";
import {
  BackToBlocksBar,
  PreviewDock,
  isTextField,
  stackHeight,
  toastLift,
} from "./mini-preview-dock";
import { PreviewPanel } from "./preview-panel";
import { checkTap, focusProfilePart, type PreviewTap } from "./preview-taps";
import { ProfileCard } from "./profile-card";
import { ShareCard } from "./share-card";
import { PublishAlert } from "./publish-alert";
import { PublishedToast } from "./published-toast";
import { SaveBanner } from "./save-banner";
import { UndoToast } from "./undo-toast";
import { UndoRedoNotice } from "./undo-redo-controls";
import { useAutosave } from "./use-autosave";
import { useIsDesktop } from "./use-is-desktop";
import { usePreviewView } from "./use-preview-view";
import { useUndoRedo } from "./use-undo-redo";
import { ViewTabs, panelId, tabId } from "./view-tabs";

export interface EditorScreenProps {
  pageId: string;
  /** The address shown in the breadcrumb, `{handle}.hydlnk.com`. */
  address: string;
  /** `pages.name` (M6-13): the title in the header, "Main page" until renamed. */
  name?: string;
  /** The public page, "http://mara.localhost:3000" in development. */
  liveUrl: string;
  /** The page's handle: the QR code's file names are `{handle}-qr.png` and `{handle}-qr.svg` (M6-31). */
  handle: string;
  /**
   * The address the QR code encodes (M6-31), decided on the server: `https://{hostname}/` of the
   * primary custom domain, else the handle's origin with a slash.
   */
  publicAddress: string;
  /** The page's primary custom domain (the oldest verified one), or null: the share preview shows it. */
  primaryDomain: string | null;
  /** `pages.published_at` (ISO), or null: it versions the live `/og` image the share preview shows. */
  publishedAt: string | null;
  draft: DraftDoc;
  /** The stored `draft->>rev` (null when the stored draft has none): the stale-tab guard's filter. */
  revKey: string | null;
  /** True when the stored draft could not be read as it was and was reset in the editor. */
  repaired: boolean;
  /** The draft's theme row, or null (none, or a deleted one): the system default applies. */
  themeTokens: Partial<TokenSet> | null;
  /**
   * The token sets of the six themes the starter templates use, by theme id (M6-40): the preview
   * shows a template's theme the moment it is applied, and the template cards draw its colors.
   */
  templateThemes?: Record<string, Partial<TokenSet>>;
  /** `pages.published_at` is set. */
  hasPublished: boolean;
  /** `pages.published` as the stored publish form; null when none or unreadable. */
  published: PublishDoc | null;
  /** The preview's footer links, `pageChrome(plan, pageId)`: the badge follows the plan, the report link is always there. */
  chrome: PageChrome;
}

/**
 * The editor screen (M2-03 .. M2-27): header with the publish state, the profile card, the add-block
 * chips and the block list beside the live preview (tabs on a phone), with autosave, undo and
 * Publish. All editing state lives in one reducer (src/lib/editor/state.ts); the write path is the
 * autosave queue (src/lib/editor/autosave.ts).
 */
export function EditorScreen(props: EditorScreenProps) {
  const { pageId, address, liveUrl, chrome } = props;
  const [state, dispatch] = useReducer(editorReducer, props.draft, initialEditorState);
  // The tokens of the theme a draft points at (M6-40): the one the page loaded with, or one of the
  // template themes. A starter template changes the theme, so the preview, the status chip and
  // Publish's comparison follow the draft's current reference instead of the loaded one.
  const { themeTokens: loadedThemeTokens, templateThemes } = props;
  const loadedRef = props.draft.theme.ref;
  const themeTokensOf = useCallback(
    (ref: string | null): Partial<TokenSet> | null => {
      if (ref === null) return null;
      if (ref === loadedRef && loadedThemeTokens !== null) return loadedThemeTokens;
      return templateThemes?.[ref] ?? null;
    },
    [loadedRef, loadedThemeTokens, templateThemes],
  );
  const themeTokens = themeTokensOf(state.draft.theme.ref);
  const [published, setPublished] = useState({ has: props.hasPublished, doc: props.published });
  // When the page was last published: the share preview's `/og?v=` follows it (M6-33).
  const [publishedAt, setPublishedAt] = useState(props.publishedAt);
  const [publishing, setPublishing] = useState(false);
  // What went wrong with the last Publish when there is no field to point at (M5-15). `retry` is
  // whether pressing Publish again can help (a failure on the way) or not (signed out, suspended).
  const [publishNote, setPublishNote] = useState<{ message: string; retry: boolean } | null>(null);
  const [publishedToken, setPublishedToken] = useState<number | null>(null);
  const isDesktop = useIsDesktop();
  // Which half of the phone editor shows, the dock and the full-size preview (M6-01, M6-02).
  const nav = usePreviewView(isDesktop);
  const { view, setView, showBlocks } = nav;
  // A text field of the page has focus: the dock shrinks to a strip so the keyboard leaves room.
  const [fieldFocused, setFieldFocused] = useState(false);
  const autosave = useAutosave({ pageId, draft: state.draft, initialRevKey: props.revKey });
  const { flush, savedDraft, currentStatus: autosaveStatus, blocked } = autosave;
  // Undo and redo (M6-07): the history is in the reducer state; each step is a normal draft change
  // and goes through the autosave above like any edit.
  const undoRedo = useUndoRedo({
    history: state.history,
    step: (direction, expect) =>
      dispatch({ type: direction === "undo" ? "history/undo" : "history/redo", expect }),
    scope: `#${panelId("blocks")}`,
  });

  // The URL fields the database refused as links to blocked sites (M5-03), shown under those fields
  // beside the Publish errors. They are derived from the draft as it is now, so changing the URL
  // clears the error at once; the save that follows takes the status back to "Saved".
  const blockedErrors = useMemo(
    () => blockedFieldErrors(state.draft, blocked),
    [state.draft, blocked],
  );
  const listErrors = useMemo(
    () =>
      blockedErrors.length === 0 ? state.publishErrors : [...state.publishErrors, ...blockedErrors],
    [state.publishErrors, blockedErrors],
  );

  // One publish form per draft: the preview draws it and the status chip compares it.
  const form = useMemo(() => toPublishForm(state.draft, themeTokens), [state.draft, themeTokens]);
  const status = computePublishStatus({
    hasPublished: published.has,
    published: published.doc,
    form,
  });

  const draftRef = useRef(state.draft);
  useEffect(() => {
    draftRef.current = state.draft;
  }, [state.draft]);

  const onPublish = useCallback(async () => {
    if (publishing) return;
    setPublishing(true);
    setPublishNote(null);
    try {
      // Publish freezes what is stored, so the newest edits are written first.
      const stored = await flush();
      if (!stored) {
        // A signed-out session has its own banner (and its own way out); a link to a blocked site
        // has its message under the field (retrying cannot help); anything else can be tried again.
        const why = autosaveStatus();
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
      setView("blocks");
      dispatch({ type: "publish/errors", errors: result.errors });
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
  }, [publishing, flush, savedDraft, autosaveStatus, pageId, themeTokensOf, setView]);

  // A "Couldn’t publish. A link points to a blocked site" note belongs to the refusal it was shown
  // for: once a save has gone through (the refusal is gone) it is stale and is not shown.
  const shownNote =
    publishNote && publishNote.message === BLOCKED_PUBLISH_NOTE && blocked === null
      ? null
      : publishNote;

  // The page's current social image, as the live page's metadata names it (M2-30): the share
  // preview shows it when the draft has no share image of its own.
  const publishedMs = publishedAt ? Date.parse(publishedAt) : Number.NaN;
  const liveOgUrl = published.has
    ? `${liveUrl}/og${Number.isFinite(publishedMs) ? `?v=${publishedMs}` : ""}`
    : null;

  const nameError =
    state.publishErrors.find((error) => error.field === "profile.name")?.message ?? null;

  // Tap to edit (M6-03): what a tap on the preview opens. From the phone's full-size preview the
  // Blocks tab comes first, committed (flushSync) before the row is asked to scroll and take focus,
  // and without restoring the old scroll position: the row scrolls itself into view.
  const draftBlocks = state.draft.blocks;
  const onPreviewTap = useCallback(
    (raw: PreviewTap) => {
      const tap = checkTap(raw, draftBlocks);
      if (!tap) return;
      flushSync(() => showBlocks({ restoreScroll: false }));
      if (tap.kind === "profile") focusProfilePart(tap.part);
      else dispatch({ type: "expand", id: tap.blockId, itemId: tap.itemId });
    },
    [draftBlocks, showBlocks],
  );

  // The toasts sit on top of whatever is docked above the tab bar (the dock, or the Back to blocks bar).
  const docked = isDesktop ? "none" : view === "blocks" ? "dock" : "bar";
  const lift = toastLift(stackHeight(docked, fieldFocused));
  return (
    <>
      <EditorHeader
        breadcrumb={address}
        title={props.name ?? DEFAULT_PAGE_NAME}
        pageId={pageId}
        flush={flush}
        previewUrl={`/preview/${pageId}`}
        status={status}
        saveStatus={autosave.status}
        liveUrl={published.has ? liveUrl : null}
        qr={{ handle: props.handle, address: props.publicAddress }}
        publishing={publishing}
        blocked={blocked !== null}
        undoRedo={undoRedo}
        onPublish={() => void onPublish()}
      />

      <div className="flex flex-col gap-2 px-4 pt-3 empty:hidden hl:px-8">
        <SaveBanner status={autosave.status} blockedHosts={blocked?.hosts} />
        <UndoRedoNotice controls={undoRedo} />
        {shownNote ? (
          <InlineNotice
            kind="publish"
            action={
              shownNote.retry
                ? { label: "Retry", onClick: () => void onPublish(), disabled: publishing }
                : undefined
            }
          >
            {shownNote.message}
          </InlineNotice>
        ) : null}
      </div>

      {isDesktop ? null : <ViewTabs view={view} onChange={nav.selectTab} />}

      <div className="flex flex-1 flex-col gap-8 px-4 py-3 hl:flex-row hl:items-start hl:gap-8 hl:px-8 hl:py-6">
        <section
          id={panelId("blocks")}
          aria-label={isDesktop ? "Blocks" : undefined}
          aria-labelledby={isDesktop ? undefined : tabId("blocks")}
          role={isDesktop ? undefined : "tabpanel"}
          onFocus={(event) => setFieldFocused(isTextField(event.target))}
          onBlur={(event) => {
            if (!isTextField(event.relatedTarget)) setFieldFocused(false);
          }}
          className={`min-w-0 max-w-[720px] flex-col gap-3 pb-28 hl:flex hl:flex-1 hl:pb-0 ${
            view === "blocks" ? "flex" : "hidden"
          }`}
        >
          {props.repaired ? (
            <p
              role="status"
              className="rounded-md border border-line-2 bg-surface px-4 py-3 text-sm text-ink-2"
            >
              {CORRUPTED_NOTICE}
            </p>
          ) : null}
          <PublishAlert
            errors={state.publishErrors}
            blocks={state.draft.blocks}
            onDismiss={() => dispatch({ type: "publish/clear-errors" })}
          />
          <ProfileCard
            name={state.draft.profile.name}
            bio={state.draft.profile.bio}
            photo={state.draft.profile.photo}
            options={state.draft.profile}
            nameError={nameError}
            focus={state.focus}
            dispatch={dispatch}
          />
          <ShareCard
            share={state.draft.share}
            name={state.draft.profile.name}
            bio={state.draft.profile.bio}
            host={props.primaryDomain ?? address}
            liveOgUrl={liveOgUrl}
            errors={state.publishErrors}
            focus={state.focus}
            dispatch={dispatch}
          />
          <AddBlockCard
            blockCount={state.draft.blocks.length}
            dispatch={dispatch}
            footer={
              <StartFromTemplate
                draft={state.draft}
                themes={templateThemes ?? {}}
                dispatch={dispatch}
              />
            }
          />
          <PageTokensProvider tokens={form.tokens}>
            <BlockList
              blocks={state.draft.blocks}
              expandedId={state.expandedId}
              errors={listErrors}
              focus={state.focus}
              announcement={state.announcement}
              announceSeq={state.announceSeq}
              dispatch={dispatch}
            />
          </PageTokensProvider>
        </section>

        <PreviewPanel
          doc={form}
          pageId={pageId}
          chrome={chrome}
          view={view}
          isDesktop={isDesktop}
          onTap={onPreviewTap}
        />
      </div>

      {docked === "dock" ? (
        <PreviewDock
          doc={form}
          pageId={pageId}
          collapsed={fieldFocused}
          buttonRef={nav.dockRef}
          onOpen={nav.openPreview}
        />
      ) : null}
      {docked === "bar" ? (
        <BackToBlocksBar buttonRef={nav.backRef} onBack={nav.closePreview} />
      ) : null}
      {/*
        The toasts are fixed 68px above the bottom edge, over the tab bar. A transformed ancestor is
        the containing block of its fixed children, so lifting this box (its bottom edge moves up by
        --toast-lift, 0 on desktop) lifts both toasts clear of the dock or the bar without a change
        to either toast.
      */}
      <div
        style={{ "--toast-lift": `${lift}px` } as CSSProperties}
        className="pointer-events-none fixed inset-x-0 top-0 bottom-[var(--toast-lift)] z-30 [transform:translateZ(0)] hl:bottom-0"
      >
        <UndoToast deleted={state.deleted} dispatch={dispatch} />
        <TemplateToast toast={state.templateToast} dispatch={dispatch} onUndo={undoRedo.undo} />
        <PublishedToast
          token={publishedToken}
          liveUrl={liveUrl}
          lifted={state.deleted !== null || state.templateToast !== null}
        />
      </div>
    </>
  );
}
