import { describe, expect, it } from "vitest";
import {
  PENDING_TEMPLATE_KEY,
  PENDING_TEMPLATE_MAX_AGE_MS,
  consumePendingTemplate,
  setPendingTemplate,
} from "@/lib/site-templates/pending";
import { SITE_TEMPLATE_IDS } from "@/lib/site-templates/catalog";

/** M12-03 review: a template is applied only from the one-shot flag the new-site form sets, once. */

function memory() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

describe("the pending template flag", () => {
  const id = SITE_TEMPLATE_IDS[0]!;

  it("is consumed exactly once", () => {
    const store = memory();
    setPendingTemplate(id, 1000, store);
    expect(consumePendingTemplate(1500, store)).toBe(id);
    expect(consumePendingTemplate(1600, store)).toBeNull();
    expect(store.map.size).toBe(0);
  });

  it("is nothing when never set (a ?template= link sets no flag)", () => {
    expect(consumePendingTemplate(1000, memory())).toBeNull();
  });

  it("is dropped, and cleared, when stale", () => {
    const store = memory();
    setPendingTemplate(id, 1000, store);
    expect(consumePendingTemplate(1000 + PENDING_TEMPLATE_MAX_AGE_MS + 1, store)).toBeNull();
    expect(store.map.size).toBe(0);
  });

  it("ignores junk and unknown ids", () => {
    for (const raw of ["not json", "null", '{"id":"evil","at":1000}', '{"id":1,"at":1000}', "[]"]) {
      const store = memory();
      store.setItem(PENDING_TEMPLATE_KEY, raw);
      expect(consumePendingTemplate(1100, store)).toBeNull();
    }
  });

  it("survives blocked storage", () => {
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    expect(() => setPendingTemplate(id, 1, broken)).not.toThrow();
    expect(consumePendingTemplate(1, broken)).toBeNull();
    expect(consumePendingTemplate(1, null)).toBeNull();
  });
});
