import Link from "next/link";
import { Card, ScreenBody, ScreenHeader } from "@/components/app/screen";
import type { AudienceData } from "@/lib/forms/audience";
import {
  AUDIENCE_ALL_FORMS,
  AUDIENCE_COPY,
  AUDIENCE_EXPORT_PATH,
  AUDIENCE_PATH,
  AUDIENCE_TEST_IDS,
} from "@/lib/forms/contract";
import type { PlanId } from "@/lib/limits";
import { DeleteFormButton } from "./delete-controls";
import { FormFilter } from "./form-filter";
import { SubmissionList } from "./submission-list";
import { UsageCard } from "./usage-card";

/**
 * Audience (M17-08, M17-09, M17-11): what people sent through the current site's forms. The month's
 * meter and the over-limit notice, the owner's responsibility line, a filter by form, the list (50
 * a page, newest first), Delete, "Delete all from this form" and the CSV export. HYDLNK UI tokens
 * only: nothing here reads a tenant `--t-*` variable.
 */
export function AudienceScreen({
  siteName,
  plan,
  form,
  data,
}: {
  siteName: string;
  plan: PlanId;
  form: string;
  data: AudienceData | null;
}) {
  return (
    <div data-testid={AUDIENCE_TEST_IDS.screen} className="flex flex-1 flex-col">
      <ScreenHeader breadcrumb={`${siteName} · Forms`} title="Audience" />
      <ScreenBody maxWidth="max-w-[1180px]">
        {data === null ? (
          <Card>
            <p
              data-testid={AUDIENCE_TEST_IDS.loadError}
              role="alert"
              className="m-0 text-[15px] leading-relaxed"
            >
              We couldn’t load your submissions. Reload the page to try again.
            </p>
          </Card>
        ) : (
          <Loaded plan={plan} form={form} data={data} />
        )}
      </ScreenBody>
    </div>
  );
}

function Loaded({ plan, form, data }: { plan: PlanId; form: string; data: AudienceData }) {
  const selected = data.forms.find((entry) => entry.blockId === form) ?? null;
  const exportHref =
    form === AUDIENCE_ALL_FORMS
      ? `${AUDIENCE_EXPORT_PATH}?form=${AUDIENCE_ALL_FORMS}`
      : `${AUDIENCE_EXPORT_PATH}?form=${encodeURIComponent(form)}`;
  const pageHref = (page: number) => {
    const query = new URLSearchParams();
    if (form !== AUDIENCE_ALL_FORMS) query.set("form", form);
    if (page > 1) query.set("page", String(page));
    const text = query.toString();
    return text === "" ? AUDIENCE_PATH : `${AUDIENCE_PATH}?${text}`;
  };
  return (
    <>
      <UsageCard usage={data.usage} plan={plan} />
      <p
        data-testid={AUDIENCE_TEST_IDS.responsibility}
        className="m-0 text-[13px] leading-normal text-text-2"
      >
        {AUDIENCE_COPY.responsibility}
      </p>
      {data.forms.length === 0 ? (
        <Card>
          <p data-testid={AUDIENCE_TEST_IDS.empty} className="m-0 text-[15px] leading-relaxed">
            {AUDIENCE_COPY.empty}
          </p>
        </Card>
      ) : (
        <>
          <div className="flex flex-col gap-3 hl:flex-row hl:items-end hl:justify-between">
            <FormFilter
              forms={data.forms}
              value={selected ? selected.blockId : AUDIENCE_ALL_FORMS}
            />
            <div className="flex flex-col gap-2 hl:flex-row">
              {selected ? (
                <DeleteFormButton blockId={selected.blockId} label={selected.label} />
              ) : null}
              <a
                href={exportHref}
                data-testid={AUDIENCE_TEST_IDS.export}
                className="inline-flex min-h-11 items-center justify-center rounded-md bg-ink px-4 text-sm font-semibold text-surface no-underline"
              >
                Download CSV
              </a>
            </div>
          </div>
          {data.rows.length === 0 ? (
            <Card>
              <p data-testid={AUDIENCE_TEST_IDS.empty} className="m-0 text-[15px]">
                Nothing on this page.
              </p>
            </Card>
          ) : (
            <SubmissionList rows={data.rows} />
          )}
          {data.pages > 1 ? (
            <nav
              aria-label="Pages"
              data-testid={AUDIENCE_TEST_IDS.pager}
              className="flex items-center gap-2"
            >
              {data.page > 1 ? (
                <Link
                  href={pageHref(data.page - 1)}
                  className="inline-flex min-h-11 items-center rounded-md border border-line-3 bg-surface px-4 text-sm font-semibold text-ink no-underline"
                >
                  Newer
                </Link>
              ) : null}
              <span className="font-mono text-[13px] text-text-2">
                Page {data.page} of {data.pages}
              </span>
              {data.page < data.pages ? (
                <Link
                  href={pageHref(data.page + 1)}
                  className="inline-flex min-h-11 items-center rounded-md border border-line-3 bg-surface px-4 text-sm font-semibold text-ink no-underline"
                >
                  Older
                </Link>
              ) : null}
            </nav>
          ) : null}
        </>
      )}
    </>
  );
}
