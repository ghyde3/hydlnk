"use client";

import { useEffect, useId, useRef, useState } from "react";
import { SUSPENDED_REASON, useAccountSuspended } from "@/components/admin/suspension-context";
import { useWorkspace } from "@/components/workspace/workspace-context";
import {
  SITE_TEMPLATES,
  isSiteTemplateId,
  type SiteTemplateId,
} from "@/lib/site-templates/catalog";

/**
 * The site templates on an empty Home (M12-03): Garage sale, Small business and Musician. Choosing
 * one fills Home's draft (blocks, theme, menu) and makes the template's two pages as drafts; nothing
 * is published. Shown only while Home has no blocks, and only when the plan has room for two more
 * pages (otherwise the limit message, as the Pages card words it).
 */
export function SiteTemplatesCard() {
  const { site } = useWorkspace();
  const suspended = useAccountSuspended();
  const headingId = useId();
  const [pending, setPending] = useState<SiteTemplateId | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const noRoom = site.limit.max - site.limit.used < 2;

  // The new-site flow lands here with `?template=<id>`: it is applied once, and the address is cleaned.
  const fromUrl = useRef(false);
  useEffect(() => {
    if (fromUrl.current) return;
    fromUrl.current = true;
    const params = new URLSearchParams(window.location.search);
    const wanted = params.get("template");
    if (wanted === null) return;
    params.delete("template");
    const query = params.toString();
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`,
    );
    if (isSiteTemplateId(wanted) && !noRoom) void choose(wanted);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on mount
  }, []);

  async function choose(id: SiteTemplateId) {
    if (pending) return;
    setPending(id);
    setFailure(null);
    const result = await site.applyTemplate(id);
    setPending(null);
    if (!result.ok) setFailure(result.message);
  }

  return (
    <section
      aria-labelledby={headingId}
      data-testid="site-templates"
      className="flex flex-col gap-3 rounded-md border border-line bg-surface p-3.5"
    >
      <div className="flex flex-col gap-0.5">
        <h2 id={headingId} className="text-sm font-semibold">
          Start from a site template
        </h2>
        <p className="m-0 text-xs text-text-2">
          Fills this page and adds two more as drafts. Nothing goes live until you publish.
        </p>
      </div>
      {noRoom ? (
        <p role="status" data-testid="site-templates-limit" className="m-0 text-[13px] text-text-2">
          {site.limitMessage} A template adds two pages.
        </p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
          {SITE_TEMPLATES.map((template) => (
            <li key={template.id} className="min-w-0">
              <button
                type="button"
                data-testid="site-template"
                data-template={template.id}
                disabled={pending !== null || suspended}
                title={suspended ? SUSPENDED_REASON : undefined}
                aria-busy={pending === template.id || undefined}
                onClick={() => void choose(template.id)}
                className="flex min-h-11 w-full min-w-0 cursor-pointer flex-col items-start gap-0.5 rounded-md border border-line-3 bg-surface px-3 py-2 text-left disabled:cursor-not-allowed disabled:opacity-60"
              >
                <span className="text-sm font-semibold text-ink">
                  {pending === template.id ? "Adding…" : template.name}
                </span>
                <span className="text-xs text-text-2">{template.pages.join(", ")}</span>
                <span className="text-xs text-text-2">{template.description}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {failure ? (
        <p role="alert" data-testid="site-templates-error" className="m-0 text-[13px] text-bad">
          {failure}
        </p>
      ) : null}
    </section>
  );
}
