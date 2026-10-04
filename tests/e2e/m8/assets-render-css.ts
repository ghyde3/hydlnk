import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PageRenderer } from "@/components/page/page-renderer";
import type { Block, PublishDoc } from "@/lib/document";
import { tenantInlineCss } from "@/lib/tenant-assets/css";
import { tokensToCssVars } from "@/lib/theme";
import { blocks, fullPublished, photoRef } from "../../unit/fixtures/page-document";

/**
 * A Node script, not a Playwright module (Playwright rewrites React elements in the files it loads):
 * renders a page with the real PageRenderer and prints, as JSON, its markup, the page's inline CSS
 * and the two source stylesheets in full, so assets-css.spec.ts can lay the same markup out with
 * each in Chrome and compare every computed style.
 *
 *   node --import tsx --import ./tests/e2e/m8/css-stub-register.mjs tests/e2e/m8/assets-render-css.ts full|links
 */

const variant = process.argv[2] ?? "full";

const extraLinks: Block[] = [
  { ...blocks.link, id: "link-pulse-001", label: "Pulse", featured: "pulse" } as Block,
  { ...blocks.link, id: "link-shine-001", label: "Shine", featured: "shine" } as Block,
  {
    ...blocks.link,
    id: "link-icon-0001",
    label: "With an icon",
    icon: { type: "builtin", name: "calendar" },
  } as Block,
  {
    ...blocks.link,
    id: "link-image-001",
    label: "With a thumbnail",
    icon: { type: "image", image: photoRef },
  } as Block,
  {
    ...blocks.link,
    id: "link-shadow-01",
    label: "Shadow",
    overrides: { buttonStyle: "shadow" },
  } as Block,
  { ...blocks.link, id: "link-soft-00001", label: "Soft", overrides: { buttonStyle: "soft" } } as Block,
  { ...blocks.link, id: "link-outline-01", label: "Outline", overrides: { buttonStyle: "outline" } } as Block,
  {
    ...blocks.image,
    id: "image-shaped-01",
    shape: "wide",
    overrides: { borderWidth: 2 },
  } as Block,
];

const doc: PublishDoc =
  variant === "links"
    ? { ...fullPublished, blocks: [blocks.link, ...extraLinks.slice(0, 6)] as PublishDoc["blocks"] }
    : { ...fullPublished, blocks: [...fullPublished.blocks, ...extraLinks] as PublishDoc["blocks"] };

const body = renderToStaticMarkup(
  createElement(PageRenderer, {
    doc,
    pageId: "6f1c2a52-3a1e-4c0b-9d57-0b8f2f7a1e01",
    mode: "live",
    chrome: { badge: true, reportHref: "/report" },
  }),
);

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
process.stdout.write(
  JSON.stringify({
    body,
    css: tenantInlineCss(doc),
    original: `${read("src/app/(tenant)/tenant.css")}\n${read("src/components/page/page-renderer.css")}`,
    vars: Object.keys(tokensToCssVars(doc.tokens)).length,
  }),
);
