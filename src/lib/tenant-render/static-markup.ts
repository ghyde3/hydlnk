import "server-only";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "next/dist/compiled/react-dom/server.node";

/**
 * Renders a React element tree to a plain HTML string: no hydration markers, no flight data, no
 * bootstrap script (M8-02). This is the whole technique behind the live tenant page: the same
 * `PageRenderer` the editor preview draws in the browser, run once on the server by a route
 * handler and turned into finished HTML, so a visitor's browser never loads React.
 *
 * The public `react-dom/server` specifier is refused inside a route handler by Next.js (a
 * route handler is a React Server Components layer, where importing it is a build error), so this
 * takes `renderToStaticMarkup` from the copy of react-dom that Next.js itself compiled and
 * ships. It renders elements made by the server layer's React without trouble: an element is a
 * plain object, and the renderer only reads its type and props. The trees rendered here may hold
 * function components but no hooks and no client components (`'use client'` modules): the module
 * graph test in tests/unit/m8-render-graph.test.ts enforces it.
 *
 * If a later Next.js release stops shipping this file, the build fails (module not found) and
 * the unit tests fail first: nothing degrades quietly.
 */
export function renderStatic(node: ReactNode): string {
  return renderToStaticMarkup(node);
}
