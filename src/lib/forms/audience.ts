import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PlanId } from "@/lib/limits";
import {
  getHomeDraftWithClient,
  getPublishedHomeWithClient,
  listDraftPagesWithClient,
} from "@/lib/site/page-entries-core";
import { createServerSupabase } from "@/lib/supabase/server";
import {
  AUDIENCE_ALL_FORMS,
  AUDIENCE_PAGE_SIZE,
  SUBMISSION_COLUMNS,
  type FormKind,
  type SubmissionRow,
} from "./contract";
import {
  AUDIENCE_EXPORT_MAX_ROWS,
  AUDIENCE_EXPORT_PAGE_ROWS,
  formLabel,
  formLabelOf,
  type FormLabels,
} from "./export";
import { loadFormUsage, type FormUsage } from "./usage";

/**
 * The Audience screen's reads (M17-08, M17-09), all with the signed-in user's own session, so RLS is
 * the access rule: a site that is not theirs reads nothing. `siteId` is the current site from
 * `getAppContext()` (their own, proved by the gate), and every query filters on it too; no id from the
 * request selects a site. A form's label comes from the PUBLISHED document that holds it (what
 * visitors fill in), else from the drafts (a form not published yet), else "Removed form"; the
 * month's usage is the one secret-key read (`form_usage`, keyed by the verified session user).
 * `?page=` past the last page shows the last page.
 */

export interface AudienceForm {
  blockId: string;
  kind: FormKind;
  label: string;
  total: number;
}

export interface AudienceData {
  forms: AudienceForm[];
  rows: (SubmissionRow & { formLabel: string })[];
  /** The rows of the current filter, all pages together. */
  total: number;
  page: number;
  pages: number;
  usage: FormUsage;
}

type Db = SupabaseClient;

/** The blocks of a page entry's document (never the site row's frozen copy). */
const entryBlocks = (entry: unknown): unknown[] => {
  const blocks = (entry as { blocks?: unknown } | null)?.blocks;
  return Array.isArray(blocks) ? blocks : [];
};

/** A page document's title, or null. */
const titleOf = (entry: unknown): string | null => {
  const title = (entry as { title?: unknown } | null)?.title;
  return typeof title === "string" && title !== "" ? title : null;
};

function addLabels(labels: Map<string, string>, blocks: unknown[], pageTitle: string): void {
  for (const raw of blocks) {
    const block = raw as { id?: unknown; type?: unknown; heading?: unknown; kind?: unknown };
    if (block.type !== "form" || typeof block.id !== "string" || labels.has(block.id)) continue;
    labels.set(
      block.id,
      formLabel(
        {
          heading: typeof block.heading === "string" ? block.heading : "",
          kind: String(block.kind),
        },
        pageTitle,
      ),
    );
  }
}

/**
 * Each form block of the site, "{heading or kind} · {page}": first from the published documents
 * (Home's, then each live page's), then from the drafts for the forms not published (review B10: a
 * form removed in a draft but still live keeps its live label). The first label of an id wins.
 */
export async function loadFormLabels(client: Db, siteId: string): Promise<FormLabels> {
  const [homeLive, homeDraft, pages] = await Promise.all([
    getPublishedHomeWithClient(client as never, siteId),
    getHomeDraftWithClient(client as never, siteId),
    listDraftPagesWithClient(client as never, siteId),
  ]);
  const labels = new Map<string, string>();
  if (homeLive) addLabels(labels, entryBlocks(homeLive.published), "Home");
  for (const page of pages) {
    if (page.published === null || page.published === undefined) continue;
    const title = titleOf(page.published) ?? titleOf(page.draft) ?? "Page";
    addLabels(labels, entryBlocks(page.published), title);
  }
  if (homeDraft) addLabels(labels, entryBlocks(homeDraft.draft), "Home");
  for (const page of pages)
    addLabels(labels, entryBlocks(page.draft), titleOf(page.draft) ?? "Page");
  return labels;
}

/** The submissions of one site, of one form or all; newest first, by time then id. */
function filtered(client: Db, siteId: string, form: string, counted: boolean) {
  const query = client
    .from("form_submissions")
    .select(SUBMISSION_COLUMNS, counted ? { count: "exact" } : {})
    .eq("site_id", siteId);
  return (form === AUDIENCE_ALL_FORMS ? query : query.eq("block_id", form))
    .order("created_at", { ascending: false })
    .order("id", { ascending: false });
}

export async function loadAudience(input: {
  userId: string;
  plan: PlanId;
  siteId: string;
  form: string;
  page: number;
}): Promise<AudienceData> {
  const client = (await createServerSupabase()) as unknown as Db;
  return loadAudienceWithClient(client, input, () => loadFormUsage(input.userId, input.plan));
}

/** `loadAudience` on a given client (the tests pass the local stack's). */
export async function loadAudienceWithClient(
  client: Db,
  input: { siteId: string; form: string; page: number },
  usageOf: () => Promise<FormUsage>,
): Promise<AudienceData> {
  const [counts, labels, usage, matching] = await Promise.all([
    client.rpc("form_submission_counts", { p_site_id: input.siteId }),
    loadFormLabels(client, input.siteId),
    usageOf(),
    countFiltered(client, input.siteId, input.form),
  ]);
  if (counts.error) throw new Error(`Loading the forms failed (${counts.error.code ?? "unknown"})`);
  const forms = (
    (counts.data ?? []) as { block_id: string; kind: FormKind; total: number; latest: string }[]
  )
    .sort((a, b) => (a.latest < b.latest ? 1 : -1))
    .map((row) => ({
      blockId: row.block_id,
      kind: row.kind,
      label: formLabelOf(labels, row.block_id),
      total: Number(row.total),
    }));

  // A page past the last one (a stale link, or the last row of the last page just deleted) shows
  // the last page; PostgREST would answer a range past the end with 416 (review B6).
  const pages = Math.max(1, Math.ceil(matching / AUDIENCE_PAGE_SIZE));
  const page = Math.min(input.page, pages);
  const from = (page - 1) * AUDIENCE_PAGE_SIZE;
  const result = await filtered(client, input.siteId, input.form, true).range(
    from,
    from + AUDIENCE_PAGE_SIZE - 1,
  );
  if (result.error)
    throw new Error(`Loading the submissions failed (${result.error.code ?? "unknown"})`);
  const total = result.count ?? matching;
  const rows = ((result.data ?? []) as unknown as SubmissionRow[]).map((row) => ({
    ...row,
    formLabel: formLabelOf(labels, row.block_id),
  }));
  return {
    forms,
    rows,
    total,
    page,
    pages: Math.max(1, Math.ceil(total / AUDIENCE_PAGE_SIZE)),
    usage,
  };
}

/** How many submissions the filter matches (a head count, no rows). */
async function countFiltered(client: Db, siteId: string, form: string): Promise<number> {
  const query = client
    .from("form_submissions")
    .select("id", { count: "exact", head: true })
    .eq("site_id", siteId);
  const { count, error } = await (form === AUDIENCE_ALL_FORMS ? query : query.eq("block_id", form));
  if (error) throw new Error(`Counting the submissions failed (${error.code ?? "unknown"})`);
  return count ?? 0;
}

/** Every row of the filter for the CSV, newest first, at most the newest 50,000, read 1,000 at a time. */
export async function loadAudienceExport(input: {
  siteId: string;
  form: string;
}): Promise<{ rows: SubmissionRow[]; labels: FormLabels }> {
  const client = (await createServerSupabase()) as unknown as Db;
  return loadAudienceExportWithClient(client, input);
}

/** `loadAudienceExport` on a given client; the tests pass the local stack's and smaller sizes. */
export async function loadAudienceExportWithClient(
  client: Db,
  input: { siteId: string; form: string },
  sizes: { maxRows: number; pageRows: number } = {
    maxRows: AUDIENCE_EXPORT_MAX_ROWS,
    pageRows: AUDIENCE_EXPORT_PAGE_ROWS,
  },
): Promise<{ rows: SubmissionRow[]; labels: FormLabels }> {
  const labels = await loadFormLabels(client, input.siteId);
  const rows: SubmissionRow[] = [];
  for (let from = 0; from < sizes.maxRows; from += sizes.pageRows) {
    const { data, error } = await filtered(client, input.siteId, input.form, false).range(
      from,
      Math.min(from + sizes.pageRows, sizes.maxRows) - 1,
    );
    if (error) throw new Error(`Loading the submissions failed (${error.code ?? "unknown"})`);
    const batch = (data ?? []) as unknown as SubmissionRow[];
    rows.push(...batch);
    if (batch.length < sizes.pageRows) break;
  }
  return { rows, labels };
}
