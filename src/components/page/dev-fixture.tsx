import { notFound } from "next/navigation";
import { FIXTURE_PAGE_ID, rendererFixtureDoc } from "./fixture-doc";
import { PageRenderer } from "./page-renderer";

/**
 * The dev-only renderer fixture page (M2-05): the stress document from fixture-doc.ts, rendered
 * live with both footer links. `RendererFixture` answers 404 in production.
 *
 * The route that serves it is a one-line page file in the app router, which the renderer area does
 * not own:
 *
 *   // src/app/(marketing)/dev/renderer/page.tsx
 *   export { default } from "@/components/page/dev-fixture";
 */

/** The dev-only fixture page: 404 in production. */
export function RendererFixture() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <PageRenderer
      doc={rendererFixtureDoc()}
      pageId={FIXTURE_PAGE_ID}
      mode="live"
      chrome={{ badge: true, reportHref: `/report?page=${FIXTURE_PAGE_ID}` }}
    />
  );
}

export default RendererFixture;
