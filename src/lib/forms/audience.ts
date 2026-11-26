import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PlanId } from "@/lib/limits";
import { getHomeDraftWithClient, listDraftPagesWithClient } from "@/lib/site/page-entries-core";
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
 * request selects a site. The labels come from the site's drafts (the owner's own view); the month's
 * usage is the one secret-key read (`form_usage`, keyed by the verified session user).
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

/** The blocks of a page entry's draft (never the site row's frozen copy). */
const entryBlocks = (entry: { blocks?: unknown }): unknown[] =>
  Array.isArray(entry.blocks) ? entry.blocks : [];

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

/** Each form block of the site's page drafts (Home's entry, then the pages): "{heading or kind} · {page}". */
export async function loadFormLabels(client: Db, siteId: string): Promise<FormLabels> {
  const [home, pages] = await Promise.all([
    getHomeDraftWithClient(client as never, siteId),
    listDraftPagesWithClient(client as never, siteId),
  ]);
  const labels = new Map<string, string>();
  if (home) addLabels(labels, entryBlocks(home.draft), "Home");
  for (const page of pages) {
    const title =
      typeof page.draft.title === "string" && page.draft.title ? page.draft.title : "Page";
    addLabels(labels, entryBlocks(page.draft), title);
  }
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
  const [counts, labels, usage] = await Promise.all([
    client.rpc("form_submission_counts", { p_site_id: input.siteId }),
    loadFormLabels(client, input.siteId),
    loadFormUsage(input.userId, input.plan),
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

  const from = (input.page - 1) * AUDIENCE_PAGE_SIZE;
  const result = await filtered(client, input.siteId, input.form, true).range(
    from,
    from + AUDIENCE_PAGE_SIZE - 1,
  );
  if (result.error)
    throw new Error(`Loading the submissions failed (${result.error.code ?? "unknown"})`);
  const total = result.count ?? 0;
  const rows = ((result.data ?? []) as unknown as SubmissionRow[]).map((row) => ({
    ...row,
    formLabel: formLabelOf(labels, row.block_id),
  }));
  return {
    forms,
    rows,
    total,
    page: input.page,
    pages: Math.max(1, Math.ceil(total / AUDIENCE_PAGE_SIZE)),
    usage,
  };
}

/** Every row of the filter for the CSV, newest first, at most the newest 50,000, read 1,000 at a time. */
export async function loadAudienceExport(input: {
  siteId: string;
  form: string;
}): Promise<{ rows: SubmissionRow[]; labels: FormLabels }> {
  const client = (await createServerSupabase()) as unknown as Db;
  const labels = await loadFormLabels(client, input.siteId);
  const rows: SubmissionRow[] = [];
  for (let from = 0; from < AUDIENCE_EXPORT_MAX_ROWS; from += AUDIENCE_EXPORT_PAGE_ROWS) {
    const { data, error } = await filtered(client, input.siteId, input.form, false).range(
      from,
      Math.min(from + AUDIENCE_EXPORT_PAGE_ROWS, AUDIENCE_EXPORT_MAX_ROWS) - 1,
    );
    if (error) throw new Error(`Loading the submissions failed (${error.code ?? "unknown"})`);
    const batch = (data ?? []) as unknown as SubmissionRow[];
    rows.push(...batch);
    if (batch.length < AUDIENCE_EXPORT_PAGE_ROWS) break;
  }
  return { rows, labels };
}
