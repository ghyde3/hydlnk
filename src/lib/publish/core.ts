import "server-only";
import { placedBlockImages, type Placed } from "./placed-images";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { blockedLinksInPublished, checkBlocklist, loadBlockedDomains } from "@/lib/blocklist";
import { publishSitePageWithClient } from "@/lib/content";
import { designPublishSchema, prepareHomeEntryPublish } from "@/lib/content/schemas/page";
import {
  PATH_MESSAGES,
  collectPublishErrors,
  collectSubPagePublishErrors,
  pageLinkTargetErrors,
  publishDocSchema,
  publishSubPageSchema,
  publishedDocSchema,
  publishedSubPageSchema,
  redirectTargetIssue,
  siteBlockIdClashes,
  toPublishForm,
  toSubPagePublishForm,
  type DraftDoc,
  type PublishDoc,
  type PublishError,
} from "@/lib/document";
import { mapPublishIssues } from "@/lib/document/publish";
import {
  getHomeDraftWithClient,
  getPublishedHomeWithClient,
  listDraftPagesWithClient,
  type DraftPage,
  type HomeDraft,
} from "@/lib/site/page-entries";
import { MEDIA_BUCKET } from "@/lib/media/limits";
import { checkLinkRules, misplacedLockErrors, ownHostsOf } from "./link-rules";
import { homeForSite, nameErrors, pageTitleOf, siteErrors, type SiteSubPage } from "./site-checks";
import { mediaOrigin } from "@/lib/media/url";
import { createAdminSupabase } from "@/lib/supabase/admin";
import type { Database, Json } from "@/lib/supabase/database.types";
import { tokenSetSchema, type TokenSet } from "@/lib/theme";
import { mediaPathOf } from "@/lib/themes/bg-image";
import { PUBLISH_STOPPED, friendlyPublishErrors } from "@/lib/themes/publish-errors";

/** Why a publish did not happen, besides `invalid` (the draft has problems the editor can show). */
export type PublishFailureReason =
  | "unauthorized"
  | "forbidden"
  | "invalid"
  | "error"
  /** The owner's account is suspended (M5-09): nothing is published until an admin unsuspends it. */
  | "account_suspended"
  /** A link in the saved draft points to a blocked site (M5-03); `errors` name each link and its host. */
  | "blocked_link"
  /** Too many publishes in the last hour (M11-12): nothing was read or written; try again later. */
  | "rate_limited"
  /** The account's sub-pages would pass the 64 MiB byte cap (HL009): not retryable until content is removed. */
  | "storage_full"
  /** The design or a page was saved somewhere else since the editor read it (M15-10): nothing was written. */
  | "conflict"
  /** Publish page and Publish design: a site that is not the caller's, an unknown one, an entry outside it. */
  | "not_found";

export type PublishResult =
  | { ok: true; publishedAt: string }
  | { ok: false; errors: PublishError[]; reason?: PublishFailureReason };

/**
 * What Publish all changes left, read by `publish_site_revs` under the publish's own locks (M15-10):
 * the design's rev key and the rev of every live page entry, Home's included. The publish can move an
 * entry's rev without changing its draft, and the editor adopts exactly these values: it never reads
 * the revs again on its own, where another writer's rev could slip in and be saved over.
 */
export type PublishedRevs = { designRev: string | null; entries: Record<string, number> };

/** The answer of Publish all changes. */
export type SitePublishResult =
  | { ok: true; publishedAt: string; revs: PublishedRevs }
  | { ok: false; errors: PublishError[]; reason?: PublishFailureReason };

const publishedRevsSchema = z.object({
  design_rev: z.string().nullable(),
  entries: z.record(z.string(), z.number().int().min(1)),
});

/**
 * What the editor last loaded or saved (M15-10): the design's rev key (`pages.draft->>rev`) and the
 * rev of each page entry it holds, Home's included. Publish all changes refuses with `conflict` when
 * any of them moved. Absent (MCP): no rev is checked.
 */
export type PublishExpected = { designRev: string | null; entries: Record<string, number> };

/** The answer of Publish page: the entry's rev afterwards, and whether the live copy was already this. */
export type PagePublishResult =
  | { ok: true; publishedAt: string; rev: number; unchanged: boolean }
  | { ok: false; errors: PublishError[]; reason?: PublishFailureReason; currentRev?: number };

const expectedSchema = z.object({
  designRev: z.string().max(40).nullable(),
  entries: z.record(z.string(), z.number().int().min(1)),
});

/** What Publish page and Publish design say on a site that was never published. */
export const SITE_NOT_LIVE_MESSAGE = "This site isn’t live yet. Use Publish all changes first.";
const TOO_LARGE_MESSAGE = "This is too large to publish. Remove some content and try again.";
const siteNotLive = () =>
  refuse("invalid", [{ blockId: null, field: "document", message: SITE_NOT_LIVE_MESSAGE }]);

export interface PublishDeps {
  /** Secret-key client (RLS does not apply: every check below is ours). */
  admin?: SupabaseClient<Database>;
  /** Does `page-media` hold this object? Defaults to a Storage HEAD with the secret key. */
  mediaExists?: (path: string) => Promise<boolean>;
  now?: () => Date;
}

const pageIdSchema = z.guid();
const UID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const refuse = (
  reason: PublishFailureReason,
  errors: PublishError[] = [],
): { ok: false; errors: PublishError[]; reason: PublishFailureReason } => ({
  ok: false,
  errors,
  reason,
});

/**
 * The publish gate (M2-23, M2-25), everything except the cache call, which only a Server Action
 * may make (see actions.ts). Takes a page id and the verified session user and nothing else: the
 * document is read from Postgres here, never taken from the caller.
 *
 *   1. no session user: `unauthorized`; a page the user does not own (or that does not exist):
 *      `forbidden`. Nothing is read or written first;
 *   2. the link blocklist (M5-03) on the stored draft, the same database function the `pages` trigger
 *      runs on every draft save: a site listed after the draft was saved is caught here. A link to
 *      a blocked site returns `blocked_link` with one error per link (block, field, host); the
 *      check failing is `error` (closed, never "clean");
 *   2b. `publishDocSchema` on the stored draft (required fields, http(s) URLs, embed allowlist,
 *      no control or bidi characters, block limit, page and block token overrides): any issue
 *      returns `{ok:false, errors}` naming the block or the design field and how to fix it
 *      ("Publish stopped: bg isn’t a valid color. Reset it in Design."), and writes nothing;
 *   3. every image path of a visible block starts with the owner's uid and exists in `page-media`,
 *      and so does the resolved background image (M3-05): a `bgImage` is only ever one of the
 *      owner's own uploads, whether it came from the page overrides or from a saved theme;
 *   4. `toPublishForm` with the tokens of the draft's theme row (a system theme or one the owner
 *      owns: the lookup is scoped to `owner_id` null or the page owner, so a draft that names
 *      someone else's theme, or a deleted one, resolves like no theme, as the editor does), then
 *      `publishedDocSchema` on the result: the frozen, fully resolved document;
 *   5. the link blocklist again, now on the final published form with the platform's URL parser
 *      (`blockedLinksInPublished`: the authority, see src/lib/blocklist/published.ts);
 *   6. `pages.published` and `published_at` are written with the secret key, filtered on the owner.
 *
 * Stage 1b: Home's blocks are the '/' page entry's draft and the design is `pages.draft` (its
 * frozen blocks are ignored); the document the gate validates is the two joined, so every issue is the
 * one the single-document draft gave.
 *
 * Whole-site Publish (M11-05): the gate above runs for Home and then for every sub-page of the site
 * (the non-Home page entries' drafts: the sub-page schema, images, the lock rule and the final blocklist check, the
 * same rules as for Home), and the checks that span documents run once all of them passed
 * (`siteErrors`: one path per page, a block id used once in the whole site, `page_link` targets that
 * are pages of the site). Every error of a sub-page names the page. Step 6 is the `publish_site`
 * function: Home and every sub-page are written in one transaction or not at all, and the version
 * trigger of `pages` still records Home. A sub-page's draft is published with the site, so a page
 * created after the last Publish goes live at this one and not before.
 *
 * A failed gate writes nothing, so a failed Publish leaves the live page and its cache as they were.
 */
export async function publishPageCore(
  input: { pageId: unknown; userId: string | null; expected?: PublishExpected },
  deps: PublishDeps = {},
): Promise<SitePublishResult> {
  if (!input.userId || !UID.test(input.userId)) return refuse("unauthorized");
  const userId = input.userId;
  const pageId = pageIdSchema.safeParse(input.pageId);
  if (!pageId.success) return refuse("forbidden");

  const admin = deps.admin ?? createAdminSupabase();

  // Ownership first: the secret key bypasses RLS, so the owner filter below is the access rule.
  const page = await admin
    .from("pages")
    .select("id, owner_id, draft, draft_rev:draft->>rev")
    .eq("id", pageId.data)
    .maybeSingle();
  if (page.error) {
    console.error("[publish] reading the draft failed", page.error.message);
    return refuse("error");
  }
  if (!page.data || page.data.owner_id !== userId) return refuse("forbidden");

  // A suspended owner cannot bring a page back by republishing (M5-08, M5-09). Read with the secret
  // key, after the ownership check so it says nothing about anyone else's account; fails closed.
  const account = await admin
    .from("accounts")
    .select("suspended_at")
    .eq("id", userId)
    .maybeSingle();
  if (account.error) {
    console.error("[publish] reading the account failed", account.error.message);
    return refuse("error");
  }
  if (!account.data || account.data.suspended_at !== null) return refuse("account_suspended");

  // Stage 1b: the design is `pages.draft` (its frozen `blocks` are never read); Home's blocks are
  // the '/' page entry and the sub-pages are the other page entries. Entry ids are the sub-page ids
  // `publish_site` expects. Read after the ownership check with the same secret key; a failed read,
  // or a site without a Home entry (not moved), refuses (closed).
  let homeDraft;
  let subDrafts;
  try {
    homeDraft = await getHomeDraftWithClient(admin, pageId.data);
    subDrafts = await listDraftPagesWithClient(admin, pageId.data);
  } catch (error) {
    console.error("[publish] reading the page entries failed", error);
    return refuse("error");
  }
  if (!homeDraft) {
    // A site whose Home entry was never made (a failed move at creation): move it now, once, then
    // read Home again. Nothing else is written before this.
    try {
      const moved = await admin.rpc("move_site_content", { p_site: pageId.data });
      if (moved.error) throw new Error(moved.error.message);
      homeDraft = await getHomeDraftWithClient(admin, pageId.data);
      subDrafts = await listDraftPagesWithClient(admin, pageId.data);
    } catch (error) {
      console.error("[publish] moving the site to page entries failed", error);
      return refuse("error");
    }
  }
  if (!homeDraft) {
    console.error("[publish] the site has no Home entry", pageId.data);
    return refuse("error");
  }
  let expectedRevs: { design: string | null; entries: Record<string, number> } | null = null;
  // Publish all changes from the editor (M15-10): what it holds must be what is stored. A design or
  // page saved somewhere else since, or a page the site no longer has, is a conflict, nothing written.
  if (input.expected !== undefined) {
    const expected = expectedSchema.safeParse(input.expected);
    if (!expected.success) return refuse("conflict");
    const storedRev = (page.data as { draft_rev?: string | null }).draft_rev ?? null;
    if (expected.data.designRev !== storedRev) return refuse("conflict");
    const revs = new Map<string, number>([[homeDraft.entryId, homeDraft.rev]]);
    for (const row of subDrafts) revs.set(row.id, row.rev);
    for (const [id, rev] of Object.entries(expected.data.entries)) {
      if (revs.get(id) !== rev) return refuse("conflict");
    }
    // A page the editor does not hold (added through MCP or in another tab) would go live unseen.
    for (const id of revs.keys()) {
      if (!Object.hasOwn(expected.data.entries, id)) return refuse("conflict");
    }
    // The same comparison is made again by `publish_site`, under its locks (M15-12): a save that
    // lands between the reads above and that call is a conflict there, and nothing is written.
    expectedRevs = { design: expected.data.designRev, entries: expected.data.entries };
  }
  const { blocks: _frozen, ...design } = (page.data.draft ?? {}) as Record<string, unknown>;
  void _frozen;
  const raw: unknown = { ...design, blocks: homeDraft.draft.blocks };

  // The blocklist again, on the stored draft (M5-03): the trigger checks every save, but a domain
  // listed since then is only caught here. Nothing has been written yet.
  let blocked;
  try {
    blocked = await checkBlocklist(admin, raw);
  } catch (error) {
    console.error("[publish] checking the link blocklist failed", error);
    return refuse("error");
  }
  if (blocked.errors.length > 0) return refuse("blocked_link", blocked.errors);

  const parsed = publishDocSchema.safeParse(raw);
  if (!parsed.success) {
    const errors = friendlyPublishErrors(collectPublishErrors(raw));
    return refuse(
      "invalid",
      errors.length > 0
        ? errors
        : [{ blockId: null, field: "document", message: "Fix this page before publishing." }],
    );
  }
  const draft = parsed.data;

  let themeTokens: Partial<TokenSet> | null;
  try {
    themeTokens = await loadThemeTokens(admin, draft.theme.ref, userId);
  } catch (error) {
    console.error("[publish] reading the theme failed", error);
    return refuse("error");
  }

  const form = toPublishForm(draft, themeTokens);

  let mediaErrors: PublishError[];
  try {
    const exists = deps.mediaExists ?? storageExists(admin);
    mediaErrors = [
      ...(await checkImages(form, userId, exists)),
      ...(await checkBackground(form, draft.theme.overrides.bgImage !== undefined, userId, exists)),
    ];
  } catch (error) {
    console.error("[publish] checking the images failed", error);
    return refuse("error");
  }
  if (mediaErrors.length > 0) return refuse("invalid", mediaErrors);

  const checked = publishedDocSchema.safeParse(form);
  if (!checked.success) {
    console.error("[publish] the publish form failed validation", checked.error.issues);
    return refuse("invalid", [
      { blockId: null, field: "document", message: "Fix this page before publishing." },
    ]);
  }

  // The sub-pages (M11-05): each is validated like Home, all problems of all pages are reported
  // together, and every error names its page. Nothing has been written yet.
  const prepared = prepareSubPages(subDrafts);
  if (prepared.errors.length > 0) return refuse("invalid", prepared.errors);
  const subPages = prepared.subPages;
  try {
    const exists = deps.mediaExists ?? storageExists(admin);
    const subMediaErrors: PublishError[] = [];
    for (const page of subPages) {
      subMediaErrors.push(
        ...nameErrors(await checkPlaced(placedBlockImages(page.form.blocks), userId, exists), page),
      );
    }
    if (subMediaErrors.length > 0) return refuse("invalid", subMediaErrors);
  } catch (error) {
    console.error("[publish] checking the sub-page images failed", error);
    return refuse("error");
  }

  // The rules that span documents (paths, block ids, page links). Home's menu drops entries that
  // point at a page no longer in the site, before anything else reads it.
  const home = homeForSite(
    checked.data,
    subPages.map((page) => page.id),
  );
  const crossErrors = siteErrors(home, subPages);
  if (crossErrors.length > 0) return refuse("invalid", crossErrors);

  // Redirect mode and locks (M9-29, M9-31): the rules that need the raw draft, the plan or the
  // page's hosts. Nothing is written yet; a failed read refuses (closed, never "fine").
  let linkErrors: PublishError[];
  try {
    linkErrors = await checkLinkRules(admin, {
      pageId: pageId.data,
      userId,
      form: checked.data,
      raw,
    });
  } catch (error) {
    console.error("[publish] checking the link rules failed", error);
    return refuse("error");
  }
  for (const row of subDrafts) {
    const page = subPages.find((candidate) => candidate.id === row.id);
    if (page) linkErrors.push(...nameErrors(misplacedLockErrors(row.draft), page));
  }
  if (linkErrors.length > 0) return refuse("invalid", linkErrors);

  // The authoritative blocklist check (M5-03): on the FINAL form, the exact document about to be
  // stored and served, with the platform's own URL parser (what a browser follows). The database
  // check above (the same function the `pages` trigger runs) is the early, specific one; its Postgres
  // reading of a URL can lag a browser's (Unicode tables, whitespace the schema trims), so this one
  // decides. Fails closed: a blocklist that cannot be read publishes nothing.
  let blockedDomains: string[];
  try {
    blockedDomains = await loadBlockedDomains(admin);
  } catch (error) {
    console.error("[publish] reading the blocked domains failed", error);
    return refuse("error");
  }
  const blockedFinal = [
    ...blockedLinksInPublished(home, blockedDomains),
    ...subPages.flatMap((page) =>
      nameErrors(blockedLinksInPublished(page.form, blockedDomains), page),
    ),
  ];
  if (blockedFinal.length > 0) return refuse("blocked_link", blockedFinal);

  const publishedAt = (deps.now?.() ?? new Date()).toISOString();
  // Home and every sub-page in one transaction, or nothing (M11-05). The function checks the owner
  // itself and that the pages given are exactly the site's current sub-pages.
  // `publish_site_revs` is `publish_site` in the same transaction, answering the revs it left.
  const written = await admin.rpc("publish_site_revs", {
    p_page_id: pageId.data,
    p_owner_id: userId,
    p_home: home as unknown as Json,
    p_sub_pages: subPages.map((page) => ({
      id: page.id,
      published: page.form as unknown as Json,
    })),
    p_published_at: publishedAt,
    // Absent (MCP, which holds no editor state): the function checks no rev.
    ...(expectedRevs === null ? {} : { p_expected_revs: expectedRevs as unknown as Json }),
  });
  if (written.error) {
    const { code, message } = written.error;
    if (code === "P0002") return refuse("forbidden");
    if (code === "HL009") return refuse("storage_full");
    // Saved, added or deleted somewhere else after the reads above: nothing was written.
    if (code === "22023" && message === "stale_rev") return refuse("conflict");
    if (code === "22023" || code === "23505") {
      // A page was added or deleted since the read above, or two pages took one path meanwhile:
      // nothing was written, and publishing again sees the site as it is now.
      console.error("[publish] the site changed while publishing", code, message);
      return refuse("invalid", [
        {
          blockId: null,
          field: "document",
          message: "The pages of this site changed while publishing. Publish again.",
        },
      ]);
    }
    console.error("[publish] writing the published site failed", message);
    return refuse("error");
  }
  // The site IS published by now. An answer that does not read (it always should) leaves the editor
  // with the revs it sent: its next save of a page the publish moved is then a conflict, never an
  // overwrite.
  const left = publishedRevsSchema.safeParse(written.data);
  if (!left.success) console.error("[publish] publish_site_revs answered no revs");
  const revs: PublishedRevs = left.success
    ? { designRev: left.data.design_rev, entries: left.data.entries }
    : { designRev: expectedRevs?.design ?? null, entries: expectedRevs?.entries ?? {} };
  return { ok: true, publishedAt, revs };
}

/**
 * Tokens of the draft's theme row, or null: no theme, a deleted one, one the owner cannot use (the
 * system themes and the owner's own are the only ones readable here, the same rule RLS gives the
 * editor) or one whose tokens do not parse.
 */
async function loadThemeTokens(
  admin: SupabaseClient<Database>,
  ref: string | null,
  ownerId: string,
): Promise<Partial<TokenSet> | null> {
  if (!ref) return null;
  const { data, error } = await admin
    .from("themes")
    .select("tokens")
    .eq("id", ref)
    .or(`owner_id.is.null,owner_id.eq.${ownerId}`)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const tokens = tokenSetSchema.partial().safeParse(data.tokens);
  return tokens.success ? tokens.data : null;
}

/** Every image of the publish form (visible blocks only) with where it sits, for the error. */
function placedImages(form: PublishDoc): Placed[] {
  const placed: Placed[] = [];
  if (form.profile.photo) {
    placed.push({ ref: form.profile.photo, blockId: null, field: "profile.photo" });
  }
  // The logo (M9-24): the same ownership and existence rules, under its own field.
  if (form.profile.logo) {
    placed.push({ ref: form.profile.logo, blockId: null, field: "profile.logo" });
  }
  placed.push(...placedBlockImages(form.blocks));
  // The share image (M6-32): the same ownership and existence rules, under its own field.
  if (form.share?.image) {
    placed.push({ ref: form.share.image, blockId: null, field: "share.image" });
  }
  return placed;
}

/**
 * A path must start with the owner's uid (so no one publishes another user's file) and exist in
 * the bucket (so a page never points at nothing). Hidden blocks are not part of the form.
 */
async function checkImages(
  form: PublishDoc,
  ownerId: string,
  exists: (path: string) => Promise<boolean>,
): Promise<PublishError[]> {
  return checkPlaced(placedImages(form), ownerId, exists);
}

async function checkPlaced(
  placed: readonly Placed[],
  ownerId: string,
  exists: (path: string) => Promise<boolean>,
): Promise<PublishError[]> {
  const errors: PublishError[] = [];
  const own: Placed[] = [];
  for (const item of placed) {
    if (item.ref.path.startsWith(`${ownerId}/`)) own.push(item);
    else {
      errors.push({
        blockId: item.blockId,
        field: item.field,
        message: "That image isn’t in your uploads. Upload it again.",
      });
    }
  }

  const paths = [...new Set(own.map((item) => item.ref.path))];
  const present = new Map<string, boolean>();
  for (let i = 0; i < paths.length; i += 8) {
    const batch = paths.slice(i, i + 8);
    const results = await Promise.all(batch.map((path) => exists(path)));
    batch.forEach((path, index) => present.set(path, results[index] === true));
  }
  for (const item of own) {
    if (!present.get(item.ref.path)) {
      errors.push({
        blockId: item.blockId,
        field: item.field,
        message: "That image is no longer available. Upload it again.",
      });
    }
  }
  return errors;
}

/**
 * The resolved background image (M3-05). `bgImage` is a URL in the token set, so the schema alone
 * would let a draft point every visitor's browser at any host, or at another user's upload. Here it
 * must be exactly one of this project's `page-media` URLs, inside the page owner's own folder, and
 * the object must exist. `fromOverrides` says where the value came from, for the message.
 */
async function checkBackground(
  form: PublishDoc,
  fromOverrides: boolean,
  ownerId: string,
  exists: (path: string) => Promise<boolean>,
): Promise<PublishError[]> {
  const value = form.tokens.bgImage;
  if (value === null) return [];
  const field = fromOverrides ? "theme.overrides.bgImage" : "theme.bgImage";
  const stopped = (message: string): PublishError[] => [
    { blockId: null, field, message: `${PUBLISH_STOPPED} ${message}` },
  ];

  const path = mediaPathOf(value, mediaOrigin());
  if (path === null || !path.startsWith(`${ownerId}/`)) {
    return stopped(
      "bgImage isn’t one of your uploaded images. Pick the background image again in Design.",
    );
  }
  if (!(await exists(path))) {
    return stopped("the background image is no longer available. Upload it again in Design.");
  }
  return [];
}

function storageExists(admin: SupabaseClient<Database>) {
  const bucket = admin.storage.from(MEDIA_BUCKET);
  return async (path: string): Promise<boolean> => {
    const { data } = await bucket.exists(path);
    return data;
  };
}

interface SubDraftRow {
  id: string;
  draft: unknown;
}

/**
 * Every sub-page draft through the Publish gate's schema (M11-05): `publishSubPageSchema` on the
 * draft (a valid path, a title, complete blocks), `toSubPagePublishForm`, then
 * `publishedSubPageSchema` on the form. The errors of all pages are returned together, each naming
 * its page; a page that passes is returned as ready to publish, in the order given.
 */
function prepareSubPages(rows: readonly SubDraftRow[]): {
  subPages: SiteSubPage[];
  errors: PublishError[];
} {
  const subPages: SiteSubPage[] = [];
  const errors: PublishError[] = [];
  for (const row of rows) {
    const page = { id: row.id, title: pageTitleOf(row.draft) };
    const parsed = publishSubPageSchema.safeParse(row.draft);
    if (!parsed.success) {
      const found = collectSubPagePublishErrors(row.draft);
      errors.push(
        ...nameErrors(
          found.length > 0
            ? found
            : [{ blockId: null, field: "document", message: "Fix this page before publishing." }],
          page,
        ),
      );
      continue;
    }
    const form = toSubPagePublishForm(parsed.data);
    const checked = publishedSubPageSchema.safeParse(form);
    if (!checked.success) {
      console.error("[publish] a sub-page's publish form failed validation", checked.error.issues);
      errors.push(
        ...nameErrors(
          [{ blockId: null, field: "document", message: "Fix this page before publishing." }],
          page,
        ),
      );
      continue;
    }
    subPages.push({ ...page, title: checked.data.title, form: checked.data });
  }
  return { subPages, errors };
}

// Publish page and Publish design (M15-10) ------------------------------------------------------------

interface OwnedSite {
  admin: SupabaseClient<Database>;
  pageId: string;
  userId: string;
  /** The site row as read: its design draft, the draft's rev and the two facts of the live design this needs. */
  page: {
    data: {
      id: string;
      draft: Json | null;
      /** `pages.draft->>rev` as Postgres reads it. */
      draft_rev: string | null;
      /** The live design's redirect (M9-31), or null: the one key of it Publish page reads. */
      live_redirect: Json | null;
    };
  };
}

type Refusal = { ok: false; errors: PublishError[]; reason: PublishFailureReason };

/**
 * The first checks of Publish page and Publish design, in order: a session; a site that is the
 * caller's (another owner's, an unknown or malformed id: `not_found`, one answer, so ids cannot be
 * probed); the account is not suspended; the site was published at least once. Of the live design
 * only its `version` (is there one) and its `redirect` are read, never the whole document.
 */
async function openOwnedSite(
  input: { pageId: unknown; userId: string | null },
  deps: PublishDeps,
): Promise<{ ok: true; site: OwnedSite } | Refusal> {
  if (!input.userId || !UID.test(input.userId)) return refuse("unauthorized");
  const userId = input.userId;
  const pageId = pageIdSchema.safeParse(input.pageId);
  if (!pageId.success) return refuse("not_found");
  const admin = deps.admin ?? createAdminSupabase();

  // Ownership first: the secret key bypasses RLS, so the owner filter is the access rule.
  const page = await admin
    .from("pages")
    .select(
      "id, owner_id, draft, draft_rev:draft->>rev, live_version:published->>version, live_redirect:published->redirect",
    )
    .eq("id", pageId.data.toLowerCase())
    .maybeSingle();
  if (page.error) {
    console.error("[publish] reading the site failed", page.error.message);
    return refuse("error");
  }
  const found = page.data as {
    id: string;
    owner_id: string;
    draft: Json | null;
    draft_rev: string | null;
    live_version: string | null;
    live_redirect: Json | null;
  } | null;
  if (!found || found.owner_id !== userId) return refuse("not_found");

  const account = await admin
    .from("accounts")
    .select("suspended_at")
    .eq("id", userId)
    .maybeSingle();
  if (account.error) {
    console.error("[publish] reading the account failed", account.error.message);
    return refuse("error");
  }
  if (!account.data || account.data.suspended_at !== null) return refuse("account_suspended");

  // Every published design carries `version`; none means `pages.published` is null: not live.
  if (found.live_version === null) return siteNotLive();
  return { ok: true, site: { admin, pageId: found.id, userId, page: { data: found } } };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

type IdBlocks = Parameters<typeof siteBlockIdClashes>[1][number]["blocks"];
/** The blocks of a page ENTRY's live copy (its stored publish form), for the id check and the redirect rule. */
function liveBlocksOf(row: { published: unknown }): IdBlocks {
  const form = isRecord(row.published) ? row.published : {};
  return Array.isArray(form.blocks) ? (form.blocks as IdBlocks) : [];
}

const SHARED_ID_MESSAGE =
  "This block shares its id with another block of the site. Remove it and add it again.";

/**
 * Publish page (M15-10): makes ONE page's draft live, Home's or a sub-page's, and nothing else. The
 * design, every other page's live copy and their `published_at` stay as they are.
 *
 *   1. a session, a uuid, a site the caller owns: else `not_found` (one answer for another owner's
 *      site, an unknown one, an entry outside it and a trashed entry);
 *   2. suspension; 3. the site must be live already (`SITE_NOT_LIVE_MESSAGE`): a page cannot be live
 *      on a site that is not;
 *   4. the entry is a page entry of that site, not in the trash;
 *   5. `expectedRev` is the entry's rev, else `conflict` with `currentRev`, nothing written;
 *   6. the gate the whole-site Publish runs for that one page (schema, images, the lock rule, both
 *      blocklist checks). Only this page's own problems are reported: a design problem never blocks
 *      it. For Home, a live redirect must still find its target among the new blocks;
 *   7. the rules that span the site, against what is LIVE: a block id used by another page's live
 *      copy, and `page_link` targets that are pages of the site (draft or live: a link to a page that
 *      is not live is hidden on the live site, never an error);
 *   8. `publish_site_page`, through the content writer.
 */
export async function publishSitePageCore(
  input: {
    pageId: unknown;
    entryId: unknown;
    expectedRev: unknown;
    userId: string | null;
    source?: "editor" | "mcp";
  },
  deps: PublishDeps = {},
): Promise<PagePublishResult> {
  const opened = await openOwnedSite(input, deps);
  if (!opened.ok) return opened;
  const { admin, pageId, userId } = opened.site;
  const entryId = pageIdSchema.safeParse(input.entryId);
  if (!entryId.success) return refuse("not_found");
  const wanted = entryId.data.toLowerCase();

  let homeDraft: HomeDraft | null;
  let subDrafts: DraftPage[];
  let liveHome;
  try {
    homeDraft = await getHomeDraftWithClient(admin, pageId);
    subDrafts = await listDraftPagesWithClient(admin, pageId);
    liveHome = await getPublishedHomeWithClient(admin, pageId);
  } catch (error) {
    console.error("[publish] reading the page entries failed", error);
    return refuse("error");
  }
  const isHome = homeDraft !== null && homeDraft.entryId === wanted;
  // The entry's row: Home's, or one of the site's sub-pages. Anything else is not found.
  const row: { rev: number; draft: Record<string, unknown> } | null = isHome
    ? { rev: homeDraft!.rev, draft: homeDraft!.draft }
    : (subDrafts.find((candidate) => candidate.id === wanted) ?? null);
  if (!row) return refuse("not_found");

  const expectedRev = input.expectedRev;
  if (typeof expectedRev !== "number" || !Number.isSafeInteger(expectedRev) || expectedRev < 1) {
    return refuse("invalid", [
      { blockId: null, field: "document", message: "Send the revision you are editing." },
    ]);
  }
  if (row.rev !== expectedRev) return { ...refuse("conflict"), currentRev: row.rev };

  // The early blocklist check on the stored draft (the database's own reading), as for the whole site.
  const named = { id: wanted, title: pageTitleOf(row.draft) };
  const name = <T extends PublishError>(errors: readonly T[]): T[] =>
    isHome ? [...errors] : nameErrors(errors, named);
  try {
    const blocked = await checkBlocklist(admin, row.draft);
    if (blocked.errors.length > 0) return refuse("blocked_link", name(blocked.errors));
  } catch (error) {
    console.error("[publish] checking the link blocklist failed", error);
    return refuse("error");
  }

  // The page through the gate's schema: `form` is what is stored, the shape `publish_site` writes.
  let form: Record<string, unknown> & { blocks: PublishDoc["blocks"] };
  if (isHome) {
    const ready = prepareHomeEntryPublish(row.draft);
    if (!ready.ok) {
      const errors = friendlyPublishErrors(mapPublishIssues(ready.issues, row.draft));
      return refuse(
        "invalid",
        errors.length > 0
          ? errors
          : [{ blockId: null, field: "document", message: "Fix this page before publishing." }],
      );
    }
    form = ready.published;
  } else {
    const prepared = prepareSubPages([{ id: wanted, draft: row.draft }]);
    if (prepared.errors.length > 0) return refuse("invalid", prepared.errors);
    named.title = prepared.subPages[0]!.title;
    form = prepared.subPages[0]!.form;
  }
  const blocks = form.blocks;

  try {
    const exists = deps.mediaExists ?? storageExists(admin);
    const mediaErrors = await checkPlaced(placedBlockImages(blocks), userId, exists);
    if (mediaErrors.length > 0) return refuse("invalid", name(mediaErrors));
  } catch (error) {
    console.error("[publish] checking the images failed", error);
    return refuse("error");
  }

  const ruleErrors: PublishError[] = name(misplacedLockErrors(row.draft));
  if (isHome) {
    // A live redirect must keep its target (M9-31): the rule runs against the LIVE design, with the
    // new blocks. The plan is the design's matter and is not asked here.
    const redirect = opened.site.page.data.live_redirect;
    if (isRecord(redirect)) {
      try {
        const issue = redirectTargetIssue(blocks, redirect.linkId, await ownHostsOf(admin, pageId));
        if (issue !== null) {
          ruleErrors.push({ blockId: null, field: "redirect.linkId", message: issue });
        }
      } catch (error) {
        console.error("[publish] checking the redirect failed", error);
        return refuse("error");
      }
    }
  }

  // Site-wide rules against what is live: this page's ids against the other pages' live copies, and
  // its page links against the pages the site has (a draft page counts: the link is hidden until then).
  const others = subDrafts
    .filter((other) => other.id !== wanted && other.published !== null)
    .map((other) => ({ id: other.id, blocks: liveBlocksOf(other) }));
  const mine = isHome ? HOME_KEY : wanted;
  const clashes = siteBlockIdClashes(
    isHome ? { blocks } : liveHome ? { blocks: liveBlocksOf(liveHome) } : null,
    isHome ? others : [...others, { id: wanted, blocks }],
  );
  for (const clash of clashes) {
    if (clash.pages.includes(mine)) {
      ruleErrors.push(...name([{ blockId: clash.id, field: "id", message: SHARED_ID_MESSAGE }]));
    }
  }
  for (const error of pageLinkTargetErrors(
    [{ pageId: mine, ...(isHome ? {} : { title: named.title }), blocks }],
    subDrafts.map((other) => other.id),
  )) {
    const base: PublishError = { blockId: error.blockId, field: "target", message: error.message };
    ruleErrors.push(isHome ? base : { ...base, subPageId: wanted, pageTitle: named.title });
  }
  if (ruleErrors.length > 0) return refuse("invalid", ruleErrors);

  // The authoritative blocklist check, on the exact copy about to be served. Fails closed.
  try {
    const blockedFinal = blockedLinksInPublished({ blocks }, await loadBlockedDomains(admin));
    if (blockedFinal.length > 0) return refuse("blocked_link", name(blockedFinal));
  } catch (error) {
    console.error("[publish] reading the blocked domains failed", error);
    return refuse("error");
  }

  const publishedAt = (deps.now?.() ?? new Date()).toISOString();
  const written = await publishSitePageWithClient(admin, {
    siteId: pageId,
    ownerId: userId,
    entryId: wanted,
    expectedRev,
    published: form,
    publishedAt,
    source: input.source ?? "editor",
  });
  if (written.ok) {
    return {
      ok: true,
      publishedAt: written.publishedAt,
      rev: written.rev,
      unchanged: written.unchanged,
    };
  }
  const { code, message } = written;
  if (code === "P0002") return refuse("not_found");
  // The id rule again, by the function under the site's lock (M15-12): another page went live with
  // one of this page's ids after the check above. The same notice, on the block it names.
  if (code === "HL014") {
    return refuse(
      "invalid",
      name([{ blockId: written.detail, field: "id", message: SHARED_ID_MESSAGE }]),
    );
  }
  if (code === "22023" && message === "stale_rev") {
    const reread = await admin.from("content_entries").select("rev").eq("id", wanted).maybeSingle();
    return reread.data
      ? { ...refuse("conflict"), currentRev: Number(reread.data.rev) }
      : refuse("conflict");
  }
  if (code === "22023" && message === "site_not_published") return siteNotLive();
  if (code === "HL012" || code === "23505") {
    return refuse(
      "invalid",
      name([{ blockId: null, field: "path", message: PATH_MESSAGES.taken }]),
    );
  }
  if (code === "HL009") return refuse("storage_full");
  if (code === "23514") {
    return refuse(
      "invalid",
      name([{ blockId: null, field: "document", message: TOO_LARGE_MESSAGE }]),
    );
  }
  console.error("[publish] writing the published page failed", code, message);
  return refuse("error");
}

/** How `siteBlockIdClashes` names Home among the pages holding an id. */
const HOME_KEY = "home";

/**
 * Publish design (M15-10): makes the design live (theme, menu, profile, banner, share card, UTM tags,
 * redirect: every key of the publish form except `blocks`) and leaves every page as it is.
 *
 *   1. to 3. as Publish page (`not_found`, suspension, the site and Home must be live already);
 *   4. `expectedRev` is `pages.draft->>rev`, else `conflict`, nothing written;
 *   5. the design through the gate's schema (`designPublishSchema`), the theme's tokens resolved and
 *      frozen as the whole-site Publish does, the images of the design (photo, logo, share image,
 *      background). A problem in Home's blocks never blocks it: they are not read;
 *   6. the menu keeps every item that names a page of the site, live or not (an item to a page that
 *      is not live is hidden on the live site); the redirect rule runs against Home's LIVE blocks;
 *   7. both blocklist checks, then `publish_design` with the form, which holds no `blocks` key.
 */
export async function publishDesignCore(
  input: { pageId: unknown; expectedRev: string | null; userId: string | null },
  deps: PublishDeps = {},
): Promise<PublishResult> {
  const opened = await openOwnedSite(input, deps);
  if (!opened.ok) return opened;
  const { admin, pageId, userId, page } = opened.site;
  const draftRev = page.data.draft_rev;

  let liveHome;
  let subDrafts: DraftPage[];
  try {
    liveHome = await getPublishedHomeWithClient(admin, pageId);
    subDrafts = await listDraftPagesWithClient(admin, pageId);
  } catch (error) {
    console.error("[publish] reading the page entries failed", error);
    return refuse("error");
  }
  if (!liveHome) return siteNotLive();

  if (input.expectedRev !== null && typeof input.expectedRev !== "string")
    return refuse("conflict");
  if (input.expectedRev !== draftRev) return refuse("conflict");

  // The design is `pages.draft` without its frozen blocks, which are dropped unread.
  const { blocks: _frozen, ...design } = (page.data.draft ?? {}) as Record<string, unknown>;
  void _frozen;
  const raw = { ...design, blocks: [] };

  try {
    const blocked = await checkBlocklist(admin, raw);
    if (blocked.errors.length > 0) return refuse("blocked_link", blocked.errors);
  } catch (error) {
    console.error("[publish] checking the link blocklist failed", error);
    return refuse("error");
  }

  const parsed = designPublishSchema.safeParse(design);
  if (!parsed.success) {
    const errors = friendlyPublishErrors(mapPublishIssues(parsed.error.issues, raw));
    return refuse(
      "invalid",
      errors.length > 0
        ? errors
        : [{ blockId: null, field: "document", message: "Fix the design before publishing." }],
    );
  }
  const draft = { ...parsed.data, blocks: [] } as DraftDoc;

  let themeTokens: Partial<TokenSet> | null;
  try {
    themeTokens = await loadThemeTokens(admin, draft.theme.ref, userId);
  } catch (error) {
    console.error("[publish] reading the theme failed", error);
    return refuse("error");
  }
  const built = toPublishForm(draft, themeTokens);

  try {
    const exists = deps.mediaExists ?? storageExists(admin);
    const mediaErrors = [
      ...(await checkImages(built, userId, exists)),
      ...(await checkBackground(
        built,
        draft.theme.overrides.bgImage !== undefined,
        userId,
        exists,
      )),
    ];
    if (mediaErrors.length > 0) return refuse("invalid", mediaErrors);
  } catch (error) {
    console.error("[publish] checking the images failed", error);
    return refuse("error");
  }

  const checked = publishedDocSchema.safeParse(built);
  if (!checked.success) {
    console.error("[publish] the design's publish form failed validation", checked.error.issues);
    return refuse("invalid", [
      { blockId: null, field: "document", message: "Fix the design before publishing." },
    ]);
  }
  // The menu keeps every page of the site, drafts included: an item to a page that is not live is
  // hidden on the live site and comes back when that page is published.
  const form = homeForSite(
    checked.data,
    subDrafts.map((other) => other.id),
  );

  // Redirect mode (M9-31): the plan, and a target among Home's LIVE blocks.
  // This check is made here, before `publish_design` takes its lock, so a Publish page of Home that
  // drops the target can land in between (and Publish page checks the live redirect the same way,
  // before its own lock). The function does not recheck it, and does not need to (M15-12): serving
  // is gated at render. `redirectTargetId` (src/lib/tenant-render/redirect.ts) answers the 302 only
  // when the live document holds that link, visible and unlocked, and draws the page otherwise, so a
  // redirect whose target is gone is never followed; the next publish of either part reports it.
  // tests/unit/m15-publish-concurrent.test.ts proves that a redirect to a missing block is not served.
  try {
    const liveBlocks = liveBlocksOf(liveHome) as unknown as PublishDoc["blocks"];
    const linkErrors = await checkLinkRules(admin, {
      pageId,
      userId,
      form: { ...form, blocks: liveBlocks },
      raw,
    });
    if (linkErrors.length > 0) return refuse("invalid", linkErrors);
  } catch (error) {
    console.error("[publish] checking the link rules failed", error);
    return refuse("error");
  }

  try {
    const blockedFinal = blockedLinksInPublished(form, await loadBlockedDomains(admin));
    if (blockedFinal.length > 0) return refuse("blocked_link", blockedFinal);
  } catch (error) {
    console.error("[publish] reading the blocked domains failed", error);
    return refuse("error");
  }

  // What is sent holds no `blocks` key: the function keeps Home's live blocks as they are.
  const { blocks: _none, ...designForm } = form;
  void _none;
  const publishedAt = (deps.now?.() ?? new Date()).toISOString();
  const written = await admin.rpc("publish_design", {
    p_page_id: pageId,
    p_owner_id: userId,
    p_design: designForm as unknown as Json,
    // The rev compared above; the function checks it again under its row lock.
    ...(draftRev === null ? {} : { p_expected_rev: draftRev }),
    p_published_at: publishedAt,
  });
  if (written.error) {
    const { code, message } = written.error;
    if (code === "P0002") return refuse("not_found");
    if (code === "22023" && message === "stale_rev") return refuse("conflict");
    if (code === "22023" && (message === "site_not_published" || message === "site_not_moved")) {
      return siteNotLive();
    }
    if (code === "23514") {
      return refuse("invalid", [{ blockId: null, field: "document", message: TOO_LARGE_MESSAGE }]);
    }
    // `design_has_blocks`, `unknown_design_key`: the form sent a key the function refuses. Our bug.
    console.error("[publish] writing the published design failed", code, message);
    return refuse("error");
  }
  return { ok: true, publishedAt };
}
