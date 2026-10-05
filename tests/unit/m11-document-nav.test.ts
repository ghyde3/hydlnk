import { describe, expect, it } from "vitest";
import {
  NAV_MAX_ITEMS,
  draftDocSchema,
  publishDocSchema,
  publishNav,
  publishedDocSchema,
  resolveNav,
  toPublishForm,
  type DraftDoc,
} from "@/lib/document";
import { draftWith, fullDraft, fullPublished } from "./fixtures/page-document";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const withNav = (nav: unknown) => ({ ...(draftWith() as object), nav });

describe("M11-07 home nav", () => {
  it("old drafts without nav still parse, and stay without it", () => {
    const parsed = draftDocSchema.parse(draftWith());
    expect(parsed.nav).toBeUndefined();
    expect(publishDocSchema.safeParse(draftWith()).success).toBe(true);
  });

  it("old published documents without nav still parse", () => {
    const stored = JSON.parse(JSON.stringify(fullPublished));
    expect("nav" in stored).toBe(false);
    expect(publishedDocSchema.safeParse(stored).success).toBe(true);
  });

  it("defaults to shown with no items", () => {
    expect(draftDocSchema.parse(withNav({})).nav).toEqual({ show: true, items: [] });
    expect(resolveNav(undefined)).toEqual({ show: true, items: [] });
    expect(resolveNav({ show: false })).toEqual({ show: false, items: [] });
  });

  it("takes ordered sub-page ids", () => {
    const nav = { show: true, items: [id(2), id(1)] };
    expect(draftDocSchema.parse(withNav(nav)).nav).toEqual(nav);
  });

  it("refuses duplicates, more than 20, and non-ids", () => {
    expect(draftDocSchema.safeParse(withNav({ show: true, items: [id(1), id(1)] })).success).toBe(
      false,
    );
    const twenty = Array.from({ length: NAV_MAX_ITEMS }, (_, i) => id(i + 1));
    expect(draftDocSchema.safeParse(withNav({ show: true, items: twenty })).success).toBe(true);
    expect(
      draftDocSchema.safeParse(withNav({ show: true, items: [...twenty, id(99)] })).success,
    ).toBe(false);
    expect(draftDocSchema.safeParse(withNav({ show: true, items: ["items"] })).success).toBe(false);
    expect(draftDocSchema.safeParse(withNav({ show: "yes", items: [] })).success).toBe(false);
  });

  it("the publish form writes nav only when it is not the default", () => {
    const base = fullDraft as DraftDoc;
    expect("nav" in toPublishForm(base, null)).toBe(false);
    expect("nav" in toPublishForm({ ...base, nav: { show: true, items: [] } }, null)).toBe(false);
    expect(toPublishForm({ ...base, nav: { show: false, items: [] } }, null).nav).toEqual({
      show: false,
      items: [],
    });
    const items = [id(3), id(1)];
    const form = toPublishForm({ ...base, nav: { show: true, items } }, null);
    expect(form.nav).toEqual({ show: true, items });
    expect(publishedDocSchema.safeParse(form).success).toBe(true);
    expect(publishNav(undefined)).toBeUndefined();
  });
});
