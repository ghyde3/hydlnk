import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";

/**
 * M8-02 step 3 in real Chrome: the page's inline CSS (only the rules its block types need,
 * minified) lays the page out exactly as the two full source stylesheets do. The same markup, drawn
 * by the real PageRenderer, is loaded twice, once with tenant.css and page-renderer.css as written
 * and once with `tenantInlineCss`, and every element's computed style (and its ::before and ::after,
 * and its box) is compared, at the viewport and in a 300px container (the editor bezel's narrow
 * rules), with and without a request for reduced motion.
 */

interface Rendered {
  body: string;
  css: string;
  original: string;
}

const cache = new Map<string, Rendered>();

function render(variant: "full" | "links"): Rendered {
  let found = cache.get(variant);
  if (!found) {
    found = JSON.parse(
      execFileSync(
        process.execPath,
        [
          "--import",
          "tsx",
          "--import",
          join(process.cwd(), "tests/e2e/m8/css-stub-register.mjs"),
          join(process.cwd(), "tests/e2e/m8/assets-render-css.ts"),
          variant,
        ],
        {
          cwd: process.cwd(),
          encoding: "utf8",
          maxBuffer: 16 * 1024 * 1024,
          env: {
            ...process.env,
            NEXT_PUBLIC_ROOT_DOMAIN: "localhost:3000",
            NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
            NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
          },
        },
      ),
    ) as Rendered;
    cache.set(variant, found);
  }
  return found;
}

const html = (body: string, css: string, width: number | null) =>
  `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">` +
  `<meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head>` +
  `<body>${width === null ? body : `<div style="width:${width}px">${body}</div>`}</body></html>`;

/** Every element's computed style, pseudo-elements and box included, in document order. */
async function computed(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const all = [
      document.documentElement,
      document.body,
      ...Array.from(document.querySelectorAll("[data-page-root], [data-page-root] *")),
    ];
    for (const [index, el] of all.entries()) {
      const label = `${index}:${el.tagName.toLowerCase()}.${typeof el.className === "string" ? el.className : ""}`;
      for (const pseudo of [null, "::before", "::after"] as const) {
        const style = getComputedStyle(el, pseudo);
        const props: string[] = [];
        for (let i = 0; i < style.length; i++) {
          const name = style.item(i);
          props.push(`${name}=${style.getPropertyValue(name)}`);
        }
        // Custom properties are listed in no fixed order.
        props.sort();
        out.push(`${label}${pseudo ?? ""} {${props.join(";")}}`);
      }
      const box = el.getBoundingClientRect();
      out.push(
        `${label} box ${box.x.toFixed(1)},${box.y.toFixed(1)},${box.width.toFixed(1)},${box.height.toFixed(1)}`,
      );
    }
    return out;
  });
}

function firstDifference(a: string[], b: string[]): string {
  if (a.length !== b.length) return `${a.length} vs ${b.length} entries`;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === b[i]) continue;
    const left = a[i]!.split(";");
    const right = b[i]!.split(";");
    const diff = left.filter((prop, index) => prop !== right[index]).slice(0, 3);
    return `${a[i]!.slice(0, 60)}: ${diff.join(" | ")} vs ${right
      .filter((prop, index) => prop !== left[index])
      .slice(0, 3)
      .join(" | ")}`;
  }
  return "identical";
}

for (const variant of ["full", "links"] as const) {
  for (const width of [null, 300] as const) {
    for (const reducedMotion of ["no-preference", "reduce"] as const) {
      test(`M8-02 ${variant} page${width ? ` in a ${width}px container` : ""}, motion ${reducedMotion}: the inline CSS computes the same styles as the source stylesheets`, async ({
        browser,
      }, info) => {
        const { body, css, original } = render(variant);
        const options = {
          viewport: info.project.use.viewport ?? { width: 390, height: 844 },
          reducedMotion,
        } as const;
        const context = await browser.newContext(options);
        const a = await context.newPage();
        const b = await context.newPage();
        await a.setContent(html(body, original, width));
        await b.setContent(html(body, css, width));
        // Animations start at different times on the two pages; freeze both at the same instant
        // (their declared names and timings are compared with everything else).
        for (const page of [a, b]) {
          await page.evaluate(() => {
            for (const animation of document.getAnimations()) {
              animation.pause();
              animation.currentTime = 1000;
            }
          });
        }
        const [left, right] = [await computed(a), await computed(b)];
        expect(left.length).toBeGreaterThan(100);
        expect(firstDifference(left, right)).toBe("identical");
        // A sanity check that the comparison can fail: no CSS at all lays the page out differently.
        const bare = await context.newPage();
        await bare.setContent(html(body, "", width));
        expect(firstDifference(left, await computed(bare))).not.toBe("identical");
        await context.close();
      });
    }
  }
}
