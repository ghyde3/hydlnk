"use client";

import { useCallback } from "react";
import { SavedThemesCard } from "@/components/themes";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { withToken } from "@/lib/design";
import { THEME_DELETED_NOTICE } from "@/lib/editor/messages";
import type { TokenSet } from "@/lib/theme";
import { resolveTokens } from "@/lib/theme";
import { DesignCard } from "./design-card";
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

/**
 * The Design tab (M3-06, M7-02): the page's theme tokens, as cards. It edits the same draft the Edit
 * tab does, through the workspace's own autosave and history (`useWorkspace`): a token change lands
 * in `draft.theme.overrides`, is one step of the one undo history and nothing is published until
 * Publish. The header, Done, the live preview and the save status of the old Design screen are the
 * workspace's now (the toolbar and the shared preview column).
 */
export function DesignTab() {
  const { draft, editDraft, pageId, ownerId, library, themesLoad, themeDeleted, preview, themeTokens } =
    useWorkspace();
  const stopPreview = preview.stop;

  // Only the controls that stream values (a slider drag, a typed or picked color) coalesce into
  // one step, by token. A click on an option is a step of its own, however soon the next one comes.
  const setToken = useCallback(
    <K extends keyof TokenSet>(key: K, value: TokenSet[K] | undefined) => {
      stopPreview({ focus: false });
      editDraft(
        (current) => withToken(current, key, value),
        STREAMING_TOKENS.has(key) ? `theme:${key}` : undefined,
      );
    },
    [editDraft, stopPreview],
  );

  const resolved = resolveTokens(themeTokens, draft.theme.overrides);
  const sectionProps: DesignSectionProps = {
    resolved,
    overrides: draft.theme.overrides,
    setToken,
    pageId,
    ownerId,
  };

  return (
    <>
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
        loadFailed={
          themesLoad.failed ? { onRetry: themesLoad.retry, retrying: themesLoad.retrying } : null
        }
        onPreview={(id) => preview.start(id)}
        previewingId={preview.theme?.id ?? null}
        onBeforeSave={() => stopPreview({ focus: false })}
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
    </>
  );
}
