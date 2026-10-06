import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { REDIRECT_MODE_MESSAGE } from "@/lib/limits";
import {
  LOCK_ONLY_ON_LINKS_MESSAGE,
  LOCK_SET_CODE_MESSAGE,
  REDIRECT_LOCKED_MESSAGE,
  REDIRECT_LOOP_MESSAGE,
  REDIRECT_PICK_MESSAGE,
  UTM_PATTERN_MESSAGE,
  type Block,
} from "@/lib/document";
import {
  draftOf,
  makeOwner,
  publishedOf,
  removeOwners,
  stackIsUp,
  type TestOwner,
} from "./publish-support";

vi.mock("server-only", () => ({}));
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

/**
 * M9-27, M9-29, M9-31 the Publish gate against the local Supabase: redirect mode's plan and target
 * rules (enforced on write, on the server), the lock rules and the UTM rules. Drafts are written
 * straight into `pages.draft`, the way a client with the publishable key could write them, then
 * Publish is attempted: a refusal names the field and leaves `pages.published` as it was.
 */
const { run } = await stackIsUp();

const SALT = "AAAAAAAAAAAAAAAAAAAAAA";
const HASH = "B".repeat(43);

const link = (id: string, extra: Record<string, unknown> = {}): Block =>
  ({
    id,
    type: "link",
    visible: true,
    label: `Label ${id}`,
    url: `https://shop.example/${id}`,
    ...extra,
  }) as Block;

describe.skipIf(!run)("M9-27 M9-29 M9-31 the Publish gate (local Supabase)", () => {
  let admin: SupabaseClient;
  let core: typeof import("@/lib/publish/core");
  let rootHost = "localhost";
  const owners: TestOwner[] = [];

  beforeAll(async () => {
    const { createClient } = await import("@supabase/supabase-js");
    admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
      auth: { persistSession: false },
    });
    core = await import("@/lib/publish/core");
    rootHost = (process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "localhost:3000").replace(/:\d+$/, "");
  });

  afterAll(async () => {
    await removeOwners(admin, owners);
  });

  const owner = async (
    label: string,
    draft: (handle: string) => unknown,
    plan?: "free" | "pro" | "studio",
  ) => {
    const made = await makeOwner(admin, label, draft, plan);
    owners.push(made);
    return made;
  };
  const writeDraft = async (o: TestOwner, draft: unknown) => {
    const { error } = await admin
      .from("pages")
      .update({ draft: draft as never })
      .eq("id", o.pageId);
    expect(error).toBeNull();
  };
  const publish = (o: TestOwner) =>
    core.publishPageCore({ pageId: o.pageId, userId: o.userId }, { admin });
  const withRedirect = (name: string, linkId: unknown, blocks: Block[] = [link("lnk-target-01")]) =>
    draftOf(name, blocks, { redirect: { linkId } } as never);
  const unpublished = async (o: TestOwner) =>
    expect(await publishedOf(admin, o.pageId)).toEqual({ published: null, published_at: null });

  describe("M9-31 redirect mode", () => {
    it("a Free account is refused with the plan sentence under the field redirect, and nothing is written", async () => {
      const o = await owner("rf1", (h) => withRedirect(h, "lnk-target-01"));
      const result = await publish(o);
      expect(result).toMatchObject({ ok: false, reason: "invalid" });
      if (result.ok) return;
      expect(result.errors).toEqual([
        { blockId: null, field: "redirect", message: REDIRECT_MODE_MESSAGE },
      ]);
      await unpublished(o);
    });

    it("a Pro and a Studio account publish it, and the stored document holds {linkId}", async () => {
      for (const plan of ["pro", "studio"] as const) {
        const o = await owner(`rp-${plan}`, (h) => withRedirect(h, "lnk-target-01"), plan);
        expect((await publish(o)).ok).toBe(true);
        const stored = (await publishedOf(admin, o.pageId)).published as { redirect?: unknown };
        expect(stored.redirect).toEqual({ linkId: "lnk-target-01" });
      }
    });

    it("a downgraded account keeps the key in its draft and cannot publish it; upgrading and publishing turns it on again", async () => {
      const o = await owner("rd1", (h) => withRedirect(h, "lnk-target-01"), "pro");
      expect((await publish(o)).ok).toBe(true);
      const live = await publishedOf(admin, o.pageId);
      await admin.from("accounts").update({ paid_plan: "free" }).eq("id", o.userId);
      const refused = await publish(o);
      expect(refused).toMatchObject({ ok: false, reason: "invalid" });
      if (!refused.ok)
        expect(refused.errors[0]).toMatchObject({
          field: "redirect",
          message: REDIRECT_MODE_MESSAGE,
        });
      // The refused Publish left the live page as it was; the draft still holds the key.
      expect(await publishedOf(admin, o.pageId)).toEqual(live);
      const draft = (await admin.from("pages").select("draft").eq("id", o.pageId).single()).data!
        .draft as { redirect?: unknown };
      expect(draft.redirect).toEqual({ linkId: "lnk-target-01" });
      await admin.from("accounts").update({ paid_plan: "pro" }).eq("id", o.userId);
      expect((await publish(o)).ok).toBe(true);
    });

    it("refuses a target that is not a visible link of the page, under redirect.linkId, on Pro", async () => {
      const cases: [string, unknown, Block[]][] = [
        [
          "a hidden block",
          "lnk-hidden-01",
          [link("lnk-hidden-01", { visible: false }), link("lnk-other-001")],
        ],
        [
          "a card",
          "card-aaaaaaa1",
          [
            {
              id: "card-aaaaaaa1",
              type: "card",
              visible: true,
              title: "T",
              caption: "",
              url: "https://shop.example/c",
              image: null,
            } as Block,
            link("lnk-other-001"),
          ],
        ],
        [
          "a social icon",
          "ico-aaaaaaa1",
          [
            {
              id: "soc-aaaaaaa1",
              type: "social",
              visible: true,
              icons: [
                { id: "ico-aaaaaaa1", platform: "instagram", url: "https://instagram.com/x" },
              ],
            } as Block,
            link("lnk-other-001"),
          ],
        ],
        [
          "a text link",
          "tl-aaaaaaa01",
          [
            {
              id: "txt-aaaaaaa1",
              type: "text",
              visible: true,
              text: "Read me",
              marks: [
                {
                  type: "link",
                  id: "tl-aaaaaaa01",
                  start: 0,
                  end: 4,
                  url: "https://shop.example/t",
                },
              ],
            } as Block,
            link("lnk-other-001"),
          ],
        ],
        ["another page's id", "lnk-elsewhere1", [link("lnk-other-001")]],
        ["an id with a slash", "a/b", [link("lnk-other-001")]],
        ["a path", "../x", [link("lnk-other-001")]],
        ["a 5,000 character string", "a".repeat(5000), [link("lnk-other-001")]],
      ];
      for (const [name, linkId, blocks] of cases) {
        const o = await owner("rb", (h) => withRedirect(h, linkId, blocks), "pro");
        const result = await publish(o);
        expect(result, name).toMatchObject({ ok: false, reason: "invalid" });
        if (!result.ok) {
          expect(
            result.errors.map((e) => `${e.blockId}|${e.field}|${e.message}`),
            name,
          ).toEqual([`null|redirect.linkId|${REDIRECT_PICK_MESSAGE}`]);
        }
        await unpublished(o);
      }
    });

    it("{linkId: {}} and a draft with no blocks to point at are refused with the field named", async () => {
      const o = await owner("rb2", (h) => withRedirect(h, {}), "pro");
      const result = await publish(o);
      expect(result).toMatchObject({ ok: false });
      if (!result.ok) expect(result.errors.map((e) => e.field)).toEqual(["redirect.linkId"]);
      await unpublished(o);
    });

    it("refuses a locked target with its own sentence", async () => {
      const o = await owner(
        "rl1",
        (h) => withRedirect(h, "lnk-target-01", [link("lnk-target-01", { lock: { kind: "age" } })]),
        "pro",
      );
      const result = await publish(o);
      if (result.ok) throw new Error("published");
      expect(result.errors).toEqual([
        { blockId: null, field: "redirect.linkId", message: REDIRECT_LOCKED_MESSAGE },
      ]);
    });

    it("refuses a link back to the page: its handle host and a verified custom domain, but not an unverified one", async () => {
      const o = await owner(
        "rh1",
        (h) =>
          withRedirect(h, "lnk-target-01", [
            link("lnk-target-01", { url: `http://placeholder.${rootHost}/` }),
          ]),
        "pro",
      );
      await writeDraft(
        o,
        withRedirect("x", "lnk-target-01", [
          link("lnk-target-01", { url: `http://${o.handle}.${rootHost}:3000/x` }),
        ]),
      );
      const own = await publish(o);
      if (own.ok) throw new Error("published a loop");
      expect(own.errors).toEqual([
        { blockId: null, field: "redirect.linkId", message: REDIRECT_LOOP_MESSAGE },
      ]);

      const domain = `links-${o.handle}.example.test`;
      const inserted = await admin
        .from("domains")
        .insert({
          page_id: o.pageId,
          hostname: domain,
          status: "verified",
          verified_at: new Date().toISOString(),
        } as never);
      expect(inserted.error).toBeNull();
      await writeDraft(
        o,
        withRedirect("x", "lnk-target-01", [link("lnk-target-01", { url: `https://${domain}/` })]),
      );
      const custom = await publish(o);
      if (custom.ok) throw new Error("published a loop on a custom domain");
      expect(custom.errors[0]).toMatchObject({
        field: "redirect.linkId",
        message: REDIRECT_LOOP_MESSAGE,
      });

      await admin
        .from("domains")
        .update({ status: "pending", verified_at: null } as never)
        .eq("page_id", o.pageId);
      expect((await publish(o)).ok).toBe(true);
    });

    it("the blocklist still judges the target as a link block's url: a blocked host refuses Publish", async () => {
      const o = await owner(
        "rbl",
        (h) =>
          withRedirect(h, "lnk-target-01", [
            link("lnk-target-01", { url: "https://shop.example/ok" }),
          ]),
        "pro",
      );
      const domain = `blocked-${o.handle}.example`;
      const blocked = await admin.from("blocked_domains").insert({ domain } as never);
      expect(blocked.error).toBeNull();
      try {
        const { error } = await admin
          .from("pages")
          .update({
            draft: withRedirect("x", "lnk-target-01", [
              link("lnk-target-01", { url: `https://${domain}/x` }),
            ]) as never,
          })
          .eq("id", o.pageId);
        // The save-time trigger refuses the draft itself; whichever layer says it, nothing is published.
        if (!error) {
          const result = await publish(o);
          expect(result).toMatchObject({ ok: false, reason: "blocked_link" });
        }
        await unpublished(o);
      } finally {
        await admin.from("blocked_domains").delete().eq("domain", domain);
      }
    });
  });

  describe("M9-29 the lock", () => {
    it("publishes an age lock and a code lock with a complete hash", async () => {
      const o = await owner("lk1", (h) =>
        draftOf(h, [
          link("lnk-age-00001", { lock: { kind: "age" } }),
          link("lnk-code-0001", { lock: { kind: "code", salt: SALT, hash: HASH } }),
        ]),
      );
      expect((await publish(o)).ok).toBe(true);
      const stored = (await publishedOf(admin, o.pageId)).published as {
        blocks: { lock?: unknown }[];
      };
      expect(stored.blocks.map((b) => b.lock)).toEqual([
        { kind: "age" },
        { kind: "code", salt: SALT, hash: HASH },
      ]);
    });

    it("refuses a code lock with no hash, a 5,000 character hash and kind:'pin', each with the field named, nothing written", async () => {
      for (const lock of [
        { kind: "code" },
        { kind: "code", salt: SALT, hash: "B".repeat(5000) },
        { kind: "pin" },
      ]) {
        const o = await owner("lk2", (h) => draftOf(h, [link("lnk-locked-001", { lock })]));
        const result = await publish(o);
        expect(result, JSON.stringify(lock).slice(0, 40)).toMatchObject({
          ok: false,
          reason: "invalid",
        });
        if (!result.ok)
          expect(result.errors.map((e) => `${e.blockId}|${e.field}`)).toEqual([
            "lnk-locked-001|lock",
          ]);
        await unpublished(o);
      }
      const noHash = await owner("lk3", (h) =>
        draftOf(h, [link("lnk-locked-002", { lock: { kind: "code" } })]),
      );
      const refused = await publish(noHash);
      if (!refused.ok) expect(refused.errors[0]!.message).toBe(LOCK_SET_CODE_MESSAGE);
    });

    it("refuses a lock on a card, a header or any block that is not a link; the lock never reaches pages.published", async () => {
      const card = {
        id: "card-aaaaaaa2",
        type: "card",
        visible: true,
        title: "T",
        caption: "",
        url: "https://shop.example/c",
        image: null,
        lock: { kind: "age" },
      } as unknown as Block;
      const o = await owner("lk4", (h) => draftOf(h, [link("lnk-plain-0001"), card]));
      const result = await publish(o);
      expect(result).toMatchObject({ ok: false });
      if (!result.ok) {
        expect(result.errors).toEqual([
          { blockId: "card-aaaaaaa2", field: "lock", message: LOCK_ONLY_ON_LINKS_MESSAGE },
        ]);
      }
      await unpublished(o);
    });

    it("a hidden block holding a bad lock does not stop Publish, and is not published", async () => {
      const o = await owner("lk5", (h) =>
        draftOf(h, [
          link("lnk-plain-0001"),
          link("lnk-hidden-002", { visible: false, lock: { kind: "pin", hash: "B".repeat(5000) } }),
        ]),
      );
      expect((await publish(o)).ok).toBe(true);
      const stored = (await publishedOf(admin, o.pageId)).published as { blocks: unknown[] };
      expect(stored.blocks).toHaveLength(1);
    });
  });

  describe("M9-27 the UTM values", () => {
    it("publishes valid page defaults and a link's own tags, and writes nothing for an empty object", async () => {
      const o = await owner("ut1", (h) =>
        draftOf(
          h,
          [
            link("lnk-own-00001", { utm: { source: "newsletter" } }),
            link("lnk-off-00001", { utm: { off: true } }),
            link("lnk-empty-001", { utm: {} }),
          ],
          {
            utm: { source: "hydlnk", medium: "link-in-bio", campaign: "spring launch" },
          } as never,
        ),
      );
      expect((await publish(o)).ok).toBe(true);
      const stored = (await publishedOf(admin, o.pageId)).published as {
        utm: unknown;
        blocks: { utm?: unknown }[];
      };
      expect(stored.utm).toEqual({
        source: "hydlnk",
        medium: "link-in-bio",
        campaign: "spring launch",
      });
      expect(stored.blocks.map((b) => b.utm)).toEqual([
        { source: "newsletter" },
        { off: true },
        undefined,
      ]);
    });

    it("refuses a value with & or a line break, naming the field; page and link alike", async () => {
      const page = await owner("ut2", (h) =>
        draftOf(h, undefined, { utm: { source: "a&utm_medium=x" } } as never),
      );
      const pageResult = await publish(page);
      if (pageResult.ok) throw new Error("published");
      expect(pageResult.errors).toEqual([
        { blockId: null, field: "utm.source", message: UTM_PATTERN_MESSAGE },
      ]);
      const own = await owner("ut3", (h) =>
        draftOf(h, [link("lnk-own-00002", { utm: { campaign: "a\r\nb", medium: "x=y" } })]),
      );
      const ownResult = await publish(own);
      if (ownResult.ok) throw new Error("published");
      expect(ownResult.errors.map((e) => `${e.blockId}|${e.field}`).sort()).toEqual([
        "lnk-own-00002|utm.campaign",
        "lnk-own-00002|utm.medium",
      ]);
      await unpublished(page);
      await unpublished(own);
    });

    it("a tag on every plan: Free publishes a utm", async () => {
      const o = await owner("ut4", (h) =>
        draftOf(h, undefined, { utm: { source: "hydlnk" } } as never),
      );
      expect((await publish(o)).ok).toBe(true);
    });
  });
});
