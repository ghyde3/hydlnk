import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ConsentScreen, startsTicked } from "@/components/oauth/consent-screen";
import { allow, authorizeQuery, harness, USER, type Harness } from "./helpers/oauth-flow";

/**
 * M10-37 (Gary, 2026-10-04, supersedes M10-13 in this respect only): Edit your drafts starts
 * ticked, Publish your pages starts unticked unless this person already holds publish for the same
 * app. The page is rendered from the real consent view.
 */

async function render(h: Harness): Promise<{ write: boolean; publish: boolean }> {
  const result = await h.authorize(authorizeQuery(), { user: USER });
  if (result.kind !== "consent") throw new Error(`expected the consent screen, got ${result.kind}`);
  const html = renderToStaticMarkup(<ConsentScreen view={result.view} />);
  const checked = (scope: string) => {
    const tag = html.match(new RegExp(`<input[^>]*value="${scope}"[^>]*>`));
    if (!tag) throw new Error(`no box for ${scope}`);
    return /checked/.test(tag[0]);
  };
  return { write: checked("hydlnk.write"), publish: checked("hydlnk.publish") };
}

describe("M10-37 which boxes start ticked", () => {
  it("first connect: write ticked, publish unticked", async () => {
    expect(await render(harness())).toEqual({ write: true, publish: false });
  });

  it("reconnect with publish held: both ticked", async () => {
    const h = harness();
    await allow(h, { scopes: ["hydlnk.write", "hydlnk.publish"] });
    expect(await render(h)).toEqual({ write: true, publish: true });
  });

  it("reconnect without publish: publish unticked", async () => {
    const h = harness();
    await allow(h, { scopes: ["hydlnk.write"] });
    expect(await render(h)).toEqual({ write: true, publish: false });
  });

  it("the helper", () => {
    expect(startsTicked("hydlnk.publish", null)).toBe(false);
    expect(startsTicked("hydlnk.publish", ["hydlnk.read", "hydlnk.publish"])).toBe(true);
    expect(startsTicked("hydlnk.write", null)).toBe(true);
  });

  it("the server grants only what was posted: no publish tick, no publish scope", async () => {
    const h = harness();
    const result = await h.authorize(authorizeQuery(), { user: USER });
    if (result.kind !== "consent") throw new Error("expected consent");
    await h.consent({
      request: result.view.requestId,
      csrf: result.view.csrf,
      decision: "allow",
      scope: ["hydlnk.write"],
    });
    expect(h.store.grants[0]!.scopes).toEqual(["hydlnk.read", "hydlnk.write"]);
  });
});
