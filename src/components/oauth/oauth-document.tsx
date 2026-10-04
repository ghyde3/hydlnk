import type { ReactNode } from "react";
import { OAUTH_CSS } from "./oauth-css";

/**
 * The whole document of an OAuth screen: `<html>`, the head with its one inline stylesheet, the
 * wordmark and a `<main>` card. Plain function components only, no hooks and no client components:
 * a route handler turns the tree into finished HTML with `renderStatic` (src/components/oauth/render.tsx),
 * so the screen needs no JavaScript and loads nothing from another origin.
 *
 * `referrer` is also set as a meta tag: the headers of an app-host response are written by the proxy,
 * and a page that sends the person on to another site must not send its own address along.
 */
export function OauthDocument({ title, children }: { title: string; children: ReactNode }) {
  return (
    <html lang="en">
      {/* A route handler answers this document, outside the App Router layouts: next/head has no part in it. */}
      {/* eslint-disable-next-line @next/next/no-head-element */}
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="referrer" content="no-referrer" />
        <meta name="robots" content="noindex, nofollow" />
        <title>{title}</title>
        <style dangerouslySetInnerHTML={{ __html: OAUTH_CSS }} />
      </head>
      <body>
        <div className="page">
          <header className="top">
            <span className="brand">
              <i aria-hidden="true" />
              HYDLNK
            </span>
          </header>
          <main className="card">{children}</main>
        </div>
      </body>
    </html>
  );
}
