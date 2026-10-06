import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { BLOCKED_FIELD_MESSAGE } from "@/lib/blocklist";
import { blockedFieldErrors, blockedPublishErrorHolds } from "@/lib/blocklist/fields";
import { blockDefaults, emptyDraft, type Block, type DraftDoc } from "@/lib/document";
import {
  AUTOSAVE_DEBOUNCE_MS,
  AutosaveQueue,
  type BlockedSave,
  type SaveFn,
  type SaveResult,
  type SaveStatus,
} from "@/lib/editor/autosave";
import { BLOCKED_PUBLISH_DISABLED_REASON, blockedSaveMessage } from "@/lib/editor/messages";
import { reconcileErrors } from "@/lib/editor/state";
import { SaveBanner, saveProblemFor } from "@/components/editor/save-banner";
import { PublishAlert } from "@/components/editor/publish-alert";

/**
 * M5-03, the Editor half: what the browser-side write reports for the database's refusal of a link
 * to a blocked site (SQLSTATE HL005), how the autosave queue treats it (a state of its own, never
 * retried, but the very next edit is written, and a refusal that arrives after the user has typed
 * on is not shown), and which fields show the error.
 */

vi.mock("@/lib/env/client", () => ({
  clientEnv: {
    NEXT_PUBLIC_ROOT_DOMAIN: "localhost:3000",
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
  },
}));

// The row summary comes through the editor's contracts module, which also pulls in the publish
// Server Action; the alert only needs the title of a block.
vi.mock("server-only", () => ({}));
vi.mock("@/lib/editor/contracts", () => ({
  blockRowSummary: () => ({ title: "Link", typeLabel: "Link", sub: "" }),
}));

// The browser-side saver ---------------------------------------------------------------------------

type Answer = {
  data: { id: string }[] | null;
  error: { code?: string; message?: string; details?: string; hint?: string } | null;
  status: number;
};
let answer: Answer;
const builder: Record<string, unknown> = {};
for (const name of ["update", "eq", "is"]) builder[name] = vi.fn(() => builder);
builder.select = vi.fn(async () => answer);
vi.mock("@/lib/supabase/browser", () => ({
  createBrowserSupabase: () => ({ from: () => builder }),
}));

const { createDraftSaver } = await import("@/lib/editor/save-client");

const draft = (blocks: Block[] = [], name = "mara"): DraftDoc => ({
  ...emptyDraft("mara"),
  rev: 4,
  profile: { name, bio: "", photo: null },
  blocks,
});
const link = (id: string, url: string): Block => ({ ...blockDefaults.link(), id, url }) as Block;

describe("M5-03 createDraftSaver maps the database's refusal", () => {
  it("HL005 (HTTP 400) is `blocked`, with the hosts and the block ids the database named", async () => {
    answer = {
      data: null,
      error: {
        code: "HL005",
        message: "blocked_link",
        details: "blocked.example, 127.0.0.1",
        hint: "lnk000000001,lnk000000002",
      },
      status: 400,
    };
    expect(await createDraftSaver("p1")(draft(), "3")).toEqual({
      kind: "blocked",
      hosts: ["blocked.example", "127.0.0.1"],
      blockIds: ["lnk000000001", "lnk000000002"],
    });
  });

  it("matches on the message too, and an HL005 with no detail is still `blocked`", async () => {
    answer = { data: null, error: { message: "blocked_link" }, status: 400 };
    expect(await createDraftSaver("p1")(draft(), "3")).toEqual({
      kind: "blocked",
      hosts: [],
      blockIds: [],
    });
  });

  it("other refusals keep their meaning: 23514 is too-large, a 500 is a retryable error, a 401 is signed out", async () => {
    answer = { data: null, error: { code: "23514", message: "check" }, status: 400 };
    expect(await createDraftSaver("p1")(draft(), "3")).toEqual({ kind: "too-large" });
    answer = { data: null, error: { code: "XX000", message: "boom" }, status: 500 };
    expect(await createDraftSaver("p1")(draft(), "3")).toEqual({ kind: "error" });
    answer = { data: null, error: { code: "PGRST301", message: "JWT expired" }, status: 401 };
    expect(await createDraftSaver("p1")(draft(), "3")).toEqual({ kind: "unauthorized" });
  });
});

// The queue ----------------------------------------------------------------------------------------

function setup(results: SaveResult[] = []) {
  const calls: DraftDoc[] = [];
  const statuses: SaveStatus[] = [];
  const blockedSeen: (BlockedSave | null)[] = [];
  const queued = [...results];
  const save: SaveFn = vi.fn(async (doc): Promise<SaveResult> => {
    calls.push(doc);
    return queued.shift() ?? { kind: "ok" };
  });
  const queue = new AutosaveQueue({
    save,
    onStatus: (status) => statuses.push(status),
    onBlocked: (blocked) => blockedSeen.push(blocked),
    initial: { rev: 3, revKey: "3" },
  });
  return { queue, calls, statuses, blockedSeen };
}
const refusal = (hosts: string[], blockIds: string[] = []): SaveResult => ({
  kind: "blocked",
  hosts,
  blockIds,
});

describe("M5-03 the autosave queue and a blocked link", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("goes to `blocked`, names the hosts and the refused draft, and never retries on a timer", async () => {
    const { queue, calls, statuses, blockedSeen } = setup([refusal(["blocked.example"], ["a"])]);
    const sent = draft([link("lnk000000001", "https://blocked.example/x")]);
    queue.schedule(sent);
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS + 10);
    expect(statuses).toEqual(["pending", "saving", "blocked"]);
    expect(queue.status).toBe("blocked");
    expect(queue.blocked).toEqual({ hosts: ["blocked.example"], blockIds: ["a"], draft: sent });
    expect(blockedSeen).toHaveLength(1);

    // The backoff for a failed write is 1 s, 2 s, 4 s, 5 s ...: a loop would show in a minute.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls).toHaveLength(1);
    expect(queue.hasUnsaved).toBe(true);
  });

  it("the next edit is written like any other, and a good save clears the refusal (Saved again)", async () => {
    const { queue, calls, statuses, blockedSeen } = setup([refusal(["blocked.example"])]);
    queue.schedule(draft([link("lnk000000001", "https://blocked.example/x")]));
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS + 10);
    expect(queue.status).toBe("blocked");

    queue.schedule(draft([link("lnk000000001", "https://ok.example/x")]));
    expect(queue.status).toBe("pending");
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS + 10);
    expect(calls).toHaveLength(2);
    expect(statuses.slice(-3)).toEqual(["pending", "saving", "saved"]);
    expect(queue.blocked).toBeNull();
    expect(blockedSeen.at(-1)).toBeNull();
  });

  it("an edit that is refused again replaces the refusal (the field that still points at a blocked host)", async () => {
    const { queue, blockedSeen } = setup([refusal(["a.example"]), refusal(["b.example"])]);
    queue.schedule(draft([link("lnk000000001", "https://a.example/")]));
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS + 10);
    queue.schedule(draft([link("lnk000000001", "https://b.example/")]));
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS + 10);
    expect(queue.status).toBe("blocked");
    expect(blockedSeen.map((b) => b?.hosts)).toEqual([["a.example"], ["b.example"]]);
  });

  it("a refusal that arrives after the user typed on is not shown: it is about a draft that is out of date", async () => {
    // https://exam is refused (no dot in the host) while the user is already typing the rest.
    let release: (result: SaveResult) => void = () => {};
    const gate = new Promise<SaveResult>((resolve) => (release = resolve));
    const calls: DraftDoc[] = [];
    const statuses: SaveStatus[] = [];
    const save: SaveFn = vi.fn(async (doc): Promise<SaveResult> => {
      calls.push(doc);
      return calls.length === 1 ? gate : { kind: "ok" };
    });
    const queue = new AutosaveQueue({
      save,
      onStatus: (status) => statuses.push(status),
      initial: { rev: 3, revKey: "3" },
    });
    queue.schedule(draft([link("lnk000000001", "https://exam")]));
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS + 10);
    expect(statuses.at(-1)).toBe("saving");

    queue.schedule(draft([link("lnk000000001", "https://example.com/")])); // typed on, mid flight
    release(refusal(["exam"]));
    await vi.advanceTimersByTimeAsync(0);
    expect(statuses).not.toContain("blocked");
    expect(queue.blocked).toBeNull();
    expect(queue.status).toBe("pending");

    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS + 10);
    expect(calls).toHaveLength(2);
    expect(queue.status).toBe("saved");
    expect(statuses).not.toContain("blocked");
  });

  it("flush resolves false while a link is blocked and sends nothing again: no wasted 400, no flicker of the banner", async () => {
    const { queue, calls, statuses, blockedSeen } = setup([refusal(["blocked.example"])]);
    queue.schedule(draft([link("lnk000000001", "https://blocked.example/x")]));
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS + 10);
    expect(queue.status).toBe("blocked");
    const before = { calls: calls.length, statuses: [...statuses], seen: blockedSeen.length };
    expect(await queue.flush()).toBe(false);
    expect(await queue.flush()).toBe(false); // a tab hide, then pagehide, then unmount
    expect(calls).toHaveLength(before.calls);
    expect(statuses).toEqual(before.statuses);
    expect(blockedSeen).toHaveLength(before.seen);
    expect(queue.status).toBe("blocked");

    // An edit brings the queue back to life, and a flush then writes the new draft.
    queue.schedule(draft([link("lnk000000001", "https://ok.example/x")]));
    expect(await queue.flush()).toBe(true);
    expect(calls).toHaveLength(before.calls + 1);
    expect(queue.blocked).toBeNull();
  });

  it("a refusal that arrives while the status was `error` cancels the retry timer and settles on blocked", async () => {
    const { queue, calls } = setup([{ kind: "error" }, refusal(["blocked.example"])]);
    queue.schedule(draft([link("lnk000000001", "https://blocked.example/x")]));
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS + 10);
    expect(queue.status).toBe("error");
    await vi.advanceTimersByTimeAsync(1_100); // the first backoff: the retry is refused
    expect(queue.status).toBe("blocked");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls).toHaveLength(2);
  });
});

// Which fields show the error -----------------------------------------------------------------------

describe("M5-03 blockedFieldErrors", () => {
  const social = (url: string): Block =>
    ({
      ...blockDefaults.social(),
      id: "soc000000001",
      icons: [
        { id: "ico000000001", platform: "email", address: "a@example.com" },
        { id: "ico000000002", platform: "instagram", url },
      ],
    }) as Block;
  const grid = (url: string): Block =>
    ({
      ...blockDefaults.grid(),
      id: "grd000000001",
      cells: [
        { id: "cel000000001", title: "One", subtitle: "", url: "https://ok.example/" },
        { id: "cel000000002", title: "Two", subtitle: "", url },
      ],
    }) as Block;
  const info = (hosts: string[], blockIds: string[] = []) => ({ hosts, blockIds });

  it("is empty with no refusal", () => {
    expect(blockedFieldErrors(draft([link("a", "https://blocked.example/")]), null)).toEqual([]);
  });

  it("marks every URL field that still points at a refused host: link, social icon and grid cell, with the item id", () => {
    const d = draft([
      link("lnk000000001", "https://BLOCKED.example./x"),
      link("lnk000000002", "https://ok.example/"),
      social("https://www.instagram.com/"),
      grid("https://blocked.example:8443/y"),
    ]);
    expect(blockedFieldErrors(d, info(["blocked.example"]))).toEqual([
      { blockId: "lnk000000001", field: "url", message: BLOCKED_FIELD_MESSAGE },
      {
        blockId: "grd000000001",
        itemId: "cel000000002",
        field: "url",
        message: BLOCKED_FIELD_MESSAGE,
      },
    ]);
    const s = draft([social("https://blocked.example/me")]);
    expect(blockedFieldErrors(s, info(["blocked.example"]))).toEqual([
      {
        blockId: "soc000000001",
        itemId: "ico000000002",
        field: "url",
        message: BLOCKED_FIELD_MESSAGE,
      },
    ]);
  });

  it("finds the URL of a card, an embed and an image block too", () => {
    const card = {
      ...blockDefaults.card(),
      id: "crd000000001",
      url: "https://blocked.example/c",
    } as Block;
    const embed = {
      ...blockDefaults.embed(),
      id: "emb000000001",
      url: "https://blocked.example/e",
    } as Block;
    const image = {
      ...blockDefaults.image(),
      id: "img000000001",
      url: "https://blocked.example/i",
    } as Block;
    const bare = { ...blockDefaults.image(), id: "img000000002", url: "" } as Block;
    expect(
      blockedFieldErrors(draft([card, embed, image, bare]), info(["blocked.example"])),
    ).toEqual([
      { blockId: "crd000000001", field: "url", message: BLOCKED_FIELD_MESSAGE },
      { blockId: "emb000000001", field: "url", message: BLOCKED_FIELD_MESSAGE },
      { blockId: "img000000001", field: "url", message: BLOCKED_FIELD_MESSAGE },
    ]);
  });

  it("clears the moment the address changes, without waiting for the next save", () => {
    const refused = draft([link("lnk000000001", "https://blocked.example/x")]);
    expect(blockedFieldErrors(refused, info(["blocked.example"]))).toHaveLength(1);
    const fixed = draft([link("lnk000000001", "https://ok.example/x")]);
    expect(blockedFieldErrors(fixed, info(["blocked.example"]))).toEqual([]);
  });

  it("falls back to the block ids the database named only for the very draft that was refused", () => {
    const refused = draft([link("lnk000000001", "not a url at all")]);
    const fallback = blockedFieldErrors(refused, {
      ...info(["weird"], ["lnk000000001"]),
      draft: refused,
    });
    expect(fallback).toEqual([
      { blockId: "lnk000000001", field: "url", message: BLOCKED_FIELD_MESSAGE },
    ]);
    // A later draft (anything edited since) no longer carries the fallback.
    const later = { ...refused, profile: { ...refused.profile, name: "typed" } };
    expect(
      blockedFieldErrors(later, { ...info(["weird"], ["lnk000000001"]), draft: refused }),
    ).toEqual([]);
  });
});

describe("M5-03 a failed Publish's blocked-link errors on icons and cells", () => {
  it("keep their itemId, hold while that icon or cell still points at the host, and go when only it changes", () => {
    const grid = {
      ...blockDefaults.grid(),
      id: "grd000000001",
      cells: [
        { id: "cel000000001", title: "One", subtitle: "", url: "https://blocked.example/a" },
        { id: "cel000000002", title: "Two", subtitle: "", url: "https://blocked.example/b" },
      ],
    } as Block;
    const errors = [
      {
        blockId: "grd000000001",
        itemId: "cel000000002",
        field: "url",
        message: BLOCKED_FIELD_MESSAGE,
        host: "blocked.example",
      },
    ];
    const d = draft([grid]);
    expect(blockedPublishErrorHolds(d, errors[0]!)).toBe(true);
    // Another cell of the block changing does not clear this one's error ...
    const otherChanged = draft([
      {
        ...grid,
        cells: [
          { ...(grid as { cells: { id: string }[] }).cells[0]!, url: "https://ok.example/" },
          (grid as { cells: unknown[] }).cells[1],
        ],
      } as Block,
    ]);
    expect(reconcileErrors(errors, otherChanged)).toEqual(errors);
    // ... and this cell changing does.
    const thisChanged = draft([
      {
        ...grid,
        cells: [
          (grid as { cells: unknown[] }).cells[0],
          { ...(grid as { cells: { id: string }[] }).cells[1]!, url: "https://ok.example/" },
        ],
      } as Block,
    ]);
    expect(reconcileErrors(errors, thisChanged)).toEqual([]);
  });
});

describe("M5-03 a failed Publish's blocked-link errors in the editor state", () => {
  const publishError = (host: string) => ({
    blockId: "lnk000000001",
    field: "url",
    message: BLOCKED_FIELD_MESSAGE,
    host,
  });

  it("stay while the field still points at the host, and go when the address changes", () => {
    const refused = draft([link("lnk000000001", "https://blocked.example/x")]);
    const errors = [publishError("blocked.example")];
    expect(blockedPublishErrorHolds(refused, errors[0]!)).toBe(true);
    expect(reconcileErrors(errors, refused)).toBe(errors);
    // An edit somewhere else keeps it (the draft schema does not know about the blocklist) ...
    const edited = { ...refused, profile: { ...refused.profile, name: "typed" } };
    expect(reconcileErrors(errors, edited)).toEqual(errors);
    // ... and a changed address clears it.
    const fixed = draft([link("lnk000000001", "https://ok.example/x")]);
    expect(reconcileErrors(errors, fixed)).toEqual([]);
    // A deleted block clears it too.
    expect(reconcileErrors(errors, draft([]))).toEqual([]);
  });
});

// Copy and banners ---------------------------------------------------------------------------------

describe("M5-03 what the editor says", () => {
  it("the banner names the hosts, says it is not saved, and is never the retry sentence", () => {
    const problem = saveProblemFor("blocked", false, ["blocked.example", "other.example"]);
    expect(problem).toEqual({
      kind: "blocked",
      message:
        "Not saved. A link on this page points to a blocked site: blocked.example, other.example. Remove or change it.",
    });
    expect(problem!.message).not.toMatch(/retry/i);
    expect(blockedSaveMessage([])).toBe(
      "Not saved. A link on this page points to a blocked site. Remove or change it.",
    );
    // A suspended owner's refused writes are explained by the suspension, not by a blocked link.
    expect(saveProblemFor("blocked", true, ["x.example"])!.kind).toBe("blocked");
  });

  it("the Design screen's banner also links to the Editor, where the URL fields are; the Editor's own does not", () => {
    const html = (editorLink: boolean) =>
      renderToStaticMarkup(
        createElement(SaveBanner, {
          status: "blocked",
          blockedHosts: ["blocked.example"],
          editorLink,
        }),
      );
    expect(html(true)).toContain('href="/editor"');
    expect(html(true)).toContain("Open Editor");
    expect(html(false)).not.toContain("Open Editor");
    // A very long host wraps instead of pushing the page wider than the phone.
    const long = `${"a".repeat(80)}.blocked.example`;
    const wrapped = renderToStaticMarkup(
      createElement(SaveBanner, { status: "blocked", blockedHosts: [long] }),
    );
    expect(wrapped).toContain("[overflow-wrap:anywhere]");
    expect(wrapped).toContain("min-w-0");
    const alert = renderToStaticMarkup(
      createElement(PublishAlert, {
        blocks: [link("lnk000000001", `https://${long}/`)],
        errors: [
          { blockId: "lnk000000001", field: "url", message: BLOCKED_FIELD_MESSAGE, host: long },
        ] as never,
      }),
    );
    expect(alert).toContain("[overflow-wrap:anywhere]");
  });

  it("Publish's reason for being off says what to do", () => {
    expect(BLOCKED_PUBLISH_DISABLED_REASON).toMatch(/blocked site/);
    expect(BLOCKED_PUBLISH_DISABLED_REASON).toMatch(/Remove or change/);
  });

  it("the Publish alert reads 'Can’t publish. 1 link points to a blocked site: host. Remove or change it.'", () => {
    const blocks = [link("lnk000000001", "https://blocked.example/x")];
    const html = renderToStaticMarkup(
      createElement(PublishAlert, {
        blocks,
        errors: [
          {
            blockId: "lnk000000001",
            field: "url",
            message: BLOCKED_FIELD_MESSAGE,
            host: "blocked.example",
          },
        ] as never,
      }),
    );
    expect(html).toContain(
      "Can’t publish. 1 link points to a blocked site: blocked.example. Remove or change it.",
    );
    expect(html).not.toContain("before publishing");

    const two = renderToStaticMarkup(
      createElement(PublishAlert, {
        blocks: [...blocks, link("lnk000000002", "https://b.example/")],
        errors: [
          {
            blockId: "lnk000000001",
            field: "url",
            message: BLOCKED_FIELD_MESSAGE,
            host: "blocked.example",
          },
          {
            blockId: "lnk000000002",
            field: "url",
            message: BLOCKED_FIELD_MESSAGE,
            host: "b.example",
          },
        ] as never,
      }),
    );
    expect(two).toContain(
      "Can’t publish. 2 links point to blocked sites: b.example, blocked.example. Remove or change them.",
    );
  });

  it("an ordinary publish failure still reads 'Fix 1 block before publishing.'", () => {
    const html = renderToStaticMarkup(
      createElement(PublishAlert, {
        blocks: [link("lnk000000001", "")],
        errors: [
          {
            blockId: "lnk000000001",
            field: "url",
            message: "Enter a full web address, like https://example.com.",
          },
        ],
      }),
    );
    expect(html).toContain("Fix 1 block before publishing.");
  });
});
