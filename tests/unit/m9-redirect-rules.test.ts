import { describe, expect, it, vi } from "vitest";
import { redirectModeResponse, redirectTargetId } from "@/lib/tenant-render/redirect";
import {
  REDIRECT_GONE_MESSAGE,
  REDIRECT_LOCKED_MESSAGE,
  REDIRECT_LOOP_MESSAGE,
  REDIRECT_PICK_MESSAGE,
  collectPublishErrors,
  draftDocSchema,
  isEligibleRedirectLink,
  publishedDocSchema,
  redirectOptions,
  redirectTargetIssue,
  toPublishForm,
  type DraftDoc,
  type PublishDoc,
} from "@/lib/document";
import {
  PLAN_LIMITS,
  REDIRECT_MODE_MESSAGE,
  SQL_COLUMNS,
  planLimits,
  toPlanId,
} from "@/lib/limits";
import { failureTab } from "@/components/workspace/failure-tab";
import { withRedirect, withoutRedirect, redirectTargetAvailable } from "@/lib/editor/link-fields";
import { blocks, draftWith, fullDraft, noirTokens } from "./fixtures/page-document";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env/client", () => ({
  clientEnv: {
    NEXT_PUBLIC_ROOT_DOMAIN: "localhost:3000",
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
  },
}));

const { checkLinkRules } = await import("@/lib/publish/link-rules");

/**
 * M9-31 redirect mode: the plan, the rules for a target, the schema in both forms, the Publish gate's
 * extra rules (with a fake database client), what the tenant route answers and the editor helpers.
 */

const SALT = "AAAAAAAAAAAAAAAAAAAAAA";
const HASH = "B".repeat(43);
const LINK = "link-main-0001";
const OTHER = "link-other-001";

const link = (id: string, extra: Record<string, unknown> = {}) => ({
  ...blocks.link,
  id,
  label: `Label ${id}`,
  url: `https://shop.example/${id}`,
  ...extra,
});

describe("M9-31 the plan", () => {
  it("redirectMode is false on Free and true on Pro and Studio, with its SQL column", () => {
    expect(PLAN_LIMITS.free.redirectMode).toBe(false);
    expect(PLAN_LIMITS.pro.redirectMode).toBe(true);
    expect(PLAN_LIMITS.studio.redirectMode).toBe(true);
    expect(SQL_COLUMNS.redirectMode).toBe("redirect_mode");
    expect(planLimits(toPlanId("anything"))).toBe(PLAN_LIMITS.free);
  });

  it("says why in one sentence", () => {
    expect(REDIRECT_MODE_MESSAGE).toBe("Redirect mode is part of Pro. Upgrade to use it.");
  });
});

describe("M9-31 which links are offered and what is wrong with a target", () => {
  const list = [
    link(LINK),
    { ...blocks.card, id: "card-00000001" },
    link("link-hidden-01", { visible: false }),
    link("link-locked-01", { lock: { kind: "age" } }),
    link("link-bad-url-01", { url: "javascript:alert(1)" }),
    link("link-empty-001", { url: "" }),
    blocks.social,
    link(OTHER, { label: "x".repeat(70) }),
    link("link-no-label1", { label: "" }),
  ];

  it("offers visible link blocks with a valid address and no lock, in page order, each by its label cut to 60", () => {
    const options = redirectOptions(list);
    expect(options.map((o) => o.id)).toEqual([LINK, OTHER, "link-no-label1"]);
    expect(options[1]!.label).toBe("x".repeat(60));
    expect(options[0]!.label).toBe(`Label ${LINK}`);
    expect(options[2]!.label).toBe("");
  });

  it("isEligibleRedirectLink: only a visible, unlocked link with an http(s) address", () => {
    expect(isEligibleRedirectLink(link(LINK))).toBe(true);
    for (const block of [
      blocks.card,
      blocks.social,
      link("a1234567", { visible: false }),
      link("a1234567", { lock: { kind: "code" } }),
      link("a1234567", { url: "ftp://x.example" }),
      null,
      undefined,
      "link",
      5,
    ]) {
      expect(isEligibleRedirectLink(block)).toBe(false);
    }
  });

  it("redirectTargetIssue: fine for a link of the page", () => {
    expect(redirectTargetIssue(list, LINK)).toBeNull();
    expect(redirectTargetIssue(list, OTHER, ["mara.localhost"])).toBeNull();
  });

  it.each([
    ["a card", "card-00000001"],
    ["a hidden block", "link-hidden-01"],
    ["a social icon's id", blocks.social.icons[0]!.id],
    ["another page's id", "link-elsewhere"],
    ["an id with a slash", "a/b"],
    ["a path", "../x"],
    ["a 5,000 character string", "a".repeat(5000)],
    ["a link with no usable address", "link-bad-url-01"],
    ["the empty string", ""],
  ])("refuses %s with 'Pick a link from your page.'", (_name, id) => {
    expect(redirectTargetIssue(list, id)).toBe(REDIRECT_PICK_MESSAGE);
  });

  it("refuses a value that is not a string", () => {
    for (const id of [undefined, null, 5, {}, [LINK]]) {
      expect(redirectTargetIssue(list, id)).toBe(REDIRECT_PICK_MESSAGE);
    }
  });

  it("refuses a locked link with its own sentence", () => {
    expect(redirectTargetIssue(list, "link-locked-01")).toBe(REDIRECT_LOCKED_MESSAGE);
    expect(REDIRECT_LOCKED_MESSAGE).toBe("Pick a link that isn’t locked.");
  });

  it("refuses a link back to the page: the handle host, a custom domain, any case, a trailing dot, any port", () => {
    const own = ["mara.localhost", "links.example.test"];
    for (const url of [
      "http://mara.localhost:3000/",
      "https://Mara.Localhost/x",
      "https://mara.localhost./x",
      "https://links.example.test/",
      "https://LINKS.example.test:8443/a?b=1",
    ]) {
      expect(redirectTargetIssue([link(LINK, { url })], LINK, own), url).toBe(
        REDIRECT_LOOP_MESSAGE,
      );
    }
    for (const url of [
      "https://other.localhost/",
      "https://example.test/",
      "https://evil.links.example.test/",
    ]) {
      expect(redirectTargetIssue([link(LINK, { url })], LINK, own), url).toBeNull();
    }
  });
});

describe("M9-31 the schema", () => {
  const withRedirectKey = (redirect: unknown, ...extra: unknown[]) => ({
    ...(draftWith(link(LINK), ...extra) as object),
    redirect,
  });

  it("the draft keeps any string; Publish wants a block id shape", () => {
    expect(draftDocSchema.safeParse(withRedirectKey({ linkId: "x".repeat(5000) })).success).toBe(
      true,
    );
    for (const linkId of ["../x", "a/b", "short", "a".repeat(25), "x".repeat(5000), "has space1"]) {
      const errors = collectPublishErrors(withRedirectKey({ linkId }));
      expect(errors, linkId).toEqual([
        { blockId: null, field: "redirect.linkId", message: REDIRECT_PICK_MESSAGE },
      ]);
    }
    expect(collectPublishErrors(withRedirectKey({ linkId: LINK }))).toEqual([]);
  });

  it("{linkId: {}} fails the draft parse itself and Publish names the field", () => {
    const doc = withRedirectKey({ linkId: {} });
    expect(draftDocSchema.safeParse(doc).success).toBe(false);
    expect(collectPublishErrors(doc).map((e) => e.field)).toEqual(["redirect.linkId"]);
  });

  it("unknown keys inside redirect are stripped", () => {
    const parsed = draftDocSchema.parse(
      withRedirectKey({ linkId: LINK, to: "https://evil.example" }),
    );
    expect(parsed.redirect).toEqual({ linkId: LINK });
  });

  it("the publish form writes {linkId} trimmed, and no key when it is off or empty", () => {
    const draft = (redirect: unknown) =>
      ({ ...(fullDraft as object), redirect, blocks: [link(LINK)] }) as DraftDoc;
    expect(toPublishForm(draft({ linkId: ` ${LINK} ` }), noirTokens).redirect).toEqual({
      linkId: LINK,
    });
    expect(Object.keys(toPublishForm(draft(undefined), noirTokens))).not.toContain("redirect");
    expect(Object.keys(toPublishForm(draft({ linkId: "  " }), noirTokens))).not.toContain(
      "redirect",
    );
    const stored = toPublishForm(draft({ linkId: LINK }), noirTokens);
    expect(publishedDocSchema.safeParse(stored).success).toBe(true);
    expect(publishedDocSchema.safeParse({ ...stored, redirect: { linkId: "../x" } }).success).toBe(
      false,
    );
  });
});

describe("M9-31 the Publish gate's rules (fake database)", () => {
  interface Rows {
    plan?: unknown;
    handle?: string;
    domains?: { hostname: string; status: string }[];
    failOn?: "accounts" | "pages";
  }

  function fakeAdmin(rows: Rows) {
    const reads: string[] = [];
    const client = {
      from(table: string) {
        reads.push(table);
        const result =
          rows.failOn === table
            ? { data: null, error: { message: "boom" } }
            : table === "accounts"
              ? { data: { plan: rows.plan }, error: null }
              : {
                  data: { handle: rows.handle ?? "mara", domains: rows.domains ?? [] },
                  error: null,
                };
        const chain: Record<string, unknown> = {};
        chain.select = () => chain;
        chain.eq = () => chain;
        chain.maybeSingle = async () => result;
        return chain;
      },
    };
    return { client: client as never, reads };
  }

  const formOf = (redirect: unknown, list: unknown[]): PublishDoc =>
    ({
      ...toPublishForm({ ...(fullDraft as object), blocks: [] } as unknown as DraftDoc, noirTokens),
      redirect,
      blocks: list,
    }) as PublishDoc;
  const input = (form: PublishDoc) => ({ pageId: "p", userId: "u", form, raw: {} });

  it("a page with no redirect reads nothing", async () => {
    const { client, reads } = fakeAdmin({ plan: "free" });
    expect(await checkLinkRules(client, input(formOf(undefined, [link(LINK)])))).toEqual([]);
    expect(reads).toEqual([]);
  });

  it("Free is refused with the plan sentence under the field redirect", async () => {
    const { client } = fakeAdmin({ plan: "free" });
    expect(await checkLinkRules(client, input(formOf({ linkId: LINK }, [link(LINK)])))).toEqual([
      { blockId: null, field: "redirect", message: REDIRECT_MODE_MESSAGE },
    ]);
  });

  it("an unknown or missing plan reads as Free: the gate fails closed", async () => {
    for (const plan of ["platinum", null, undefined, 3, ""]) {
      const { client } = fakeAdmin({ plan });
      const errors = await checkLinkRules(client, input(formOf({ linkId: LINK }, [link(LINK)])));
      expect(
        errors.map((e) => e.field),
        String(plan),
      ).toEqual(["redirect"]);
    }
  });

  it("Pro and Studio are accepted when the target is a link of the page", async () => {
    for (const plan of ["pro", "studio"]) {
      const { client } = fakeAdmin({ plan });
      expect(await checkLinkRules(client, input(formOf({ linkId: LINK }, [link(LINK)])))).toEqual(
        [],
      );
    }
  });

  it("Pro with a bad target: the sentence under redirect.linkId", async () => {
    const { client } = fakeAdmin({ plan: "pro" });
    const cases: [string, unknown[], string][] = [
      ["a card", [{ ...blocks.card, id: LINK }], REDIRECT_PICK_MESSAGE],
      ["no such block", [link(OTHER)], REDIRECT_PICK_MESSAGE],
      ["a social icon", [blocks.social], REDIRECT_PICK_MESSAGE],
      [
        "locked",
        [link(LINK, { lock: { kind: "code", salt: SALT, hash: HASH } })],
        REDIRECT_LOCKED_MESSAGE,
      ],
    ];
    for (const [name, list, message] of cases) {
      const target = name === "a social icon" ? blocks.social.icons[0]!.id : LINK;
      expect(await checkLinkRules(client, input(formOf({ linkId: target }, list))), name).toEqual([
        { blockId: null, field: "redirect.linkId", message },
      ]);
    }
  });

  it("refuses a target on the page's own handle host or a verified custom domain, not an unverified one", async () => {
    const own = fakeAdmin({
      plan: "pro",
      handle: "Mara",
      domains: [
        { hostname: "links.example.test", status: "verified" },
        { hostname: "pending.example.test", status: "pending" },
      ],
    });
    const looped = async (url: string) =>
      checkLinkRules(own.client, input(formOf({ linkId: LINK }, [link(LINK, { url })])));
    for (const url of ["http://mara.localhost:3000/", "https://links.example.test/x"]) {
      expect(await looped(url), url).toEqual([
        { blockId: null, field: "redirect.linkId", message: REDIRECT_LOOP_MESSAGE },
      ]);
    }
    expect(await looped("https://pending.example.test/x")).toEqual([]);
    expect(await looped("https://elsewhere.example/x")).toEqual([]);
  });

  it("a database error throws, so the gate refuses (closed)", async () => {
    await expect(
      checkLinkRules(
        fakeAdmin({ plan: "pro", failOn: "accounts" }).client,
        input(formOf({ linkId: LINK }, [link(LINK)])),
      ),
    ).rejects.toThrow();
    await expect(
      checkLinkRules(
        fakeAdmin({ plan: "pro", failOn: "pages" }).client,
        input(formOf({ linkId: LINK }, [link(LINK)])),
      ),
    ).rejects.toThrow();
  });

  it("a lock on a card is refused alongside, from the raw draft", async () => {
    const { client } = fakeAdmin({ plan: "free" });
    const raw = draftWith({ ...blocks.card, lock: { kind: "age" } });
    const errors = await checkLinkRules(client, {
      pageId: "p",
      userId: "u",
      form: formOf(undefined, []),
      raw,
    });
    expect(errors.map((e) => e.field)).toEqual(["lock"]);
  });
});

describe("M9-31 what the tenant route answers", () => {
  const PAGE = "00000000-0000-4000-8000-0000000000b1";
  const doc = (redirect: unknown, list: unknown[] = [link(LINK)]): PublishDoc =>
    ({
      ...toPublishForm({ ...(fullDraft as object), blocks: [] } as unknown as DraftDoc, noirTokens),
      ...(redirect ? { redirect } : {}),
      blocks: list,
    }) as PublishDoc;
  const answer = (document: PublishDoc, plan: string) =>
    redirectModeResponse({ pageId: PAGE, document, plan });

  it("a Pro page in redirect mode answers 302 with a relative Location built from the two ids", async () => {
    for (const plan of ["pro", "studio"]) {
      const response = answer(doc({ linkId: LINK }), plan)!;
      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toBe(`/r/${PAGE}/${LINK}`);
      expect(response.headers.get("set-cookie")).toBeNull();
      expect(await response.text()).toBe("");
    }
  });

  it("is never a 301 or a 308, and never immutable", () => {
    const response = answer(doc({ linkId: LINK }), "pro")!;
    expect([301, 308]).not.toContain(response.status);
    expect(response.headers.get("cache-control") ?? "").not.toContain("immutable");
  });

  it("a Free page, a downgraded page and a page with no redirect render normally", () => {
    expect(answer(doc({ linkId: LINK }), "free")).toBeNull();
    expect(answer(doc({ linkId: LINK }), "something-else")).toBeNull();
    expect(answer(doc(undefined), "pro")).toBeNull();
  });

  it("a target that cannot be resolved is ignored: gone, a card, a locked link, a link with a bad address", () => {
    expect(answer(doc({ linkId: "link-gone-0001" }), "pro")).toBeNull();
    expect(answer(doc({ linkId: LINK }, [{ ...blocks.card, id: LINK }]), "pro")).toBeNull();
    expect(
      answer(doc({ linkId: LINK }, [link(LINK, { lock: { kind: "age" } })]), "pro"),
    ).toBeNull();
    expect(
      answer(doc({ linkId: LINK }, [link(LINK, { url: "javascript:alert(1)" })]), "pro"),
    ).toBeNull();
    expect(redirectTargetId(doc({ linkId: LINK }), "pro")).toBe(LINK);
  });

  it("an id with a slash or a query never reaches the Location (it resolves to no block)", () => {
    for (const linkId of ["a/b", "../x", `${LINK}?to=https://evil.example`, `${LINK}/../../x`]) {
      expect(answer(doc({ linkId }), "pro")).toBeNull();
    }
  });
});

describe("M9-32 the editor", () => {
  const base = { ...(fullDraft as object), blocks: [link(LINK), link(OTHER)] } as DraftDoc;

  it("withRedirect and withoutRedirect write and remove the key, and give the same draft when nothing changes", () => {
    const on = withRedirect(base, LINK);
    expect(on.redirect).toEqual({ linkId: LINK });
    expect(withRedirect(on, LINK)).toBe(on);
    expect(withRedirect(on, OTHER).redirect).toEqual({ linkId: OTHER });
    const off = withoutRedirect(on);
    expect(Object.keys(off)).not.toContain("redirect");
    expect(withoutRedirect(off)).toBe(off);
  });

  it("the target stays available while it is a visible, unlocked link, and not when it is hidden, locked or removed", () => {
    const on = withRedirect(base, LINK);
    expect(redirectTargetAvailable(on)).toBe(true);
    expect(redirectTargetAvailable(base)).toBe(false);
    const hidden = { ...on, blocks: [link(LINK, { visible: false }), link(OTHER)] } as DraftDoc;
    const locked = {
      ...on,
      blocks: [link(LINK, { lock: { kind: "age" } }), link(OTHER)],
    } as DraftDoc;
    const removed = { ...on, blocks: [link(OTHER)] } as DraftDoc;
    for (const draft of [hidden, locked, removed])
      expect(redirectTargetAvailable(draft)).toBe(false);
    expect(REDIRECT_GONE_MESSAGE).toBe("This link is no longer available for redirect mode.");
  });

  it("a failed Publish for utm or redirect brings you to the Share tab", () => {
    for (const field of [
      "utm.source",
      "utm.medium",
      "utm.campaign",
      "redirect",
      "redirect.linkId",
    ]) {
      expect(failureTab([{ blockId: null, field, message: "x" }]), field).toBe("share");
    }
    expect(failureTab([{ blockId: "a", field: "utm.source", message: "x" }])).toBe("edit");
    expect(
      failureTab([
        { blockId: null, field: "profile.name", message: "x" },
        { blockId: null, field: "redirect", message: "x" },
      ]),
    ).toBe("edit");
  });
});
