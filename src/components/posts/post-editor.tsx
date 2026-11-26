"use client";

import { useId, useRef, useState } from "react";
import { SUSPENDED_REASON, useAccountSuspended } from "@/components/admin/suspension-context";
import { FORM_BUTTON, FORM_BUTTON_DANGER } from "@/components/blocks/field";
import type { TermSummary } from "@/lib/content/schemas/summaries";
import { CONTENT_CONFLICT_MESSAGE } from "@/lib/posts/messages";
import { POST_TEST_IDS } from "@/lib/blog/test-ids";
import {
  fetchPost,
  expirePost,
  postAction,
  refusalMessage,
  restoreRevision,
  type FieldIssue,
  type Refused,
} from "@/lib/posts/client";
import {
  bodyUsage,
  fieldOfIssue,
  postFieldId,
  readPostForm,
  slugFollowsTitle,
  stableJson,
  toStoredDraft,
  type PostForm,
} from "@/lib/posts/draft";
import type { PostEntry } from "@/lib/posts/types";
import { suggestSlug } from "@/lib/posts/slug";
import type { PostState } from "@/lib/posts/status";
import { createPreviewLink, listPreviewLinks } from "@/lib/previews/actions";
import {
  choosePreviewLink,
  forgetPreview,
  HAS_PREVIEW_LINK_MESSAGE,
  rememberedPreview,
  rememberPreview,
} from "@/lib/posts/preview-link";
import { BodyEditor } from "./body-editor/body-editor";
import { bodyBytes } from "./body-editor/markdown";
import {
  ExcerptField,
  FeaturedImageField,
  PostCard,
  SearchFields,
  SlugField,
  TitleField,
} from "./post-fields";
import { PostIssues, PostPublishPanel, type PostBusy } from "./post-publish-panel";
import { PostRevisions } from "./post-revisions";
import { TermPicker } from "./term-picker";
import { usePostAutosave } from "./use-post-autosave";

/**
 * The post editor (M16-13 to M16-15): one post of the current site. Title, slug, the Markdown body,
 * excerpt, featured image, categories, tags and the search fields, autosaved as `{rev, draft}` to
 * the entry draft route; Publish, Unpublish, Revisions, Trash and Restore for this post alone.
 *
 * State is `{form, rev, save}`: the form is what is on screen, the rev and the save state live in
 * the save queue. An edit is stored 1.5 s later. A stale rev (the post was changed in another tab or
 * by an AI assistant) shows the conflict notice with Reload and overwrites nothing. Publish and the
 * other actions first store what is typed, then run alone at the stored rev, and the editor adopts
 * only the rev they answer.
 *
 * The server decides everything that matters: ownership, the plan, the strict publish rules. This
 * screen reports what it answered. HYDLNK UI tokens only; the tenant's theme is never drawn here.
 */

export interface PostEditorProps {
  siteId: string;
  ownerId: string;
  /** The blog's archive path, for the slug field's prefix. */
  archivePath: string;
  entry: PostEntry;
  terms: TermSummary[];
}

interface Meta {
  status: PostEntry["status"];
  everPublished: boolean;
  /** The stored form of the draft that is live, or null when it is not known to match anything. */
  liveJson: string | null;
}

export function PostEditor({
  siteId,
  ownerId,
  archivePath,
  entry,
  terms: firstTerms,
}: PostEditorProps) {
  const suspended = useAccountSuspended();
  const bodyLabelId = useId();
  const { view: save, queue } = usePostAutosave(siteId, entry.id, entry.rev);

  /** The stored draft as loaded: what the form is written over (keys the screen has no field for). */
  const [base, setBase] = useState<unknown>(entry.draft);
  const [form, setForm] = useState<PostForm>(() => readPostForm(entry.draft));
  const latest = useRef(form);
  const [meta, setMeta] = useState<Meta>(() => ({
    status: entry.status,
    everPublished: entry.firstPublishedAt !== null,
    liveJson: liveJsonOf(entry),
  }));
  const [following, setFollowing] = useState(() =>
    slugFollowsTitle(readPostForm(entry.draft), entry.firstPublishedAt !== null),
  );
  const [terms, setTerms] = useState(firstTerms);
  const [issues, setIssues] = useState<FieldIssue[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  /** The last action stood but its cache expiry failed: the live copy may lag until a retry. */
  const [cacheStale, setCacheStale] = useState(false);
  const [busy, setBusy] = useState<PostBusy>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  /** Bumped when the draft is replaced from the server, so the body editor mounts on the new body. */
  const [loadKey, setLoadKey] = useState(0);

  const trashed = meta.status === "trashed";
  const conflict = save.state === "conflict";
  const locked = suspended || trashed || conflict || busy === "revision" || busy === "restore";
  const usage = bodyUsage(bodyBytes(form.body));
  const stored = stableJson(toStoredDraft(form, base));
  const state: PostState = trashed
    ? "trashed"
    : meta.status === "draft"
      ? "draft"
      : stored === meta.liveJson
        ? "live"
        : "changes";

  function change(patch: Partial<PostForm>) {
    let next: PostForm = { ...latest.current, ...patch };
    if ("slug" in patch) setFollowing(false);
    else if ("title" in patch && following) {
      next = { ...next, slug: next.title.trim() === "" ? "" : suggestSlug(next.title) };
    }
    latest.current = next;
    setForm(next);
    setNotice(null);
    const edited = new Set(
      Object.keys(patch).map((key) => (key.startsWith("seo") || key === "noindex" ? "seo" : key)),
    );
    if ("title" in patch && following) edited.add("slug");
    if ("categories" in patch || "tags" in patch) edited.add("terms");
    setIssues((current) => current.filter((issue) => !edited.has(fieldOfIssue(issue.path))));
    // A body over the limit is refused here, before any request; the text stays on screen.
    if (bodyUsage(bodyBytes(next.body)).over) return;
    queue.push(toStoredDraft(next, base));
  }

  /** Replace everything on screen with the post as the server holds it. */
  function adopt(fresh: PostEntry) {
    setBase(fresh.draft);
    const next = readPostForm(fresh.draft);
    latest.current = next;
    setForm(next);
    setFollowing(slugFollowsTitle(next, fresh.firstPublishedAt !== null));
    setMeta({
      status: fresh.status,
      everPublished: fresh.firstPublishedAt !== null,
      liveJson: liveJsonOf(fresh),
    });
    setIssues([]);
    setLoadKey((key) => key + 1);
  }

  function report(refused: Refused) {
    if (refused.kind === "conflict") {
      queue.markConflict();
      return;
    }
    if (refused.kind === "invalid") {
      setIssues(
        refused.issues.length > 0
          ? refused.issues
          : [{ path: "post", message: refused.message || "That post isn’t valid." }],
      );
      return;
    }
    if (refused.kind === "slug") {
      setIssues([{ path: "slug", message: refused.message }]);
      return;
    }
    if (refused.kind === "blocked") {
      setIssues([{ path: "body", message: refusalMessage(refused) }]);
      return;
    }
    setNotice(refusalMessage(refused));
  }

  const NOT_SAVED =
    "Your latest changes aren’t saved yet, so nothing was done. Check the message above and try again.";

  async function run(action: "publish" | "unpublish" | "trash" | "restore") {
    if (busy !== null) return;
    setBusy(action);
    setNotice(null);
    setIssues([]);
    let sent = "";
    try {
      const out = await queue.exclusive(async (rev) => {
        // Everything typed is stored: this is the draft the action acts on.
        sent = stableJson(toStoredDraft(latest.current, base));
        const answer = await postAction(siteId, entry.id, action, rev);
        return { rev: answer.kind === "ok" ? answer.rev : undefined, value: answer };
      });
      if (!out.ok) {
        if (queue.view.state !== "conflict") setNotice(NOT_SAVED);
        return;
      }
      if (out.value.kind !== "ok") {
        report(out.value);
        return;
      }
      setCacheStale(out.value.cacheStale === true);
      if (action === "publish") {
        setMeta({ status: "published", everPublished: true, liveJson: sent });
        setFollowing(false);
      } else if (action === "unpublish") {
        setMeta((current) => ({ ...current, status: "draft", liveJson: null }));
      } else if (action === "trash") {
        setMeta((current) => ({ ...current, status: "trashed", liveJson: null }));
      } else {
        setMeta((current) => ({ ...current, status: "draft", liveJson: null }));
      }
    } finally {
      setBusy(null);
    }
  }

  async function expireAgain() {
    const out = await expirePost(siteId, entry.id);
    if (out.kind === "ok" && out.expired) setCacheStale(false);
  }

  async function restoreFrom(revision: number): Promise<string | null> {
    if (busy !== null) return "Wait for the current step to finish.";
    setBusy("revision");
    try {
      let refused: Refused | null = null;
      const out = await queue.exclusive(async (rev) => {
        const answer = await restoreRevision(siteId, entry.id, revision, rev);
        if (answer.kind !== "ok") {
          refused = answer;
          return { value: null };
        }
        const fresh = await fetchPost(siteId, entry.id);
        if (fresh.kind !== "ok") {
          refused = fresh;
          return { rev: answer.rev, value: null };
        }
        return { rev: fresh.entry.rev, value: fresh.entry };
      });
      if (!out.ok) return queue.view.state === "conflict" ? CONTENT_CONFLICT_MESSAGE : NOT_SAVED;
      if (out.value === null) {
        const why = refused as Refused | null;
        if (why?.kind === "conflict") queue.markConflict();
        return why ? refusalMessage(why) : "That revision could not be restored. Try again.";
      }
      adopt(out.value);
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function preview() {
    if (busy !== null) return;
    setBusy("preview");
    setNotice(null);
    // Opened in the click itself, so the browser does not block it; it is pointed at the link below.
    const tab = window.open("about:blank", "_blank");
    try {
      await queue.flush();
      const remembered = rememberedPreview(siteId);
      const listed = await listPreviewLinks(siteId).catch(() => null);
      const choice = choosePreviewLink({
        remembered,
        activeLinkIds: listed?.ok ? listed.links.map((l) => l.id) : null,
      });
      // A remembered link that is no longer active (turned off, run out) is never opened again.
      if (remembered !== null && listed?.ok && choice !== "use-remembered") forgetPreview(siteId);
      if (choice === "has-link" || choice === "unknown") {
        tab?.close();
        setNotice(
          choice === "has-link"
            ? HAS_PREVIEW_LINK_MESSAGE
            : "The preview could not be opened. Try again.",
        );
        return;
      }
      let link = choice === "use-remembered" ? (remembered?.url ?? null) : null;
      if (link === null) {
        const made = await createPreviewLink(siteId);
        if (!made.ok) {
          tab?.close();
          setNotice(made.message);
          return;
        }
        link = made.url;
        rememberPreview(siteId, made);
      }
      const target = `${link.replace(/\/+$/, "")}/entry/${entry.id}`;
      setPreviewUrl(target);
      if (tab) {
        tab.opener = null;
        tab.location.replace(target);
      }
    } catch {
      tab?.close();
      setNotice("The preview could not be opened. Try again.");
    } finally {
      setBusy(null);
    }
  }

  const fieldError = (field: string) =>
    issues.find((issue) => fieldOfIssue(issue.path) === field)?.message;
  const errors = {
    title: fieldError("title"),
    slug: fieldError("slug"),
    excerpt: fieldError("excerpt"),
    featuredImage: fieldError("featuredImage"),
    seo: fieldError("seo"),
  };
  const bodyError = usage.over
    ? "The body is over 512 KiB, so it isn’t being saved. Shorten it."
    : fieldError("body");
  const publishOff = usage.over ? "Shorten the body first." : suspended ? SUSPENDED_REASON : null;
  const fields = { form, change, disabled: locked, errors };

  return (
    <div data-testid="post-editor" data-post-id={entry.id} className="flex min-w-0 flex-col gap-3">
      <PostPublishPanel
        state={state}
        save={save}
        busy={busy}
        disabled={suspended || conflict}
        publishOff={publishOff}
        previewUrl={previewUrl}
        onPublish={() => void run("publish")}
        onUnpublish={() => void run("unpublish")}
        onPreview={() => void preview()}
      />

      {conflict ? (
        <div
          role="alert"
          data-testid={POST_TEST_IDS.conflict}
          className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-bad-line bg-surface py-1 pr-1 pl-4 text-sm text-bad"
        >
          <span className="min-w-0 py-2 [overflow-wrap:anywhere]">{CONTENT_CONFLICT_MESSAGE}</span>
          <button type="button" onClick={() => window.location.reload()} className={FORM_BUTTON}>
            Reload
          </button>
        </div>
      ) : null}
      {save.state === "error" ? (
        <div
          role="alert"
          data-testid="post-save-error"
          data-save-problem={save.problem ?? "error"}
          className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-bad-line bg-surface py-1 pr-1 pl-4 text-sm text-bad"
        >
          <span className="min-w-0 py-2 [overflow-wrap:anywhere]">{saveProblemText(save)}</span>
          {save.problem === "unauthorized" ? (
            <a href="/login" target="_blank" rel="noopener" className={FORM_BUTTON}>
              Sign in
            </a>
          ) : (
            <button type="button" onClick={() => queue.retry()} className={FORM_BUTTON}>
              Try again
            </button>
          )}
        </div>
      ) : null}
      {cacheStale ? (
        <div
          role="status"
          data-testid="post-cache-stale"
          className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-line bg-surface py-1 pr-1 pl-4 text-sm text-text-2"
        >
          <span className="min-w-0 py-2 [overflow-wrap:anywhere]">{CACHE_STALE_MESSAGE}</span>
          <button type="button" onClick={() => void expireAgain()} className={FORM_BUTTON}>
            Try again
          </button>
        </div>
      ) : null}
      {notice ? (
        <p
          role="alert"
          data-testid="post-notice"
          className="m-0 rounded-md border border-bad-line bg-surface px-4 py-3 text-sm text-bad"
        >
          {notice}
        </p>
      ) : null}
      <PostIssues issues={issues} />

      {trashed ? (
        <div
          role="status"
          data-testid="post-trashed"
          className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-md border border-line bg-surface p-3.5 text-sm text-text-2"
        >
          <span className="min-w-0">
            This post is in the trash and off the site. It is deleted for good 30 days after it was
            trashed, and counts toward your posts until then.
          </span>
          <button
            type="button"
            data-testid={POST_TEST_IDS.restore}
            disabled={suspended || busy !== null}
            onClick={() => void run("restore")}
            className={FORM_BUTTON}
          >
            {busy === "restore" ? "Restoring…" : "Restore post"}
          </button>
        </div>
      ) : null}

      <PostCard title="Post">
        <TitleField {...fields} />
        <SlugField {...fields} archivePath={archivePath} following={following} />
        <div id={postFieldId("body")} className="flex min-w-0 scroll-mt-24 flex-col gap-1.5">
          <div className="flex items-baseline justify-between gap-3">
            <span id={bodyLabelId} className="text-[13px] font-semibold text-ink-2">
              Body
            </span>
            {usage.near ? (
              <span
                data-testid="post-body-size"
                className={`font-mono text-[11px] ${usage.over ? "text-bad" : "text-text-2"}`}
              >
                {usage.text}
              </span>
            ) : null}
          </div>
          <BodyEditor
            key={loadKey}
            initial={form.body}
            disabled={locked}
            ownerId={ownerId}
            labelledBy={bodyLabelId}
            onChange={(body) => change({ body })}
          />
          <div aria-live="polite" className="empty:hidden">
            {bodyError ? (
              <p data-testid="post-body-error" className="m-0 text-[13px] text-bad">
                {bodyError}
              </p>
            ) : null}
          </div>
        </div>
      </PostCard>

      <PostCard title="Summary and image">
        <ExcerptField {...fields} />
        <FeaturedImageField {...fields} />
      </PostCard>

      <PostCard title="Categories and tags">
        <div id={postFieldId("terms")} className="flex min-w-0 scroll-mt-24 flex-col gap-5">
          <TermPicker
            taxonomy="category"
            siteId={siteId}
            terms={terms}
            onTermsChange={setTerms}
            selected={form.categories}
            onSelect={(categories) => change({ categories })}
            disabled={locked}
          />
          <TermPicker
            taxonomy="tag"
            siteId={siteId}
            terms={terms}
            onTermsChange={setTerms}
            selected={form.tags}
            onSelect={(tags) => change({ tags })}
            disabled={locked}
          />
        </div>
      </PostCard>

      <PostCard title="Search">
        <SearchFields {...fields} />
      </PostCard>

      {trashed ? null : (
        <PostCard title="Revisions and trash">
          <PostRevisions
            siteId={siteId}
            entryId={entry.id}
            disabled={suspended || conflict || busy !== null}
            onRestore={restoreFrom}
          />
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
            <button
              type="button"
              data-testid={POST_TEST_IDS.trash}
              disabled={suspended || conflict || busy !== null}
              onClick={() => void run("trash")}
              className={FORM_BUTTON_DANGER}
            >
              {busy === "trash" ? "Moving…" : "Move to trash"}
            </button>
            <span className="min-w-0 text-xs text-text-2">
              Takes the post off the site at once. You can restore it for 30 days.
            </span>
          </div>
        </PostCard>
      )}
    </div>
  );
}

const CACHE_STALE_MESSAGE =
  "Done. Your live site may take a moment to show this change. Try again to update it now.";

/**
 * The live copy as the screen compares it with what it would store: so a post opened with
 * unpublished changes reads Live again once it is edited back to what is live. Null when not live.
 */
function liveJsonOf(entry: PostEntry): string | null {
  if (entry.status !== "published") return null;
  const live = entry.published ?? (entry.hasUnpublishedChanges ? null : entry.draft);
  if (live === null || typeof live !== "object") return null;
  return stableJson(toStoredDraft(readPostForm(live), live));
}

function saveProblemText(save: { problem: string | null; message?: string }): string {
  switch (save.problem) {
    case "too-large":
      return "This post is too large to save. Shorten it.";
    case "storage-full":
      return "Your storage is full, so this post isn’t being saved. Remove some images or upgrade.";
    case "blocked":
      return "The post links to a site that isn’t allowed, so it isn’t being saved. Remove the link.";
    case "invalid":
      return (
        save.message ??
        "Something in this post can’t be saved. Check the slug and the fields below."
      );
    case "suspended":
      return SUSPENDED_REASON;
    case "missing":
      return "This post no longer exists, or the blog was turned off. Go back to all posts.";
    case "unauthorized":
      return "You’re signed out, so this post isn’t being saved. Sign in, then come back to this tab.";
    default:
      return "This post isn’t being saved. Check your connection.";
  }
}
