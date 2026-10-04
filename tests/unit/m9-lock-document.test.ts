import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { PageRenderer } from "@/components/page/page-renderer";
import {
  LOCK_CODE_MESSAGE,
  LOCK_ONLY_ON_LINKS_MESSAGE,
  LOCK_SET_CODE_MESSAGE,
  LOCK_SHORT_NUMBER_WARNING,
  collectPublishErrors,
  draftDocSchema,
  isLockShape,
  lockCodeError,
  lockCodeWarning,
  lockMarker,
  normalizeLockCode,
  publishLock,
  publishedDocSchema,
  redactLock,
  toPublishForm,
  type DraftDoc,
  type PublishDoc,
} from "@/lib/document";
import { sanitizeSharedDoc } from "@/lib/previews/sanitize";
import { tenantInlineCss } from "@/lib/tenant-assets";
import { misplacedLockErrors } from "@/lib/publish/link-rules";
import { blocks, draftWith, fullDraft, noirTokens } from "./fixtures/page-document";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/media/url", () => ({
  mediaUrl: (path: string) => `https://media.test/page-media/${path}`,
}));
vi.mock("@/lib/env/client", () => ({
  clientEnv: {
    NEXT_PUBLIC_ROOT_DOMAIN: "localhost:3000",
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
  },
}));

/**
 * M9-29, M9-30 the link lock in the document: the shape and its patterns, the draft and Publish
 * rules, the code's normal form, the publish form, what the page markup carries (a marker, no
 * destination, no salt or hash), the CSS that goes with it and what the share link strips.
 */

const SALT = "AAAAAAAAAAAAAAAAAAAAAA"; // 22 base64url characters
const HASH = "B".repeat(43);
const PAGE_ID = "00000000-0000-4000-8000-0000000000b1";

const lockedLink = (lock: unknown, extra: Record<string, unknown> = {}) => ({
  ...blocks.link,
  lock,
  ...extra,
});

describe("M9-29 the shape", () => {
  it("accepts an age lock and a code lock with a 22 and a 43 character base64url salt and hash", () => {
    expect(isLockShape({ kind: "age" })).toBe(true);
    expect(isLockShape({ kind: "code", salt: SALT, hash: HASH })).toBe(true);
    expect(isLockShape({ kind: "code", salt: "a-_".repeat(7) + "a", hash: "z".repeat(43) })).toBe(
      true,
    );
  });

  it.each([
    ["no kind", {}],
    ["kind pin", { kind: "pin" }],
    ["a code lock with no hash", { kind: "code", salt: SALT }],
    ["a code lock with no salt", { kind: "code", hash: HASH }],
    ["a 21 character salt", { kind: "code", salt: SALT.slice(1), hash: HASH }],
    ["a 44 character hash", { kind: "code", salt: SALT, hash: HASH + "B" }],
    ["a 5,000 character hash", { kind: "code", salt: SALT, hash: "B".repeat(5000) }],
    ["a salt with a + sign", { kind: "code", salt: "+".repeat(22), hash: HASH }],
    ["a hash with a newline", { kind: "code", salt: SALT, hash: "B".repeat(42) + "\n" }],
    ["null", null],
    ["a string", "age"],
  ])("refuses %s", (_name, value) => {
    expect(isLockShape(value)).toBe(false);
  });

  it("the marker is only ever the two known words", () => {
    expect(lockMarker({ kind: "age" })).toBe("age");
    expect(lockMarker({ kind: "code" })).toBe("code");
    expect(lockMarker({ kind: "code", salt: SALT, hash: HASH })).toBe("code");
    for (const value of [undefined, null, {}, { kind: "pin" }, { kind: 1 }, "age", []]) {
      expect(lockMarker(value)).toBeNull();
    }
  });
});

describe("M9-29 the code's normal form", () => {
  it("is NFKC, trimmed and lower-cased", () => {
    expect(normalizeLockCode("Spring2026")).toBe("spring2026");
    expect(normalizeLockCode("  spring2026 \n")).toBe("spring2026");
    expect(normalizeLockCode("ＳＰＲＩＮＧ２０２６")).toBe("spring2026");
    expect(normalizeLockCode("ﬁnale")).toBe("finale");
  });

  it("allows 4 to 32 characters with no whitespace, control or bidi characters", () => {
    for (const ok of [
      "abcd",
      "Spring2026",
      "a".repeat(32),
      "  trim-me  ",
      "pässwörd",
      "12 34".replace(" ", ""),
    ]) {
      expect(lockCodeError(ok), ok).toBeNull();
    }
    for (const bad of [
      "abc",
      "a".repeat(33),
      "has space",
      "tab\there",
      "new\nline",
      "bidi‮abc",
      "zero​width",
      "",
      "    ",
      "\u0000abcd",
    ]) {
      expect(lockCodeError(bad), JSON.stringify(bad)).toBe(LOCK_CODE_MESSAGE);
    }
    expect(lockCodeError(1234)).toBe(LOCK_CODE_MESSAGE);
    expect(lockCodeError(undefined)).toBe(LOCK_CODE_MESSAGE);
  });

  it("counts code points, and judges the normal form (a compatibility letter is shorter)", () => {
    expect(lockCodeError("😀😀😀😀")).toBeNull();
    expect(lockCodeError("😀".repeat(33))).toBe(LOCK_CODE_MESSAGE);
    expect(lockCodeError("ﬃ".repeat(11))).toBe(LOCK_CODE_MESSAGE); // 11 x "ffi" = 33
    expect(lockCodeError("ﬃ".repeat(10))).toBeNull();
  });
});

describe("M9-30 the short number warning (a hint, never an error)", () => {
  it("warns about a code of digits only that is shorter than 6: a PIN has few values to guess", () => {
    for (const short of ["1234", "12345", " 1234 ", "０１２３"]) {
      expect(lockCodeWarning(short), JSON.stringify(short)).toBe(LOCK_SHORT_NUMBER_WARNING);
    }
    expect(LOCK_SHORT_NUMBER_WARNING).toBe(
      "A short number is easy to guess. Use 6 or more characters, or add letters.",
    );
  });

  it("is quiet for 6 or more digits, for a code with a letter, and for a code that has no digits", () => {
    for (const fine of [
      "123456",
      "1234567890",
      "abcd",
      "ab12",
      "1234a",
      "pässwörd",
      "Spring2026",
    ]) {
      expect(lockCodeWarning(fine), fine).toBeNull();
    }
  });

  it("leaves a code the rule already refuses to the error, and never blocks one: the rule is unchanged", () => {
    for (const refused of ["", "12", "123", "12 34", "1".repeat(33), 1234, undefined, null]) {
      expect(lockCodeWarning(refused), JSON.stringify(refused)).toBeNull();
    }
    // The short number is still a valid code: 'Set code' accepts it.
    expect(lockCodeError("1234")).toBeNull();
    expect(lockCodeError("12345")).toBeNull();
  });
});

describe("M9-29 the schema, draft and Publish", () => {
  it("a draft keeps a half-set lock (a code lock without a hash saves) and any strings", () => {
    expect(draftDocSchema.safeParse(draftWith(lockedLink({ kind: "code" }))).success).toBe(true);
    expect(draftDocSchema.safeParse(draftWith(lockedLink({ kind: "age" }))).success).toBe(true);
    expect(
      draftDocSchema.safeParse(
        draftWith(lockedLink({ kind: "code", salt: "x", hash: "y".repeat(5000) })),
      ).success,
    ).toBe(true);
    expect(draftDocSchema.safeParse(draftWith(lockedLink({ kind: "pin" }))).success).toBe(true);
  });

  it("Publish accepts an age lock and a complete code lock", () => {
    expect(collectPublishErrors(draftWith(lockedLink({ kind: "age" })))).toEqual([]);
    expect(
      collectPublishErrors(draftWith(lockedLink({ kind: "code", salt: SALT, hash: HASH }))),
    ).toEqual([]);
  });

  it("Publish refuses a code lock with no usable hash: 'Set a code for this lock.' under the field lock", () => {
    for (const lock of [
      { kind: "code" },
      { kind: "code", salt: SALT },
      { kind: "code", salt: SALT, hash: "B".repeat(5000) },
      { kind: "code", salt: "short", hash: HASH },
    ]) {
      const errors = collectPublishErrors(draftWith(lockedLink(lock)));
      expect(errors).toEqual([
        { blockId: blocks.link.id, field: "lock", message: LOCK_SET_CODE_MESSAGE },
      ]);
    }
  });

  it("Publish refuses kind:'pin' with the field named", () => {
    const errors = collectPublishErrors(draftWith(lockedLink({ kind: "pin" })));
    expect(errors.map((e) => `${e.blockId}|${e.field}`)).toEqual([`${blocks.link.id}|lock`]);
  });

  it("a hidden block holding a bad lock does not stop Publish", () => {
    const doc = draftWith(
      lockedLink({ kind: "pin", hash: "B".repeat(5000) }, { visible: false }),
      blocks.header,
    );
    expect(collectPublishErrors(doc)).toEqual([]);
  });

  it("a lock on a card (any block that is not a link) is stripped by the schema and refused by the gate's raw check", () => {
    const doc = draftWith(
      { ...blocks.card, lock: { kind: "age" } },
      { ...blocks.header, lock: { kind: "age" } },
    );
    expect(collectPublishErrors(doc)).toEqual([]); // the schema strips it
    expect(JSON.stringify(draftDocSchema.parse(doc))).not.toContain('"lock"');
    expect(misplacedLockErrors(doc)).toEqual([
      { blockId: blocks.card.id, field: "lock", message: LOCK_ONLY_ON_LINKS_MESSAGE },
      { blockId: blocks.header.id, field: "lock", message: LOCK_ONLY_ON_LINKS_MESSAGE },
    ]);
  });

  it("the raw check ignores a link, a hidden block and garbage", () => {
    expect(misplacedLockErrors(draftWith(lockedLink({ kind: "age" })))).toEqual([]);
    expect(
      misplacedLockErrors(draftWith({ ...blocks.card, visible: false, lock: { kind: "age" } })),
    ).toEqual([]);
    for (const raw of [null, 5, "x", {}, { blocks: 5 }, { blocks: [null, 3, "x"] }]) {
      expect(misplacedLockErrors(raw)).toEqual([]);
    }
  });

  it("unknown keys inside a lock are stripped (a draft keeps an age lock's stray strings, the publish form does not)", () => {
    const parsed = draftDocSchema.parse(
      draftWith(lockedLink({ kind: "age", pin: "1234", hash: HASH })),
    );
    expect(Object.keys((parsed.blocks[0] as { lock: object }).lock).sort()).toEqual([
      "hash",
      "kind",
    ]);
    const form = toPublishForm(parsed as DraftDoc, noirTokens);
    expect((form.blocks[0] as { lock?: unknown }).lock).toEqual({ kind: "age" });
  });
});

describe("M9-29 the publish form", () => {
  const draftOf = (lock: unknown): DraftDoc =>
    ({ ...(fullDraft as object), blocks: [lockedLink(lock)] }) as DraftDoc;

  it("writes an age lock, a complete code lock, and nothing else", () => {
    const get = (lock: unknown) =>
      (toPublishForm(draftOf(lock), noirTokens).blocks[0] as { lock?: unknown }).lock;
    expect(get({ kind: "age" })).toEqual({ kind: "age" });
    expect(get({ kind: "code", salt: SALT, hash: HASH, extra: 1 })).toEqual({
      kind: "code",
      salt: SALT,
      hash: HASH,
    });
    expect(get({ kind: "code" })).toBeUndefined();
    expect(get({ kind: "code", salt: SALT, hash: "short" })).toBeUndefined();
    expect(get({ kind: "pin" })).toBeUndefined();
    expect(get(undefined)).toBeUndefined();
    expect(publishLock({ kind: "age", salt: SALT })).toEqual({ kind: "age" });
  });

  it("the stored form parses with the published schema", () => {
    const form = toPublishForm(draftOf({ kind: "code", salt: SALT, hash: HASH }), noirTokens);
    expect(publishedDocSchema.safeParse(form).success).toBe(true);
    const tampered = structuredClone(form) as { blocks: { lock?: unknown }[] };
    tampered.blocks[0]!.lock = { kind: "code", salt: SALT, hash: "short" };
    expect(publishedDocSchema.safeParse(tampered).success).toBe(false);
  });

  it("redactLock keeps the kind and empties the salt and hash", () => {
    expect(redactLock({ kind: "age" })).toEqual({ kind: "age" });
    expect(redactLock({ kind: "code", salt: SALT, hash: HASH })).toEqual({
      kind: "code",
      salt: "",
      hash: "",
    });
    expect(redactLock({ kind: "code" })).toEqual({ kind: "code", salt: "", hash: "" });
    expect(redactLock(undefined)).toBeUndefined();
  });
});

describe("M9-30 the markup", () => {
  const form = (lock: unknown, label = "Private portfolio"): PublishDoc =>
    toPublishForm(
      {
        ...(fullDraft as object),
        blocks: [lockedLink(lock, { label, url: "https://secret.example/vault" })],
      } as DraftDoc,
      noirTokens,
    );
  const html = (doc: PublishDoc, mode: "live" | "preview", thumbnail = false) =>
    renderToStaticMarkup(
      createElement(PageRenderer, {
        doc,
        pageId: PAGE_ID,
        mode,
        ...(thumbnail ? { thumbnail } : {}),
      }),
    );

  const code = form({ kind: "code", salt: SALT, hash: HASH });
  const age = form({ kind: "age" });

  it("live: keeps the /r/ href and gains data-locked, a padlock and the hidden words", () => {
    const out = html(age, "live");
    expect(out).toContain(`href="/r/${PAGE_ID}/${blocks.link.id}"`);
    expect(out).toContain('data-locked="age"');
    expect(out).toContain('class="pg-link pg-lock"');
    expect(out).toContain('<span class="pg-lock-text"> (sensitive content)</span>');
    expect(out).toMatch(/<svg class="pg-lock-glyph"[^>]*aria-hidden="true"/);
    expect(html(code, "live")).toContain('data-locked="code"');
    expect(html(code, "live")).toContain("> (locked)</span>");
  });

  it("the glyph is an inline 16px currentColor outline, not a library component", () => {
    const out = html(age, "live");
    const svg = /<svg class="pg-lock-glyph"[\s\S]*?<\/svg>/.exec(out)![0];
    expect(svg).toContain('width="16"');
    expect(svg).toContain('height="16"');
    expect(svg).toContain('stroke="currentColor"');
    expect(svg).toContain('fill="none"');
    expect(svg).toContain('focusable="false"');
  });

  it("never carries the destination, the salt, the hash or the plaintext", () => {
    for (const doc of [code, age]) {
      for (const mode of ["live", "preview"] as const) {
        const out = html(doc, mode);
        expect(out).not.toContain("secret.example");
        expect(out).not.toContain(SALT);
        expect(out).not.toContain(HASH);
      }
    }
  });

  it("preview and thumbnail: the marker and no href at all", () => {
    for (const out of [html(code, "preview"), html(age, "preview")]) {
      expect(out).toContain("data-locked=");
      expect(out).toContain("pg-lock-glyph");
      // The anchor is there (a link, inert) and has no href of any kind.
      const anchor = /<a [^>]*data-block-id="link-portraits"[^>]*>/.exec(out)![0];
      expect(anchor).not.toContain("href=");
      expect(anchor).toContain('rel="nofollow noopener"');
    }
    const thumb = html(age, "preview", true);
    expect(thumb).toContain('data-locked="age"');
    expect(thumb).not.toMatch(/<a /);
    expect(thumb).toMatch(/<div class="pg-link pg-lock"[^>]*data-locked="age"/);
  });

  it("an unlocked link and a page with no lock are byte-identical to before: no class, no attribute, no glyph", () => {
    const plain = toPublishForm(
      { ...(fullDraft as object), blocks: [blocks.link] } as DraftDoc,
      noirTokens,
    );
    for (const mode of ["live", "preview"] as const) {
      const out = html(plain, mode);
      expect(out).not.toContain("data-locked");
      expect(out).not.toContain("pg-lock");
    }
    expect(html(plain, "live")).toContain('class="pg-link"');
  });

  it("a hostile label is text next to the glyph", () => {
    const out = html(form({ kind: "age" }, "<img src=x onerror=alert(1)>"), "live");
    expect(out).not.toContain("<img src=x");
    expect(out).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });

  it("a lock of an unknown kind draws nothing (a stored value that bypassed Publish)", () => {
    const doc = structuredClone(age) as { blocks: { lock?: unknown }[] };
    doc.blocks[0]!.lock = { kind: "pin" };
    const out = html(doc as unknown as PublishDoc, "live");
    expect(out).not.toContain("data-locked");
    expect(out).not.toContain("pg-lock");
  });

  it("the CSS of the marker is in the page's <style> only when a locked link exists", () => {
    const withLock = tenantInlineCss(age);
    const without = tenantInlineCss(form(undefined));
    expect(withLock).toContain("pg-lock-glyph");
    expect(withLock).toContain("pg-lock-text");
    expect(withLock).toContain(".pg-lock");
    expect(without).not.toContain("pg-lock");
    // A page with no lock at all (here a text block only) never carries it either.
    const text = toPublishForm(
      { ...(fullDraft as object), blocks: [blocks.text] } as DraftDoc,
      noirTokens,
    );
    expect(tenantInlineCss(text)).not.toContain("pg-lock");
    // A lock of a block that is not a link does not count.
    const card = structuredClone(text) as { blocks: { lock?: unknown }[] };
    card.blocks[0]!.lock = { kind: "age" };
    expect(tenantInlineCss(card as unknown as PublishDoc)).not.toContain("pg-lock");
  });
});

describe("M9-29 the share link", () => {
  it("strips the salt and the hash and keeps the kind, so the shared page draws the padlock and no href", () => {
    const doc = toPublishForm(
      {
        ...(fullDraft as object),
        blocks: [lockedLink({ kind: "code", salt: SALT, hash: HASH }), blocks.link],
      } as DraftDoc,
      noirTokens,
    ) as PublishDoc;
    const shared = sanitizeSharedDoc(doc);
    const text = JSON.stringify(shared);
    expect(text).not.toContain(SALT);
    expect(text).not.toContain(HASH);
    expect((shared.blocks[0] as { lock?: unknown }).lock).toEqual({
      kind: "code",
      salt: "",
      hash: "",
    });
    const out = renderToStaticMarkup(
      createElement(PageRenderer, {
        doc: shared,
        pageId: PAGE_ID,
        mode: "preview",
        inertEmbeds: true,
      }),
    );
    expect(out).toContain('data-locked="code"');
    expect(out).not.toContain(HASH);
    // the original document is not changed
    expect(JSON.stringify(doc)).toContain(HASH);
  });
});
