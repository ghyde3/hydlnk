"use client";

import { createContext, useContext, type Dispatch } from "react";
import type { Autosave } from "@/components/editor/use-autosave";
import type { UndoRedo } from "@/components/editor/use-undo-redo";
import type { PreviewTap } from "@/components/editor/preview-taps";
import type { SiteValue } from "@/components/site/use-site-pages";
import type { ThemeLibrary, ThemePreview } from "@/components/themes";
import type { DraftDoc, PublishDoc } from "@/lib/document";
import type { PageChrome } from "@/lib/editor/contracts";
import type { EditorState } from "@/lib/editor/state";
import type { PublishStatus } from "@/lib/editor/status";
import type { PlanId } from "@/lib/limits/table";
import type { TokenSet } from "@/lib/theme";
import type { WorkspaceAction } from "./workspace-reducer";

/** The three tabs, in order. `href` is the browser path on the app host; `id` is the segment under the layout. */
export const WORKSPACE_TABS = [
  { id: "edit", label: "Edit", href: "/editor", segment: "editor" },
  { id: "design", label: "Design", href: "/design", segment: "design" },
  { id: "share", label: "Share", href: "/share", segment: "share" },
] as const;

export type WorkspaceTab = (typeof WORKSPACE_TABS)[number]["id"];

/** The one tab panel every tab renders its content into, and what each tab link controls. */
export const WORKSPACE_PANEL_ID = "workspace-panel";
export const workspaceTabId = (tab: WorkspaceTab): string => `workspace-tab-${tab}`;

/** The block of the Share tab the toolbar's menus ask to open: `/share#preview-links` and `/share#qr`. */
export type ShareTarget = "preview-links" | "qr";

export interface PublishNote {
  message: string;
  /** Whether pressing Publish again can help (a failure on the way) or not (signed out, suspended). */
  retry: boolean;
}

/** What the saved-themes list needs when the server could not read it (M5-16). */
export interface ThemesLoad {
  failed: boolean;
  retrying: boolean;
  retry: () => void;
}

export interface WorkspaceValue {
  // Page identity. Live: the layout passes them on every render, so a rename (`router.refresh()`) updates `name`.
  pageId: string;
  /** The signed-in user's id: the first path segment of the page's uploaded media. */
  ownerId: string;
  plan: PlanId;
  handle: string;
  /** `{handle}.hydlnk.com`, the display address (the mono line above the page name). */
  address: string;
  /** `pages.name` (M6-13). */
  name: string;
  /** The public page's origin, "http://mara.localhost:3000" in development. */
  liveUrl: string;
  /** The address the QR code encodes and the Share tab shows (decided on the server, M6-31). */
  publicAddress: string;
  /** The page's primary custom domain, or null. */
  primaryDomain: string | null;
  /** The preview's footer links, `pageChrome(plan, pageId)`. */
  chrome: PageChrome;

  // The draft: ONE reducer, ONE history, ONE autosave queue for the three tabs.
  state: EditorState;
  draft: DraftDoc;
  /** The site's pages (M11-08): the list, the open page, the open sub-page's editor, the menu and the preview's site. */
  site: SiteValue;
  dispatch: Dispatch<WorkspaceAction>;
  /** `dispatch({ type: "draft/edit", ... })` with a batch number: writes made in one tick are one undo step. */
  editDraft: (update: (draft: DraftDoc) => DraftDoc, group?: string) => void;
  /** The stored draft could not be read as it was and was reset in the editor (M2-03). */
  repaired: boolean;
  autosave: Autosave;
  undoRedo: UndoRedo;

  // What is published, and Publish.
  status: PublishStatus;
  /** Home's own state (the pages list shows it beside each page's). */
  homeStatus: PublishStatus;
  /** The published document as it was last published or loaded, or null (M9-32: the Share tab says what the live page does). */
  publishedForm: PublishDoc | null;
  hasPublished: boolean;
  publishedAt: string | null;
  /** `{liveUrl}/og?v=...` once the page is published, else null: the share preview shows it. */
  liveOgUrl: string | null;
  publishing: boolean;
  /** Writes pending edits, then publishes. Works from every tab; a refusal takes you to what failed. */
  publish: () => void;
  publishNote: PublishNote | null;
  /** Changes with every successful Publish (the toast's key); null until the first one. */
  publishedToken: number | null;
  /** Why Publish is off (suspended owner, a link to a blocked site), or null. */
  publishDisabledReason: string | null;

  // What the preview draws.
  /** The draft's theme tokens (the loaded theme, or one of the template themes). */
  themeTokens: Partial<TokenSet> | null;
  /** `toPublishForm(draft, themeTokens)`: the page as Publish would freeze it. */
  form: PublishDoc;
  /** `form`, or the page in the theme being previewed (M6-44). Draw THIS in the bezel and the mini phone. */
  shownForm: PublishDoc;
  /** The token sets of the six template themes, by theme id (M6-40). */
  templateThemes: Record<string, Partial<TokenSet>>;

  // Themes (the Design tab's Themes card).
  library: ThemeLibrary;
  themesLoad: ThemesLoad;
  /** The draft points at a theme that no longer exists (M5-16): the Design tab says so. */
  themeDeleted: boolean;
  preview: ThemePreview;

  // Tabs, taps, and the Share tab's focus protocol.
  activeTab: WorkspaceTab;
  /** True at 760px and up. */
  isDesktop: boolean;
  /**
   * What a tap on the page in the preview opens (M6-03): goes to the Edit tab first when another
   * tab is open (a soft navigation), then opens that block's row or focuses that profile field.
   * Does nothing while a theme is being previewed.
   */
  onPreviewTap: (tap: PreviewTap) => void;
  /** A pending request to focus a profile field, set by `onPreviewTap`; the Edit tab consumes it. */
  profileTap: { part: "avatar" | "name" | "bio"; nonce: number } | null;
  clearProfileTap: (nonce: number) => void;
  /** Goes to `/share#preview-links` or `/share#qr` and focuses that card's first control. */
  openShare: (target: ShareTarget) => void;
  shareFocus: { target: ShareTarget; nonce: number } | null;
  clearShareFocus: (nonce: number) => void;
}

const WorkspaceContext = createContext<WorkspaceValue | null>(null);

export const WorkspaceContextProvider = WorkspaceContext.Provider;

/** The workspace's shared state. Throws outside the workspace layout: every consumer lives inside it. */
export function useWorkspace(): WorkspaceValue {
  const value = useContext(WorkspaceContext);
  if (value === null) throw new Error("useWorkspace must be used inside the workspace layout.");
  return value;
}

/**
 * Like `useWorkspace`, but null outside the workspace layout: for editor pieces that also render
 * alone (a block form in a unit test) and only add detail when the workspace is there (M9-28).
 */
export function useOptionalWorkspace(): WorkspaceValue | null {
  return useContext(WorkspaceContext);
}
