import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { stackIsUp } from "./publish-support";
import { contentHarness, type BlogOwner, type ContentHarness } from "./support/mcp-content-db";

const mocks = vi.hoisted(() => ({ admin: undefined as unknown }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminSupabase: () => mocks.admin }));
vi.mock("next/cache", () => ({ revalidateTag: () => undefined, updateTag: () => undefined }));
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

const { run } = await stackIsUp();

/**
 * M18-05 (plan 3.5): `checkPostBody`, the writer's export that runs on a body what Publish runs:
 * allowed schemes, uploads only, at most 50 images, each the actor's own existing file. It reads
 * and stores nothing; the editor's lenient draft save does not call it.
 */
describe.skipIf(!run)("checkPostBody (local Supabase and Storage)", () => {
  let h: ContentHarness;
  let a: BlogOwner;
  let b: BlogOwner;
  let checkPostBody: typeof import("@/lib/content").checkPostBody;
  let storageUrl: (path: string) => string;
  const check = (o: BlogOwner, body: unknown) =>
    checkPostBody({ actor: { userId: o.userId, source: "mcp" }, draft: { title: "T", body } });

  beforeAll(async () => {
    h = await contentHarness();
    mocks.admin = h.admin;
    ({ checkPostBody } = await import("@/lib/content"));
    ({ storageUrl } = await import("@/lib/media/url"));
    a = await h.owner("cb-a");
    b = await h.owner("cb-b");
  });
  afterAll(async () => h?.cleanup());

  it("a clean body passes: http, https, mailto, tel and relative links, and no image", async () => {
    expect(
      await check(
        a,
        "# Hello\n\n[a](https://example.com) [b](http://example.com) [c](mailto:x@example.com) [d](tel:+15550100) [e](/about) [f](#top)\n\n<b>raw html is text</b>",
      ),
    ).toBeNull();
    expect(await check(a, "")).toBeNull();
    expect(
      await checkPostBody({ actor: { userId: a.userId, source: "mcp" }, draft: {} }),
    ).toBeNull();
    expect(
      await checkPostBody({ actor: { userId: a.userId, source: "mcp" }, draft: null }),
    ).toBeNull();
  });

  it("javascript:, data: and vbscript: are refused, as a link and as an image", async () => {
    for (const body of [
      "[x](javascript:alert(1))",
      "[x](JaVaScRiPt:alert(1))",
      "![x](javascript:alert(1))",
      "[x](data:text/html;base64,PHNjcmlwdD4=)",
      "![x](data:image/png;base64,AAAA)",
      "[x](vbscript:msgbox(1))",
      '<a href="javascript:alert(1)">x</a>',
      // In angle brackets a destination may hold a tab; a browser drops it and reads javascript:.
      "[x](<java\tscript:alert(1)>)",
      "[x](&#106;avascript:alert(1))",
      "[x][ref]\n\n[ref]: javascript:alert(1)",
    ]) {
      const out = await check(a, body);
      expect(out, body).not.toBeNull();
      expect(out, body).toMatchObject({ ok: false, error: "invalid" });
      expect(out!.issues![0]!.path).toBe("body");
    }
  });

  it("an image that is not an upload is refused: a remote one, dot segments, a percent-encoded letter, a query string", async () => {
    const own = await h.upload(a, "img-0000000cb001");
    const good = storageUrl(own);
    expect(await check(a, `![ok](${good})`)).toBeNull();
    for (const address of [
      "https://evil.example/pixel.png",
      good.replace("/page-media/", "/page-media/../page-media/"),
      good.replace("img-", "%69mg-"),
      `${good}?v=1`,
      `${good}#x`,
      good.replace("http://", "HTTP://"),
      good.replace(/^https?:/, ""),
      `/${own}`,
    ]) {
      const out = await check(a, `![x](${address})`);
      expect(out, address).toMatchObject({ ok: false, error: "invalid" });
      expect(out!.issues, address).toEqual([
        { path: "body", message: "Use an image from your uploads." },
      ]);
    }
    // An image inside a link is still an image.
    const nested = await check(a, `[![x](https://evil.example/p.png)](https://example.com)`);
    expect(nested).toMatchObject({ ok: false, error: "invalid" });
  });

  it("another account's upload is refused although the file exists; the owner's own missing file too", async () => {
    const theirs = await h.upload(b, "img-0000000cb002");
    const foreign = await check(a, `![x](${storageUrl(theirs)})`);
    expect(foreign).toMatchObject({ ok: false, error: "invalid" });
    expect(foreign!.issues).toEqual([
      { path: "body", message: "That image isn’t in your uploads. Upload it again." },
    ]);
    // The same address is fine for its owner.
    expect(await check(b, `![x](${storageUrl(theirs)})`)).toBeNull();
    const missing = await check(a, `![x](${storageUrl(`${a.userId}/img-00000000dead.webp`)})`);
    expect(missing).toMatchObject({ ok: false, error: "invalid" });
    expect(missing!.issues).toEqual([
      { path: "body", message: "That image is no longer available. Upload it again." },
    ]);
  });

  it("51 images are refused before Storage is asked about any of them; 50 are counted once each", async () => {
    const paths = Array.from(
      { length: 51 },
      (_, index) => `${a.userId}/img-${String(index).padStart(12, "0")}.webp`,
    );
    const out = await check(a, paths.map((path) => `![x](${storageUrl(path)})`).join("\n\n"));
    expect(out).toMatchObject({ ok: false, error: "invalid" });
    expect(out!.issues).toEqual([
      { path: "body", message: "A post can hold up to 50 images. Remove some." },
    ]);
    // The same upload fifty-one times is one image.
    const own = await h.upload(a, "img-0000000cb003");
    expect(
      await check(
        a,
        Array(51)
          .fill(`![x](${storageUrl(own)})`)
          .join("\n\n"),
      ),
    ).toBeNull();
  });

  it("it stores nothing: the entry is as it was after a refused check", async () => {
    const made = await h.post(a, { body: "Before" });
    const before = await h.row(made.id);
    const out = await checkPostBody({
      actor: { userId: a.userId, source: "mcp" },
      draft: { ...before.draft, body: "[x](javascript:alert(1))" },
    });
    expect(out).not.toBeNull();
    expect(await h.row(made.id)).toEqual(before);
  });
});
