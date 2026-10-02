"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { Card } from "@/components/app/screen";
import { SaveAsThemeButton, SavedThemesCard, useThemeLibrary } from "@/components/themes";
import { useAutosave } from "@/components/editor/use-autosave";
import { useIsDesktop } from "@/components/editor/use-is-desktop";
import { toPublishForm, type DraftDoc } from "@/lib/document";
import { withToken } from "@/lib/design";
import type { PageChrome } from "@/lib/editor/contracts";
import {
  CORRUPTED_NOTICE,
  INVALID_MESSAGE,
  SAVE_FAILED_MESSAGE,
  STALE_MESSAGE,
} from "@/lib/editor/messages";
import { DesignSaveStatus } from "./design-save-status";
import { resolveTokens, type TokenSet } from "@/lib/theme";
import type { PlanId } from "@/lib/limits/table";
import { themeTokensFor, type ThemeRow } from "@/lib/themes";
import { DesignPreview } from "./design-preview";
import { DesignTabs, designPanelId, designTabId, type DesignView } from "./design-tabs";
import { BackgroundSection, ShapeSection, SpacingSection } from "./external-sections";
import { ColorSection } from "./sections/color-section";
import { FontSection } from "./sections/font-section";
import { TypeSection } from "./sections/type-section";
import type { DesignSectionProps } from "./types";

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
  /** The preview's footer links, `pageChrome(plan, pageId)`. */
  chrome: PageChrome;
}

/**
 * The Design screen (M3-06): the page's theme tokens beside a live preview (Tokens | Preview tabs
 * on a phone). It edits the same draft the editor does, through the editor's own autosave
 * (`useAutosave`, a PATCH of `{draft}` with rev + 1 under the user's session), so a token change
 * lands in `draft.theme.overrides` and nothing is published until Publish.
 */
export function DesignScreen(props: DesignScreenProps) {
  const { pageId, ownerId, plan, chrome } = props;
  const router = useRouter();
  const [draft, setDraft] = useState<DraftDoc>(props.draft);
  const [view, setView] = useState<DesignView>("tokens");
  const isDesktop = useIsDesktop();
  const autosave = useAutosave({ pageId, draft, initialRevKey: props.revKey });
  const { flush } = autosave;

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

  const themeTokens = useMemo(() => themeTokensFor(themes, draft.theme.ref), [themes, draft.theme.ref]);
  const resolved = useMemo(
    () => resolveTokens(themeTokens, draft.theme.overrides),
    [themeTokens, draft.theme.overrides],
  );
  const form = useMemo(() => toPublishForm(draft, themeTokens), [draft, themeTokens]);

  const setToken = useCallback(
    <K extends keyof TokenSet>(key: K, value: TokenSet[K] | undefined) =>
      setDraft((current) => withToken(current, key, value)),
    [],
  );

  const sectionProps: DesignSectionProps = {
    resolved,
    overrides: draft.theme.overrides,
    setToken,
    pageId,
    ownerId,
  };

  const saveProblem =
    autosave.status === "conflict"
      ? STALE_MESSAGE
      : autosave.status === "invalid"
        ? INVALID_MESSAGE
        : autosave.status === "error"
          ? SAVE_FAILED_MESSAGE
          : null;

  // Done writes what is pending first, so the editor never loads a draft older than the edit.
  async function onDone(): Promise<void> {
    if (await flush()) router.push("/editor");
  }

  return (
    <>
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 border-b border-line bg-surface px-4 py-3.5 hl:px-8">
        <div className="min-w-0">
          <p className="font-mono text-xs text-text-2">{library.statusLabel}</p>
          <h1 className="mt-0.5 text-[22px] leading-[1.2] font-bold tracking-[-0.01em]">Design</h1>
        </div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <DesignSaveStatus status={autosave.status} />
          <SaveAsThemeButton library={library} />
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

      {saveProblem ? (
        <div className="flex flex-col gap-2 px-4 pt-3 hl:px-8">
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
        </div>
      ) : null}

      {isDesktop ? null : <DesignTabs view={view} onChange={setView} />}

      <div className="flex flex-1 flex-col gap-8 px-4 py-3 hl:flex-row hl:items-start hl:gap-8 hl:px-8 hl:py-6">
        <section
          id={designPanelId("tokens")}
          aria-label={isDesktop ? "Theme tokens" : undefined}
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
          <SavedThemesCard library={library} />
          <div data-design-section="color">
            <Card className="flex flex-col gap-3.5">
              <h2 className="m-0 text-sm font-semibold">Color</h2>
              <ColorSection {...sectionProps} />
            </Card>
          </div>
          <div data-design-section="style">
            <Card className="flex flex-col gap-4">
              <FontSection {...sectionProps} />
              <TypeSection {...sectionProps} />
              <ShapeSection {...sectionProps} />
              {/* Side by side while 220px each fit, stacked below that (Design.dc.html). */}
              <div className="flex flex-wrap gap-4">
                <div className="min-w-0 flex-[1_1_220px]">
                  <SpacingSection {...sectionProps} />
                </div>
                <div className="min-w-0 flex-[1_1_220px]">
                  <BackgroundSection {...sectionProps} />
                </div>
              </div>
            </Card>
          </div>
        </section>

        <DesignPreview doc={form} pageId={pageId} chrome={chrome} view={view} isDesktop={isDesktop} />
      </div>
    </>
  );
}
