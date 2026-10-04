/**
 * Next.js ships its own copy of `react-dom/server` and refuses the public `react-dom/server`
 * specifier inside a route handler (it is a React Server Components layer: "You're importing a
 * component that imports react-dom/server"). `renderToStaticMarkup` itself is plain string
 * rendering and works there, so the live-page builder imports it from the copy Next compiled.
 * See static-markup.ts.
 */
declare module "next/dist/compiled/react-dom/server.node" {
  export function renderToStaticMarkup(element: import("react").ReactNode): string;
}
