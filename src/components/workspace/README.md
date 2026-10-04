# The workspace (M7-01 .. M7-05)

One signed-in screen with three tabs, **Edit** (`/editor`), **Design** (`/design`) and **Share**
(`/share`). The sidebar has one item for it, "Editor". `/editor/history` is NOT part of it (it is
its own screen under the Editor nav item).

```
src/app/(editor)/app/(screens)/
  layout.tsx                 app shell (sidebar, tab bar), unchanged in shape
  (workspace)/layout.tsx     SERVER: reads the draft, themes, template themes, primary domain ONCE,
                             then renders <WorkspaceProvider key={pageId}> + <WorkspaceShell>
  (workspace)/editor/page.tsx   <EditTab/>      (src/components/editor/editor-screen.tsx)
  (workspace)/design/page.tsx   <DesignTab/>    (src/components/design/design-screen.tsx)
  (workspace)/share/page.tsx    <ShareTab/>     (src/components/workspace/share/share-tab.tsx)
  editor/history/page.tsx    outside the workspace
```

The three pages only fill the shell's one `role="tabpanel"` (`id="workspace-panel"`). A soft
navigation between tabs re-runs the page modules and nothing else: the toolbar, the preview bezel,
the notices, the toasts and the whole draft state are the same React nodes.

## One draft

`WorkspaceProvider` (client, `workspace-provider.tsx`) is the ONLY place that calls `useAutosave`,
the history/reducer and `useUndoRedo`. No Edit, Design or Share component may import them (a Vitest
scan enforces it). It holds:

- `state` / `draft` / `dispatch`: the editor reducer (`src/lib/editor/state.ts`) wrapped by
  `workspaceReducer` (`workspace-reducer.ts`), which adds the generic action
  `{ type: "draft/edit", update: (draft) => draft, group?, batch? }`. The Design controls and the
  saved-themes hook write through it (`editDraft(update, group?)`), so their edits are steps of the
  SAME history as the Edit tab's. Undo/redo, the autosave queue and `rev` are therefore shared.
- `autosave`, `undoRedo` (scope = the tab panel, so the share Title and Description keep the app's
  undo and the toolbar's page-name field keeps the browser's), `library` (`useThemeLibrary`),
  `preview` (`useThemePreview`), publish state.

The provider is keyed by the page id only. Everything the server passes in that is **draft data**
(`draft`, `revKey`, `hasPublished`, `published`, ...) is read once, on mount; a `router.refresh()`
(rename, Publish) re-renders the layout with fresh props but never recreates the save queue or clears
the history. Page **identity** props (`name`, `handle`, `publicAddress`, `chrome`) are live: a rename
shows at once. Switching pages in the sidebar changes the key, so the old queue flushes and the new
page starts with an empty history.

## Using it

```tsx
const { draft, dispatch, editDraft, undoRedo, autosave, status, publish, publishing, form,
        shownForm, library, preview, onPreviewTap, openShare, isDesktop, activeTab, ... } = useWorkspace();
```

The full list, with comments, is `WorkspaceValue` in `workspace-context.tsx`. Highlights for the
other Wave I areas:

- **Toolbar (M7-05)**: `toolbar/workspace-toolbar.tsx` is mounted once by the shell (through
  `workspace-toolbar-slot.tsx`), as a direct child of the workspace root so its `sticky` works over the
  whole screen. It pins itself and publishes `--hl-toolbar-h` (`toolbar/pinned-height.ts`); the
  preview column pins at `PREVIEW_PIN_TOP`. Use `<WorkspaceTabs active={activeTab} />`
  (`workspace-tabs.tsx`) for the 'Workspace' tablist: real links, roving tabindex, arrow keys,
  `aria-controls="workspace-panel"`. The toolbar holds the page's only `h1` (the page name).
  `useWorkspace()` has `pageId`, `autosave.flush`, `autosave.status`, `undoRedo`, `status`,
  `publishing`, `publishDisabledReason`, `publish`, `openShare("preview-links" | "qr")`.
- **Themes (M7-06)**: the Design tab renders the card with `library`, `themesLoad`, `preview`
  from `useWorkspace()`; the library is loaded by the layout and shared (the card must not load its
  own). `library.apply` etc. write through `editDraft`.
- **Templates (M7-07/08)**: the Edit tab's "Add a block" card renders `<StartFromTemplate draft
themes dispatch />`; `dispatch` is the workspace dispatch. The reducer action is still
  `template/apply` in `src/lib/editor/state.ts`.
- **Mini phone (M7-09)**: the shell renders it (`workspace-mini-phone-slot.tsx`) only below 760px (`!isDesktop`). It draws
  `shownForm` (the draft, or the page in the theme being previewed) with `pageId` and `chrome`; a
  tap goes to `onPreviewTap(tap)`, which handles the tab switch and does nothing during a theme
  preview. The desktop bezel is `workspace-preview.tsx`; below 760px there is NO bezel in the DOM.
- **Share focus protocol**: `openShare("qr")` pushes `/share#qr`; the Share tab focuses the QR
  card's first button (`preview-links`: 'Create link') once it is mounted, whether you were already on
  Share or arrived from another tab.

## Layout contract

- The shell is `<div data-testid="workspace">` > toolbar > notices area > `[content panel | preview
column]`. Content column max 720px, preview column 330px (`hl:` = 760px and up). The preview
  column is `sticky` at `PREVIEW_PIN_TOP` (`calc(var(--hl-toolbar-h, 56px) + 16px)`).
- Notices (once each, every tab): save banner, undo notice, corrupted-draft notice, publish note,
  Publish alert.
- Toasts (block deleted, template applied, published) live in the shell, above the phone tab bar.

## Files

| File                                         | What it is                                                                       |
| -------------------------------------------- | -------------------------------------------------------------------------------- |
| `workspace-provider.tsx`                     | the one draft, history, save queue, undo, library, theme preview and Publish     |
| `workspace-context.tsx`                      | `WorkspaceValue`, `useWorkspace()`, the tab list, the panel and tab ids          |
| `workspace-reducer.ts`                       | the editor reducer plus the generic `draft/edit` action                          |
| `failure-tab.ts`                             | which tab a refused Publish brings you to (profile, blocks, share, page)         |
| `workspace-shell.tsx`                        | toolbar slot, notices, tab panel, preview column or mini phone, toasts           |
| `workspace-tabs.tsx`                         | the 'Workspace' tablist (real links)                                             |
| `workspace-preview.tsx`, `preview-bezel.tsx` | the 330px preview column and the 310x660 bezel                                   |
| `workspace-notices.tsx`                      | the one notices area                                                             |
| `share/`                                     | the Share tab: address, QR, private preview links, version history (phone) cards |
| `toolbar/`, `mini-preview/`                  | the pinned toolbar (M7-05) and the mini phone (M7-09)                            |
