"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import {
  SaveAsThemeButton,
  SavedThemesCard,
  useThemeLibrary,
  useThemePreview,
} from "@/components/themes";
import { SaveBanner } from "@/components/editor/save-banner";
import { useAutosave } from "@/components/editor/use-autosave";
import { UndoRedoButtons, UndoRedoNotice } from "@/components/editor/undo-redo-controls";
import { useUndoRedo } from "@/components/editor/use-undo-redo";
import { useIsDesktop } from "@/components/editor/use-is-desktop";
import { toPublishForm, type DraftDoc } from "@/lib/document";
import { withToken } from "@/lib/design";
import type { PageChrome } from "@/lib/editor/contracts";
import { CORRUPTED_NOTICE, THEME_DELETED_NOTICE } from "@/lib/editor/messages";
import { DesignSaveStatus } from "./design-save-status";
import { resolveTokens, type TokenSet } from "@/lib/theme";
import type { PlanId } from "@/lib/limits/table";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import { fetchThemeLibrary, themeById, themeTokensFor, type ThemeRow } from "@/lib/themes";
import { DesignCard } from "./design-card";
import { DesignPreview } from "./design-preview";
import { useDraftHistory } from "./use-draft-history";
import { DesignTabs, designPanelId, designTabId, type DesignView } from "./design-tabs";
import { BackgroundSection, ShapeSection, SpacingSection } from "./external-sections";
import { ColorSection } from "./sections/color-section";
import { FontSection } from "./sections/font-section";
import { TypeSection } from "./sections/type-section";
import type { DesignSectionProps } from "./types";

/** Tokens whose control sends many values in one gesture: the sliders and the color fields and pickers (the gradient's too). */
const STREAMING_TOKENS: ReadonlySet<keyof TokenSet> = new Set<keyof TokenSet>([
  "overlayOpacity",
  "blur",
  "bg",
  "surface",
  "text",
  "textMuted",
  "accent",
  "buttonBg",
  "buttonText",
  "border",
  "gradientFrom",
  "gradientTo",
]);

export interface DesignScreenProps {
  pageId: string;
  /** The signed-in user's id: the first path segment of the page's uploaded media. */
  ownerId: string;
  /** The account's plan: the saved-themes limit message names it. */
  plan: PlanId;
  draft: DraftDoc;
  /** The stored `draft->>rev` (null when the stored draft has none): the stale-tab guard's filter. */
  revKey: string | null;
  /** True when the stored draft could not be read as it was and was reset on load. */
  repaired: boolean;
  /** Every theme the user may use (system and their own saved ones), read under RLS. */
  themes: ThemeRow[];
  /** The server could not read the themes (`themes` is empty): the row says so and offers Retry (M5-16). */
  themesFailed?: boolean;
  /** The preview's footer links, `pageChrome(plan, pageId)`. */
  chrome: PageChrome;
}

/**
 * The Design screen (M3-06): the page's theme tokens beside a live preview (Style | Preview tabs
 * on a phone). It edits the same draft the editor does, through the editor's own autosave
 * (`useAutosave`, a PATCH of `{draft}` with rev + 1 under the user's session), so a token change
 * lands in `draft.theme.overrides` and nothing is published until Publish.
 */
export function DesignScreen(props: DesignScreenProps) {
  const { pageId, ownerId, plan, chrome } = props;
  const router = useRouter();
  // The draft with its undo history (M6-08): in memory only, this screen's own, gone with it.
  const { draft, history, setDraft, update, step } = useDraftHistory(props.draft);
  const [view, setView] = useState<DesignView>("tokens");
  const isDesktop = useIsDesktop();
  const autosave = useAutosave({ pageId, draft, initialRevKey: props.revKey });
  const { flush } = autosave;
  const undoRedo = useUndoRedo({
    history,
    step,
    scope: `#${designPanelId("tokens")}`,
    nativeWithin: '[data-testid="saved-themes-card"]',
  });

  // The saved-themes logic (apply, save, update, rename, delete) is the themes area's hook; the
  // draft and its autosave stay this screen's, and a theme action only writes `draft.theme`.
  const library = useThemeLibrary({
    initialThemes: props.themes,
    ownerId,
    plan,
    draft,
    setDraft,
  });
  const themes = library.themes;

  // The themes the server could not read: the row shows the message and Retry; everything else on the
  // screen keeps working (an unreadable list only means no theme tokens: the page resolves from the
  // system default plus its own overrides). Retry reads the list from the browser, so it works
  // without discarding what is being edited here.
  const [themesFailed, setThemesFailed] = useState(props.themesFailed === true);
  const [retryingThemes, setRetryingThemes] = useState(false);
  const { replaceThemes } = library;
  const retryThemes = useCallback(async () => {
    setRetryingThemes(true);
    try {
      const result = await fetchThemeLibrary(createBrowserSupabase());
      if (result.ok) {
        replaceThemes(result.themes);
        setThemesFailed(false);
      }
    } finally {
      setRetryingThemes(false);
    }
  }, [replaceThemes]);

  // The draft points at a theme that no longer exists (deleted with the secret key, or from another
  // page): every reader resolves it to the default. Say so, and write nothing: the reference is only
  // replaced when the person picks a theme, and the live page is what the last Publish froze.
  const themeDeleted =
    !themesFailed && draft.theme.ref !== null && themeById(themes, draft.theme.ref) === null;

  const themeTokens = useMemo(() => themeTokensFor(themes, draft.theme.ref), [themes, draft.theme.ref]);
  const resolved = useMemo(
    () => resolveTokens(themeTokens, draft.theme.overrides),
    [themeTokens, draft.theme.overrides],
  );
  const form = useMemo(() => toPublishForm(draft, themeTokens), [draft, themeTokens]);

  // Previewing a theme on the page without applying it (M6-44): derived, never saved or published.
  // The preview column draws the previewed form while one is on show; every control that changes
  // the page, Save as theme, Done and the Style tab end it first.
  const preview = useThemePreview({
    draft,
    themes,
    applyTheme: library.apply,
    showPreview: () => {
      if (!isDesktop) setView("preview");
    },
    showStyle: () => setView("tokens"),
  });
  const stopPreview = preview.stop;

  // Only the controls that stream values (a slider drag, a typed or picked color) coalesce into
  // one step, by token. A click on an option is a step of its own, however soon the next one comes.
  const setToken = useCallback(
    <K extends keyof TokenSet>(key: K, value: TokenSet[K] | undefined) => {
      stopPreview({ focus: false });
      update(
        (current) => withToken(current, key, value),
        STREAMING_TOKENS.has(key) ? `theme:${key}` : undefined,
      );
    },
    [update, stopPreview],
  );

  const sectionProps: DesignSectionProps = {
    resolved,
    overrides: draft.theme.overrides,
    setToken,
    pageId,
    ownerId,
  };

  // Done writes what is pending first, so the editor never loads a draft older than the edit.
  async function onDone(): Promise<void> {
    stopPreview({ focus: false });
    // A link to a blocked site (M5-03) is fixed in the Editor, where the URL fields are: Done goes
    // there instead of doing nothing while the save is refused.
    if ((await flush()) || autosave.currentStatus() === "blocked") router.push("/editor");
  }

  return (
    <>
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 border-b border-line bg-surface px-4 py-3.5 hl:px-8">
        <div className="min-w-0">
          <p className="font-mono text-xs text-text-2">{library.statusLabel}</p>
          <h1 className="mt-0.5 text-[22px] leading-[1.2] font-bold tracking-[-0.01em]">Design</h1>
        </div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <UndoRedoButtons controls={undoRedo} />
          <DesignSaveStatus status={autosave.status} />
          <SaveAsThemeButton library={library} onBefore={() => stopPreview({ focus: false })} />
          <Link
            href="/editor"
            onClick={(event) => {
              event.preventDefault();
              void onDone();
            }}
            className="inline-flex min-h-11 items-center rounded-md bg-ink px-4 text-sm font-semibold text-surface no-underline"
          >
            Done
          </Link>
        </div>
      </header>

      <div className="flex flex-col gap-2 px-4 pt-3 empty:hidden hl:px-8">
        <SaveBanner status={autosave.status} blockedHosts={autosave.blocked?.hosts} editorLink />
        <UndoRedoNotice controls={undoRedo} />
      </div>

      {isDesktop ? null : (
        <DesignTabs
          view={view}
          onChange={(next) => {
            // Leaving the Preview tab for Style ends a theme preview: what is on screen is the page.
            if (next === "tokens") stopPreview({ focus: false });
            setView(next);
          }}
        />
      )}

      <div className="flex flex-1 flex-col gap-8 px-4 py-3 hl:flex-row hl:items-start hl:gap-8 hl:px-8 hl:py-6">
        <section
          id={designPanelId("tokens")}
          aria-label={isDesktop ? "Style settings" : undefined}
          aria-labelledby={isDesktop ? undefined : designTabId("tokens")}
          role={isDesktop ? undefined : "tabpanel"}
          className={`min-w-0 max-w-[720px] flex-col gap-3 hl:flex hl:flex-1 ${
            view === "tokens" ? "flex" : "hidden"
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
          {themeDeleted ? (
            <p
              role="status"
              data-testid="theme-deleted-notice"
              className="rounded-md border border-line-2 bg-surface px-4 py-3 text-sm text-ink-2"
            >
              {THEME_DELETED_NOTICE}
            </p>
          ) : null}
          <SavedThemesCard
            library={library}
            loadFailed={themesFailed ? { onRetry: () => void retryThemes(), retrying: retryingThemes } : null}
            onPreview={(id) => preview.start(id)}
            previewingId={preview.theme?.id ?? null}
          />
          <DesignCard section="color" title="Colors">
            <ColorSection {...sectionProps} />
          </DesignCard>
          <DesignCard section="fonts" title="Fonts">
            <FontSection {...sectionProps} />
            <TypeSection {...sectionProps} />
          </DesignCard>
          <DesignCard section="buttons" title="Buttons">
            <ShapeSection {...sectionProps} />
          </DesignCard>
          <DesignCard section="layout" title="Layout">
            <SpacingSection {...sectionProps} />
          </DesignCard>
          <DesignCard section="background" title="Background">
            <BackgroundSection {...sectionProps} />
          </DesignCard>
        </section>

        <DesignPreview
          doc={preview.form ?? form}
          pageId={pageId}
          chrome={chrome}
          view={view}
          isDesktop={isDesktop}
          themePreview={preview.view}
        />
      </div>
    </>
  );
}
