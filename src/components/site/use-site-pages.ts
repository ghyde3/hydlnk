"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type Dispatch,
} from "react";
import { blockedFieldErrors } from "@/lib/blocklist/fields";
import {
  publishFormsEqual,
  resolveNav,
  toSubPagePublishForm,
  type DraftDoc,
  type Nav,
  type PublishError,
  type SubPageDraft,
  type SubPagePublish,
} from "@/lib/document";
import type { EditorState } from "@/lib/editor/state";
import { pagesPerSiteMessage } from "@/lib/limits/messages";
import type { PlanId } from "@/lib/limits/table";
import {
  addToNav,
  blockIdsOf,
  duplicatedPageContent,
  moveInNav,
  moveToPlaceOf,
  orderSitePages,
  pageLimitState,
  pathProblem,
  removeFromNav,
  subPageState,
  takenPaths,
  titleOf,
  HOME_PAGE_ID,
  type PageLimitState,
  type PageState,
  type SitePageItem,
  type SubPageSummary,
} from "@/lib/site-pages/pages";
import { SubPageSaver, type SubBlocked, type SubSaveStatus } from "@/lib/site-pages/saver";
import { createSubPageSaveFn } from "@/lib/site-pages/save-client";
import {
  instantiateSiteTemplate,
  siteTemplateById,
  type SiteTemplateId,
} from "@/lib/site-templates/catalog";
import { buildMenu, hrefsOf, type SiteContext, type SitePageSummary } from "@/lib/site/menu";
import type { WorkspaceAction } from "@/components/workspace/workspace-reducer";
import { docOf, initSiteState, siteReducer, type SubPageSettings } from "./site-state";

/** One sub-page as the workspace opens it (the layout's read of `site_pages`). */
export interface SubPageInit {
  id: string;
  draft: SubPageDraft;
  published: SubPagePublish | null;
  livePath: string | null;
  createdAt: string;
}

export type SiteAddResult = { ok: true; id: string } | { ok: false; message: string };
export type SiteDeleteResult = { ok: true } | { ok: false; message: string };
export type SiteTemplateResult = { ok: true } | { ok: false; message: string };

/** What `add` takes: a title and optionally a path (suggested from the title when absent), and starting content. */
export interface SiteAddInput {
  title: string;
  path?: string;
  description?: string;
  blocks?: SubPageDraft["blocks"];
}

/** What the preview needs to draw the open page as part of its site: the menu, the links, the sub-page. */
export interface PreviewSite {
  site: SiteContext;
  subPage?: { title: string; blocks: SubPagePublish["blocks"] };
}

export interface SiteValue {
  /** Home first, then the sub-pages in menu order, then the ones outside the menu. */
  items: SitePageItem[];
  /** "home" or the open sub-page's id. */
  activeId: string;
  isHome: boolean;
  select: (id: string) => void;
  /** The open sub-page's block editor state, or null on Home. */
  activeEditor: EditorState | null;
  dispatchActive: Dispatch<WorkspaceAction>;
  activeSettings: SubPageSettings | null;
  /** The open sub-page's fields the link blocklist refused, for its block list. */
  activeBlockedErrors: PublishError[];
  /** The settings of any sub-page (the page-link picker, the list). */
  titles: ReadonlyArray<{ id: string; title: string }>;
  updateSettings: (id: string, patch: Partial<SubPageSettings>) => void;
  /** The live check of a path typed for `id` (null for a new page): the rule, the reserved list, the site's other paths. */
  pathError: (path: string, id: string | null) => string | null;
  /** Every path another page of the site holds, as a draft or live: what a new page's path may not be. */
  takenPaths: string[];
  add: (input: SiteAddInput) => Promise<SiteAddResult>;
  /** Fills Home and creates the template's two pages as drafts (M12-03). Publishes nothing. */
  applyTemplate: (id: SiteTemplateId) => Promise<SiteTemplateResult>;
  remove: (id: string) => Promise<SiteDeleteResult>;
  /** A new draft page from a copy of this one, with fresh ids and a free path (M12-08). */
  duplicate: (id: string) => Promise<SiteAddResult>;
  /** Each sub-page's state against the live site (M12-08). */
  pageStates: Readonly<Record<string, PageState>>;
  toggleMenu: (id: string) => void;
  moveInMenu: (id: string, direction: -1 | 1) => void;
  /** Drag and drop: put a menu page where another one is. */
  reorderMenu: (id: string, overId: string) => void;
  menuShown: boolean;
  setMenuShown: (show: boolean) => void;
  limit: PageLimitState;
  limitMessage: string;
  /** Writes the sub-pages' pending edits; true when everything is stored. */
  flush: () => Promise<boolean>;
  saveStatus: SubSaveStatus;
  /** A sub-page differs from what is live (an edit, or never published): Publish has something to do. */
  dirty: boolean;
  /** Called after a successful Publish with the sub-pages as they were saved. */
  markPublished: () => void;
  preview: PreviewSite;
  /** What Publish refused on sub-pages: block errors go to that page's editor, field errors are kept here. Opens the first page named. */
  applyPublishErrors: (errors: readonly PublishError[]) => void;
  clearPublishErrors: () => void;
  /** A sub-page's Publish errors for its own fields (title, description, path). */
  fieldErrors: Readonly<Record<string, readonly PublishError[]>>;
  /** Ids of the sub-pages that have a Publish error to fix. */
  pagesWithErrors: ReadonlySet<string>;
  /** The page a relative menu href ("/" or "/items") names, or null: a click on the preview's menu opens it. */
  hrefToId: (href: string) => string | null;
}

/**
 * The sub-pages of the open site (M11-08), owned by the workspace provider. Home keeps its own draft
 * and save queue; this holds the other half: per sub-page its settings and block editor
 * (`site-state.ts`), one debounced save queue for all of them (`SubPageSaver`) and the menu, which
 * is Home's draft (`nav`), so it is edited through the workspace's `editDraft` and waits for Publish
 * with everything else. Title, description, path and menu changes are draft; creating and deleting
 * a page go through the server and are immediate.
 */
export function useSitePages(args: {
  siteId: string;
  plan: PlanId;
  initial: readonly SubPageInit[];
  homeTitle: string;
  nav: DraftDoc["nav"];
  editDraft: (update: (draft: DraftDoc) => DraftDoc, group?: string) => void;
}): SiteValue {
  const { siteId, plan, homeTitle, nav, editDraft } = args;
  const [initial] = useState(() => args.initial);
  const [state, dispatch] = useReducer(siteReducer, initial, initSiteState);
  const [activeId, setActiveId] = useState<string>(HOME_PAGE_ID);

  // What each page was when it last went to the saver (or loaded): a page is written only when its
  // settings or blocks are another object than that.
  const [livePaths, setLivePaths] = useState(
    () => new Map(initial.map((page) => [page.id, page.livePath])),
  );
  const [createdAt, setCreatedAt] = useState(
    () => new Map(initial.map((page) => [page.id, page.createdAt])),
  );
  const [publishedForms, setPublishedForms] = useState(
    () => new Map(initial.map((page) => [page.id, page.published])),
  );

  const [saveStatus, setSaveStatus] = useState<SubSaveStatus>("idle");
  const [blocked, setBlocked] = useState<Record<string, SubBlocked>>({});
  const saverRef = useRef<SubPageSaver | null>(null);
  useEffect(() => {
    const saver = new SubPageSaver({
      save: createSubPageSaveFn(),
      onStatus: setSaveStatus,
      onBlocked: (id, refusal) =>
        setBlocked((current) => {
          if (refusal === null) {
            if (!(id in current)) return current;
            const { [id]: _removed, ...rest } = current;
            void _removed;
            return rest;
          }
          return { ...current, [id]: refusal };
        }),
    });
    saverRef.current = saver;
    const onVisibility = () => {
      if (document.visibilityState === "hidden") void saver.flush();
      else saver.retryNow();
    };
    const onPageHide = () => void saver.flush();
    const onOnline = () => saver.retryNow();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("online", onOnline);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("online", onOnline);
      void saver.flush().finally(() => saver.dispose());
      saverRef.current = null;
    };
  }, []);

  // Edits not stored yet: the browser asks before the tab closes, as it does for Home's.
  useEffect(() => {
    if (saveStatus === "idle" || saveStatus === "saved") return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [saveStatus]);

  const seen = useRef(new Map<string, { settings: SubPageSettings; blocks: unknown }>());
  useEffect(() => {
    const saver = saverRef.current;
    for (const id of state.ids) {
      const settings = state.settings[id]!;
      const blocks = state.editors[id]!.draft.blocks;
      const before = seen.current.get(id);
      seen.current.set(id, { settings, blocks });
      // A page the effect has not seen is a new one: its row exists and is empty, nothing to write.
      if (!before) continue;
      if (before.settings === settings && before.blocks === blocks) continue;
      const doc = docOf(state, id);
      if (doc) saver?.schedule(id, doc);
    }
    for (const id of [...seen.current.keys()]) {
      if (!state.ids.includes(id)) seen.current.delete(id);
    }
  }, [state]);

  const summaries = useMemo<SubPageSummary[]>(
    () =>
      state.ids.map((id) => ({
        id,
        title: titleOf({ title: state.settings[id]!.title }),
        path: state.settings[id]!.path,
        livePath: livePaths.get(id) ?? null,
        createdAt: createdAt.get(id) ?? "",
      })),
    [state.ids, state.settings, livePaths, createdAt],
  );
  const items = useMemo(
    () => orderSitePages(homeTitle, nav, summaries),
    [homeTitle, nav, summaries],
  );
  const resolvedNav = useMemo(() => resolveNav(nav), [nav]);
  const limit = pageLimitState(plan, state.ids.length);
  const limitMessage = pagesPerSiteMessage(plan, limit.used);

  const select = useCallback(
    (id: string) => setActiveId(id === HOME_PAGE_ID || state.ids.includes(id) ? id : HOME_PAGE_ID),
    [state.ids],
  );
  const effectiveId =
    activeId !== HOME_PAGE_ID && state.ids.includes(activeId) ? activeId : HOME_PAGE_ID;
  const isHome = effectiveId === HOME_PAGE_ID;
  const activeEditor = isHome ? null : (state.editors[effectiveId] ?? null);
  const dispatchActive = useCallback<Dispatch<WorkspaceAction>>(
    (action) => {
      if (effectiveId !== HOME_PAGE_ID) dispatch({ type: "editor", id: effectiveId, action });
    },
    [effectiveId],
  );

  const activeBlocked = isHome ? undefined : blocked[effectiveId];
  const activeBlockedErrors = useMemo(
    () =>
      activeEditor && activeBlocked
        ? blockedFieldErrors(activeEditor.draft, {
            hosts: activeBlocked.hosts,
            blockIds: activeBlocked.blockIds,
            draft: activeEditor.draft,
          })
        : [],
    [activeEditor, activeBlocked],
  );

  // Publish errors on a sub-page's own fields; block errors live in that page's editor state.
  const [fieldErrors, setFieldErrors] = useState<Record<string, readonly PublishError[]>>({});
  const updateSettings = useCallback((id: string, patch: Partial<SubPageSettings>) => {
    dispatch({ type: "settings", id, patch });
    // An edited field no longer has the error the last Publish gave it.
    setFieldErrors((current) => {
      const held = current[id];
      if (!held) return current;
      const kept = held.filter((error) => !(error.field in patch));
      if (kept.length === held.length) return current;
      const { [id]: _removed, ...rest } = current;
      void _removed;
      return kept.length === 0 ? rest : { ...rest, [id]: kept };
    });
  }, []);
  const applyPublishErrors = useCallback(
    (errors: readonly PublishError[]) => {
      const byPage = new Map<string, PublishError[]>();
      for (const error of errors) {
        if (!error.subPageId) continue;
        byPage.set(error.subPageId, [...(byPage.get(error.subPageId) ?? []), error]);
      }
      const fields: Record<string, readonly PublishError[]> = {};
      for (const [id, list] of byPage) {
        if (!state.ids.includes(id)) continue;
        dispatch({
          type: "editor",
          id,
          action: {
            type: "publish/errors",
            errors: list.filter((error) => error.blockId !== null),
          },
        });
        const own = list.filter((error) => error.blockId === null);
        if (own.length > 0) fields[id] = own;
      }
      setFieldErrors(fields);
      const first = [...byPage.keys()].find((id) => state.ids.includes(id));
      if (first) setActiveId(first);
    },
    [state.ids],
  );
  const clearPublishErrors = useCallback(() => {
    setFieldErrors((current) => (Object.keys(current).length === 0 ? current : {}));
    for (const id of state.ids) {
      if (state.editors[id]!.publishErrors.length > 0) {
        dispatch({ type: "editor", id, action: { type: "publish/clear-errors" } });
      }
    }
  }, [state.ids, state.editors]);
  const pagesWithErrors = useMemo(() => {
    const ids = new Set(Object.keys(fieldErrors));
    for (const id of state.ids) if (state.editors[id]!.publishErrors.length > 0) ids.add(id);
    return ids;
  }, [fieldErrors, state.ids, state.editors]);
  const pathError = useCallback(
    (path: string, id: string | null) =>
      pathProblem(path.trim(), takenPaths(summaries, id ?? undefined)),
    [summaries],
  );

  const setNav = useCallback(
    (next: (nav: DraftDoc["nav"]) => Nav, group?: string) =>
      editDraft((draft) => ({ ...draft, nav: next(draft.nav) }), group),
    [editDraft],
  );
  const toggleMenu = useCallback(
    (id: string) =>
      setNav((current) =>
        resolveNav(current).items.includes(id) ? removeFromNav(current, id) : addToNav(current, id),
      ),
    [setNav],
  );
  const moveInMenu = useCallback(
    (id: string, direction: -1 | 1) => setNav((current) => moveInNav(current, id, direction)),
    [setNav],
  );
  const reorderMenu = useCallback(
    (id: string, overId: string) => setNav((current) => moveToPlaceOf(current, id, overId)),
    [setNav],
  );
  const setMenuShown = useCallback(
    (show: boolean) => setNav((current) => ({ ...resolveNav(current), show })),
    [setNav],
  );

  const add = useCallback<SiteValue["add"]>(
    async ({ title, path, description, blocks }) => {
      try {
        const response = await fetch(`/api/pages/${siteId}/sub-pages`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ title, path, description, blocks }),
        });
        const body = (await response.json().catch(() => null)) as {
          id?: string;
          draft?: SubPageDraft;
          createdAt?: string;
          message?: string;
        } | null;
        if (!response.ok || !body?.id || !body.draft) {
          return { ok: false, message: body?.message ?? "Couldn’t add the page. Try again." };
        }
        const id = body.id;
        setCreatedAt((current) =>
          new Map(current).set(id, body.createdAt ?? new Date().toISOString()),
        );
        setPublishedForms((current) => new Map(current).set(id, null));
        dispatch({ type: "add", id, draft: body.draft });
        // A new page joins the menu (a page nobody can reach is rarely the point); hide it from there if not.
        setNav((current) => addToNav(current, id));
        setActiveId(id);
        return { ok: true, id };
      } catch {
        return {
          ok: false,
          message: "Couldn’t add the page. Check your connection and try again.",
        };
      }
    },
    [siteId, setNav],
  );

  const remove = useCallback<SiteValue["remove"]>(
    async (id) => {
      try {
        const response = await fetch(`/api/pages/${siteId}/sub-pages/${id}`, { method: "DELETE" });
        if (!response.ok && response.status !== 404) {
          const body = (await response.json().catch(() => null)) as { message?: string } | null;
          return { ok: false, message: body?.message ?? "Couldn’t delete the page. Try again." };
        }
        // Gone on the server: stop writing it, leave the menu and go home if it was open.
        saverRef.current?.drop(id);
        dispatch({ type: "remove", id });
        setNav((current) => removeFromNav(current, id));
        setPublishedForms((current) => {
          const next = new Map(current);
          next.delete(id);
          return next;
        });
        setActiveId((current) => (current === id ? HOME_PAGE_ID : current));
        return { ok: true };
      } catch {
        return {
          ok: false,
          message: "Couldn’t delete the page. Check your connection and try again.",
        };
      }
    },
    [siteId, setNav],
  );

  const applyTemplate = useCallback<SiteValue["applyTemplate"]>(
    async (id) => {
      const template = siteTemplateById(id);
      if (!template) return { ok: false, message: "That template doesn’t exist." };
      if (limit.max - limit.used < 2) return { ok: false, message: limitMessage };
      // Ids already on the site (the pages' blocks): the template's own never repeat one.
      const taken = new Set<string>();
      const walk = (value: unknown): void => {
        if (Array.isArray(value)) value.forEach(walk);
        else if (value && typeof value === "object") {
          for (const [key, inner] of Object.entries(value)) {
            if (
              (key === "id" || key === "googleId" || key === "appleId") &&
              typeof inner === "string"
            )
              taken.add(inner);
            else walk(inner);
          }
        }
      };
      for (const pageId of state.ids) walk(state.editors[pageId]!.draft.blocks);
      const made = instantiateSiteTemplate(template, taken);
      const created: string[] = [];
      for (const page of made.pages) {
        const result = await add({
          title: page.title,
          description: page.description,
          blocks: page.blocks,
        });
        if (!result.ok) {
          // All or nothing: a page that was made is taken back.
          for (const pageId of created) await remove(pageId);
          return { ok: false, message: result.message };
        }
        created.push(result.id);
      }
      editDraft((draft) => made.home(draft, [created[0]!, created[1]!]), "site-template");
      setActiveId(HOME_PAGE_ID);
      return { ok: true };
    },
    [limit.max, limit.used, limitMessage, state.ids, state.editors, add, remove, editDraft],
  );

  const duplicate = useCallback<SiteValue["duplicate"]>(
    async (id) => {
      const source = docOf(state, id);
      if (!source) return { ok: false, message: "That page doesn’t exist." };
      if (limit.atLimit) return { ok: false, message: limitMessage };
      const taken = new Set<string>();
      for (const pageId of state.ids) {
        for (const blockId of blockIdsOf(state.editors[pageId]!.draft.blocks)) taken.add(blockId);
      }
      const copy = duplicatedPageContent(source, takenPaths(summaries), taken);
      return add(copy);
    },
    [state, limit.atLimit, limitMessage, summaries, add],
  );

  const flush = useCallback(async () => (await saverRef.current?.flush()) ?? true, []);

  const forms = useMemo(() => {
    const map = new Map<string, SubPagePublish>();
    for (const id of state.ids) {
      const doc = docOf(state, id);
      if (doc) map.set(id, toSubPagePublishForm(doc));
    }
    return map;
  }, [state]);
  const pageStates = useMemo(() => {
    const map: Record<string, PageState> = {};
    for (const id of state.ids) {
      const form = forms.get(id);
      if (form) map[id] = subPageState(form, publishedForms.get(id) ?? null);
    }
    return map;
  }, [state.ids, forms, publishedForms]);
  const dirty = state.ids.some(
    (id) => !publishFormsEqual(forms.get(id), publishedForms.get(id) ?? null),
  );
  const formsRef = useRef(forms);
  useEffect(() => {
    formsRef.current = forms;
  }, [forms]);
  const markPublished = useCallback(() => {
    const current = formsRef.current;
    setPublishedForms(new Map(current));
    setLivePaths(new Map([...current].map(([id, form]) => [id, form.path])));
  }, []);

  const preview = useMemo<PreviewSite>(() => {
    const live: SitePageSummary[] = state.ids.map((id) => ({
      id,
      path: state.settings[id]!.path.trim(),
      title: titleOf({ title: state.settings[id]!.title }),
    }));
    const menu = buildMenu(nav, live, effectiveId, "links");
    const site: SiteContext = { hrefs: hrefsOf(live), menu };
    if (isHome) return { site };
    return {
      site,
      subPage: {
        title: titleOf({ title: state.settings[effectiveId]!.title }),
        blocks: forms.get(effectiveId)?.blocks ?? [],
      },
    };
  }, [state.ids, state.settings, nav, effectiveId, isHome, forms]);

  const hrefToId = useCallback(
    (href: string) => {
      if (href === "/") return HOME_PAGE_ID;
      return state.ids.find((id) => `/${state.settings[id]!.path.trim()}` === href) ?? null;
    },
    [state.ids, state.settings],
  );

  const titles = useMemo(
    () => state.ids.map((id) => ({ id, title: titleOf({ title: state.settings[id]!.title }) })),
    [state.ids, state.settings],
  );

  return {
    items,
    activeId: effectiveId,
    isHome,
    select,
    activeEditor,
    dispatchActive,
    activeSettings: isHome ? null : (state.settings[effectiveId] ?? null),
    activeBlockedErrors,
    titles,
    updateSettings,
    pathError,
    takenPaths: takenPaths(summaries),
    add,
    applyTemplate,
    remove,
    duplicate,
    pageStates,
    toggleMenu,
    moveInMenu,
    reorderMenu,
    menuShown: resolvedNav.show,
    setMenuShown,
    limit,
    limitMessage,
    flush,
    saveStatus,
    dirty,
    markPublished,
    preview,
    applyPublishErrors,
    clearPublishErrors,
    fieldErrors,
    pagesWithErrors,
    hrefToId,
  };
}
