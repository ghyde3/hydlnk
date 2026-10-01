import { expect, type Page } from "@playwright/test";

/** Port the local dev server listens on. Matches baseURL in playwright.config.ts. */
export const DEV_PORT = 3000;

/**
 * Builds a local dev URL.
 *   url()                 -> http://localhost:3000/            (marketing)
 *   url("app", "/signup") -> http://app.localhost:3000/signup  (editor)
 *   url("mara")           -> http://mara.localhost:3000/       (tenant page)
 * An empty or missing prefix means the root host.
 */
export function url(hostPrefix?: string | null, path = "/"): string {
  const host = hostPrefix ? `${hostPrefix}.localhost` : "localhost";
  const pathname = path.startsWith("/") ? path : `/${path}`;
  return `http://${host}:${DEV_PORT}${pathname}`;
}

/**
 * Asserts the page cannot be scrolled sideways. Compares the document width against both the
 * layout viewport and the emulated viewport, so a missing <meta name="viewport"> (which makes
 * mobile Chromium lay out at 980px) is caught too. On failure, names the widest offenders.
 */
export async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const result = await page.evaluate(() => {
    const root = document.documentElement;
    const limit = Math.min(root.clientWidth, window.innerWidth);
    const offenders: string[] = [];
    for (const el of Array.from(document.body.querySelectorAll("*"))) {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.right > limit + 0.5 && offenders.length < 5) {
        const id = el.id ? `#${el.id}` : "";
        const cls =
          typeof el.className === "string" && el.className
            ? `.${el.className.split(/\s+/)[0]}`
            : "";
        offenders.push(`${el.tagName.toLowerCase()}${id}${cls} right=${Math.round(rect.right)}`);
      }
    }
    return {
      scrollWidth: Math.max(root.scrollWidth, document.body.scrollWidth),
      limit,
      offenders,
    };
  });
  const viewportWidth = page.viewportSize()?.width ?? result.limit;
  const allowed = Math.min(result.limit, viewportWidth);
  expect(
    result.scrollWidth,
    `horizontal scroll at ${viewportWidth}px (document ${result.scrollWidth}px). Wide elements: ${result.offenders.join(", ") || "none found"}`,
  ).toBeLessThanOrEqual(allowed);
}

const INTERACTIVE = 'a, button, input, [role="button"]';

/**
 * Asserts every visible a / button / input / [role=button] box is at least `min` CSS px in both
 * dimensions (default 44, the HYDLNK touch-target floor). Bounding boxes are in CSS pixels, so
 * the result does not depend on deviceScaleFactor.
 *
 * `selector` optionally scopes the check to descendants of matching containers (or the matching
 * elements themselves); omit it to check the whole page.
 * Skipped: hidden inputs, elements with no box, 1px visually-hidden elements (skip links), and
 * inline links that sit inside running text, i.e. next to non-blank text (the WCAG 2.5.8 inline
 * exception). An inline link on its own, such as a padded nav item, is measured.
 */
export async function expectTapTargets(page: Page, selector?: string, min = 44): Promise<void> {
  const failures = await page.evaluate(
    ({ scope, minSize, interactive }) => {
      const roots = scope ? Array.from(document.querySelectorAll(scope)) : [document.body];
      const targets = new Set<Element>();
      for (const root of roots) {
        if (root.matches(interactive)) targets.add(root);
        root.querySelectorAll(interactive).forEach((el) => targets.add(el));
      }
      const bad: string[] = [];
      for (const el of targets) {
        if (el instanceof HTMLInputElement && el.type === "hidden") continue;
        const style = getComputedStyle(el);
        if (style.display === "none" || style.visibility === "hidden") continue;
        if (el.tagName === "A" && style.display === "inline") {
          // WCAG 2.5.8 inline exception: only a link inside running text. A bare inline link
          // (a nav item with padding, say) is a real target and is measured like any other.
          const inRunningText = Array.from(el.parentNode?.childNodes ?? []).some(
            (node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? "").trim() !== "",
          );
          if (inRunningText) continue;
        }
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        if (rect.width <= 1 && rect.height <= 1) continue;
        if (rect.width < minSize - 0.5 || rect.height < minSize - 0.5) {
          const label = (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 30);
          bad.push(
            `<${el.tagName.toLowerCase()}> "${label}" ${Math.round(rect.width)}x${Math.round(rect.height)}`,
          );
        }
      }
      return bad;
    },
    { scope: selector ?? null, minSize: min, interactive: INTERACTIVE },
  );
  expect(failures, `tap targets smaller than ${min}px: ${failures.join("; ")}`).toEqual([]);
}
