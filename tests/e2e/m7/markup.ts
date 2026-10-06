import type { Locator } from "@playwright/test";

/**
 * The markup of an element in a form two renderings of the same page can be compared in: attributes
 * in alphabetical order and an inline `style` as `property:value` pairs with no extra spaces.
 *
 * Why: the workspace draws its preview in the browser, once the viewport is known (M7-02, M7-09),
 * where the live page is HTML from the server. React sets the attributes of an element it creates in
 * the browser in its own order (an image's `src` goes last) and the browser writes a style attribute
 * with a space after each colon. The page is the same; only its spelling differs. Runs in the page.
 */
export function comparableMarkup(root: Element): string {
  const clone = root.cloneNode(true) as Element;
  const walk = (node: Element): void => {
    const attributes = Array.from(node.attributes)
      .map((attribute) => [attribute.name, attribute.value] as [string, string])
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    for (const [name] of attributes) node.removeAttribute(name);
    for (const [name, value] of attributes) {
      let text = value;
      if (name === "style") {
        text = value
          .split(";")
          .map((declaration) => declaration.trim())
          .filter((declaration) => declaration !== "")
          .map((declaration) => {
            const colon = declaration.indexOf(":");
            return `${declaration.slice(0, colon).trim()}:${declaration.slice(colon + 1).trim()}`;
          })
          .join(";");
      }
      node.setAttribute(name, text);
    }
    for (const child of Array.from(node.children)) walk(child);
  };
  walk(clone);
  return clone.outerHTML;
}

/** `comparableMarkup` of the element a locator finds. */
export const markupOf = (locator: Locator): Promise<string> => locator.evaluate(comparableMarkup);

/** An element's `style` attribute in the same comparable form (declarations, no extra spaces). */
export const styleAttrOf = (locator: Locator): Promise<string | null> =>
  locator.evaluate((el) => {
    const value = el.getAttribute("style");
    if (value === null) return null;
    return value
      .split(";")
      .map((declaration) => declaration.trim())
      .filter((declaration) => declaration !== "")
      .map((declaration) => {
        const colon = declaration.indexOf(":");
        return `${declaration.slice(0, colon).trim()}:${declaration.slice(colon + 1).trim()}`;
      })
      .join(";");
  });
