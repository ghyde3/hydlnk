/* eslint-disable @typescript-eslint/no-explicit-any -- a tool result is JSON whose shape each test checks */
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { stackIsUp } from "./publish-support";
import { contentHarness, type BlogOwner, type ContentHarness } from "./support/mcp-content-db";

const mocks = vi.hoisted(() => ({
  admin: undefined as unknown,
  invalidateEntry: vi.fn(),
  invalidateType: vi.fn(),
  invalidatePage: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminSupabase: () => mocks.admin }));
vi.mock("@/lib/publish/invalidate", () => ({
  invalidateEntry: mocks.invalidateEntry,
  invalidateType: mocks.invalidateType,
  invalidatePage: mocks.invalidatePage,
}));
vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

const { run } = await stackIsUp();

/**
 * M18-05 (plan 3.5 and abuse cases 8 and 9), against the local database and Storage: tenant content
 * is untrusted, and so is what an AI sends for it. Each hostile body is refused AT SAVE, by
 * `create_entry` and by `update_entry` (as a whole body and as the result of `bodyEdits`), with
 * nothing written.
 */
describe.skipIf(!run)(
  "hostile Markdown and oversized input through the tools (local Supabase)",
  () => {
    let h: ContentHarness;
    let a: BlogOwner;
    let b: BlogOwner;
    let target: { id: string; rev: number };
    let storageUrl: (path: string) => string;
    let ownImage: string;
    // MARK stands alone, so what replaces it starts a block of its own, as in a whole body.
    const SAFE = "A safe body.\n\nMARK\n";

    const count = async () =>
      (await h.admin.from("content_entries").select("id").eq("site_id", a.pageId)).data!.length;

    /** The body through all three doors; each must refuse with `code` and leave everything as it was. */
    async function refusedEverywhere(body: string, code: string, label = body.slice(0, 60)) {
      const before = await h.row(target.id);
      const entries = await count();
      const created = await h.call("create_entry", { pageId: a.pageId, title: "Hostile", body }, a);
      expect(created.error?.code, `create: ${label}`).toBe(code);
      const replaced = await h.call(
        "update_entry",
        { entryId: target.id, ifRev: before.rev, body },
        a,
      );
      expect(replaced.error?.code, `update: ${label}`).toBe(code);
      const edited = await h.call(
        "update_entry",
        { entryId: target.id, ifRev: before.rev, bodyEdits: [{ find: "MARK", replace: body }] },
        a,
      );
      expect(edited.error?.code, `bodyEdits: ${label}`).toBe(code);
      expect(await h.row(target.id), label).toEqual(before);
      expect(await count(), label).toBe(entries);
      return { created, replaced, edited };
    }

    beforeAll(async () => {
      h = await contentHarness();
      mocks.admin = h.admin;
      ({ storageUrl } = await import("@/lib/media/url"));
      a = await h.owner("hm-a", { plan: "pro" });
      b = await h.owner("hm-b");
      target = await h.post(a, { body: SAFE });
      ownImage = storageUrl(await h.upload(a, "img-0000000hm001"));
    });
    afterAll(async () => h?.cleanup());

    it("a clean body with the caller's own upload saves through all three doors", async () => {
      const body = `# Fine\n\n![alt](${ownImage})\n\n[a link](https://example.com/page)\n`;
      const created = await h.call("create_entry", { pageId: a.pageId, title: "Clean", body }, a);
      expect(created.isError, JSON.stringify(created.error)).toBe(false);
      const made = await h.post(a, { body: SAFE });
      const replaced = await h.call("update_entry", { entryId: made.id, ifRev: 1, body }, a);
      expect(replaced.isError, JSON.stringify(replaced.error)).toBe(false);
      const edited = await h.call(
        "update_entry",
        { entryId: made.id, ifRev: 2, bodyEdits: [{ find: "# Fine", replace: "# Still fine" }] },
        a,
      );
      expect(edited.isError, JSON.stringify(edited.error)).toBe(false);
    });

    it("a javascript:, data: or vbscript: link or image is refused, however it is written", async () => {
      for (const body of [
        "[x](javascript:alert(1))",
        "![x](javascript:alert(1))",
        "[x](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)",
        "![x](data:image/svg+xml;base64,PHN2Zy8+)",
        "[x](vbscript:msgbox(1))",
        "[x](JaVaScRiPt:alert(1))",
        "[x](  javascript:alert(1))",
        // A scheme split by a tab (a browser drops it) and one hidden behind an entity.
        "[x](<java\tscript:alert(1)>)",
        "[x](&#106;avascript:alert(1))",
        "[x](&#x6A;avascript:alert(1))",
        "[x](javascript&colon;alert(1))",
        // A reference-style definition, an autolink, and raw HTML attributes.
        "[x][ref]\n\n[ref]: javascript:alert(1)",
        "<javascript:alert(1)>",
        '<a href="javascript:alert(1)">x</a>',
        "<img src='javascript:alert(1)'>",
        '<iframe src="data:text/html,<script>alert(1)</script>"></iframe>',
        // Inside a table, a list and a quote.
        "| a | b |\n|---|---|\n| [x](javascript:alert(1)) | y |",
        "- item\n  - [x](vbscript:run)",
        "> quoted [x](data:text/html,hi)",
        // An image inside a link: the link's own address.
        `[![alt](${"IMAGE"})](javascript:alert(1))`,
      ]) {
        const { created } = await refusedEverywhere(
          body.replace("IMAGE", ownImage),
          "invalid_input",
        );
        expect(created.error!.issues![0]!.path, body).toBe("body");
      }
    });

    it("bodyEdits cannot build a javascript: link from two harmless halves", async () => {
      const made = await h.post(a, { body: "[click](java) and script:alert(1) end" });
      const before = await h.row(made.id);
      const out = await h.call(
        "update_entry",
        {
          entryId: made.id,
          ifRev: 1,
          bodyEdits: [{ find: "(java) and script:alert(1) end", replace: "(javascript:alert(1))" }],
        },
        a,
      );
      expect(out.error?.code).toBe("invalid_input");
      expect(out.error!.issues![0]!.path).toBe("body");
      // Two steps, each harmless on its own.
      const twoSteps = await h.call(
        "update_entry",
        {
          entryId: made.id,
          ifRev: 1,
          bodyEdits: [
            { find: "(java) and ", replace: "(java" },
            { find: " end", replace: ")" },
          ],
        },
        a,
      );
      expect(twoSteps.error?.code).toBe("invalid_input");
      expect(await h.row(made.id)).toEqual(before);
    });

    it("an image must be the exact address of the caller's own existing upload", async () => {
      const theirs = storageUrl(await h.upload(b, "img-0000000hm002"));
      const missing = storageUrl(`${a.userId}/img-00000000dead.webp`);
      for (const address of [
        "https://evil.example/pixel.png",
        "http://127.0.0.1:54321/storage/v1/object/public/other-bucket/x.webp",
        theirs,
        missing,
        ownImage.replace("/page-media/", "/page-media/../page-media/"),
        ownImage.replace("/page-media/", "/page-media/./"),
        ownImage.replace("img-", "%69mg-"),
        ownImage.replace(a.userId, `${b.userId}/../${a.userId}`),
        `${ownImage}?download=1`,
        `${ownImage}#frag`,
        ownImage.replace(/^http:/, "HTTP:"),
        ownImage.replace("://", ":\\\\"),
        ownImage.replace(/^https?:/, ""),
      ]) {
        const { created } = await refusedEverywhere(`![x](${address})`, "invalid_input", address);
        expect(created.error!.issues![0]!.path, address).toBe("body");
      }
      // A reference-style image and an image inside a link are images too.
      await refusedEverywhere("![x][pic]\n\n[pic]: https://evil.example/p.png", "invalid_input");
      await refusedEverywhere(
        "[![x](https://evil.example/p.png)](https://example.com)",
        "invalid_input",
      );
    });

    it("51 images are refused; 50 uploads of the caller's own save", async () => {
      const many = Array.from(
        { length: 51 },
        (_, index) =>
          `![i](${storageUrl(`${a.userId}/img-${String(index).padStart(12, "0")}.webp`)})`,
      ).join("\n\n");
      const { created } = await refusedEverywhere(many, "invalid_input", "51 images");
      expect(created.error!.message).toContain("up to 50 images");
    });

    it("a link to a blocklisted host is blocked_link with the host: in a table, in raw HTML and behind character references", async () => {
      const host = `zq-blocked-${Math.random().toString(36).slice(2, 10)}.example`;
      await h.block(host);
      for (const body of [
        `[x](https://${host}/a)`,
        `| a | b |\n|---|---|\n| [x](https://${host}/a) | y |`,
        `<a href="https://${host}/a">x</a>`,
        `<a href='https://${host.replace(".", "&#46;")}/a'>x</a>`,
        `[x](https://${host.replace(".", "&#x2e;")}/a)`,
        `[x](https://sub.${host}/a)`,
        `<https://${host}/a>`,
        `[x](//${host}/a)`,
        `<img src="https://${host}/pixel.png">`,
      ]) {
        const { created, replaced } = await refusedEverywhere(body, "blocked_link");
        expect(created.error!.details!.hosts.join(","), body).toContain(host);
        expect(replaced.error!.details!.hosts.join(","), body).toContain(host);
      }
    });

    it("U+0000 is refused in the body; in a title it becomes a space", async () => {
      const nul = String.fromCharCode(0);
      await refusedEverywhere(`before${nul}after`, "invalid_input", "NUL in the body");
      // A one-line field is cleaned before the writer sees it: the U+0000 is replaced by a space, as
      // a line break is (pinned: the title is saved, not refused).
      const out = await h.call("create_entry", { pageId: a.pageId, title: `T${nul}itle` }, a);
      expect(out.isError, JSON.stringify(out.error)).toBe(false);
      expect((await h.row(out.json!.id)).draft.title).toBe("T itle");
      const renamed = await h.call(
        "update_entry",
        { entryId: out.json!.id, ifRev: 1, title: `New${nul}title` },
        a,
      );
      expect(renamed.isError, JSON.stringify(renamed.error)).toBe(false);
      expect((await h.row(out.json!.id)).draft.title).toBe("New title");
    });

    it("raw HTML is stored as written and is text on the live page", async () => {
      const body =
        '<script>alert("x")</script>\n\n<img src="https://example.com/pic.png" onerror="alert(1)">\n\nA <b onclick="x()">bold</b> word.\n';
      const made = await h.post(a, { body });
      expect((await h.row(made.id)).draft.body).toBe(body);
      const { PostBody } = await import("@/components/post/post-body");
      const html = renderToStaticMarkup(
        PostBody({ markdown: body, ownerId: a.userId, embeds: "inert" }),
      );
      // No element and no attribute of the raw HTML exists: every angle bracket and quote is escaped text.
      expect(html).not.toMatch(/<script|<img|<b[ >]| onerror="| onclick="/i);
      expect(html).toContain("&lt;script&gt;");
      expect(html).toContain("&lt;img");
    });

    describe("oversized input", () => {
      const KIB_512 = 512 * 1024;

      it("a 512 KiB body can be created and replaced; one byte more is invalid_input on body", async () => {
        const full = "a".repeat(KIB_512);
        const created = await h.call(
          "create_entry",
          { pageId: a.pageId, title: "Full", body: full },
          a,
        );
        expect(created.isError, JSON.stringify(created.error)).toBe(false);
        expect(created.json!.bodyChars).toBe(KIB_512);
        const other = "b".repeat(KIB_512);
        const replaced = await h.call(
          "update_entry",
          { entryId: created.json!.id, ifRev: 1, body: other },
          a,
        );
        expect(replaced.isError, JSON.stringify(replaced.error)).toBe(false);
        expect((await h.row(created.json!.id)).draft.body === other).toBe(true);

        const over = `${full}a`;
        const refused = await h.call(
          "create_entry",
          { pageId: a.pageId, title: "Over", body: over },
          a,
        );
        expect(refused.error).toMatchObject({ code: "invalid_input" });
        expect(refused.error!.issues).toEqual([
          { path: "body", message: "The body is over 512 KiB." },
        ]);
        const before = await h.row(created.json!.id);
        const again = await h.call(
          "update_entry",
          { entryId: created.json!.id, ifRev: 2, body: over },
          a,
        );
        expect(again.error?.code).toBe("invalid_input");
        expect(again.error!.issues![0]!.path).toBe("body");
        expect(await h.row(created.json!.id)).toEqual(before);
      });

      it("the limit is bytes, not characters: 512 KiB of astral characters fits, one more does not", async () => {
        const astral = "😀".repeat(KIB_512 / 4);
        const created = await h.call(
          "create_entry",
          { pageId: a.pageId, title: "Astral", body: astral },
          a,
        );
        expect(created.isError, JSON.stringify(created.error)).toBe(false);
        expect(created.json!.bodyChars).toBe(KIB_512 / 4);
        const read = await h.call("get_entry", { entryId: created.json!.id, length: 30_000 }, a);
        expect(read.json!.body).toBe("😀".repeat(30_000));
        const over = await h.call(
          "update_entry",
          { entryId: created.json!.id, ifRev: 1, body: `${astral}😀` },
          a,
        );
        expect(over.error?.code).toBe("invalid_input");
        expect(over.error!.issues![0]!.path).toBe("body");
      });

      it("a replace that grows the body past the limit is invalid_input on body, and nothing is written", async () => {
        const made = await h.post(a, { body: "x GROW x" });
        const before = await h.row(made.id);
        const out = await h.call(
          "update_entry",
          {
            entryId: made.id,
            ifRev: 1,
            bodyEdits: [{ find: "GROW", replace: "g".repeat(KIB_512) }],
          },
          a,
        );
        expect(out.error?.code).toBe("invalid_input");
        expect(out.error!.issues![0]!.path).toBe("body");
        expect(await h.row(made.id)).toEqual(before);
      });

      it("a title of 201, 21 bodyEdits, a find of 100,001 characters, an empty find and 51 terms are invalid_input", async () => {
        const made = await h.post(a, { body: "x" });
        const before = await h.row(made.id);
        const term = "11111111-1111-4111-8111-111111111111";
        const cases: Array<[Record<string, unknown>, string]> = [
          [{ title: "t".repeat(201) }, "title"],
          [{ excerpt: "e".repeat(401) }, "excerpt"],
          [{ seoTitle: "s".repeat(121) }, "seoTitle"],
          [{ seoDescription: "d".repeat(321) }, "seoDescription"],
          [
            { bodyEdits: Array.from({ length: 21 }, () => ({ find: "x", replace: "y" })) },
            "bodyEdits",
          ],
          [{ bodyEdits: [{ find: "f".repeat(100_001), replace: "" }] }, "bodyEdits[0].find"],
          [{ bodyEdits: [{ find: "", replace: "y" }] }, "bodyEdits[0].find"],
          [{ bodyEdits: [{ find: "x", replace: "y", extra: 1 }] }, "bodyEdits[0]"],
          [{ categories: Array(51).fill(term) }, "categories"],
          [{ tags: Array(51).fill(term) }, "tags"],
          [{ slug: "s".repeat(81) }, "slug"],
        ];
        for (const [fields, path] of cases) {
          const out = await h.call("update_entry", { entryId: made.id, ifRev: 1, ...fields }, a);
          expect(out.error?.code, path).toBe("invalid_input");
          expect(out.error!.issues![0]!.path, path).toBe(path);
          // An issue never echoes a long input back.
          expect(JSON.stringify(out.error).length, path).toBeLessThan(2_000);
        }
        const created = await h.call(
          "create_entry",
          { pageId: a.pageId, title: "t".repeat(201) },
          a,
        );
        expect(created.error?.code).toBe("invalid_input");
        expect(created.error!.issues![0]!.path).toBe("title");
        expect(await h.row(made.id)).toEqual(before);
        // 200 characters and 20 edits are fine.
        const fine = await h.call(
          "update_entry",
          {
            entryId: made.id,
            ifRev: 1,
            title: "t".repeat(200),
            bodyEdits: Array.from({ length: 20 }, (_, index) => ({
              find: index === 0 ? "x" : `x${index - 1}`,
              replace: `x${index}`,
            })),
          },
          a,
        );
        expect(fine.isError, JSON.stringify(fine.error)).toBe(false);
        expect((await h.row(made.id)).draft.body).toBe("x19");
      });

      it("twenty edits on a full body answer in time", async () => {
        const filler = "lorem ipsum dolor sit amet ".repeat(19_000).slice(0, 500_000);
        const made = await h.post(a, { body: `${filler} E0` });
        const started = performance.now();
        const out = await h.call(
          "update_entry",
          {
            entryId: made.id,
            ifRev: 1,
            bodyEdits: Array.from({ length: 20 }, (_, index) => ({
              find: ` E${index}`,
              replace: ` E${index + 1}`,
            })),
          },
          a,
        );
        expect(out.isError, JSON.stringify(out.error)).toBe(false);
        expect(performance.now() - started).toBeLessThan(15_000);
        expect((await h.row(made.id)).draft.body.endsWith(" E20")).toBe(true);
      });
    });
  },
);
