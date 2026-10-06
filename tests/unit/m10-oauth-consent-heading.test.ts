import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ConsentScreen } from "@/components/oauth/consent-screen";
import {
  CLAUDE_ID,
  CLAUDE_REDIRECT,
  OTHER_CIMD_ID,
  OTHER_CIMD_REDIRECT,
  addClaude,
  addOtherCimd,
  authorizeQuery,
  harness,
  USER,
  type Harness,
} from "./helpers/oauth-flow";

/**
 * M10-38 (Wave L second review, finding 2): every client that is not one of the three known documents
 * is introduced as unverified, with where the person goes back to. A metadata document is data anyone
 * can host under any name; only the known clients keep the plain heading.
 */

const heading = (html: string) => /<h1>([\s\S]*?)<\/h1>/.exec(html)![1]!;

async function view(h: Harness, query: Record<string, string | null>) {
  const result = await h.authorize(authorizeQuery(query), { user: USER });
  if (result.kind !== "consent") throw new Error(`expected the consent screen, got ${result.kind}`);
  return renderToStaticMarkup(createElement(ConsentScreen, { view: result.view }));
}

describe("M10-38 the heading says unverified for every client that is not known", () => {
  it("a metadata client nobody knows: unverified, at its return host", async () => {
    const h = harness();
    addOtherCimd(h);
    const html = await view(h, { client_id: OTHER_CIMD_ID, redirect_uri: OTHER_CIMD_REDIRECT });
    expect(heading(html)).toBe(
      "“Some app” (unverified) at app.example.org wants to connect to your HYDLNK",
    );
  });

  it("a registered client: still unverified", async () => {
    expect(heading(await view(harness(), {}))).toBe(
      "“Test app” (unverified) at a.example wants to connect to your HYDLNK",
    );
  });

  it("a known client keeps the plain heading", async () => {
    const h = harness();
    addClaude(h);
    const html = await view(h, { client_id: CLAUDE_ID, redirect_uri: CLAUDE_REDIRECT });
    expect(heading(html)).toBe("Claude wants to connect to your HYDLNK");
  });
});
