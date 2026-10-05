import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { RESERVED_PATHS, RESERVED_PATH_PREFIX } from "@/lib/document/path";

/**
 * M11-12 (Wave M1 security review): facts about the three wave migrations that only a source check
 * can hold. The behaviour is in supabase/tests/database/178-site-review-fixes.test.sql.
 */

const sql = (name: string) => readFileSync(`supabase/migrations/${name}`, "utf8");
const SITE_PAGES = sql("20261011000001_site_pages.sql");
const PUBLISH = sql("20261011000003_publish_site.sql");

describe("the reserved paths in SQL equal RESERVED_PATHS", () => {
  const check = SITE_PAGES.match(
    /constraint site_pages_live_path_not_reserved check \(([\s\S]*?)\n  \)\n/,
  )?.[1];

  it("the check exists", () => {
    expect(check).toBeDefined();
  });

  it("lists exactly the paths of src/lib/document/path.ts (so the two cannot drift)", () => {
    const list = check!.match(/live_path not in \(([\s\S]*?)\)/)?.[1] ?? "";
    const sqlPaths = [...list.matchAll(/'([^']+)'/g)].map((m) => m[1]!);
    expect([...sqlPaths].sort()).toEqual([...RESERVED_PATHS].sort());
  });

  it("and the hl- prefix", () => {
    expect(check).toContain(`live_path not like '${RESERVED_PATH_PREFIX}%'`);
  });
});

describe("publish_site locks the site row without blocking foreign-key checks", () => {
  it("uses FOR NO KEY UPDATE on the pages row, never FOR UPDATE", () => {
    const body = PUBLISH.slice(PUBLISH.indexOf("create function public.publish_site"));
    expect(body).toMatch(
      /from public\.pages p\s+where p\.id = p_page_id and p\.owner_id = p_owner_id\s+for no key update;/,
    );
    // The sub-page rows are the only FOR UPDATE left (nothing references them).
    expect(body.match(/for update/g)).toHaveLength(1);
    expect(body).toMatch(/from public\.site_pages where page_id = p_page_id for update/);
  });
});

describe("lock order and after-row accounting", () => {
  const firstDelete = SITE_PAGES.slice(
    SITE_PAGES.indexOf("create function public.media_queue_site_refs_on_page_delete"),
    SITE_PAGES.indexOf("create trigger pages_queue_deleted_site_page_media"),
  );
  it("the first BEFORE DELETE trigger on pages locks the site's sub-page rows, in id order", () => {
    expect(firstDelete).toContain(
      "perform 1 from public.site_pages where page_id = old.id order by id for update;",
    );
    // The lock is the first statement, before anything else in the body.
    expect(firstDelete.indexOf("perform 1 from public.site_pages")).toBeLessThan(
      firstDelete.indexOf("insert into public.image_cleanup_queue"),
    );
  });

  it("the byte release trigger sorts after it, so its sum is read after the lock", () => {
    const names = ["pages_queue_deleted_site_page_media", "pages_release_site_page_bytes"];
    expect([...names].reverse().sort()).toEqual(names);
    for (const name of names)
      expect(SITE_PAGES).toMatch(
        new RegExp(`create trigger ${name}\\s+before delete on public.pages`),
      );
  });

  it("no other BEFORE DELETE trigger on pages sorts earlier", () => {
    const names = [
      ...SITE_PAGES.matchAll(/create trigger (\w+)\s+before delete on public\.pages/g),
    ].map((m) => m[1]!);
    expect([...names].sort()[0]).toBe("pages_queue_deleted_site_page_media");
  });

  it("the byte total is kept by an AFTER ROW trigger and page_id is immutable", () => {
    expect(SITE_PAGES).toMatch(
      /create trigger site_pages_byte_cap\s+after insert or update of draft, published or delete on public\.site_pages/,
    );
    expect(SITE_PAGES).toMatch(
      /create trigger site_pages_page_id_immutable\s+before update of page_id on public\.site_pages/,
    );
  });
});

describe("the byte cap", () => {
  it("is 64 MiB, raises HL009 and fires after the page-limit trigger so its lock is last", () => {
    expect(SITE_PAGES).toContain("c_cap constant bigint := 67108864");
    expect(SITE_PAGES).toContain("using errcode = 'HL009'");
    // Triggers fire in name order: enforce_site_page_limit < set_updated_at < site_pages_byte_cap.
    expect(["enforce_site_page_limit", "set_updated_at", "site_pages_byte_cap"]).toEqual(
      ["site_pages_byte_cap", "enforce_site_page_limit", "set_updated_at"].sort(),
    );
  });
});
