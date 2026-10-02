"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { toPublishForm, type DraftDoc, type PublishDoc } from "@/lib/document";
import { publishPage, type PageChrome } from "@/lib/editor/contracts";
import {
  CORRUPTED_NOTICE,
  INVALID_MESSAGE,
  SAVE_FAILED_MESSAGE,
  STALE_MESSAGE,
} from "@/lib/editor/messages";
import { editorReducer, initialEditorState } from "@/lib/editor/state";
import { computePublishStatus } from "@/lib/editor/status";
import type { TokenSet } from "@/lib/theme";
import { PageTokensProvider } from "@/components/themes";
import { AddBlockCard } from "./add-block-card";
import { BlockList } from "./block-list";
import { EditorHeader } from "./editor-header";
import { PreviewPanel } from "./preview-panel";
import { ProfileCard } from "./profile-card";
import { PublishAlert } from "./publish-alert";
import { PublishedToast } from "./published-toast";
import { UndoToast } from "./undo-toast";
import { useAutosave } from "./use-autosave";
import { useIsDesktop } from "./use-is-desktop";
import { ViewTabs, panelId, tabId, type EditorView } from "./view-tabs";

export interface EditorScreenProps {
  pageId: string;
  /** The address shown in the breadcrumb, `{handle}.hydlnk.com`. */
  address: string;
  /** The public page, "http://mara.localhost:3000" in development. */
  liveUrl: string;
  draft: DraftDoc;
  /** The stored `draft->>rev` (null when the stored draft has none): the stale-tab guard's filter. */
  revKey: string | null;
  /** True when the stored draft could not be read as it was and was reset in the editor. */
  repaired: boolean;
  /** The draft's theme row, or null (none, or a deleted one): the system default applies. */
  themeTokens: Partial<TokenSet> | null;
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
  const { pageId, address, liveUrl, themeTokens, chrome } = props;
  const [state, dispatch] = useReducer(editorReducer, props.draft, initialEditorState);
  const [view, setView] = useState<EditorView>("blocks");
  const [published, setPublished] = useState({ has: props.hasPublished, doc: props.published });
  const [publishing, setPublishing] = useState(false);
  const [publishNote, setPublishNote] = useState<string | null>(null);
  const [publishedToken, setPublishedToken] = useState<number | null>(null);
  const isDesktop = useIsDesktop();
  const autosave = useAutosave({ pageId, draft: state.draft, initialRevKey: props.revKey });
  const { flush, savedDraft } = autosave;

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
        setPublishNote("Couldn’t publish. Your latest changes aren’t saved yet.");
        return;
      }
      const snapshot = savedDraft() ?? draftRef.current;
      const result = await publishPage(pageId);
      if (result.ok) {
        setPublished({ has: true, doc: toPublishForm(snapshot, themeTokens) });
        dispatch({ type: "publish/clear-errors" });
        setPublishedToken((token) => (token ?? 0) + 1);
        return;
      }
      setView("blocks");
      dispatch({ type: "publish/errors", errors: result.errors });
      if (result.errors.length === 0) {
        setPublishNote(
          result.reason === "unauthorized"
            ? "Couldn’t publish. Sign in again, then try again."
            : "Couldn’t publish. Try again.",
        );
      }
    } catch {
      setPublishNote("Couldn’t publish. Try again.");
    } finally {
      setPublishing(false);
    }
  }, [publishing, flush, savedDraft, pageId, themeTokens]);

  const nameError =
    state.publishErrors.find((error) => error.field === "profile.name")?.message ?? null;
  const saveProblem =
    autosave.status === "conflict"
      ? STALE_MESSAGE
      : autosave.status === "invalid"
        ? INVALID_MESSAGE
        : autosave.status === "error"
          ? SAVE_FAILED_MESSAGE
          : null;

  return (
    <>
      <EditorHeader
        breadcrumb={`${address} / main`}
        title="Main page"
        status={status}
        saveStatus={autosave.status}
        liveUrl={published.has ? liveUrl : null}
        previewUrl={liveUrl}
        publishing={publishing}
        onPublish={() => void onPublish()}
      />

      {saveProblem || publishNote ? (
        <div className="flex flex-col gap-2 px-4 pt-3 hl:px-8">
          {saveProblem ? (
            <div
              role="alert"
              className="flex max-w-[720px] flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-bad-line bg-surface py-1 pr-1 pl-4 text-sm text-bad"
            >
              <span className="py-2">{saveProblem}</span>
              {autosave.status === "conflict" ? (
                <button
                  type="button"
                  onClick={() => window.location.reload()}
                  className="min-h-11 rounded-md border border-bad-line bg-surface px-4 text-[13px] font-semibold text-bad"
                >
                  Reload
                </button>
              ) : null}
            </div>
          ) : null}
          {publishNote ? (
            <div
              role="alert"
              className="max-w-[720px] rounded-md border border-bad-line bg-surface px-4 py-3 text-sm text-bad"
            >
              {publishNote}
            </div>
          ) : null}
        </div>
      ) : null}

      {isDesktop ? null : <ViewTabs view={view} onChange={setView} />}

      <div className="flex flex-1 flex-col gap-8 px-4 py-3 hl:flex-row hl:items-start hl:gap-8 hl:px-8 hl:py-6">
        <section
          id={panelId("blocks")}
          aria-label={isDesktop ? "Blocks" : undefined}
          aria-labelledby={isDesktop ? undefined : tabId("blocks")}
          role={isDesktop ? undefined : "tabpanel"}
          className={`min-w-0 max-w-[720px] flex-col gap-3 hl:flex hl:flex-1 ${
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
            nameError={nameError}
            focus={state.focus}
            dispatch={dispatch}
          />
          <AddBlockCard blockCount={state.draft.blocks.length} dispatch={dispatch} />
          <PageTokensProvider tokens={form.tokens}>
            <BlockList
              blocks={state.draft.blocks}
              expandedId={state.expandedId}
              errors={state.publishErrors}
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
        />
      </div>

      <UndoToast deleted={state.deleted} dispatch={dispatch} />
      <PublishedToast token={publishedToken} liveUrl={liveUrl} lifted={state.deleted !== null} />
    </>
  );
}
