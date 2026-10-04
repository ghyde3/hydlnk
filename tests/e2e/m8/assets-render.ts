import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { EmbedFacadeMarkup } from "@/components/page/embed-facade-markup";
import { parseEmbed } from "@/lib/document";
import { SYSTEM_DEFAULT_TOKENS, tokensToCssVars } from "@/lib/theme";
import { TENANT_SCRIPT_SRC } from "@/lib/tenant-assets/generated";
import { tenantInlineCss } from "@/lib/tenant-assets/css";
import { EMBEDS, FIXTURE_PAGE_ID, type FixtureEmbed } from "./assets-embeds";

/**
 * Renders a fixture page's HTML with the real facade component, the real inline CSS and the real
 * script tag. A Node script, not a Playwright module: Playwright rewrites React elements in the files
 * it loads, so `assets-fixture.ts` runs this with tsx and reads the page from its output.
 *
 *   tsx tests/e2e/m8/assets-render.ts '{"names":["YouTube"],"script":true}'
 */

/** The `[data-page-root]` of a page that holds `embeds`, laid out by the real inline CSS. */
function embedsPageHtml(
  embeds: readonly FixtureEmbed[],
  options: { pageId?: string; script?: boolean; extraBody?: string } = {},
): string {
  const { pageId = FIXTURE_PAGE_ID, script = true, extraBody = "" } = options;
  const blocks = embeds
    .map((embed, index) => {
      const parsed = parseEmbed(embed.url)!;
      const facade = renderToStaticMarkup(
        createElement(EmbedFacadeMarkup, {
          provider: parsed.provider,
          kind: parsed.kind,
          src: parsed.src,
          caption: `Caption ${index}`,
        }),
      );
      return (
        `<div class="pg-embed" data-block-id="embed-${index}" data-block-type="embed" ` +
        `data-embed-provider="${parsed.provider}">${facade}` +
        `<p class="pg-embed-caption">Caption ${index} · ${parsed.provider}</p></div>`
      );
    })
    .join("");
  const vars = Object.entries(tokensToCssVars(SYSTEM_DEFAULT_TOKENS))
    .map(([name, value]) => `${name}:${value}`)
    .join(";")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;");
  const css = tenantInlineCss({ blocks: [{ type: "embed" }], tokens: SYSTEM_DEFAULT_TOKENS });
  return (
    `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1"><title>fixture</title>` +
    `<style>${css}</style></head><body>` +
    `<div class="pg-root" data-page-root="" data-density="regular" data-align="center" data-bg-type="solid" ` +
    `style="${vars}"><div class="pg-column"><main class="pg-blocks">${blocks}</main></div></div>` +
    extraBody +
    (script ? `<script src="${TENANT_SCRIPT_SRC}" defer data-page-id="${pageId}"></script>` : "") +
    `</body></html>`
  );
}


const input = JSON.parse(process.argv[2] ?? "{}") as {
  names?: string[];
  pageId?: string;
  script?: boolean;
  extraBody?: string;
};
const chosen = input.names
  ? input.names.map((name) => EMBEDS.find((embed) => embed.name === name)!)
  : EMBEDS;
process.stdout.write(
  JSON.stringify(
    embedsPageHtml(chosen, {
      pageId: input.pageId ?? FIXTURE_PAGE_ID,
      script: input.script ?? true,
      extraBody: input.extraBody ?? "",
    }),
  ),
);
